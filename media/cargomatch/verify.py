#!/usr/bin/env python3
"""One delivery-level technical pass and review sheets, without modifying media."""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "media/cargomatch/build"
DELIVERY = ROOT / "attached_assets/cargomatch/delivery"
MOVIE = DELIVERY / "cargomatch-en-nl-1080p.mp4"


def main():
    metadata = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(MOVIE)
    ], text=True))
    video = next(s for s in metadata["streams"] if s["codec_type"] == "video")
    audio = next(s for s in metadata["streams"] if s["codec_type"] == "audio")
    assert (video["width"], video["height"], video["codec_name"], video["pix_fmt"]) == (1920, 1080, "h264", "yuv420p")
    assert video["avg_frame_rate"] == "24/1"
    assert int(video["nb_frames"]) == 4032
    assert abs(float(metadata["format"]["duration"]) - 168) < .08
    assert audio["codec_name"] == "aac" and audio["channels"] == 2 and audio["sample_rate"] == "48000"
    assert MOVIE.stat().st_size < 104857600, "Delivery exceeds the 100 MiB asset-card upload limit"
    decoded = subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(MOVIE), "-f", "null", "-"],
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
    cues = json.loads((DELIVERY / "subtitle-cues.json").read_text())["cues"]
    previous = 0
    for cue in cues:
        assert previous <= cue["start"] < cue["end"] < 167
        assert len(cue["lines"]) <= 2 and all(len(line) <= 58 for line in cue["lines"])
        previous = cue["end"]
    cap = cv2.VideoCapture(str(MOVIE))
    review = BUILD / "final-review"
    review.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
    means, contact_paths = {}, []
    for phase, offset in (("start", 1.1), ("middle", 3.5), ("end", 5.8)):
        sheet = Image.new("RGB", (1920, 1200), "#101827")
        draw = ImageDraw.Draw(sheet)
        for index in range(24):
            timestamp = index * 7 + offset
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
    cap.release()
    receipt = json.loads((DELIVERY / "production-receipt.json").read_text())
    loudness = receipt["audio"]["finalMeasurement"]
    assert float(loudness["input_tp"]) <= -.5, loudness
    assert -17.5 <= float(loudness["input_i"]) <= -14.5, loudness
    report = {
        "output": str(MOVIE.relative_to(ROOT)),
        "sha256": hashlib.sha256(MOVIE.read_bytes()).hexdigest(),
        "seconds": 168, "resolution": [1920, 1080], "fps": 24, "frames": 4032,
        "codec": "H.264/yuv420p + AAC stereo 48kHz",
        "wholeFileDecodesWithoutWarnings": True,
        "firstFrameMean": float(first.mean()), "subtitleCueCount": len(cues),
        "subtitleMatteTop": 930, "allDeviceScreensClearOfMatteAndHeader": True,
        "deviceGeometry": geometry, "loudness": loudness,
        "reviewSheets": contact_paths,
        "sampledFrameMeans": means,
        "reviewLimits": "Human-style visual review is sampled throughout all chapters, not every frame; no independent human listening session or external-player certification."
    }
    (DELIVERY / "technical-verification.json").write_text(json.dumps(report, indent=2) + "\n")
    # Retain a compact edit-decision/asset receipt even when ignored builds are cleaned.
    for name in ("picture-receipt.json",):
        (DELIVERY / name).write_text((BUILD / name).read_text())
    print(json.dumps({"passed": True, "seconds": 168, "frames": 4032,
                      "deviceComposites": len(geometry), "subtitleCues": len(cues),
                      "loudnessLUFS": loudness["input_i"]}, indent=2))


if __name__ == "__main__":
    main()