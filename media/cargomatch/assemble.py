#!/usr/bin/env python3
"""Assemble the CargoMatch English-narration/Dutch-subtitle master."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MEDIA_DIR = ROOT / "media" / "cargomatch"
PRODUCTION_PATH = MEDIA_DIR / "production.json"
AUDIO_MANIFEST_PATH = MEDIA_DIR / "audio-manifest.json"
DEFAULT_PICTURE = MEDIA_DIR / "build" / "picture-master.mp4"
DEFAULT_DELIVERY = ROOT / "attached_assets" / "cargomatch" / "delivery"
EXPECTED_DURATION = 168.0
VOICE_OFFSET = 0.6
MAX_VOICE_DURATION = 6.15
MAX_TEMPO = 1.15


def fail(message: str) -> "NoReturn":
    raise RuntimeError(message)


def run(command: list[str], *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )
    if result.returncode:
        detail = (result.stderr or result.stdout or "").strip()
        fail(f"Command failed ({result.returncode}): {' '.join(command)}\n{detail}")
    return result


def require_tools() -> None:
    missing = [name for name in ("ffmpeg", "ffprobe") if not shutil.which(name)]
    if missing:
        fail("Missing required executable(s): " + ", ".join(missing))


def probe(path: Path) -> dict:
    result = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(path),
        ],
        capture=True,
    )
    return json.loads(result.stdout)


def duration_of(path: Path) -> float:
    data = probe(path)
    try:
        return float(data["format"]["duration"])
    except (KeyError, TypeError, ValueError):
        fail(f"Could not determine duration: {path}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_loudnorm(stderr: str) -> dict:
    matches = re.findall(r"\{\s*\"input_i\".*?\}", stderr, flags=re.DOTALL)
    if not matches:
        fail("FFmpeg did not return loudnorm JSON.")
    return json.loads(matches[-1])


def loudnorm_measure(path: Path, target_i: float, target_tp: float, lra: float = 7.0) -> dict:
    result = run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(path),
            "-af",
            f"loudnorm=I={target_i}:TP={target_tp}:LRA={lra}:print_format=json",
            "-f",
            "null",
            "-",
        ],
        capture=True,
    )
    return parse_loudnorm(result.stderr)


def normalize_file(
    source: Path,
    destination: Path,
    target_i: float,
    target_tp: float,
    *,
    trim_silence: bool = False,
    tempo: float = 1.0,
    duration: float | None = None,
) -> dict:
    filters: list[str] = []
    if trim_silence:
        filters.append(
            "silenceremove="
            "start_periods=1:start_duration=0.03:start_threshold=-45dB"
        )
        filters.extend(
            [
                "areverse",
                "silenceremove=start_periods=1:start_duration=0.08:start_threshold=-45dB",
                "areverse",
            ]
        )
    if tempo > 1.00001:
        filters.append(f"atempo={tempo:.8f}")
    if duration is not None:
        filters.append(f"atrim=duration={duration:.6f}")
    filters.extend(["aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=stereo"])

    with tempfile.TemporaryDirectory(prefix="cargomatch-norm-") as temp_name:
        prepared = Path(temp_name) / "prepared.wav"
        run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(source),
                "-af",
                ",".join(filters),
                "-c:a",
                "pcm_s24le",
                str(prepared),
            ]
        )
        measured = loudnorm_measure(prepared, target_i, target_tp)
        linear = (
            f"loudnorm=I={target_i}:TP={target_tp}:LRA=7:"
            f"measured_I={measured['input_i']}:"
            f"measured_LRA={measured['input_lra']}:"
            f"measured_TP={measured['input_tp']}:"
            f"measured_thresh={measured['input_thresh']}:"
            f"offset={measured['target_offset']}:linear=true:print_format=summary"
        )
        destination.parent.mkdir(parents=True, exist_ok=True)
        run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(prepared),
                "-af",
                linear,
                "-ar",
                "48000",
                "-ac",
                "2",
                "-c:a",
                "pcm_s24le",
                str(destination),
            ]
        )
    return measured


def silence_centres(path: Path) -> list[float]:
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(path),
            "-af",
            "silencedetect=noise=-38dB:d=0.07",
            "-f",
            "null",
            "-",
        ],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode:
        fail(f"Silence detection failed for {path}:\n{result.stderr}")
    starts = [float(value) for value in re.findall(r"silence_start: ([0-9.]+)", result.stderr)]
    ends = [float(value) for value in re.findall(r"silence_end: ([0-9.]+)", result.stderr)]
    centres: list[float] = []
    end_index = 0
    for start in starts:
        while end_index < len(ends) and ends[end_index] < start:
            end_index += 1
        if end_index < len(ends):
            centres.append((start + ends[end_index]) / 2.0)
            end_index += 1
    return centres


def split_sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+", text.strip()) if part.strip()]


def wrap_subtitle(text: str) -> list[str]:
    lines = textwrap.wrap(
        text,
        width=58,
        break_long_words=False,
        break_on_hyphens=False,
        replace_whitespace=True,
    )
    if len(lines) > 2 or any(len(line) > 58 for line in lines):
        fail(f"Dutch subtitle exceeds two lines of 58 characters: {text!r}")
    return lines


def make_slot_cues(item: dict, voice_duration: float, silences: list[float], total: float) -> list[dict]:
    english = split_sentences(item["en"])
    dutch = split_sentences(item["nl"])
    if len(english) != len(dutch):
        english, dutch = [item["en"]], [item["nl"]]

    weights = [max(1, len(re.sub(r"\W", "", sentence))) for sentence in english]
    boundaries = [0.0]
    running = 0
    for weight in weights[:-1]:
        running += weight
        proposed = voice_duration * running / sum(weights)
        nearby = [point for point in silences if abs(point - proposed) <= 0.45]
        snapped = min(nearby, key=lambda point: abs(point - proposed)) if nearby else proposed
        minimum = boundaries[-1] + 0.65
        maximum = voice_duration - 0.65 * (len(weights) - len(boundaries))
        boundaries.append(max(minimum, min(snapped, maximum)))
    boundaries.append(voice_duration)

    units = [
        {
            "en": english[index],
            "nl": dutch[index],
            "localStart": boundaries[index],
            "localEnd": boundaries[index + 1],
        }
        for index in range(len(english))
    ]

    merged: list[dict] = []
    unit_index = 0
    while unit_index < len(units):
        unit = units[unit_index]
        short = unit["localEnd"] - unit["localStart"] < 0.9
        if short and merged:
            candidate = merged[-1]["nl"] + " " + unit["nl"]
            if len(textwrap.wrap(candidate, width=58, break_long_words=False)) <= 2:
                merged[-1]["en"] += " " + unit["en"]
                merged[-1]["nl"] = candidate
                merged[-1]["localEnd"] = unit["localEnd"]
                unit_index += 1
                continue
        if short and not merged and unit_index + 1 < len(units):
            following = units[unit_index + 1]
            candidate = unit["nl"] + " " + following["nl"]
            if len(textwrap.wrap(candidate, width=58, break_long_words=False)) <= 2:
                merged.append(
                    {
                        "en": unit["en"] + " " + following["en"],
                        "nl": candidate,
                        "localStart": unit["localStart"],
                        "localEnd": following["localEnd"],
                    }
                )
                unit_index += 2
                continue
        merged.append(unit)
        unit_index += 1

    slot_start = (item["id"] - 1) * 7.0
    read_start = slot_start + VOICE_OFFSET
    slot_limit = min(slot_start + 6.75, total - 1.05)
    cues: list[dict] = []
    previous_end = read_start
    for index, unit in enumerate(merged):
        start = max(previous_end, read_start + unit["localStart"])
        end = min(slot_limit, read_start + unit["localEnd"] + 0.18)
        if end - start < 0.75:
            end = min(slot_limit, start + 0.75)
        if end <= start:
            fail(f"No readable subtitle duration remains in slot {item['id']}.")
        lines = wrap_subtitle(unit["nl"])
        cues.append(
            {
                "slotId": item["id"],
                "sentence": index + 1,
                "start": round(start, 3),
                "end": round(end, 3),
                "english": unit["en"],
                "dutch": unit["nl"],
                "lines": lines,
            }
        )
        previous_end = end
    return cues


def srt_time(seconds: float) -> str:
    milliseconds = int(round(seconds * 1000))
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    secs, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"


def ass_time(seconds: float) -> str:
    centiseconds = int(round(seconds * 100))
    hours, centiseconds = divmod(centiseconds, 360_000)
    minutes, centiseconds = divmod(centiseconds, 6_000)
    secs, centiseconds = divmod(centiseconds, 100)
    return f"{hours:d}:{minutes:02d}:{secs:02d}.{centiseconds:02d}"


def ass_escape(text: str) -> str:
    return text.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")


def write_subtitles(cues: list[dict], delivery: Path) -> tuple[Path, Path, Path]:
    delivery.mkdir(parents=True, exist_ok=True)
    srt_path = delivery / "cargomatch-nl.srt"
    ass_path = delivery / "cargomatch-nl.ass"
    cues_path = delivery / "subtitle-cues.json"

    srt_blocks = []
    ass_events = []
    for number, cue in enumerate(cues, 1):
        subtitle = "\n".join(cue["lines"])
        srt_blocks.append(
            f"{number}\n{srt_time(cue['start'])} --> {srt_time(cue['end'])}\n{subtitle}\n"
        )
        ass_events.append(
            "Dialogue: 0,"
            f"{ass_time(cue['start'])},{ass_time(cue['end'])},Dutch,,0,0,0,,"
            + r"\N".join(ass_escape(line) for line in cue["lines"])
        )

    srt_path.write_text("\n".join(srt_blocks), encoding="utf-8")
    ass_header = """[Script Info]
Title: CargoMatch Dutch subtitles
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Dutch,DejaVu Sans,36,&H00FFFFFF,&H00FFFFFF,&HCC000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,2,70,70,22,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ass_path.write_text(ass_header + "\n".join(ass_events) + "\n", encoding="utf-8")
    cues_path.write_text(
        json.dumps(
            {
                "language": "nl",
                "generatedFrom": "media/cargomatch/production.json",
                "timingBasis": "Trimmed/normalized English voice reads, sentence-weight estimates snapped to detected silence",
                "cueCount": len(cues),
                "cues": cues,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return srt_path, ass_path, cues_path


def validate_picture(path: Path, production: dict) -> dict:
    if not path.is_file():
        fail(
            f"Missing picture master: {path}. Build the silent picture master first; "
            "this assembler does not substitute or synthesize missing footage."
        )
    data = probe(path)
    videos = [stream for stream in data.get("streams", []) if stream.get("codec_type") == "video"]
    audios = [stream for stream in data.get("streams", []) if stream.get("codec_type") == "audio"]
    if len(videos) != 1:
        fail(f"Picture master must contain exactly one video stream; found {len(videos)}.")
    if audios:
        fail("Picture master must be silent, but an audio stream is present.")
    video = videos[0]
    if (int(video.get("width", 0)), int(video.get("height", 0))) != (
        production["width"],
        production["height"],
    ):
        fail(
            "Picture master geometry mismatch: "
            f"{video.get('width')}x{video.get('height')}, expected "
            f"{production['width']}x{production['height']}."
        )
    frame_rate = video.get("avg_frame_rate", "0/1")
    numerator, denominator = (int(value) for value in frame_rate.split("/"))
    fps = numerator / denominator if denominator else 0
    if abs(fps - production["fps"]) > 0.01:
        fail(f"Picture master frame rate is {fps:.4f}, expected {production['fps']}.")
    measured_duration = float(data["format"]["duration"])
    if abs(measured_duration - production["duration"]) > 0.15:
        fail(
            f"Picture master duration is {measured_duration:.3f}s, "
            f"expected {production['duration']}s (tolerance 0.15s)."
        )
    return data


def validate_configuration(production: dict, manifest: dict) -> None:
    if production.get("duration") != 168 or production.get("slot") != 7:
        fail("production.json must define a 168-second film with seven-second slots.")
    if len(production.get("narration", [])) != 24:
        fail("production.json must contain exactly 24 narration slots.")
    clips = manifest.get("narration", {}).get("clips", [])
    if len(clips) != 24:
        fail("audio-manifest.json must contain exactly 24 narration clips.")
    for item, clip in zip(production["narration"], clips):
        if item["id"] != clip.get("id") or item["en"] != clip.get("text"):
            fail(f"Narration manifest mismatch at slot {item['id']}.")


def assemble(picture: Path, delivery: Path) -> None:
    require_tools()
    production = json.loads(PRODUCTION_PATH.read_text(encoding="utf-8"))
    manifest = json.loads(AUDIO_MANIFEST_PATH.read_text(encoding="utf-8"))
    validate_configuration(production, manifest)
    picture_probe = validate_picture(picture, production)
    total = float(production["duration"])

    sources = [Path(clip["file"]) for clip in manifest["narration"]["clips"]]
    music_source = Path(manifest["music"]["file"])
    port_source = Path(manifest["soundEffects"][0]["file"])
    road_source = Path(manifest["soundEffects"][1]["file"])
    required = sources + [music_source, port_source, road_source]
    missing = [str(path) for path in required if not (ROOT / path).is_file()]
    if missing:
        fail("Missing required audio asset(s):\n" + "\n".join(missing))

    delivery.mkdir(parents=True, exist_ok=True)
    output = delivery / "cargomatch-en-nl-1080p.mp4"
    receipt_path = delivery / "production-receipt.json"

    with tempfile.TemporaryDirectory(prefix="cargomatch-assembly-") as temp_name:
        temp = Path(temp_name)
        processed_voices: list[Path] = []
        voice_receipts: list[dict] = []
        all_cues: list[dict] = []

        for item, relative_source in zip(production["narration"], sources):
            source = ROOT / relative_source
            raw_duration = duration_of(source)
            clean_probe_path = temp / f"voice-{item['id']:02d}-clean.wav"
            run(
                [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-i",
                    str(source),
                    "-af",
                    "silenceremove=start_periods=1:start_duration=0.03:start_threshold=-45dB,"
                    "areverse,"
                    "silenceremove=start_periods=1:start_duration=0.08:start_threshold=-45dB,"
                    "areverse",
                    "-ar",
                    "48000",
                    "-ac",
                    "2",
                    "-c:a",
                    "pcm_s24le",
                    str(clean_probe_path),
                ]
            )
            trimmed_duration = duration_of(clean_probe_path)
            tempo = max(1.0, trimmed_duration / MAX_VOICE_DURATION)
            if tempo > MAX_TEMPO + 1e-6:
                fail(
                    f"Voice {item['id']:02d} is {trimmed_duration:.3f}s after trimming and "
                    f"would require {tempo:.4f}x tempo, above the {MAX_TEMPO:.2f}x limit."
                )
            destination = temp / f"voice-{item['id']:02d}.wav"
            loudness_input = normalize_file(
                source,
                destination,
                -18.0,
                -3.0,
                trim_silence=True,
                tempo=tempo,
            )
            final_duration = duration_of(destination)
            if final_duration > MAX_VOICE_DURATION + 0.03:
                fail(
                    f"Processed voice {item['id']:02d} is {final_duration:.3f}s; "
                    f"maximum is {MAX_VOICE_DURATION:.2f}s."
                )
            detected_silences = silence_centres(destination)
            all_cues.extend(make_slot_cues(item, final_duration, detected_silences, total))
            processed_voices.append(destination)
            voice_receipts.append(
                {
                    "id": item["id"],
                    "source": str(relative_source),
                    "sourceDurationSeconds": round(raw_duration, 6),
                    "trimmedDurationSeconds": round(trimmed_duration, 6),
                    "tempo": round(tempo, 8),
                    "processedDurationSeconds": round(final_duration, 6),
                    "timelineStartSeconds": round((item["id"] - 1) * 7 + VOICE_OFFSET, 3),
                    "detectedSilenceCentresSeconds": [round(value, 4) for value in detected_silences],
                    "normalizationTarget": {"integratedLUFS": -18, "truePeakDbTP": -3},
                    "normalizationInputMeasurement": loudness_input,
                }
            )

        srt_path, ass_path, cues_path = write_subtitles(all_cues, delivery)

        music = temp / "music.wav"
        port = temp / "port.wav"
        road = temp / "road.wav"
        music_measure = normalize_file(ROOT / music_source, music, -30.0, -3.0, duration=total)
        port_measure = normalize_file(ROOT / port_source, port, -38.0, -6.0, duration=8.0)
        road_measure = normalize_file(ROOT / road_source, road, -38.0, -6.0, duration=8.0)

        command = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(picture)]
        command += ["-i", str(music)]
        for voice in processed_voices:
            command += ["-i", str(voice)]
        command += ["-i", str(port), "-i", str(road)]

        audio_filters = [
            f"[1:a]atrim=0:{total},afade=t=in:st=0:d=1.2,"
            f"afade=t=out:st={total - 2.0}:d=2.0[music]"
        ]
        mix_labels = ["[music]"]
        for index, item in enumerate(production["narration"], start=2):
            delay = int(round(((item["id"] - 1) * 7 + VOICE_OFFSET) * 1000))
            label = f"v{item['id']:02d}"
            audio_filters.append(
                f"[{index}:a]adelay={delay}|{delay},apad,atrim=0:{total}[{label}]"
            )
            mix_labels.append(f"[{label}]")

        port_index = 26
        road_index = 27
        audio_filters.extend(
            [
                f"[{port_index}:a]atrim=0:8,afade=t=in:st=0:d=0.5,"
                "afade=t=out:st=7:d=1,adelay=200|200,apad,"
                f"atrim=0:{total}[port]",
                f"[{road_index}:a]asplit=2[roadA][roadB]",
                "[roadA]atrim=0:8,afade=t=in:st=0:d=0.5,afade=t=out:st=7:d=1,"
                f"adelay=77200|77200,apad,atrim=0:{total}[road77]",
                "[roadB]atrim=0:8,afade=t=in:st=0:d=0.5,afade=t=out:st=7:d=1,"
                f"adelay=147200|147200,apad,atrim=0:{total}[road147]",
            ]
        )
        mix_labels.extend(["[port]", "[road77]", "[road147]"])
        audio_filters.append(
            "".join(mix_labels)
            + f"amix=inputs={len(mix_labels)}:duration=longest:normalize=0,"
            f"atrim=0:{total},loudnorm=I=-16:TP=-1.5:LRA=11,"
            "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[aout]"
        )

        ass_filter_path = str(ass_path.resolve()).replace("\\", "/").replace(":", r"\:")
        video_filter = (
            "drawbox=x=0:y=930:w=1920:h=150:color=0x061421@0.95:t=fill,"
            f"ass='{ass_filter_path}',"
            "fade=t=in:st=0:d=0.8:color=black,"
            f"fade=t=out:st={total - 1.0}:d=1.0:color=black[vout]"
        )
        filter_complex = ";".join([f"[0:v]{video_filter}"] + audio_filters)
        disclosure = (
            "AI-generated people/location footage and generated narration, music and ambience; "
            "product screens use fictional demo personas/records. Introduction only, not booking. "
            "Availability is estimated; rail and air are fictional demo pilots."
        )
        command += [
            "-filter_complex_threads", "1",
            "-filter_complex",
            filter_complex,
            "-map",
            "[vout]",
            "-map",
            "[aout]",
            "-t",
            f"{total:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "20",
            "-maxrate",
            "4200k",
            "-bufsize",
            "8400k",
            "-pix_fmt",
            "yuv420p",
            "-threads",
            "2",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-movflags",
            "+faststart",
            "-metadata",
            f"title={production['title']}",
            "-metadata",
            f"description={disclosure}",
            "-metadata",
            f"comment={disclosure}",
            "-metadata",
            "language=eng",
            "-metadata:s:v:0",
            "language=eng",
            "-metadata:s:v:0",
            "title=CargoMatch picture with burned Dutch subtitles",
            "-metadata:s:a:0",
            "language=eng",
            "-metadata:s:a:0",
            "title=English narration and original score",
            str(output),
        ]
        run(command)

    output_probe = probe(output)
    output_duration = float(output_probe["format"]["duration"])
    if abs(output_duration - total) > 0.08:
        fail(f"Output duration validation failed: {output_duration:.3f}s, expected {total:.3f}s.")
    output_video = next(
        stream for stream in output_probe["streams"] if stream.get("codec_type") == "video"
    )
    output_audio = next(
        stream for stream in output_probe["streams"] if stream.get("codec_type") == "audio"
    )
    if (output_video.get("width"), output_video.get("height")) != (1920, 1080):
        fail("Output geometry validation failed.")
    if output_audio.get("sample_rate") != "48000" or output_audio.get("channels") != 2:
        fail("Output audio must be stereo 48 kHz.")

    final_loudness = loudnorm_measure(output, -16.0, -1.5, 11.0)
    receipt = {
        "production": production["title"],
        "output": str(output.relative_to(ROOT)),
        "durationSeconds": output_duration,
        "pictureSource": str(picture.relative_to(ROOT)),
        "pictureProbe": picture_probe,
        "outputProbe": output_probe,
        "hashesSha256": {
            str(path.relative_to(ROOT)): sha256(path)
            for path in [picture, *[ROOT / source for source in sources], ROOT / music_source,
                         ROOT / port_source, ROOT / road_source, srt_path, ass_path, cues_path, output]
        },
        "voiceProcessing": voice_receipts,
        "subtitleFiles": {
            "srt": str(srt_path.relative_to(ROOT)),
            "ass": str(ass_path.relative_to(ROOT)),
            "editableCues": str(cues_path.relative_to(ROOT)),
            "cueCount": len(all_cues),
            "lastCueEndSeconds": max(cue["end"] for cue in all_cues),
            "maximumLines": 2,
            "maximumCharactersPerLine": 58,
        },
        "audio": {
            "music": {
                "timelineStartSeconds": 0,
                "normalizationTargetLUFS": -30,
                "inputMeasurement": music_measure,
            },
            "portSfx": {
                "timelineStartSeconds": 0.2,
                "normalizationTargetLUFS": -38,
                "inputMeasurement": port_measure,
            },
            "roadSfx": {
                "timelineStartSeconds": [77.2, 147.2],
                "normalizationTargetLUFS": -38,
                "inputMeasurement": road_measure,
            },
            "finalTarget": {"integratedLUFS": -16, "truePeakDbTP": -1.5},
            "finalMeasurement": final_loudness,
            "sampleRateHz": 48000,
            "channels": 2,
        },
        "video": {
            "matte": {"x": 0, "y": 930, "width": 1920, "height": 150, "color": "0x061421@0.95"},
            "fadeInSeconds": 0.8,
            "fadeOutSeconds": 1.0,
            "codec": "H.264",
            "crf": 20,
            "maximumBitrateKbps": 4200,
            "bufferSizeKbits": 8400,
            "preset": "fast",
            "threads": 2,
            "pixelFormat": "yuv420p",
        },
    }
    receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Created {output.relative_to(ROOT)}")
    print(f"Created {receipt_path.relative_to(ROOT)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--picture",
        type=Path,
        default=DEFAULT_PICTURE,
        help="Silent 1920x1080/24 fps/168 s picture master",
    )
    parser.add_argument(
        "--delivery-dir",
        type=Path,
        default=DEFAULT_DELIVERY,
        help="Directory for MP4, subtitles, cues and receipt",
    )
    args = parser.parse_args()
    picture = args.picture if args.picture.is_absolute() else ROOT / args.picture
    delivery = args.delivery_dir if args.delivery_dir.is_absolute() else ROOT / args.delivery_dir
    try:
        assemble(picture.resolve(), delivery.resolve())
    except (RuntimeError, OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())