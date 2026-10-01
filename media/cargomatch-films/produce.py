#!/usr/bin/env python3
"""Isolated, resumable film producer; approved earlier exports stay read-only."""
from __future__ import annotations
import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("flow_reference", ROOT / "media/cargomatch-import/flow/render.py")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
a = r.a
PROTECTED = [
    ROOT / "attached_assets/cargomatch-import/flow/cargomatch-en-nl-1080p.mp4",
    ROOT / "attached_assets/cargomatch-import/delivery/cargomatch-en-nl-1080p.mp4",
    ROOT / "attached_assets/cargomatch/revised/cargomatch-en-nl-1080p.mp4",
    ROOT / "attached_assets/cargomatch/delivery/cargomatch-en-nl-1080p.mp4",
]


def configure(name):
    r.HERE = HERE / name
    r.SCRIPT = r.HERE / "production.json"
    r.MANIFEST = r.HERE / "narration.json"
    r.ASSETS = ROOT / "attached_assets/cargomatch-films" / name
    r.OUT = r.ASSETS
    r.BUILD = r.HERE / "build"
    script = json.loads(r.SCRIPT.read_text())
    r.SHOTS = [(s["ids"], s["source"], s.get("screens", []), s["heading"]) for s in script["shots"]]
    r.configure()
    r.aligner.normalized_tokens = base_tokens
    r.aligner.transcription_words = base_transcription
    for folder in ("audio", "source", "screens"):
        (r.ASSETS / folder).mkdir(exist_ok=True)
    for source in {s[1] for s in r.SHOTS}:
        target = r.ASSETS / "source" / f"{source}.mp4"
        options = [
            ROOT / "attached_assets/cargomatch-films/source" / f"{source}.mp4",
            ROOT / "attached_assets/cargomatch-import/source" / f"{source}.mp4",
            ROOT / "attached_assets/cargomatch/source" / f"{source}.mp4",
        ]
        original = next((p for p in options if p.exists()), None)
        if original and not target.exists():
            target.symlink_to(original)
    voice = json.loads((ROOT / "media/cargomatch-import/flow/narration.json").read_text())["voice"]
    r.write(r.MANIFEST, {
        "voice": voice,
        "deliveryDirection": "One uninterrupted documentary take. Same voice and speed as approved reference.",
        "groups": [{"id": "story", "ids": [x["id"] for x in script["narration"]],
                    "text": " ".join(x["en"] for x in script["narration"]),
                    "path": str((r.OUT / "audio/story.mp3").relative_to(ROOT))}],
    })
    r.label = lambda scene: label(scene, script["title"])
    return script


base_tokens = r.aligner.normalized_tokens
base_transcription = r.aligner.transcription_words


def label(scene, title):
    image = r.Image.new("RGBA", (1920, 1080))
    d = r.ImageDraw.Draw(image)
    if scene["heading"]:
        d.rectangle((0, 0, 1920, 64), fill=(12, 24, 41, 238))
        d.rectangle((42, 20, 47, 44), fill=(58, 184, 184, 255))
        d.text((65, 19), scene["heading"], font=r.picture.font(23, True), fill="white")
    if scene["id"] == 1:
        d.text((70, 765), title.split(" — ")[-1] + ".", font=r.picture.font(58, True), fill="white")
    if scene["id"] == len(r.SHOTS):
        d.rectangle((0, 0, 1920, 1080), fill=(9, 23, 42, 210))
        logo = r.Image.open(ROOT / "attached_assets/cargomatch/logo.png").convert("RGBA")
        logo.thumbnail((840, 225))
        image.alpha_composite(logo, ((1920 - logo.width)//2, 245))
        for y, text in [(520, "The transport capacity"), (598, "intelligence network."), (775, "DISCOVER CARGOMATCH")]:
            font = r.picture.font(52 if y < 700 else 25, True)
            d.text(((1920-d.textlength(text, font=font))/2, y), text, font=font, fill="white")
    return r.np.array(image)


def nodes(edit):
    return [{"path": r.BUILD / f"shot-{s['id']:02}.mp4",
             "start": s["renderStartFrame"], "end": s["renderEndFrame"]} for s in edit["scenes"]]


def proof(edit):
    # Two physical transitions and a screen-only change, with uninterrupted voice.
    selection = edit["scenes"][2:5]
    ns = [{"path": r.render_scene(s), "start": s["renderStartFrame"], "end": s["renderEndFrame"]} for s in selection]
    picture = r.rp.join(ns, r.BUILD / "proof-picture.mp4")["path"]
    start = ns[0]["start"] / 24
    duration = (ns[-1]["end"] - ns[0]["start"]) / 24
    a.run(["ffmpeg", "-y", "-v", "error", "-i", str(picture),
           "-ss", str(start-.65), "-i", str(r.OUT / "audio/story-normalized.wav"),
           "-map", "0:v", "-map", "1:a", "-t", str(duration), "-c:v", "copy", "-c:a", "aac",
           "-movflags", "+faststart", str(r.BUILD / "representative-proof.mp4")])


def final(edit, script, name):
    assert (r.BUILD / "representative-proof.mp4").exists(), "Create moving proof before final export."
    master = r.BUILD / "picture-master.mp4"
    assert master.exists(), "Complete bounded joins first."
    audio, measurement = r.mix(edit)
    duration = edit["durationSeconds"]
    movie = r.OUT / f"cargomatch-{name}-en-nl-1080p.mp4"
    ceiling = min(4200, int(94*1024*1024*8/duration/1000)-220)
    filters = (f"drawbox=x=0:y=930:w=1920:h=150:color=0x061421@0.95:t=fill,"
               f"ass='{r.OUT/'cargomatch-nl.ass'}',fade=t=in:d=0.6,fade=t=out:st={duration-1.05}:d=1")
    a.run(["ffmpeg", "-y", "-v", "error", "-i", str(master), "-i", str(audio),
           "-map", "0:v", "-map", "1:a", "-vf", filters, "-t", str(duration),
           "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-maxrate", f"{ceiling}k",
           "-bufsize", f"{ceiling*2}k", "-threads", "2", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart",
           "-metadata", "title=" + script["title"], "-metadata", "comment=" + " ".join(script["disclosures"]), str(movie)])
    assert movie.stat().st_size < 104857600
    r.write(r.OUT / "production-receipt.json", {
        "output": str(movie.relative_to(ROOT)), "outputSha256": a.sha256(movie),
        "durationSeconds": duration, "bytes": movie.stat().st_size,
        "voice": json.loads(r.MANIFEST.read_text())["voice"], "narrationTakes": 1, "voiceTimeStretch": 1,
        "disclosures": script["disclosures"], "mixInputMeasurement": measurement,
        "audio": {"finalMeasurement": a.loudnorm_measure(movie, -16, -1.5)},
        "originalsPreserved": json.loads((HERE / "original-hashes.json").read_text()),
        "rendererSha256": a.sha256(Path(__file__)), "scriptSha256": a.sha256(r.SCRIPT),
        "reviewLimits": "Technical checks and sampled images; no independent human listening assessment.",
    })


def main():
    p = argparse.ArgumentParser()
    p.add_argument("film", choices=["brokerage", "groupage"])
    p.add_argument("stage", choices=["init", "prepare", "align", "timeline", "shot", "proof", "batch", "join", "final"])
    p.add_argument("--index", type=int, default=1)
    args = p.parse_args()
    script = configure(args.film)
    protection = HERE / "original-hashes.json"
    if not protection.exists():
        r.write(protection, {str(x.relative_to(ROOT)): a.sha256(x) for x in PROTECTED})
    original_hashes = json.loads(protection.read_text())
    if args.stage == "init":
        return
    if args.stage == "prepare":
        return r.prepare()
    if args.stage == "align":
        sys.argv = ["align", "--output", str(r.OUT / "alignment.json")]
        return r.aligner.main()
    edit = r.timeline()
    if args.stage == "shot":
        r.render_scene(edit["scenes"][args.index-1])
    elif args.stage == "proof":
        proof(edit)
    elif args.stage == "batch":
        ns = nodes(edit)
        i = (args.index-1)*3
        r.rp.join(ns[i:i+3], r.BUILD / f"batch-{args.index}.mp4")
    elif args.stage == "join":
        ns = nodes(edit)
        batches = [{"path": r.BUILD / f"batch-{i//3+1}.mp4",
                    "start": ns[i]["start"], "end": ns[min(i+2,len(ns)-1)]["end"]} for i in range(0,len(ns),3)]
        # The long assembly is an intermediate, not the delivery encode.
        # Spend storage instead of exceeding bounded execution time.
        r.rp.ENCODE = ["ultrafast" if x == "fast" else x for x in r.rp.ENCODE]
        r.rp.join(batches, r.BUILD / "picture-master.mp4")
    elif args.stage == "final":
        final(edit, script, args.film)
    assert all(a.sha256(ROOT / path) == digest for path, digest in original_hashes.items())


if __name__ == "__main__":
    main()