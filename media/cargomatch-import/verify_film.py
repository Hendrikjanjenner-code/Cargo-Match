#!/usr/bin/env python3
"""Verify only the new import delivery and its own source fingerprints."""
import json
import re
import subprocess
import sys
from pathlib import Path

import cv2
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "media/cargomatch"))
from assemble import probe, sha256

ASSETS = ROOT / "attached_assets/cargomatch-import"
BUILD = ROOT / "media/cargomatch-import/build"
OUT = ASSETS / "delivery"


def main():
    movie = OUT / "cargomatch-en-nl-1080p.mp4"
    timeline = json.loads((OUT / "edit-timeline.json").read_text())
    receipt = json.loads((OUT / "production-receipt.json").read_text())
    assert receipt["outputSha256"] == sha256(movie)
    metadata = probe(movie)
    video = next(s for s in metadata["streams"] if s["codec_type"] == "video")
    audio = next(s for s in metadata["streams"] if s["codec_type"] == "audio")
    assert (video["width"], video["height"], video["codec_name"], video["pix_fmt"]) == (1920, 1080, "h264", "yuv420p")
    assert video["avg_frame_rate"] == "24/1"
    assert int(video["nb_frames"]) == timeline["frames"]
    assert abs(float(metadata["format"]["duration"]) - timeline["durationSeconds"]) < .08
    assert (audio["codec_name"], audio["channels"], audio["sample_rate"]) == ("aac", 2, "48000")
    assert movie.stat().st_size < 104857600
    decoded = subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(movie), "-f", "null", "-"],
                             capture_output=True, text=True)
    assert decoded.returncode == 0 and not decoded.stderr.strip(), decoded.stderr
    black = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(movie),
                            "-vf", "blackdetect=d=0.15:pix_th=0.10", "-an", "-f", "null", "-"],
                           capture_output=True, text=True, check=True)
    black_intervals = [{"start": float(a), "end": float(b), "duration": float(c)}
                       for a, b, c in re.findall(r"black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)", black.stderr)]
    assert all(x["start"] < .65 or x["end"] > timeline["durationSeconds"] - 1.3 for x in black_intervals), black_intervals
    geometries = {}
    for path in BUILD.glob("device-*.json"):
        data = json.loads(path.read_text())
        assert len(data["frames"]) == 168
        for frame in data["frames"]:
            left, top, right, bottom = frame["screenBounds"]
            assert 0 <= left < right <= 1920 and 0 <= top < bottom < 930, (path, frame)
        for name, digest in data["screens"].items():
            assert sha256(ASSETS / "screens" / name) == digest
        assert sha256(ASSETS / "source" / f"plate-{data['plate']}.mp4") == data["sourceSha256"]
        geometries[path.stem] = {"frames": len(data["frames"]),
                               "maxScreenBottom": max(f["screenBounds"][3] for f in data["frames"]),
                               "minCloseupWidth": min(f["screenBounds"][2]-f["screenBounds"][0] for f in data["frames"][72:])}
    expected = json.loads((ROOT / "media/cargomatch-import/shots.json").read_text())["devices"]
    assert len(geometries) == len(expected)
    cues_path = OUT / "subtitle-cues.json"
    cue_report = json.loads(cues_path.read_text())
    # The shared subtitle writer supplies original-production defaults. Correct
    # provenance without altering the freshly aligned cue times or video.
    cue_report["generatedFrom"] = "media/cargomatch-import/production.json"
    cue_report["timingBasis"] = "Fresh local faster-whisper base.en word timestamps aligned to the exact normalized continuous English reads and bilingual import script"
    cue_report["alignmentEvidence"] = "attached_assets/cargomatch-import/delivery/alignment.json"
    cues_path.write_text(json.dumps(cue_report, ensure_ascii=False, indent=2))
    cues = cue_report["cues"]
    previous = 0
    for cue in cues:
        assert previous <= cue["start"] < cue["end"] <= timeline["durationSeconds"]
        assert len(cue["lines"]) <= 2 and all(len(line) <= 58 for line in cue["lines"])
        previous = cue["end"]
    loudness = receipt["audio"]["finalMeasurement"]
    assert -17.5 <= float(loudness["input_i"]) <= -14.5 and float(loudness["input_tp"]) <= -.5
    review = BUILD / "final-review"
    review.mkdir(exist_ok=True)
    cap = cv2.VideoCapture(str(movie))
    samples = []
    for phase, fraction in (("start", .2), ("middle", .5), ("end", .8)):
        sheet = Image.new("RGB", (1920, 1200), "#101827")
        draw = ImageDraw.Draw(sheet)
        for i, scene in enumerate(timeline["scenes"]):
            time = scene["start"] + (scene["end"]-scene["start"])*fraction
            cap.set(cv2.CAP_PROP_POS_MSEC, time*1000)
            ok, frame = cap.read()
            assert ok and frame.mean() > 3, (scene["id"], time)
            path = review / f"scene-{i+1:02}-{phase}.jpg"
            cv2.imwrite(str(path), frame)
            thumb = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            thumb.thumbnail((350, 173))
            x, y = (i % 4)*480+55, (i//4)*200
            sheet.paste(thumb, (x,y))
            draw.text((x,y+175), f"{i+1:02} / {time:.2f}s", fill="white")
            samples.append({"scene": i+1, "time": time, "mean": float(frame.mean())})
        sheet.save(review/f"contact-{phase}.jpg", quality=94)
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    ok, first = cap.read()
    assert ok and first.mean() < 1
    cap.set(cv2.CAP_PROP_POS_FRAMES, timeline["frames"]-1)
    ok, last = cap.read()
    assert ok and last.mean() < 3
    cap.release()
    report = {"passed": True, "sha256": sha256(movie), "durationSeconds": timeline["durationSeconds"],
              "bytes": movie.stat().st_size, "frames": timeline["frames"], "wholeFileDecodesWithoutWarnings": True,
              "deviceGeometry": geometries, "subtitleCues": len(cues), "loudness": loudness,
              "sampledFrames": samples, "firstFrameMean": float(first.mean()), "lastFrameMean": float(last.mean()),
              "blackIntervals": black_intervals, "noInternalBlackGapsDetected": True,
              "limits": "Sampled visual review, technical full decode; browser tested separately. No independent human listening or external-player certification."}
    (OUT / "technical-verification.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in ("passed","durationSeconds","bytes","frames","subtitleCues")}))


if __name__ == "__main__":
    main()