#!/usr/bin/env python3
"""Reproduce the Closa film exports from the generated source footage/audio."""
from __future__ import annotations

import array
import argparse
import hashlib
import json
import math
import re
import subprocess
import textwrap
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads((ROOT / "media/closa/production.json").read_text())
SOURCE = ROOT / "attached_assets/closa/source"
BUILD = ROOT / "media/closa/build"
DELIVERY = ROOT / "attached_assets/closa/delivery"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SECONDS = CONFIG["duration"]
SLOT = CONFIG["shotDuration"]
BUILD.mkdir(parents=True, exist_ok=True)
DELIVERY.mkdir(parents=True, exist_ok=True)


def run(args: list[str]) -> str:
    result = subprocess.run(args, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f"Command failed: {args}\n{result.stderr[-6000:]}")
    return result.stdout


def ffmpeg(*args: str) -> None:
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-threads", "2", *map(str, args)])


def probe(path: Path) -> dict:
    return json.loads(run(["ffprobe", "-v", "error", "-show_format",
                          "-show_streams", "-of", "json", str(path)]))


def duration(path: Path) -> float:
    return float(probe(path)["format"]["duration"])


def disable_default_subtitles(path: Path) -> None:
    """Clear MP4 track_enabled for subtitles, preserving selectable text samples.

    This FFmpeg MOV muxer enables the first track of each type even when
    -disposition:s:0 0 was supplied. Set the container flag explicitly, then
    verify the demuxer's resulting default/forced dispositions.
    """
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
                    if child == b"mdia":
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
    required = [SOURCE / f"shot-{i:02}.mp4" for i in range(1, 11)]
    required += [SOURCE / f"voice-{lang}-{i:02}.mp3"
                 for lang in ("nl", "en") for i in range(1, 11)]
    required += [SOURCE / "music.mp3"]
    missing = [str(p) for p in required if not p.is_file()]
    if missing:
        raise FileNotFoundError("Missing production sources:\n" + "\n".join(missing))
    for path in required[:10]:
        info = probe(path)
        video = next(s for s in info["streams"] if s["codec_type"] == "video")
        if (video["width"], video["height"]) != (1920, 1080):
            raise ValueError(f"Expected native 1080p footage: {path}")
        if float(info["format"]["duration"]) < 7.7:
            raise ValueError(f"Source shot is too short: {path}")


def prepare_shot(i: int) -> Path:
    dest = BUILD / f"shot-{i:02}.mp4"
    filters = ["fps=24", "setsar=1", "format=yuv420p"]
    if i == 10:
        # A plain typeset name, explicitly not a fabricated official logo.
        filters += [
            "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.23:t=fill",
            f"drawtext=fontfile={FONT}:text='Closa':fontsize=94:"
            "fontcolor=white:x=(w-tw)/2:y=(h-th)/2:"
            "shadowcolor=black@0.3:shadowx=1:shadowy=2",
        ]
    ffmpeg("-ss", "0.2", "-i", SOURCE / f"shot-{i:02}.mp4",
           "-t", str(SLOT), "-an", "-vf", ",".join(filters),
           "-c:v", "libx264", "-preset", "fast", "-crf", "19",
           "-threads", "2", "-g", "48", "-video_track_timescale", "12288",
           "-movflags", "+faststart", dest)
    print(f"Picture shot {i:02} ready", flush=True)
    return dest


def prepare_voice(lang: str, i: int) -> dict:
    cleaned = BUILD / f"clean-{lang}-{i:02}.wav"
    dest = BUILD / f"voice-{lang}-{i:02}.wav"
    ffmpeg("-i", SOURCE / f"voice-{lang}-{i:02}.mp3",
           "-af", "silenceremove=start_periods=1:start_duration=0.025:"
           "start_threshold=-50dB,areverse,"
           "silenceremove=start_periods=1:start_duration=0.025:"
           "start_threshold=-50dB,areverse",
           "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", cleaned)
    raw_duration = duration(cleaned)
    # Keep the read natural; a long source read speeds up to fit the fixed slot.
    tempo = max(0.9, raw_duration / 6.55)
    if tempo > 1.4:
        raise ValueError(f"Narration {lang}/{i} is too long; rewrite it first.")
    ffmpeg("-i", cleaned, "-af",
           f"atempo={tempo:.8f},loudnorm=I=-18:TP=-3:LRA=7,"
           "afade=t=in:st=0:d=0.015",
           "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", dest)
    actual_duration = duration(dest)
    if actual_duration > 6.65:
        raise ValueError(f"Narration exceeds its slot: {lang}/{i}")
    return {"lang": lang, "scene": i, "file": str(dest.relative_to(ROOT)),
            "start": (i - 1) * SLOT + 0.5, "duration": actual_duration,
            "sourceDuration": raw_duration, "tempo": tempo}


def silence_centres(path: Path) -> list[float]:
    """Locate phrase gaps from amplitude, without sending generated audio to AI."""
    with wave.open(str(path), "rb") as wav:
        assert wav.getnchannels() == 1 and wav.getsampwidth() == 2
        rate = wav.getframerate()
        samples = array.array("h", wav.readframes(wav.getnframes()))
    window = int(rate * 0.02)
    spans, start = [], None
    for offset in range(0, len(samples), window):
        chunk = samples[offset:offset + window]
        rms = math.sqrt(sum(x * x for x in chunk) / max(1, len(chunk)))
        quiet = rms < 180
        t = offset / rate
        if quiet and start is None:
            start = t
        elif not quiet and start is not None:
            if t - start >= 0.1:
                spans.append((start + t) / 2)
            start = None
    return spans


def stamp(seconds: float, separator: str = ",") -> str:
    total = round(seconds * 1000)
    hours, rem = divmod(total, 3600000)
    minutes, rem = divmod(rem, 60000)
    secs, ms = divmod(rem, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02}{separator}{ms:03}"


def write_subtitles(voice_data: list[dict]) -> list[dict]:
    cues = []
    for info in sorted((x for x in voice_data if x["lang"] == "en"),
                       key=lambda x: x["scene"]):
        line = CONFIG["narration"][info["scene"] - 1]
        nl = re.split(r"(?<=[.!?])\s+", line["nl"])
        en = re.split(r"(?<=[.!?])\s+", line["en"])
        if len(nl) != len(en):
            raise ValueError("Sentence correspondence is required for subtitle timing.")
        start, length = info["start"], info["duration"]
        finish = min((info["scene"] - 1) * SLOT + 7.35,
                     start + max(length + 0.3, 3.2))
        boundaries = [start]
        if len(en) == 2:
            fraction = len(en[0]) / (len(en[0]) + len(en[1]))
            expected = length * fraction
            gaps = [g for g in silence_centres(ROOT / info["file"])
                    if 1.0 < g < length - 0.8]
            nearest = min(gaps, key=lambda g: abs(g - expected)) if gaps else expected
            if abs(nearest - expected) > 1.0:
                nearest = expected
            # Minimum subtitle reading time at either side of the sentence break.
            split = max(start + 1.25, min(start + nearest, finish - 1.25))
            boundaries.append(split)
        boundaries.append(finish)
        for j, sentence in enumerate(nl):
            # Split long sentences into sequential cues, never three-line blocks.
            parts = textwrap.wrap(sentence, width=80)
            total_chars = sum(len(part) for part in parts)
            cursor = boundaries[j]
            available = boundaries[j + 1] - boundaries[j]
            for part in parts:
                wrapped = textwrap.wrap(part, width=45)
                if len(wrapped) > 2:
                    raise ValueError(f"Subtitle exceeds two lines: {part}")
                end = cursor + available * len(part) / total_chars
                cues.append({"start": round(cursor, 3),
                             "end": round(end - 0.02, 3),
                             "text": "\n".join(wrapped)})
                cursor = end
    for i, cue in enumerate(cues):
        if not (0 <= cue["start"] < cue["end"] <= SECONDS):
            raise ValueError("Invalid subtitle time.")
        if i and cues[i - 1]["end"] > cue["start"]:
            raise ValueError("Overlapping subtitle times.")
    srt = "\n\n".join(f"{i}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}"
                      for i, c in enumerate(cues, 1)) + "\n"
    vtt = "WEBVTT\n\n" + "\n\n".join(
        f"{stamp(c['start'], '.')} --> {stamp(c['end'], '.')}\n{c['text']}"
        for c in cues) + "\n"
    (DELIVERY / "closa-en-nl.srt").write_text(srt)
    (DELIVERY / "closa-en-nl.vtt").write_text(vtt)
    (BUILD / "subtitle-cues.json").write_text(json.dumps(cues, indent=2))
    return cues


def mix_audio(lang: str, voices: list[dict]) -> Path:
    sources = sorted((x for x in voices if x["lang"] == lang),
                     key=lambda x: x["scene"])
    args = []
    for info in sources:
        args += ["-i", str(ROOT / info["file"])]
    args += ["-i", str(SOURCE / "music.mp3")]
    filters = [
        f"[{i}:a]adelay={round(info['start'] * 1000)}:all=1[v{i}]"
        for i, info in enumerate(sources)
    ]
    filters += [
        "[10:a]atrim=0:75,asetpts=PTS-STARTPTS,"
        "loudnorm=I=-30:TP=-9:LRA=7,"
        "afade=t=in:st=0:d=1.2,afade=t=out:st=72.5:d=2.5[music]",
        "".join(f"[v{i}]" for i in range(10)) +
        "[music]amix=inputs=11:duration=longest:normalize=0,"
        "apad=whole_dur=75,atrim=0:75[a]",
    ]
    dest = BUILD / f"mix-{lang}.wav"
    ffmpeg(*args, "-filter_complex_threads", "1",
           "-filter_complex", ";".join(filters), "-map", "[a]",
           "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le", dest)
    return dest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reuse-picture", action="store_true",
                        help="Reuse the completed master ONLY when footage/branding are unchanged.")
    args = parser.parse_args()
    required_sources()
    master = BUILD / "picture-master.mp4"
    if args.reuse_picture:
        if not master.is_file() or abs(duration(master) - SECONDS) > 0.05:
            raise ValueError("No complete picture master available to reuse.")
    else:
        with ThreadPoolExecutor(max_workers=2) as pool:
            shots = list(pool.map(prepare_shot, range(1, 11)))
        concat = BUILD / "shots.txt"
        concat.write_text("".join(f"file '{p.as_posix()}'\n" for p in shots))
        ffmpeg("-f", "concat", "-safe", "0", "-i", concat, "-map", "0:v:0",
               "-c:v", "copy", "-an", "-movflags", "+faststart", master)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(prepare_voice, lang, i)
                   for lang in ("nl", "en") for i in range(1, 11)]
        voices = [f.result() for f in futures]
    cues = write_subtitles(voices)
    for lang in ("nl", "en"):
        mix = mix_audio(lang, voices)
        dest = DELIVERY / f"closa-{lang}-1080p.mp4"
        args = ["-i", str(master), "-i", str(mix)]
        if lang == "en":
            args += ["-i", str(DELIVERY / "closa-en-nl.srt")]
        args += ["-map", "0:v:0", "-map", "1:a:0"]
        if lang == "en":
            args += ["-map", "2:0", "-c:s", "mov_text",
                     "-metadata:s:s:0", "language=nld",
                     "-metadata:s:s:0", "title=Nederlands (optioneel)",
                     "-disposition:s:0", "0"]
        args += [
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-metadata:s:a:0", f"language={'nld' if lang == 'nl' else 'eng'}",
            "-metadata", "title=Closa — vastgoed en vertrouwen",
            "-metadata", "comment=AI-generated footage, voice and music. "
            "Plain name only; official branding not supplied.",
            "-t", "75", "-movflags", "+faststart", str(dest),
        ]
        ffmpeg(*args)
        if lang == "en":
            disable_default_subtitles(dest)
        print(f"Exported {dest.name}", flush=True)
    receipt = {"specification": CONFIG, "voices": voices, "subtitles": cues,
               "outputs": {}}
    for path in sorted(DELIVERY.glob("*.mp4")):
        receipt["outputs"][path.name] = {
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "probe": probe(path),
        }
    (BUILD / "production-receipt.json").write_text(json.dumps(receipt, indent=2))
    print("Montage complete.", flush=True)


if __name__ == "__main__":
    main()