#!/usr/bin/env python3
"""Add bilingual narration, music, subtitles and documents to the screens picture master."""
from __future__ import annotations

import array
import hashlib
import json
import math
import re
import subprocess
import sys
import textwrap
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT / "media/closa/screens-production.json"
CONFIG = json.loads(CONFIG_PATH.read_text())
SOURCE = ROOT / CONFIG["audio"]["directory"]
BUILD = ROOT / "media/closa/build-screens"
DELIVERY = ROOT / "attached_assets/closa/delivery/screens"
MASTER = BUILD / "picture-master.mp4"
SECONDS = CONFIG["duration"]
SLOT = CONFIG["shotDuration"]


def run(args: list[str]) -> str:
    result = subprocess.run(args, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f"Command failed: {args}\n{result.stderr[-6000:]}")
    return result.stdout


def ffmpeg(*args: str | Path) -> None:
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-threads", "2",
         *map(str, args)])


def probe(path: Path) -> dict:
    return json.loads(run(["ffprobe", "-v", "error", "-show_format",
                           "-show_streams", "-of", "json", str(path)]))


def duration(path: Path) -> float:
    return float(probe(path)["format"]["duration"])


def disable_default_subtitles(path: Path) -> None:
    """Clear MP4 track_enabled on the subtitle track (FFmpeg enables it anyway)."""
    changed = 0
    with path.open("r+b") as file:
        def atoms(start: int, end: int):
            pos = start
            while pos + 8 <= end:
                file.seek(pos)
                header = file.read(8)
                size, kind = int.from_bytes(header[:4], "big"), header[4:]
                header_size = 8
                if size == 1:
                    size = int.from_bytes(file.read(8), "big")
                    header_size = 16
                elif size == 0:
                    size = end - pos
                if size < header_size or pos + size > end:
                    raise ValueError("Malformed MP4 atom boundary.")
                yield kind, pos + header_size, pos + size
                pos += size

        for kind, start, end in atoms(0, path.stat().st_size):
            if kind != b"moov":
                continue
            for kind, start, end in atoms(start, end):
                if kind != b"trak":
                    continue
                children = list(atoms(start, end))
                is_subtitle = False
                for child, payload, child_end in children:
                    if child != b"mdia":
                        continue
                    for leaf, payload, _ in atoms(payload, child_end):
                        if leaf == b"hdlr":
                            file.seek(payload + 8)
                            is_subtitle = file.read(4) in (b"sbtl", b"text", b"subt")
                if not is_subtitle:
                    continue
                for child, payload, _ in children:
                    if child == b"tkhd":
                        file.seek(payload + 1)
                        flags = int.from_bytes(file.read(3), "big")
                        file.seek(payload + 1)
                        file.write((flags & ~1).to_bytes(3, "big"))
                        changed += 1
    if changed != 1:
        raise ValueError(f"Expected exactly one subtitle track, found {changed}.")
    subtitle = next(s for s in probe(path)["streams"] if s["codec_type"] == "subtitle")
    if subtitle["disposition"]["default"] or subtitle["disposition"]["forced"]:
        raise ValueError("MP4 subtitle track still defaults to on.")


def required_sources() -> None:
    required = [SOURCE / f"voice-{lang}-{i:02}.mp3"
                for lang in ("nl", "en") for i in range(1, 11)]
    required.append(SOURCE / CONFIG["audio"]["music"])
    missing = [str(path) for path in [MASTER, *required] if not path.is_file()]
    if missing:
        raise FileNotFoundError(
            "Missing screens master/audio source(s); picture rendering is not performed "
            "by this script:\n" + "\n".join(missing))
    master_info = probe(MASTER)
    video = next((s for s in master_info["streams"] if s["codec_type"] == "video"), None)
    if not video or (video["width"], video["height"]) != (1920, 1080):
        raise ValueError("picture-master.mp4 must contain a 1920x1080 video stream.")
    if abs(duration(MASTER) - SECONDS) > 0.05:
        raise ValueError(f"picture-master.mp4 must be {SECONDS} seconds.")
    rate = video.get("avg_frame_rate", "0/1").split("/")
    fps = float(rate[0]) / float(rate[1])
    if abs(fps - CONFIG["fps"]) > 0.01:
        raise ValueError(f"picture-master.mp4 must be {CONFIG['fps']} fps.")


def prepare_voice(lang: str, scene: int) -> dict:
    source = SOURCE / f"voice-{lang}-{scene:02}.mp3"
    clean = BUILD / f"clean-{lang}-{scene:02}.wav"
    output = BUILD / f"voice-{lang}-{scene:02}.wav"
    ffmpeg("-i", source, "-af",
           "silenceremove=start_periods=1:start_duration=0.025:start_threshold=-50dB,"
           "areverse,silenceremove=start_periods=1:start_duration=0.025:"
           "start_threshold=-50dB,areverse",
           "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", clean)
    source_duration = duration(clean)
    tempo = max(0.9, source_duration / 6.55)
    if tempo > 1.4:
        raise ValueError(
            f"Narration {lang}/{scene:02} is too long ({source_duration:.2f}s); "
            "rewrite or regenerate it instead of forcing an unnatural read.")
    ffmpeg("-i", clean, "-af",
           f"atempo={tempo:.8f},loudnorm=I=-18:TP=-3:LRA=7,"
           "afade=t=in:st=0:d=0.015",
           "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", output)
    actual_duration = duration(output)
    if actual_duration > 6.65:
        raise ValueError(f"Narration {lang}/{scene:02} exceeds its slot.")
    return {"lang": lang, "scene": scene,
            "source": str(source.relative_to(ROOT)),
            "file": str(output.relative_to(ROOT)),
            "start": (scene - 1) * SLOT + 0.5,
            "duration": actual_duration,
            "sourceDuration": source_duration, "tempo": tempo}


def silence_centres(path: Path) -> list[float]:
    with wave.open(str(path), "rb") as wav:
        if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise ValueError(f"Expected mono 16-bit timing WAV: {path}")
        rate = wav.getframerate()
        samples = array.array("h", wav.readframes(wav.getnframes()))
    window, spans, start = int(rate * 0.02), [], None
    for offset in range(0, len(samples), window):
        chunk = samples[offset:offset + window]
        rms = math.sqrt(sum(x * x for x in chunk) / max(1, len(chunk)))
        quiet, moment = rms < 180, offset / rate
        if quiet and start is None:
            start = moment
        elif not quiet and start is not None:
            if moment - start >= 0.1:
                spans.append((start + moment) / 2)
            start = None
    return spans


def stamp(seconds: float, separator: str = ",") -> str:
    total = round(seconds * 1000)
    hours, rem = divmod(total, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, millis = divmod(rem, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02}{separator}{millis:03}"


def write_subtitles(voices: list[dict]) -> list[dict]:
    cues = []
    english = sorted((v for v in voices if v["lang"] == "en"),
                     key=lambda v: v["scene"])
    for info in english:
        text = CONFIG["narration"][info["scene"] - 1]
        dutch_sentences = re.split(r"(?<=[.!?])\s+", text["nl"])
        english_sentences = re.split(r"(?<=[.!?])\s+", text["en"])
        if len(dutch_sentences) != len(english_sentences):
            raise ValueError(f"Sentence correspondence missing in scene {info['scene']}.")
        start, length = info["start"], info["duration"]
        finish = min(info["scene"] * SLOT - 0.15, start + max(length + 0.3, 3.2))
        boundaries = [start]
        if len(english_sentences) == 2:
            expected = length * len(english_sentences[0]) / sum(map(len, english_sentences))
            gaps = [g for g in silence_centres(ROOT / info["file"])
                    if 1 < g < length - 0.8]
            split = min(gaps, key=lambda g: abs(g - expected)) if gaps else expected
            if abs(split - expected) > 1:
                split = expected
            boundaries.append(max(start + 1.25, min(start + split, finish - 1.25)))
        boundaries.append(finish)
        for index, sentence in enumerate(dutch_sentences):
            parts = textwrap.wrap(sentence, width=80)
            total_chars = sum(map(len, parts))
            cursor, available = boundaries[index], boundaries[index + 1] - boundaries[index]
            for part in parts:
                wrapped = textwrap.wrap(part, width=45)
                if len(wrapped) > 2:
                    raise ValueError(f"Subtitle exceeds two lines: {part}")
                end = cursor + available * len(part) / total_chars
                cues.append({"start": round(cursor, 3), "end": round(end - 0.02, 3),
                             "text": "\n".join(wrapped), "scene": info["scene"]})
                cursor = end
    for index, cue in enumerate(cues):
        if not (0 <= cue["start"] < cue["end"] <= SECONDS):
            raise ValueError("Invalid subtitle timing.")
        if index and cues[index - 1]["end"] > cue["start"]:
            raise ValueError("Overlapping subtitle timing.")
    srt = "\n\n".join(
        f"{i}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}"
        for i, c in enumerate(cues, 1)) + "\n"
    vtt = "WEBVTT\n\n" + "\n\n".join(
        f"{stamp(c['start'], '.')} --> {stamp(c['end'], '.')} "
        f"line:2% position:50% align:center size:90%\n{c['text']}"
        for c in cues) + "\n"
    (DELIVERY / "closa-en-nl.srt").write_text(srt)
    (DELIVERY / "closa-en-nl.vtt").write_text(vtt)
    (BUILD / "subtitle-cues.json").write_text(json.dumps(cues, indent=2) + "\n")
    return cues


def mix_audio(lang: str, voices: list[dict]) -> Path:
    selected = sorted((v for v in voices if v["lang"] == lang),
                      key=lambda v: v["scene"])
    inputs: list[str | Path] = []
    for voice in selected:
        inputs.extend(["-i", ROOT / voice["file"]])
    inputs.extend(["-i", SOURCE / CONFIG["audio"]["music"]])
    filters = [f"[{i}:a]adelay={round(v['start'] * 1000)}:all=1[v{i}]"
               for i, v in enumerate(selected)]
    filters += [
        f"[{len(selected)}:a]atrim=0:{SECONDS},asetpts=PTS-STARTPTS,"
        "loudnorm=I=-30:TP=-9:LRA=7,afade=t=in:st=0:d=1.2,"
        f"afade=t=out:st={SECONDS - 2.5}:d=2.5[music]",
        "".join(f"[v{i}]" for i in range(len(selected))) +
        f"[music]amix=inputs={len(selected) + 1}:duration=longest:normalize=0,"
        f"apad=whole_dur={SECONDS},atrim=0:{SECONDS}[a]",
    ]
    output = BUILD / f"mix-{lang}.wav"
    ffmpeg(*inputs, "-filter_complex_threads", "1",
           "-filter_complex", ";".join(filters), "-map", "[a]",
           "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le", output)
    return output


def export(lang: str, mix: Path) -> Path:
    output = DELIVERY / f"closa-{lang}-1080p.mp4"
    args: list[str | Path] = ["-i", MASTER, "-i", mix]
    if lang == "en":
        args += ["-i", DELIVERY / "closa-en-nl.srt"]
    args += ["-map", "0:v:0", "-map", "1:a:0"]
    if lang == "en":
        args += ["-map", "2:0", "-c:s", "mov_text",
                 "-metadata:s:s:0", "language=nld",
                 "-metadata:s:s:0", "title=Nederlands (optioneel)",
                 "-disposition:s:0", "0"]
    args += ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
             "-metadata:s:a:0", f"language={'nld' if lang == 'nl' else 'eng'}",
             "-metadata", f"title={CONFIG['title']}",
             "-metadata", "comment=User-supplied application screenshots and logo; "
             "AI-generated people, property footage, narration and music. "
             "Screens and application behavior not independently verified.",
             "-t", str(SECONDS), "-movflags", "+faststart", output]
    ffmpeg(*args)
    if lang == "en":
        disable_default_subtitles(output)
    return output


def main() -> None:
    required_sources()
    BUILD.mkdir(parents=True, exist_ok=True)
    DELIVERY.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        voices = list(pool.map(lambda item: prepare_voice(*item),
                               [(lang, scene) for lang in ("nl", "en")
                                for scene in range(1, 11)]))
    cues = write_subtitles(voices)
    outputs = {}
    for lang in ("nl", "en"):
        output = export(lang, mix_audio(lang, voices))
        outputs[output.name] = {
            "bytes": output.stat().st_size,
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            "probe": probe(output),
        }
        print(f"Exported {output}", flush=True)
    receipt = {"specification": CONFIG, "voices": voices, "subtitles": cues,
               "outputs": outputs}
    receipt_path = BUILD / "production-receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    run([sys.executable, str(ROOT / "media/closa/document-screens.py"),
         "--receipt", str(receipt_path)])
    print("Screens audio, subtitle and document delivery complete.", flush=True)


if __name__ == "__main__":
    main()