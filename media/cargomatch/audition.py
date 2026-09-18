#!/usr/bin/env python3
"""Voice/transition audition only. Never overwrites the approved original film."""
import hashlib
import json
import math
import re
import statistics
import subprocess
from pathlib import Path

from assemble import (
    ROOT, duration_of, loudnorm_measure, normalize_file, run,
    silence_centres, split_sentences, wrap_subtitle, write_subtitles,
)

OUT = ROOT / "attached_assets/cargomatch/audition"
BUILD = ROOT / "media/cargomatch/build"
FPS = 24
VOICE_OFFSET = .35


def frame_time(value):
    return round(value * FPS) / FPS


def create_cues(items, duration, silences):
    units = []
    for item in items:
        en, nl = split_sentences(item["en"]), split_sentences(item["nl"])
        assert len(en) == len(nl)
        for a, b in zip(en, nl):
            units.append({"id": item["id"], "english": a, "dutch": b})
    weights = [len(re.sub(r"\W", "", u["english"])) for u in units]
    bounds, elapsed = [0.0], 0
    for index, weight in enumerate(weights[:-1]):
        elapsed += weight
        proposed = duration * elapsed / sum(weights)
        nearby = [p for p in silences if abs(p - proposed) <= .6 and p > bounds[-1] + .9]
        point = min(nearby, key=lambda p: abs(p - proposed)) if nearby else proposed
        bounds.append(max(bounds[-1] + .9, min(point, duration - .9 * (len(units) - index - 1))))
    bounds.append(duration)
    cues = []
    for index, unit in enumerate(units):
        cues.append({
            "slotId": unit["id"], "sentence": index + 1,
            "start": round(VOICE_OFFSET + bounds[index], 3),
            "end": round(VOICE_OFFSET + bounds[index + 1], 3),
            "english": unit["english"], "dutch": unit["dutch"],
            "lines": wrap_subtitle(unit["dutch"]),
        })
    return cues


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    original = ROOT / "attached_assets/cargomatch/delivery/cargomatch-en-nl-1080p.mp4"
    original_hash = hashlib.sha256(original.read_bytes()).hexdigest()
    production = json.loads((ROOT / "media/cargomatch/production.json").read_text())
    items = [i for i in production["narration"] if 5 <= i["id"] <= 9]
    voice = OUT / "john-normalized.wav"
    normalize_file(OUT / "john-continuous.mp3", voice, -18, -3, trim_silence=True)
    voice_duration = duration_of(voice)
    total = math.ceil((VOICE_OFFSET + voice_duration + .85) * FPS) / FPS
    cues = create_cues(items, voice_duration, silence_centres(voice))
    _, ass_path, cues_path = write_subtitles(cues, OUT)
    cues_data = json.loads(cues_path.read_text())
    cues_data["timingBasis"] = "Audition estimates: continuous read weighted by sentence length and snapped to voice silences; subject to final alignment"
    cues_path.write_text(json.dumps(cues_data, ensure_ascii=False, indent=2))

    # Picture boundaries follow the read, not a fixed seven-second grid.
    boundaries = [0] + [frame_time(next(c["start"] for c in cues if c["slotId"] == i))
                        for i in range(6, 10)] + [total]
    # Context changes dissolve gently; the last same-monitor UI change takes
    # four frames only, avoiding prolonged overlaid/double UI text.
    overlaps = [12 / FPS, 12 / FPS, 12 / FPS, 4 / FPS]
    starts, lengths = [], []
    inputs, filters = [], []
    for index, item in enumerate(items):
        start = boundaries[index] - (overlaps[index - 1] / 2 if index else 0)
        end = boundaries[index + 1] + (overlaps[index] / 2 if index < 4 else 0)
        length = frame_time(end - start)
        starts.append(frame_time(start))
        lengths.append(length)
        source = BUILD / f"scene-{item['id']:02}.mp4"
        if not source.exists():
            raise FileNotFoundError(f"Rebuild preserved scene with picture.render_scene({item['id']}) first")
        source_start, source_length = (3, 4) if index == 4 else (0, 7)
        inputs += ["-ss", str(source_start), "-t", str(source_length), "-i", str(source)]
        filters.append(f"[{index}:v]settb=1/24,setpts=(PTS-STARTPTS)*{length / source_length:.9f},"
                       f"fps=24,tpad=stop_mode=clone:stop_duration=0.1,trim=duration={length:.9f},"
                       f"setpts=PTS-STARTPTS,format=yuv420p[v{index}]")
    label = "v0"
    running = lengths[0]
    transition_receipts = []
    for index in range(1, 5):
        overlap = overlaps[index - 1]
        offset = frame_time(running - overlap)
        next_label = f"blend{index}"
        filters.append(f"[{label}][v{index}]xfade=transition=fade:duration={overlap:.9f}:"
                       f"offset={offset:.9f}[{next_label}]")
        transition_receipts.append({"start": offset, "duration": overlap,
                                    "fromScene": items[index - 1]["id"], "toScene": items[index]["id"]})
        running = offset + lengths[index]
        label = next_label
    total = frame_time(running)
    music = OUT / "music-normalized.wav"
    normalize_file(ROOT / "attached_assets/cargomatch/audio/music.mp3", music, -31, -4, duration=total)
    inputs += ["-i", str(voice), "-i", str(music)]
    filters += [
        f"[{label}]drawbox=x=0:y=930:w=1920:h=150:color=0x061421@0.95:t=fill,"
        f"ass='{ass_path}',fade=t=in:st=0:d=0.4,fade=t=out:st={total - .6}:d=0.6[vout]",
        f"[5:a]adelay=350|350,apad,atrim=duration={total}[voice]",
        f"[6:a]afade=t=in:st=0:d=0.4,afade=t=out:st={total - .6}:d=0.6[music]",
        "[voice][music]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,"
        "aresample=48000[aout]",
    ]
    output = OUT / "cargomatch-stem-montageproef.mp4"
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs,
         "-filter_complex_threads", "1", "-filter_complex", ";".join(filters),
         "-map", "[vout]", "-map", "[aout]", "-t", str(total),
         "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-maxrate", "4200k",
         "-bufsize", "8400k", "-threads", "2", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart",
         "-metadata", "title=CargoMatch - voice and transition audition",
         "-metadata", "comment=Original library narrator John. Fictional demo screens and AI-generated scenes. Audition, not the final film.",
         str(output)])
    old_reads = json.loads((ROOT / "attached_assets/cargomatch/delivery/production-receipt.json").read_text())["voiceProcessing"]
    gaps = [b["timelineStartSeconds"] - a["timelineStartSeconds"] - a["processedDurationSeconds"]
            for a, b in zip(old_reads, old_reads[1:])]
    detect = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(voice),
                             "-af", "silencedetect=noise=-38dB:d=0.15", "-f", "null", "-"],
                            capture_output=True, text=True, check=True)
    pauses = [float(n) for n in re.findall(r"silence_duration: ([0-9.]+)", detect.stderr)]
    run(["ffmpeg", "-v", "error", "-xerror", "-i", str(output), "-f", "null", "-"])
    loudness = loudnorm_measure(output, -16, -1.5, 11)
    assert output.stat().st_size < 104857600
    assert hashlib.sha256(original.read_bytes()).hexdigest() == original_hash
    receipt = {
        "purpose": "User approval of original narrator and smoother editing; not final delivery",
        "voice": {"name": "John - Irish Man", "voiceId": "GFyWqnwcF2mv6dWlo3u1",
                  "model": "eleven_multilingual_v2", "speed": 1.0,
                  "provider": "ElevenLabs via Replit-managed media tools"},
        "text": " ".join(i["en"] for i in items), "sourceNarrationIds": [5, 6, 7, 8, 9],
        "continuousReadSeconds": voice_duration, "durationSeconds": duration_of(output),
        "transitions": transition_receipts,
        "originalReadGapSeconds": {"median": statistics.median(gaps), "maximum": max(gaps),
                                  "total": sum(gaps)},
        "auditionDetectedPausesSeconds": pauses,
        "continuousReadNotTimeStretched": True, "loudness": loudness,
        "originalExportSha256Unchanged": original_hash,
        "outputSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "reviewLimit": "Pause and loudness measurements are not a human listening assessment. Subtitle timing in this audition is estimated."
    }
    (OUT / "audition-receipt.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()