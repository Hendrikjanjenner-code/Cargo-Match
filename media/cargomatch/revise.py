#!/usr/bin/env python3
"""Speech-led revision; original delivery and approved audition are immutable inputs."""
from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import subprocess
import textwrap
from pathlib import Path

from assemble import (ROOT, duration_of, loudnorm_measure, normalize_file, probe,
                      run, sha256, wrap_subtitle, write_subtitles)
from revised_picture import render

OUT = ROOT / "attached_assets/cargomatch/revised"
MANIFEST = ROOT / "media/cargomatch/revised-narration.json"
FPS = 24
CHAPTER_GAP = .55


def prepare_audio(manifest):
    measurements = []
    for group in manifest["groups"]:
        source = ROOT / group["path"]
        output = OUT / "audio" / f"{group['id']}-normalized.wav"
        measurement = normalize_file(source, output, -18, -3, trim_silence=True)
        measurements.append({"id": group["id"], "duration": duration_of(output),
                             "sourceSha256": sha256(source), "normalizedSha256": sha256(output),
                             "normalizationInput": measurement})
    (OUT / "audio/normalization.json").write_text(json.dumps(measurements, indent=2))


def subtitle_cues(items):
    cues = []
    for item in items:
        units = item["sentences"]
        whole_nl = " ".join(u["dutch"] for u in units)
        # The four short transport modes read better as one stable caption.
        if item["id"] == 2:
            units = [{"english": " ".join(u["english"] for u in units), "dutch": whole_nl,
                      "start": units[0]["start"], "end": units[-1]["end"]}]
        merged = []
        for unit in units:
            unit = dict(unit)
            if merged and (unit["end"] - unit["start"] < 1.0 or
                           merged[-1]["end"] - merged[-1]["start"] < 1.0):
                combined = merged[-1]["dutch"] + " " + unit["dutch"]
                if len(textwrap.wrap(combined, width=58, break_long_words=False)) <= 2:
                    merged[-1]["dutch"] = combined
                    merged[-1]["english"] += " " + unit["english"]
                    merged[-1]["end"] = unit["end"]
                    continue
            merged.append(unit)
        for index, unit in enumerate(merged):
            cues.append({"slotId": item["id"], "sentence": index + 1,
                         "start": round(unit["start"], 3), "end": round(unit["end"], 3),
                         "english": unit["english"], "dutch": unit["dutch"],
                         "lines": wrap_subtitle(unit["dutch"])})
    return cues


def timeline_from_alignment(manifest):
    aligned = json.loads((OUT / "alignment.json").read_text())
    assert aligned["manifestSha256"] == sha256(MANIFEST), "Re-align after changing the voice manifest"
    assert aligned["scriptSha256"] == sha256(ROOT / "media/cargomatch/production.json"), "Re-align after changing the script"
    by_group = {g["id"]: g for g in aligned["groups"]}
    groups, items = [], []
    start = .65
    for definition in manifest["groups"]:
        group = by_group[definition["id"]]
        voice = OUT / "audio" / f"{group['id']}-normalized.wav"
        duration = duration_of(voice)
        assert group["normalizedSha256"] == sha256(voice), "Re-align after changing a normalized voice read"
        assert abs(duration - group["duration"]) < .002, "Alignment must use the exact normalized WAV"
        groups.append({"id": group["id"], "ids": definition["ids"], "start": start,
                       "end": start + duration, "path": str(voice.relative_to(ROOT)),
                       "sourcePath": definition["path"], "normalizedSha256": sha256(voice)})
        assert [i["id"] for i in group["items"]] == definition["ids"]
        for original in group["items"]:
            item = dict(original)
            item["start"] = original["start"] + start
            item["end"] = original["end"] + start
            item["sentences"] = [{**u, "start": u["start"] + start, "end": u["end"] + start}
                                 for u in original["sentences"]]
            items.append(item)
        start += duration + CHAPTER_GAP
    assert [i["id"] for i in items] == list(range(1, 25))
    total_frames = math.ceil((groups[-1]["end"] + 1.25) * FPS)
    assert total_frames / FPS <= 180
    # Narration introduces the next topic slightly before the picture resolves.
    boundaries = [0] + [round((i["start"] + .12) * FPS) for i in items[1:]] + [total_frames]
    overlaps = [4 if index in (8, 9, 13, 23) else 12 for index in range(1, 24)]
    scenes, transitions = [], []
    for index, item in enumerate(items):
        first = boundaries[index] - (overlaps[index - 1] // 2 if index else 0)
        last = boundaries[index + 1] + (overlaps[index] // 2 if index < 23 else 0)
        scenes.append({"id": item["id"], "start": boundaries[index] / FPS,
                       "end": boundaries[index + 1] / FPS,
                       "renderStartFrame": first, "renderEndFrame": last,
                       "narrationStart": item["start"], "narrationEnd": item["end"]})
        if index:
            transitions.append({"fromScene": index, "toScene": index + 1,
                                "start": first / FPS, "duration": overlaps[index - 1] / FPS,
                                "kind": "short screen dissolve" if overlaps[index - 1] == 4 else "context dissolve"})
    timeline = {"durationSeconds": total_frames / FPS, "frames": total_frames, "fps": FPS,
                "groups": groups, "scenes": scenes, "transitions": transitions,
                "chapterGapSeconds": CHAPTER_GAP,
                "pictureLeadInSeconds": .65, "pictureTailSeconds": 1.25,
                "naturalRuntimeApproved": True, "voiceTimeStretch": 1.0}
    (OUT / "edit-timeline.json").write_text(json.dumps(timeline, indent=2))
    cues = subtitle_cues(items)
    _, ass_path, cues_path = write_subtitles(cues, OUT)
    cue_report = json.loads(cues_path.read_text())
    cue_report["timingBasis"] = "Local faster-whisper base.en word timestamps aligned to the original bilingual script; aligned against exact normalized continuous WAVs"
    cue_report["alignmentEvidence"] = str((OUT / "alignment.json").relative_to(ROOT))
    cues_path.write_text(json.dumps(cue_report, ensure_ascii=False, indent=2))
    return timeline, ass_path


def mix_audio(timeline):
    total = timeline["durationSeconds"]
    music = OUT / "audio/music-normalized.wav"
    normalize_file(ROOT / "attached_assets/cargomatch/audio/music.mp3", music, -31, -4, duration=total)
    for name in ("port", "road"):
        normalize_file(ROOT / f"attached_assets/cargomatch/audio/{name}.mp3",
                       OUT / f"audio/{name}-ambience.wav", -38, -6)
    inputs, filters, voices = [], [], []
    for index, group in enumerate(timeline["groups"]):
        inputs += ["-i", str(ROOT / group["path"])]
        milliseconds = round(group["start"] * 1000)
        filters.append(f"[{index}:a]adelay={milliseconds}|{milliseconds},apad,atrim=duration={total}[v{index}]")
        voices.append(f"[v{index}]")
    count = len(voices)
    inputs += ["-i", str(music), "-i", str(OUT / "audio/port-ambience.wav"),
               "-i", str(OUT / "audio/road-ambience.wav")]
    filters.append("".join(voices) + f"amix=inputs={count}:normalize=0[voice]")
    filters.append(f"[{count}:a]afade=t=in:st=0:d=0.65,afade=t=out:st={total-1.15}:d=1.15[music]")
    filters.append(f"[{count+1}:a]afade=t=in:st=0:d=0.6,afade=t=out:st=6:d=2,"
                   f"atrim=duration=8,adelay=200|200,apad,atrim=duration={total}[port]")
    road_start = round(next(g["start"] for g in timeline["groups"] if g["id"] == "road") * 1000)
    filters.append(f"[{count+2}:a]afade=t=in:st=0:d=0.4,afade=t=out:st=6:d=2,"
                   f"atrim=duration=8,adelay={road_start}|{road_start},apad,atrim=duration={total}[road]")
    filters.append("[voice][music][port][road]amix=inputs=4:normalize=0[out]")
    raw = OUT / "audio/mix-raw.wav"
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs,
         "-filter_complex_threads", "1", "-filter_complex", ";".join(filters),
         "-map", "[out]", "-t", str(total), "-c:a", "pcm_s24le", str(raw)])
    final = OUT / "audio/mix.wav"
    measurement = normalize_file(raw, final, -16, -1.5)
    return final, measurement


def pause_report(path):
    result = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path),
                             "-af", "silencedetect=noise=-38dB:d=0.15", "-f", "null", "-"],
                            capture_output=True, text=True, check=True)
    return [float(n) for n in re.findall(r"silence_duration: ([0-9.]+)", result.stderr)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare-audio", action="store_true")
    parser.add_argument("--timeline-only", action="store_true")
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    if args.prepare_audio:
        prepare_audio(manifest)
        return
    original = ROOT / "attached_assets/cargomatch/delivery/cargomatch-en-nl-1080p.mp4"
    audition = ROOT / "attached_assets/cargomatch/audition/cargomatch-stem-montageproef.mp4"
    protected = {str(p.relative_to(ROOT)): sha256(p) for p in (original, audition)}
    timeline, subtitles = timeline_from_alignment(manifest)
    if args.timeline_only:
        print(json.dumps({"duration": timeline["durationSeconds"], "scenes": len(timeline["scenes"])}))
        return
    picture = render(timeline)
    audio, measurement = mix_audio(timeline)
    total = timeline["durationSeconds"]
    output = OUT / "cargomatch-en-nl-1080p.mp4"
    video_filter = (f"drawbox=x=0:y=930:w=1920:h=150:color=0x061421@0.95:t=fill,"
                    f"ass='{subtitles}',fade=t=in:st=0:d=0.6,"
                    f"fade=t=out:st={total-1.05}:d=1")
    disclosure = ("AI-generated people/location footage; original library narrator John, generated score/ambience; "
                  "actual fictional CargoMatch demo screens. Introduction, not booking. Availability estimated, "
                  "not live tracking. Rail and air are fictional demo pilots.")
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(picture), "-i", str(audio),
         "-map", "0:v:0", "-map", "1:a:0", "-vf", video_filter, "-t", str(total),
         "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-maxrate", "4200k", "-bufsize", "8400k",
         "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
         "-movflags", "+faststart", "-metadata", "title=CargoMatch - Find the next load",
         "-metadata", f"comment={disclosure}", "-metadata", f"description={disclosure}", str(output)])
    assert output.stat().st_size < 104857600
    for path, digest in protected.items():
        assert sha256(ROOT / path) == digest, "Protected original or audition changed"
    previous_reads = json.loads((original.parent / "production-receipt.json").read_text())["voiceProcessing"]
    previous_gaps = [b["timelineStartSeconds"] - a["timelineStartSeconds"] - a["processedDurationSeconds"]
                     for a, b in zip(previous_reads, previous_reads[1:])]
    pauses = {g["id"]: pause_report(ROOT / g["path"]) for g in timeline["groups"]}
    picture_receipt = {"timeline": "edit-timeline.json", "sources": "Preserved source footage and measured device composites",
                       "masterSha256": sha256(picture), "durationSeconds": total,
                       "internalTransitions": "Six-frame dissolves between montage inserts",
                       "scenes": timeline["scenes"], "transitions": timeline["transitions"]}
    (OUT / "picture-receipt.json").write_text(json.dumps(picture_receipt, indent=2))
    receipt = {
        "production": "CargoMatch — Find the next load", "revision": "Approved original Irish narrator and speech-led edit",
        "output": str(output.relative_to(ROOT)), "durationSeconds": total,
        "voice": manifest["voice"], "voiceGroups": timeline["groups"], "voiceTimeStretch": 1.0,
        "originalsPreserved": protected, "outputSha256": sha256(output), "outputProbe": probe(output),
        "audio": {"mixInputMeasurement": measurement, "finalMeasurement": loudnorm_measure(output, -16, -1.5)},
        "pacing": {"oldGapMedianSeconds": statistics.median(previous_gaps),
                   "oldGapMaximumSeconds": max(previous_gaps), "newChapterGapSeconds": CHAPTER_GAP,
                   "newInternalPauseSeconds": pauses,
                   "subtitleAlignment": "Local word-level ASR aligned to approved bilingual script; evidence in alignment.json"},
        "disclosures": json.loads((ROOT / "media/cargomatch/production.json").read_text())["disclosures"],
    }
    (OUT / "production-receipt.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps({"output": str(output.relative_to(ROOT)), "seconds": total,
                      "megabytes": output.stat().st_size / 1e6, "loudness": receipt["audio"]["finalMeasurement"]}))


if __name__ == "__main__":
    main()