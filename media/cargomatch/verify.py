#!/usr/bin/env python3
"""One delivery-level technical pass and review sheets, without modifying media."""
from __future__ import annotations

import hashlib
import json
import subprocess
import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "media/cargomatch/build"
DELIVERY = ROOT / "attached_assets/cargomatch/delivery"
MOVIE = DELIVERY / "cargomatch-en-nl-1080p.mp4"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--delivery-dir", type=Path, default=DELIVERY,
                        help="delivery directory (defaults to the original 168-second delivery)")
    args = parser.parse_args()
    delivery = args.delivery_dir.resolve()
    movie = delivery / "cargomatch-en-nl-1080p.mp4"
    timeline_path = delivery / "edit-timeline.json"
    timeline = json.loads(timeline_path.read_text()) if timeline_path.exists() else None
    duration_expected = float(timeline["durationSeconds"]) if timeline else 168.0
    fps_expected = float(timeline.get("fps", 24)) if timeline else 24.0
    metadata = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(movie)
    ], text=True))
    video = next(s for s in metadata["streams"] if s["codec_type"] == "video")
    audio = next(s for s in metadata["streams"] if s["codec_type"] == "audio")
    assert (video["width"], video["height"], video["codec_name"], video["pix_fmt"]) == (1920, 1080, "h264", "yuv420p")
    assert video["avg_frame_rate"] == "24/1"
    if timeline:
        assert abs(float(metadata["format"]["duration"]) - duration_expected) < .08
    else:
        assert int(video["nb_frames"]) == 4032
        assert abs(float(metadata["format"]["duration"]) - 168) < .08
    assert audio["codec_name"] == "aac" and audio["channels"] == 2 and audio["sample_rate"] == "48000"
    assert movie.stat().st_size < 104857600, "Delivery exceeds the 100 MiB asset-card upload limit"
    decoded = subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(movie), "-f", "null", "-"],
                             capture_output=True, text=True)
    if decoded.returncode or decoded.stderr.strip():
        raise RuntimeError(f"Final stream decoding failed: {decoded.stderr}")
    geometry = {}
    for path in sorted(BUILD.glob("device-*.json")):
        data = json.loads(path.read_text())
        frames = data["frames"]
        assert len(frames) == 168
        for frame in frames:
            left, top, right, bottom = frame["screenBounds"]
            assert 0 <= left < right <= 1920
            assert 64 < top < bottom < 930, (path.name, frame)
        for filename, original_hash in data["screens"].items():
            current = hashlib.sha256((ROOT / "attached_assets/cargomatch/screens" / filename).read_bytes()).hexdigest()
            assert current == original_hash, f"Stale screenshot in {path}"
        geometry[path.stem] = {
            "outputFrames": len(frames),
            "screenBottomMax": max(f["screenBounds"][3] for f in frames),
            "minimumWidthAfterThreeSeconds": min(f["screenBounds"][2] - f["screenBounds"][0] for f in frames[72:]),
            "originalCaptureHashesMatch": True,
        }
    assert len(geometry) == 12
    cues = json.loads((delivery / "subtitle-cues.json").read_text())["cues"]
    previous = 0
    for cue in cues:
        assert previous <= cue["start"] < cue["end"] <= duration_expected
        assert len(cue["lines"]) <= 2 and all(len(line) <= 58 for line in cue["lines"])
        previous = cue["end"]
    cap = cv2.VideoCapture(str(movie))
    review = BUILD / ("revised-review" if timeline else "final-review")
    review.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
    means, contact_paths = {}, []
    scenes = timeline.get("scenes", []) if timeline else []
    if scenes:
        bounds = [(float(scene["start"]), float(scene["end"])) for scene in scenes]
    else:
        bounds = [(index * 7, min(index * 7 + 7, duration_expected)) for index in range(24)]
    for phase, fraction in (("start", .2), ("middle", .5), ("end", .8)):
        sheet = Image.new("RGB", (1920, 1200), "#101827")
        draw = ImageDraw.Draw(sheet)
        for index in range(24):
            start, end = bounds[index]
            # Keep samples inside even very short scenes (and away from the
            # exact end, where seeking may present the next scene).
            timestamp = start + (end - start) * fraction
            timestamp = min(max(timestamp, start), max(start, end - 1.0 / fps_expected))
            cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
            ok, frame = cap.read()
            assert ok
            means[str(round(timestamp, 2))] = round(float(frame.mean()), 3)
            still = review / f"scene-{index + 1:02}-{phase}.jpg"
            cv2.imwrite(str(still), frame, [cv2.IMWRITE_JPEG_QUALITY, 94])
            thumbnail = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).resize((480, 270))
            x, y = (index % 4) * 480, (index // 4) * 200
            # Fit a complete film frame into each cell, subtitles included.
            thumbnail.thumbnail((350, 173))
            sheet.paste(thumbnail, (x + 55, y))
            draw.text((x + 55, y + 175), f"{index + 1:02} / {timestamp:05.1f}s", font=font, fill="white")
        path = review / f"contact-{phase}.jpg"
        sheet.save(path, quality=95)
        contact_paths.append(str(path.relative_to(ROOT)))
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    ok, first = cap.read()
    assert ok and float(first.mean()) < 1, "Film must begin from black"
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, int(round(duration_expected * fps_expected)) - 1))
    ok, last = cap.read()
    assert ok and float(last.mean()) < 3, "Film must end from black"
    cap.release()
    receipt = json.loads((delivery / "production-receipt.json").read_text())
    if "durationSeconds" in receipt:
        assert abs(float(receipt["durationSeconds"]) - duration_expected) < .08
    loudness = receipt["audio"]["finalMeasurement"]
    assert float(loudness["input_tp"]) <= -.5, loudness
    assert -17.5 <= float(loudness["input_i"]) <= -14.5, loudness
    report = {
        "output": str(movie.relative_to(ROOT)),
        "sha256": hashlib.sha256(movie.read_bytes()).hexdigest(),
        "seconds": duration_expected, "resolution": [1920, 1080], "fps": fps_expected,
        "frames": int(video.get("nb_frames", round(duration_expected * fps_expected))),
        "codec": "H.264/yuv420p + AAC stereo 48kHz",
        "wholeFileDecodesWithoutWarnings": True,
        "firstFrameMean": float(first.mean()), "lastFrameMean": float(last.mean()),
        "subtitleCueCount": len(cues),
        "subtitleMatteTop": 930, "allDeviceScreensClearOfMatteAndHeader": True,
        "deviceGeometry": geometry, "loudness": loudness,
        "reviewSheets": contact_paths,
        "sampledFrameMeans": means,
        "reviewLimits": "Human-style visual review is sampled throughout all chapters, not every frame; no independent human listening session or external-player certification."
    }
    (delivery / "technical-verification.json").write_text(json.dumps(report, indent=2) + "\n")
    # Retain a compact edit-decision/asset receipt even when ignored builds are cleaned.
    if not timeline:
        for name in ("picture-receipt.json",):
            target = delivery / name
            source = BUILD / name
            if source.exists():
                target.write_text(source.read_text())
    print(json.dumps({"passed": True, "seconds": duration_expected,
                      "frames": int(video.get("nb_frames", round(duration_expected * fps_expected))),
                      "deviceComposites": len(geometry), "subtitleCues": len(cues),
                      "loudnessLUFS": loudness["input_i"]}, indent=2))


if __name__ == "__main__":
    main()