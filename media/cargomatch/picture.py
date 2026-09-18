#!/usr/bin/env python3
"""Build the 168-second silent live-action master from measured composites."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from composite import BUILD, ROOT, SOURCE, render

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
ASSETS = ROOT / "attached_assets/cargomatch"
ENCODE = ["-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
          "-threads", "2", "-pix_fmt", "yuv420p", "-r", "24",
          "-g", "48", "-video_track_timescale", "12288", "-movflags", "+faststart"]

# Every device uses the same actual product captures as its reported scene.
DEVICES = {
    "planner": ("planner", [(0, "deepsea-capacity.png")], (1600, 1000)),
    "capacity": ("monitor", [(0, "deepsea-capacity-detail.png")], (1600, 1000)),
    "cargo": ("monitor", [(0, "deepsea-cargo.png")], (1600, 1000)),
    "opportunity": ("monitor", [(0, "deepsea-opportunity.png")], (1600, 1000)),
    "consent": ("monitor", [(0, "deepsea-interest.png"), (3.5, "deepsea-connected.png")], (1600, 1000)),
    "messages": ("planner", [(0, "deepsea-messages.png")], (1600, 1000)),
    "driver": ("phone", [(0, "road-availability-mobile.png")], (430, 960)),
    "nextload": ("phone", [(0, "road-next-load-mobile.png")], (430, 960)),
    "referral": ("monitor", [(0, "road-referral.png")], (1600, 1000)),
    "rail": ("tablet", [(0, "rail-capacity-tablet.png")], (1024, 768)),
    "air": ("monitor", [(0, "air-capacity.png"), (3.3, "air-flight-detail.png")], (1600, 1000)),
    "map": ("tablet", [(0, "regional-map-tablet.png")], (1024, 768)),
}

# source kind/name, source start, output duration. Cuts are intentional editorial
# inserts, not a claim that static screenshots contain recorded cursor actions.
SCENES = [
    [("source", "port", .2, 5.5), ("source", "vessel", .2, 1.5)],
    [("source", "vessel", 2, 1.5), ("source", "truck", .2, 1.5), ("source", "rail", .2, 1.5), ("source", "air", .2, 2.5)],
    [("source", "unloading", .25, 7)],
    [("source", "empty-trailer", .25, 7)],
    [("device", "planner", 0, 7)],
    [("device", "capacity", 0, 7)],
    [("source", "captain", .25, 7)],
    [("device", "cargo", 0, 7)],
    [("device", "opportunity", 0, 7)],
    [("device", "consent", 0, 7)],
    [("device", "messages", 0, 7)],
    [("source", "truck", .25, 7)],
    [("device", "driver", 0, 7)],
    [("device", "nextload", 0, 7)],
    [("device", "referral", 0, 7)],
    [("source", "collaboration", .25, 7)],
    [("source", "rail", 1, 2.5), ("device", "rail", 2.5, 4.5)],
    [("source", "air", .25, 7)],
    [("device", "air", 0, 7)],
    [("source", "rail", 3.5, 3.5), ("source", "air", 3.5, 3.5)],
    [("device", "map", 3.5, 3.5), ("source", "collaboration", 4, 3.5)],
    [("source", "vessel", 3, 2.5), ("source", "truck", 3, 2.5), ("source", "port", 5, 2)],
    [("source", "port", .25, 7)],
    [("source", "port", .75, 7)],
]

LABELS = [
    ("GLOBAL LOGISTICS", "A WORLD IN MOTION"),
    ("SEA / ROAD / RAIL / AIR", ""),
    ("THE NEXT JOB", "WHAT COMES NEXT?"),
    ("EMPTY CAPACITY", "TIME. FUEL. OPPORTUNITY."),
    ("CARGOMATCH", "ACTUAL PRODUCT DEMO"),
    ("DEEPSEA / EXPECTED OPEN POSITION", "MALAYSIA"),
    ("OPERATOR ESTIMATES", "PEOPLE PROVIDE THE CONTEXT"),
    ("DEEPSEA / CARGO ORDER", "INDONESIA → CHINA / 75,000 MT"),
    ("DEEPSEA / MATCH OPPORTUNITY", "PRIVATE UNTIL BOTH PARTIES AGREE"),
    ("MUTUAL CONSENT", "INTEREST → CONNECTION"),
    ("A COMMERCIAL CONVERSATION", "AN INTRODUCTION. NOT A BOOKING."),
    ("ROAD TRANSPORT", "PLAN BEYOND THE CURRENT DELIVERY"),
    ("ASSIGNED AVAILABILITY", "DRIVER CONFIRMATION / ROAD PILOT"),
    ("NEXT-LOAD OPPORTUNITIES", "DRIVER → PLANNER / ROAD PILOT"),
    ("THE PLANNER DECIDES", "COMMERCIAL AUTHORITY / ROAD PILOT"),
    ("PEOPLE IN CONTROL", "CHECK AVAILABILITY AND REQUIREMENTS"),
    ("RAIL / AVAILABLE WAGONS", "FUNCTIONAL DEMO PILOT"),
    ("AIR CARGO / REMAINING CAPACITY", "FUNCTIONAL DEMO PILOT"),
    ("FLIGHT CAPACITY / AMS → DXB", "FUNCTIONAL DEMO PILOT"),
    ("EXPLORING RAIL AND AIR", "FICTIONAL PILOTS / NOT LIVE BOOKINGS"),
    ("EARLIER CONVERSATIONS", "A NETWORK OF PROFESSIONALS"),
    ("SEE THE NEXT OPPORTUNITY", ""),
    ("", ""),
    ("", ""),
]


def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-5000:])
    return result.stdout


def ffmpeg(*args):
    return run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *map(str, args)])


def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else FONT, size)


def label_image(index):
    image = Image.new("RGBA", (1920, 1080))
    draw = ImageDraw.Draw(image)
    title, note = LABELS[index - 1]
    if title:
        draw.rectangle((0, 0, 1920, 64), fill=(12, 24, 41, 238))
        draw.rectangle((42, 20, 47, 44), fill=(58, 184, 184, 255))
        draw.text((65, 19), title, font=font(23, True), fill="white")
        if note:
            note_width = draw.textlength(note, font=font(19))
            draw.text((1860 - note_width, 23), note, font=font(19),
                      fill=(255, 214, 142, 255) if index in (17, 18, 19, 20) else (181, 209, 230, 255))
    if index == 1:
        draw.text((70, 736), "Every journey.", font=font(64, True), fill="white", stroke_width=1, stroke_fill=(0, 0, 0, 100))
        draw.text((72, 818), "The next opportunity.", font=font(42), fill="white")
    if index in (23, 24):
        draw.rectangle((0, 0, 1920, 1080), fill=(9, 23, 42, 210))
        # The actual rendered app mark is retained, not recreated by AI.
        logo = Image.open(ASSETS / "logo.png").convert("RGBA")
        logo.thumbnail((840, 225))
        logo = logo.resize((round(logo.width * 1.6), round(logo.height * 1.6)), Image.Resampling.LANCZOS)
        image.alpha_composite(logo, ((1920 - logo.width) // 2, 242))
        draw = ImageDraw.Draw(image)
        lines = (["Find the next load", "before capacity becomes empty."]
                 if index == 23 else ["The transport capacity", "intelligence network."])
        for y, text in zip((540, 620), lines):
            width = draw.textlength(text, font=font(58, index == 23))
            draw.text(((1920 - width) / 2, y), text, font=font(58, index == 23), fill="white")
        if index == 24:
            text = "DISCOVER CARGOMATCH"
            width = draw.textlength(text, font=font(24, True))
            draw.rounded_rectangle(((1920 - width) / 2 - 30, 772, (1920 + width) / 2 + 30, 834),
                                   radius=8, fill=(22, 137, 141, 255))
            draw.text(((1920 - width) / 2, 788), text, font=font(24, True), fill="white")
    path = BUILD / f"label-{index:02}.png"
    image.save(path)
    return path


def render_device(name):
    plate, screens, panel = DEVICES[name]
    out = BUILD / f"device-{name}.mp4"
    fingerprint = hashlib.sha256(Path(__file__).read_bytes() +
                                 (ROOT / "media/cargomatch/composite.py").read_bytes())
    for source in [SOURCE / f"plate-{plate}.mp4", *[ASSETS / "screens" / n for _, n in screens]]:
        fingerprint.update(source.read_bytes())
    digest = fingerprint.hexdigest()
    stamp = out.with_suffix(".fingerprint")
    if out.exists() and stamp.exists() and stamp.read_text() == digest:
        return out
    render(plate, screens, out, panel_size=panel)
    stamp.write_text(digest)
    return out


def render_scene(index):
    parts = SCENES[index - 1]
    inputs, filters = [], []
    for number, (kind, name, start, length) in enumerate(parts):
        path = SOURCE / f"{name}.mp4" if kind == "source" else BUILD / f"device-{name}.mp4"
        if not path.is_file():
            raise FileNotFoundError(path)
        inputs += ["-ss", str(start), "-t", str(length), "-i", str(path)]
        filters.append(f"[{number}:v]setpts=PTS-STARTPTS,fps=24,setsar=1[v{number}]")
    filters.append("".join(f"[v{i}]" for i in range(len(parts))) + f"concat=n={len(parts)}:v=1:a=0[cut]")
    inputs += ["-loop", "1", "-i", str(label_image(index))]
    filters.append(f"[cut][{len(parts)}:v]overlay=0:0:format=auto,format=yuv420p[out]")
    output = BUILD / f"scene-{index:02}.mp4"
    ffmpeg(*inputs, "-filter_complex_threads", "1", "-filter_complex", ";".join(filters),
           "-map", "[out]", "-t", "7", *ENCODE, output)
    print(f"Scene {index:02} ready", flush=True)
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", choices=DEVICES)
    args = parser.parse_args()
    BUILD.mkdir(parents=True, exist_ok=True)
    if args.device:
        render_device(args.device)
        return
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(render_device, DEVICES))
        scenes = list(pool.map(render_scene, range(1, 25)))
    concat = BUILD / "concat.txt"
    concat.write_text("".join(f"file '{p}'\n" for p in scenes))
    master = BUILD / "picture-master.mp4"
    ffmpeg("-f", "concat", "-safe", "0", "-i", concat, "-an", "-c:v", "copy",
           "-movflags", "+faststart", master)
    receipt = {
        "duration": 168, "fps": 24, "screenReplacement": "Per-frame measured physical device planes",
        "screensAreStaticCaptures": True,
        "sources": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in sorted(SOURCE.glob("*.mp4"))},
        "scenes": [{"id": i, "start": (i - 1) * 7, "duration": 7,
                    "label": LABELS[i - 1], "parts": SCENES[i - 1]} for i in range(1, 25)],
        "masterSha256": hashlib.sha256(master.read_bytes()).hexdigest(),
    }
    (BUILD / "picture-receipt.json").write_text(json.dumps(receipt, indent=2))
    print("Silent picture master complete: 168 seconds", flush=True)


if __name__ == "__main__":
    main()