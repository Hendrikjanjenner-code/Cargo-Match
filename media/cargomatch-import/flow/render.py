#!/usr/bin/env python3
"""Continuous-shot revision: one voice read, one physical camera clock per shot."""
from __future__ import annotations
import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
ASSETS = ROOT / "attached_assets/cargomatch-import"
OUT = ASSETS / "flow"
BUILD = HERE / "build"
sys.path.insert(0, str(ROOT / "media/cargomatch"))
import assemble as a
import align_narration as aligner
import composite as c
import picture
import revised_picture as rp

FPS = 24
SCRIPT = HERE / "production.json"
MANIFEST = HERE / "narration.json"
# ids, physical source, (narration id, authentic screenshot), persistent heading
SHOTS = [
    ([1], "port", [], "ONE CONNECTED JOURNEY"),
    ([2], "plate-import", [(2, "01-import-overview.png")], "CHINA / YANTIAN → ROTTERDAM → EINDHOVEN"),
    ([3, 4], "plate-customs", [(3, "03-exceptions-180kg.png"), (4, "06b-weight-confirmed.png")], "DOCUMENTS / HUMAN REVIEW"),
    ([5], "plate-planner-clear", [(5, "08-partners.png")], "PARTNERS / ROLE-BASED ACCESS"),
    ([6, 7], "plate-customs", [(6, "10-customs-human-review.png"), (7, "13-customs-released.png")], "CUSTOMS / SIMULATED"),
    ([8, 9, 10], "plate-planner-clear", [(8, "14-charges-95707.png"), (9, "16-release-gates.png"), (10, "16b-release-gates-satisfied.png")], "CHARGES AND RELEASE / SIMULATED"),
    ([11], "truck", [], "FROM PORT TO HINTERLAND"),
    ([12, 13], "plate-planner-clear", [(12, "17d-delivery-connected.png"), (13, "17e-delivery-planned.png")], "MUTUAL CONSENT / CONNECTION IS NOT A BOOKING"),
    ([14], "warehouse", [], "THE HANDOVER"),
    ([15, 16], "plate-receiver-clear", [(15, "20-india-receiver-private.png"), (16, "23-india-delivery-choice.png")], "INDIA / ONLY THE RECEIVER'S OWN SHIPMENT"),
    ([17, 18], "plate-import", [(17, "18-control-geographic.png"), (18, "19-vessel-jade-horizon.png")], "CONTROL TOWER / SYNTHETIC DEMO, NOT LIVE AIS"),
    ([19, 20], "port", [], ""),
]


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def configure():
    BUILD.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    c.SOURCE, c.SCREENS, c.BUILD = ASSETS / "source", ASSETS / "screens", BUILD
    rp.WORK = BUILD
    aligner.MANIFEST, aligner.PRODUCTION = MANIFEST, SCRIPT
    aligner.NORMALIZED_DIR = OUT / "audio"
    # Use the already proven number normalization from the import producer.
    sys.path.insert(0, str(ROOT / "media/cargomatch-import"))
    import build_film
    aligner.normalized_tokens = build_film.import_tokens
    aligner.transcription_words = build_film.import_transcription


def prepare():
    source = OUT / "audio/story.mp3"
    target = OUT / "audio/story-normalized.wav"
    measurement = a.normalize_file(source, target, -18, -3, trim_silence=True)
    write(OUT / "audio/normalization.json", {"sourceSha256": a.sha256(source),
          "normalizedSha256": a.sha256(target), "measurement": measurement})


def timeline():
    alignment = json.loads((OUT / "alignment.json").read_text())
    assert alignment["manifestSha256"] == a.sha256(MANIFEST)
    assert alignment["scriptSha256"] == a.sha256(SCRIPT)
    group = alignment["groups"][0]
    assert len(alignment["groups"]) == 1
    voice = OUT / "audio/story-normalized.wav"
    assert group["normalizedSha256"] == a.sha256(voice)
    items = {x["id"]: {**x, "start": x["start"] + .65, "end": x["end"] + .65} for x in group["items"]}
    frames = math.ceil((a.duration_of(voice) + 1.9) * FPS)
    cuts = [0] + [round((items[ids[0]]["start"] + .10) * FPS) for ids, *_ in SHOTS[1:]] + [frames]
    scenes = []
    for i, (ids, source, screens, heading) in enumerate(SHOTS):
        start = cuts[i] - (8 if i else 0)
        end = cuts[i + 1] + (8 if i < len(SHOTS) - 1 else 0)
        changes = [{"frame": max(0, round((items[n]["start"] + .10)*FPS)-start),
                    "screen": screen} for n, screen in screens]
        if changes:
            changes[0]["frame"] = 0
        scenes.append({"id": i+1, "ids": ids, "source": source, "heading": heading,
                       "start": cuts[i]/FPS, "end": cuts[i+1]/FPS,
                       "renderStartFrame": start, "renderEndFrame": end, "screens": changes})
    script = json.loads(SCRIPT.read_text())
    cues = [{"slotId": x["id"], "sentence": 1, "start": items[x["id"]]["start"],
             "end": items[x["id"]]["end"], "english": x["en"], "dutch": x["nl"],
             "lines": a.wrap_subtitle(x["nl"])} for x in script["narration"]]
    a.write_subtitles(cues, OUT)
    cue_path = OUT / "subtitle-cues.json"
    cue_data = json.loads(cue_path.read_text())
    cue_data.update(generatedFrom=str(SCRIPT.relative_to(ROOT)),
                    timingBasis="Fresh word alignment against one uninterrupted normalized story read.",
                    alignmentEvidence=str((OUT / "alignment.json").relative_to(ROOT)))
    write(cue_path, cue_data)
    edit = {"durationSeconds": frames/FPS, "frames": frames, "fps": FPS, "scenes": scenes,
            "chapterGapSeconds": 0, "voiceTimeStretch": 1,
            "narration": {"path": str(voice.relative_to(ROOT)), "start": .65, "takes": 1},
            "transitions": [{"start": s["renderStartFrame"]/FPS, "duration": 16/FPS,
                             "kind": "context dissolve"} for s in scenes[1:]],
            "screenTransitionFrames": 6, "cameraClock": "One continuous linear source clock per whole physical shot; never reset for screen changes."}
    write(OUT / "edit-timeline.json", edit)
    return edit


def label(scene):
    image = Image.new("RGBA", (1920, 1080))
    d = ImageDraw.Draw(image)
    if scene["heading"]:
        d.rectangle((0, 0, 1920, 64), fill=(12, 24, 41, 238))
        d.rectangle((42, 20, 47, 44), fill=(58, 184, 184, 255))
        d.text((65, 19), scene["heading"], font=picture.font(23, True), fill="white")
    if scene["id"] == 1:
        d.text((70, 765), "One connected journey.", font=picture.font(58, True), fill="white")
    if scene["id"] == len(SHOTS):
        d.rectangle((0, 0, 1920, 1080), fill=(9, 23, 42, 210))
        logo = Image.open(ROOT / "attached_assets/cargomatch/logo.png").convert("RGBA")
        logo.thumbnail((840, 225))
        image.alpha_composite(logo, ((1920-logo.width)//2, 245))
        d = ImageDraw.Draw(image)
        for y, text in [(520, "The transport capacity"), (598, "intelligence network."), (775, "DISCOVER CARGOMATCH")]:
            font = picture.font(52 if y < 700 else 25, True)
            width = d.textlength(text, font=font)
            d.text(((1920-width)/2, y), text, font=font, fill="white")
    return np.array(image)


def render_scene(scene):
    """Resample whole physical shot smoothly, then project screen changes into it.

    Optical-flow motion interpolation is applied BEFORE screen replacement, so
    UI text is never warped by optical flow and its geometry stays measured.
    """
    output = BUILD / f"shot-{scene['id']:02}.mp4"
    source = ASSETS / "source" / (scene["source"] + ".mp4")
    sources = [Path(__file__), source, ROOT / "media/cargomatch/composite.py",
               ROOT / "attached_assets/cargomatch/logo.png"]
    sources += [ASSETS / "screens" / x["screen"] for x in scene["screens"]]
    settings = {"scene": scene, "sourceStart": .25, "sourceEnd": 7.5,
                "interpolation": "FFmpeg motion-compensated minterpolate at 960x540, restored to 1080p before full-resolution screen replacement"}
    stamp, digest, cached = rp.cache_signature(output, settings, sources)
    if cached and output.with_suffix(".json").exists():
        return output
    count = scene["renderEndFrame"] - scene["renderStartFrame"]
    # Reserve end frames for minterpolate's forward lookahead.
    target_duration = (count + 3) / FPS
    slow = BUILD / f"motion-{scene['id']:02}.mp4"
    motion_stamp, motion_digest, motion_cached = rp.cache_signature(
        slow, {"count": count, "settings": settings}, [source])
    if not motion_cached:
        a.run(["ffmpeg", "-y", "-v", "error", "-ss", "0.25", "-t", "7.5", "-i", str(source),
               "-an", "-vf", f"scale=960:540,setpts=(PTS-STARTPTS)*{target_duration/7.25:.10f},"
               "minterpolate=fps=24:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,"
               f"trim=end_frame={count},setpts=PTS-STARTPTS,scale=1920:1080:flags=lanczos",
               "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-threads", "2",
               "-pix_fmt", "yuv420p", str(slow)])
        assert int(a.probe(slow)["streams"][0]["nb_frames"]) >= count
        motion_stamp.write_text(motion_digest)
    cap = cv2.VideoCapture(str(slow))
    panels = {x["screen"]: c.fit_panel(x["screen"], (1600, 1000))[0] for x in scene["screens"]}
    overlay = label(scene)
    alpha = overlay[:, :, 3:4].astype(np.float32)/255
    foreground = cv2.cvtColor(overlay[:, :, :3], cv2.COLOR_RGB2BGR).astype(np.float32)
    proc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-s", "1920x1080", "-r", "24", "-i", "-", "-an", "-c:v", "libx264",
        "-preset", "fast", "-crf", "18", "-threads", "2", "-pix_fmt", "yuv420p", str(output)], stdin=subprocess.PIPE)
    geometry = []
    # Measure the exact motion-compensated plate, not corners from another clock.
    points = c.track(slow) if panels else None
    try:
        for i in range(count):
            ok, frame = cap.read()
            assert ok, (scene["id"], i)
            if panels:
                q = points[i]
                # Constant framing: no zoom restart when a screenshot changes.
                frame, q = c.reframe(frame, q, 1.0)
                active = max(n for n, change in enumerate(scene["screens"]) if change["frame"] <= i)
                change = scene["screens"][active]
                panel = panels[change["screen"]]
                blend = min(1., (i-change["frame"]+1)/6) if active else 1.
                if blend < 1:
                    panel = cv2.addWeighted(panels[scene["screens"][active-1]["screen"]], 1-blend, panel, blend, 0)
                frame = c.replace(frame, q, panel)
                geometry.append({"frame": i, "sourceTime": .25+i/FPS*7.25/target_duration,
                    "screen": change["screen"], "screenBlend": blend,
                    "corners": q.tolist(), "screenBounds": [float(q[:,0].min()), float(q[:,1].min()),
                                                          float(q[:,0].max()), float(q[:,1].max())]})
            frame = np.clip(foreground*alpha + frame*(1-alpha), 0, 255).astype(np.uint8)
            proc.stdin.write(frame.tobytes())
            if i in (0, count//2, count-1):
                cv2.imwrite(str(BUILD/f"shot-{scene['id']:02}-{i}.jpg"), frame)
    finally:
        cap.release()
        proc.stdin.close()
        code = proc.wait()
    assert code == 0
    write(output.with_suffix(".json"), {"scene": scene, "frames": geometry, "outputFrames": count,
          "sourceSha256": a.sha256(source), "screens": {p: a.sha256(ASSETS/"screens"/p) for p in panels},
          "motionInterpolation": settings["interpolation"], "cameraResetsAtScreenChanges": 0})
    stamp.write_text(digest)
    print(f"Rendered continuous shot {scene['id']}, {count/FPS:.2f}s", flush=True)
    return output


def mix(edit):
    total = edit["durationSeconds"]
    music = OUT / "audio/music-normalized.wav"
    a.normalize_file(ROOT/"attached_assets/cargomatch/audio/music.mp3", music, -31, -4, duration=total)
    for name in ("port", "road"):
        a.normalize_file(ROOT/f"attached_assets/cargomatch/audio/{name}.mp3", OUT/f"audio/{name}-ambience.wav", -38, -6)
    road_ms = round(edit["scenes"][6]["start"]*1000)
    filters = (f"[0:a]adelay=650|650,apad,atrim=duration={total}[v];"
        f"[1:a]afade=t=in:d=0.65,afade=t=out:st={total-1.15}:d=1.15[m];"
        f"[2:a]atrim=duration=7,afade=t=in:d=0.5,afade=t=out:st=5:d=2,adelay=200|200[p];"
        f"[3:a]atrim=duration=7,afade=t=in:d=0.5,afade=t=out:st=5:d=2,adelay={road_ms}|{road_ms}[r];"
        "[v][m][p][r]amix=inputs=4:normalize=0[out]")
    raw = OUT/"audio/mix-raw.wav"
    a.run(["ffmpeg", "-y", "-v", "error", "-i", str(OUT/"audio/story-normalized.wav"),
           "-i", str(music), "-i", str(OUT/"audio/port-ambience.wav"), "-i", str(OUT/"audio/road-ambience.wav"),
           "-filter_complex", filters, "-map", "[out]", "-t", str(total), "-c:a", "pcm_s24le", str(raw)])
    final = OUT/"audio/mix.wav"
    measurement = a.normalize_file(raw, final, -16, -1.5)
    return final, measurement


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare-audio", action="store_true")
    parser.add_argument("--align", action="store_true")
    parser.add_argument("--proof", action="store_true")
    args = parser.parse_args()
    configure()
    if args.prepare_audio:
        return prepare()
    if args.align:
        sys.argv = ["align", "--output", str(OUT/"alignment.json")]
        return aligner.main()
    protected_paths = [ROOT/"attached_assets/cargomatch-import/delivery/cargomatch-en-nl-1080p.mp4",
                       ROOT/"attached_assets/cargomatch/revised/cargomatch-en-nl-1080p.mp4",
                       ROOT/"attached_assets/cargomatch/delivery/cargomatch-en-nl-1080p.mp4"]
    protected = {str(p.relative_to(ROOT)): a.sha256(p) for p in protected_paths}
    edit = timeline()
    if args.proof:
        scene = edit["scenes"][2]
        rendered = render_scene(scene)
        start, duration = scene["renderStartFrame"]/FPS, (scene["renderEndFrame"]-scene["renderStartFrame"])/FPS
        a.run(["ffmpeg", "-y", "-v", "error", "-i", str(rendered),
               "-ss", str(max(0,start-.65)), "-i", str(OUT/"audio/story-normalized.wav"),
               "-map", "0:v", "-map", "1:a", "-t", str(duration),
               "-c:v", "copy", "-c:a", "aac", str(BUILD/"representative-proof.mp4")])
        return
    assert (BUILD/"representative-proof.mp4").exists(), "Review representative moving proof first"
    nodes = [{"path": render_scene(s), "start": s["renderStartFrame"], "end": s["renderEndFrame"]} for s in edit["scenes"]]
    batches = [rp.join(nodes[i:i+3], BUILD/f"batch-{i//3}.mp4") for i in range(0,len(nodes),3)]
    master = rp.join(batches, BUILD/"picture-master.mp4")["path"]
    audio, measurement = mix(edit)
    total = edit["durationSeconds"]
    movie = OUT/"cargomatch-en-nl-1080p.mp4"
    ceiling = min(4200, int(94*1024*1024*8/total/1000)-220)
    filters = (f"drawbox=x=0:y=930:w=1920:h=150:color=0x061421@0.95:t=fill,"
               f"ass='{OUT/'cargomatch-nl.ass'}',fade=t=in:d=0.6,fade=t=out:st={total-1.05}:d=1")
    disclosure = json.loads((HERE.parent/"production.json").read_text())["disclosures"]
    a.run(["ffmpeg", "-y", "-v", "error", "-i", str(master), "-i", str(audio),
           "-map", "0:v", "-map", "1:a", "-vf", filters, "-t", str(total),
           "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-maxrate", f"{ceiling}k",
           "-bufsize", f"{ceiling*2}k", "-threads", "2", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart",
           "-metadata", "title=CargoMatch - One connected journey",
           "-metadata", "comment="+" ".join(disclosure), str(movie)])
    assert movie.stat().st_size < 104857600
    assert all(a.sha256(ROOT/p)==h for p,h in protected.items())
    write(OUT/"production-receipt.json", {"output": str(movie.relative_to(ROOT)), "outputSha256": a.sha256(movie),
          "durationSeconds": total, "bytes": movie.stat().st_size, "voice": json.loads(MANIFEST.read_text())["voice"],
          "narrationTakes": 1, "voiceTimeStretch": 1, "insertedChapterPauses": 0,
          "originalsPreserved": protected, "audio": {"mixInputMeasurement": measurement,
          "finalMeasurement": a.loudnorm_measure(movie,-16,-1.5)}, "disclosures": disclosure,
          "scriptSha256": a.sha256(SCRIPT), "manifestSha256": a.sha256(MANIFEST),
          "rendererSha256": a.sha256(Path(__file__)), "captureManifestSha256": a.sha256(ASSETS/"capture-manifest.json"),
          "motionMethod": "Continuous optical-flow-resampled physical source per shot; screen-only six-frame blends; no camera reset at screen changes.",
          "reviewLimits": "Technical motion/frame and browser playback checks plus sampled image review; no independent human listening assessment."})
    print(json.dumps({"output":str(movie),"seconds":total,"bytes":movie.stat().st_size}), flush=True)


if __name__ == "__main__":
    main()