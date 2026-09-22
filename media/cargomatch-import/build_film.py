#!/usr/bin/env python3
"""Separate import film using the approved CargoMatch production utilities."""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "media/cargomatch"))
import assemble
import align_narration
import composite
import picture
import revised_picture
import revise
from PIL import Image, ImageDraw

HERE = ROOT / "media/cargomatch-import"
ASSETS = ROOT / "attached_assets/cargomatch-import"
OUT = ASSETS / "delivery"
BUILD = HERE / "build"
MANIFEST = HERE / "narration.json"
SCRIPT = HERE / "production.json"
FPS = 24
BASE_TOKENS = align_narration.normalized_tokens
BASE_TRANSCRIBE = align_narration.transcription_words


def import_tokens(text):
    text = re.sub(r"\b95\s*,?\s*707\b", "ninety five thousand seven hundred and seven", text)
    text = re.sub(r"\b180\b", "one hundred and eighty", text)
    text = re.sub(r"\bAIS\b", "a i s", text, flags=re.I)
    return BASE_TOKENS(text)


def import_transcription(model, path):
    heard, transcript = BASE_TRANSCRIBE(model, path)
    result = []
    i = 0
    while i < len(heard):
        if i + 1 < len(heard) and heard[i]["token"] == "95" and heard[i + 1]["token"] == "707":
            first, last = heard[i], heard[i + 1]
            tokens = "ninety five thousand seven hundred and seven".split()
            for n, token in enumerate(tokens):
                result.append({**first, "token": token, "raw": first["raw"] + last["raw"],
                               "start": first["start"] + (last["end"] - first["start"]) * n / len(tokens),
                               "end": first["start"] + (last["end"] - first["start"]) * (n + 1) / len(tokens)})
            i += 2
        else:
            result.append(heard[i])
            i += 1
    return result, transcript


def configure():
    OUT.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(parents=True, exist_ok=True)
    composite.SOURCE = ASSETS / "source"
    composite.SCREENS = ASSETS / "screens"
    composite.BUILD = BUILD
    picture.BUILD = BUILD
    picture.ASSETS = ASSETS
    picture.SOURCE = ASSETS / "source"
    revised_picture.WORK = BUILD / "edit"
    revised_picture.BUILD = BUILD
    revised_picture.SOURCE = ASSETS / "source"
    revise.OUT = OUT
    revise.MANIFEST = MANIFEST
    align_narration.MANIFEST = MANIFEST
    align_narration.PRODUCTION = SCRIPT
    align_narration.NORMALIZED_DIR = OUT / "audio"
    align_narration.normalized_tokens = import_tokens
    align_narration.transcription_words = import_transcription


def align():
    sys.argv = ["align_narration", "--output", str(OUT / "alignment.json")]
    align_narration.main()


def timeline():
    manifest = json.loads(MANIFEST.read_text())
    alignment = json.loads((OUT / "alignment.json").read_text())
    assert alignment["manifestSha256"] == assemble.sha256(MANIFEST)
    assert alignment["scriptSha256"] == assemble.sha256(SCRIPT)
    groups, items = [], []
    start = .65
    for definition, group in zip(manifest["groups"], alignment["groups"]):
        voice = OUT / "audio" / f"{group['id']}-normalized.wav"
        assert group["id"] == definition["id"]
        assert group["normalizedSha256"] == assemble.sha256(voice)
        duration = assemble.duration_of(voice)
        groups.append({"id": group["id"], "ids": definition["ids"], "start": start,
                       "end": start + duration, "path": str(voice.relative_to(ROOT)),
                       "normalizedSha256": assemble.sha256(voice)})
        for item in group["items"]:
            items.append({**item, "start": item["start"] + start, "end": item["end"] + start,
                          "sentences": [{**s, "start": s["start"] + start, "end": s["end"] + start}
                                        for s in item["sentences"]]})
        start += duration + .55
    frames = math.ceil((groups[-1]["end"] + 1.25) * FPS)
    boundaries = [0] + [round((i["start"] + .12) * FPS) for i in items[1:]] + [frames]
    # Adjacent states of the same physical laptop dissolve in four frames.
    same_device = {6, 7, 10, 11, 14, 15, 18, 19, 22}
    overlaps = [4 if i in same_device else 12 for i in range(1, 24)]
    scenes = []
    transitions = []
    for i, item in enumerate(items):
        first = boundaries[i] - (overlaps[i - 1] // 2 if i else 0)
        last = boundaries[i + 1] + (overlaps[i] // 2 if i < 23 else 0)
        scenes.append({"id": item["id"], "start": boundaries[i] / FPS, "end": boundaries[i + 1] / FPS,
                       "renderStartFrame": first, "renderEndFrame": last,
                       "narrationStart": item["start"], "narrationEnd": item["end"]})
        if i:
            transitions.append({"fromScene": i, "toScene": i + 1,
                                "start": first / FPS, "duration": overlaps[i - 1] / FPS})
    result = {"durationSeconds": frames / FPS, "frames": frames, "fps": FPS,
              "groups": groups, "scenes": scenes, "transitions": transitions,
              "chapterGapSeconds": .55, "voiceTimeStretch": 1.0}
    (OUT / "edit-timeline.json").write_text(json.dumps(result, indent=2))
    cues = revise.subtitle_cues(items)
    _, subtitles, _ = assemble.write_subtitles(cues, OUT)
    return result, subtitles


LABELS = [
    ("THE IMPORT JOURNEY", "FROM ARRIVAL TO DELIVERY"),
    ("CHINA / FCL", "YANTIAN → ROTTERDAM → EINDHOVEN"),
    ("CARGOMATCH IMPORT", "ACTUAL PRODUCT DEMO"),
    ("TEN CONNECTED MODULES", "PEOPLE AND RESPONSIBILITIES"),
    ("DOCUMENTS", "CHECK THE SOURCE"),
    ("EXCEPTIONS", "180 KG WEIGHT DIFFERENCE"),
    ("HUMAN REVIEW", "CORRECTION AND TRACEABILITY"),
    ("PARTNERS", "ROLE-BASED ACCESS"),
    ("CUSTOMS", "PEOPLE REMAIN IN CONTROL"),
    ("DOSSIER REVIEW", "HUMAN CHECK REQUIRED"),
    ("CUSTOMS / SIMULATED", "NO REAL DECLARATION"),
    ("IMPORT READINESS", "STATUS AND RESPONSIBILITY"),
    ("CHARGES", "CHINA EXAMPLE / EUR 95,707"),
    ("RELEASE CONDITIONS", "CHECK EVERY REQUIREMENT"),
    ("SIMULATED PAYMENTS", "NO REAL MONEY MOVED"),
    ("THE ONWARD JOURNEY", "PORT → HINTERLAND"),
    ("TRANSPORT OPTIONS", "ROTTERDAM → EINDHOVEN"),
    ("MUTUAL CONSENT", "AN INTRODUCTION. NOT A BOOKING."),
    ("PLANNING AND DELIVERY", "SEPARATE OPERATIONAL STEPS"),
    ("THE HANDOVER", "PORT TO WAREHOUSE"),
    ("INDIA / LCL", "MUMBAI → ROTTERDAM → TILBURG"),
    ("RECEIVER PORTAL", "ONLY THEIR OWN HOUSE SHIPMENT"),
    ("CONTROL TOWER", "SYNTHETIC DEMO / NOT LIVE AIS"),
    ("", ""),
]


def label_image(index):
    image = Image.new("RGBA", (1920, 1080))
    draw = ImageDraw.Draw(image)
    title, note = LABELS[index - 1]
    if title:
        draw.rectangle((0, 0, 1920, 64), fill=(12, 24, 41, 238))
        draw.rectangle((42, 20, 47, 44), fill=(58, 184, 184, 255))
        draw.text((65, 19), title, font=picture.font(23, True), fill="white")
        width = draw.textlength(note, font=picture.font(19))
        draw.text((1860 - width, 23), note, font=picture.font(19), fill=(181, 209, 230, 255))
    if index == 1:
        draw.text((70, 736), "Every arrival.", font=picture.font(64, True), fill="white")
        draw.text((72, 818), "The next step.", font=picture.font(42), fill="white")
    if index == 24:
        draw.rectangle((0, 0, 1920, 1080), fill=(9, 23, 42, 210))
        logo = Image.open(ROOT / "attached_assets/cargomatch/logo.png").convert("RGBA")
        logo.thumbnail((840, 225))
        logo = logo.resize((round(logo.width * 1.6), round(logo.height * 1.6)), Image.Resampling.LANCZOS)
        image.alpha_composite(logo, ((1920 - logo.width) // 2, 242))
        draw = ImageDraw.Draw(image)
        for y, text in ((540, "The transport capacity"), (620, "intelligence network.")):
            width = draw.textlength(text, font=picture.font(58))
            draw.text(((1920 - width) / 2, y), text, font=picture.font(58), fill="white")
        text = "DISCOVER CARGOMATCH"
        width = draw.textlength(text, font=picture.font(24, True))
        draw.rounded_rectangle(((1920 - width) / 2 - 30, 772, (1920 + width) / 2 + 30, 834),
                               radius=8, fill=(22, 137, 141, 255))
        draw.text(((1920 - width) / 2, 788), text, font=picture.font(24, True), fill="white")
    path = BUILD / f"label-{index:02}.png"
    image.save(path)
    return path


def render_device(name):
    definition = json.loads((HERE / "shots.json").read_text())["devices"][name]
    plate, screen = definition["plate"], definition["screen"]
    if plate in ("planner", "receiver"):
        plate += "-clear"
    output = BUILD / f"device-{name}.mp4"
    paths = [Path(__file__), ROOT / "media/cargomatch/composite.py",
             ASSETS / "source" / f"plate-{plate}.mp4", ASSETS / "screens" / screen]
    stamp, digest, cached = revised_picture.cache_signature(output, definition, paths)
    if not cached:
        composite.render(plate, [(0, screen)], output)
        stamp.write_text(digest)
    return output


def render_film(edit, subtitles):
    protected = {str(p.relative_to(ROOT)): assemble.sha256(p) for p in (
        ROOT / "attached_assets/cargomatch/revised/cargomatch-en-nl-1080p.mp4",
        ROOT / "attached_assets/cargomatch/delivery/cargomatch-en-nl-1080p.mp4",
        ROOT / "attached_assets/cargomatch/audition/cargomatch-stem-montageproef.mp4")}
    shots = json.loads((HERE / "shots.json").read_text())
    revised_picture.SCENES = shots["scenes"]
    revised_picture.DEVICES = shots["devices"]
    revised_picture.render_device = render_device
    revised_picture.label_image = label_image
    master = revised_picture.render(edit)
    audio, measurement = revise.mix_audio(edit)
    total = edit["durationSeconds"]
    output = OUT / "cargomatch-en-nl-1080p.mp4"
    filters = (f"drawbox=x=0:y=930:w=1920:h=150:color=0x061421@0.95:t=fill,"
               f"ass='{subtitles}',fade=t=in:st=0:d=0.6,fade=t=out:st={total-1.05}:d=1")
    # Reserve audio and container overhead below the 100 MiB delivery limit.
    ceiling = min(4200, int(95 * 1024 * 1024 * 8 / total / 1000) - 220)
    disclosures = json.loads(SCRIPT.read_text())["disclosures"]
    assemble.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                  "-i", str(master), "-i", str(audio), "-map", "0:v:0", "-map", "1:a:0",
                  "-vf", filters, "-t", str(total), "-c:v", "libx264", "-preset", "fast",
                  "-crf", "20", "-maxrate", f"{ceiling}k", "-bufsize", f"{ceiling*2}k",
                  "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                  "-ar", "48000", "-ac", "2", "-movflags", "+faststart",
                  "-metadata", "title=CargoMatch - From arrival to delivery",
                  "-metadata", "comment=" + " ".join(disclosures), str(output)])
    assert output.stat().st_size < 104857600
    receipt = {"production": "CargoMatch — From arrival to delivery",
               "output": str(output.relative_to(ROOT)), "durationSeconds": total,
               "voice": json.loads(MANIFEST.read_text())["voice"], "voiceTimeStretch": 1,
               "outputSha256": assemble.sha256(output), "outputProbe": assemble.probe(output),
               "audio": {"mixInputMeasurement": measurement,
                         "finalMeasurement": assemble.loudnorm_measure(output, -16, -1.5)},
               "sources": {str(p.relative_to(ROOT)): assemble.sha256(p)
                           for p in sorted((ASSETS / "source").glob("*.mp4"))},
               "scriptSha256": assemble.sha256(SCRIPT), "manifestSha256": assemble.sha256(MANIFEST),
               "captureManifestSha256": assemble.sha256(ASSETS / "capture-manifest.json"),
               "rendererSha256": assemble.sha256(Path(__file__)),
               "originalsPreserved": protected,
               "disclosures": disclosures,
               "pacing": {"chapterGapSeconds": .55, "narrationTimeStretch": 1,
                          "alignment": "Fresh local word-level recognition aligned to the bilingual script"},
               "reviewLimits": "Representative visual review and technical measurements; no independent human listening session."}
    (OUT / "production-receipt.json").write_text(json.dumps(receipt, indent=2))
    for path, digest in protected.items():
        assert assemble.sha256(ROOT / path) == digest, "Protected film changed"
    print(json.dumps({"output": str(output), "seconds": total, "bytes": output.stat().st_size}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare-audio", action="store_true")
    parser.add_argument("--align", action="store_true")
    parser.add_argument("--timeline-only", action="store_true")
    args = parser.parse_args()
    configure()
    if args.prepare_audio:
        revise.prepare_audio(json.loads(MANIFEST.read_text()))
    elif args.align:
        align()
    else:
        edit, subtitles = timeline()
        if not args.timeline_only:
            render_film(edit, subtitles)


if __name__ == "__main__":
    main()