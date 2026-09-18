#!/usr/bin/env python3
"""Render speech-led picture edits, reusing the measured physical screen planes."""
from __future__ import annotations

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor

from assemble import ROOT, duration_of, sha256
from picture import BUILD, DEVICES, ENCODE, SCENES, SOURCE, ffmpeg, label_image, render_device

WORK = BUILD / "revised"
FPS = 24


def cache_signature(output, settings, paths):
    signature = hashlib.sha256(json.dumps(settings, sort_keys=True).encode())
    signature.update(__file__.encode())
    signature.update(sha256(ROOT / "media/cargomatch/revised_picture.py").encode())
    for path in paths:
        signature.update(sha256(path).encode())
    stamp = output.with_suffix(".fingerprint")
    digest = signature.hexdigest()
    return stamp, digest, output.is_file() and stamp.is_file() and stamp.read_text() == digest


def distribute_frames(total, weights):
    frames = [int(total * w / sum(weights)) for w in weights]
    for index in range(total - sum(frames)):
        frames[index % len(frames)] += 1
    return frames


def render_scene(scene):
    index = scene["id"]
    parts = SCENES[index - 1]
    output = WORK / f"scene-{index:02}.mp4"
    paths = [SOURCE / f"{name}.mp4" if kind == "source" else BUILD / f"device-{name}.mp4"
             for kind, name, _, _ in parts]
    overlay = label_image(index)
    stamp, digest, cached = cache_signature(output, scene, [*paths, overlay])
    if cached:
        return output
    # Short inserts retain pace. Six-frame dissolves soften location changes
    # without laying two readable product screens over each other for long.
    blend_frames = 6
    total_frames = scene["renderEndFrame"] - scene["renderStartFrame"]
    lengths = distribute_frames(total_frames + blend_frames * (len(parts) - 1),
                                [part[3] for part in parts])
    inputs, filters = [], []
    for number, ((kind, name, start, source_length), path, frames) in enumerate(zip(parts, paths, lengths)):
        # Skip initial wide framing for short single-screen scenes. The measured
        # replacement remains attached to its original footage at every frame.
        if kind == "device" and len(parts) == 1 and name not in ("consent", "air"):
            start, source_length = (2.0, 5.0) if name in ("driver", "nextload") else (1.5, 5.5)
        length = frames / FPS
        inputs += ["-ss", str(start), "-t", str(source_length), "-i", str(path)]
        filters.append(f"[{number}:v]settb=1/24,setpts=(PTS-STARTPTS)*{length/source_length:.9f},"
                       f"fps=24,tpad=stop_mode=clone:stop_duration=0.1,"
                       f"trim=end_frame={frames},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[v{number}]")
    running, label = lengths[0], "v0"
    for number in range(1, len(parts)):
        offset = running - blend_frames
        filters.append(f"[{label}][v{number}]xfade=transition=fade:duration={blend_frames/FPS}:"
                       f"offset={offset/FPS:.9f}[part{number}]")
        label, running = f"part{number}", offset + lengths[number]
    inputs += ["-loop", "1", "-i", str(overlay)]
    filters.append(f"[{label}][{len(parts)}:v]overlay=0:0:format=auto,format=yuv420p[out]")
    ffmpeg(*inputs, "-filter_complex_threads", "1", "-filter_complex", ";".join(filters),
           "-map", "[out]", "-frames:v", total_frames, *ENCODE, output)
    stamp.write_text(digest)
    print(f"Revised picture scene {index:02}: {total_frames/FPS:.2f}s", flush=True)
    return output


def join(nodes, output):
    """Join a bounded batch so FFmpeg does not buffer 24 HD inputs together."""
    stamp, digest, cached = cache_signature(output,
                                           [{k: v for k, v in n.items() if k != "path"} for n in nodes],
                                           [n["path"] for n in nodes])
    if cached:
        return {"path": output, "start": nodes[0]["start"], "end": nodes[-1]["end"]}
    inputs, filters = [], []
    for index, node in enumerate(nodes):
        inputs += ["-i", str(node["path"])]
        filters.append(f"[{index}:v]settb=1/24,setpts=PTS-STARTPTS,format=yuv420p[v{index}]")
    label = "v0"
    for index in range(1, len(nodes)):
        overlap = nodes[index - 1]["end"] - nodes[index]["start"]
        assert overlap > 0
        offset = nodes[index]["start"] - nodes[0]["start"]
        filters.append(f"[{label}][v{index}]xfade=transition=fade:duration={overlap/FPS:.9f}:"
                       f"offset={offset/FPS:.9f}[j{index}]")
        label = f"j{index}"
    total_frames = nodes[-1]["end"] - nodes[0]["start"]
    ffmpeg(*inputs, "-filter_complex_threads", "1", "-filter_complex", ";".join(filters),
           "-map", f"[{label}]", "-frames:v", total_frames, *ENCODE, output)
    assert abs(duration_of(output) - total_frames / FPS) < .05
    stamp.write_text(digest)
    return {"path": output, "start": nodes[0]["start"], "end": nodes[-1]["end"]}


def render(timeline):
    WORK.mkdir(parents=True, exist_ok=True)
    # The existing source/screenshot fingerprint check prevents reusing stale
    # device composites after a changed screenshot. It does not recapture UI.
    for name in DEVICES:
        render_device(name)
    with ThreadPoolExecutor(max_workers=2) as pool:
        paths = list(pool.map(render_scene, timeline["scenes"]))
    by_id = {scene["id"]: {"path": path, "start": scene["renderStartFrame"],
                           "end": scene["renderEndFrame"]}
             for scene, path in zip(timeline["scenes"], paths)}
    chapters = []
    for group in timeline["groups"]:
        chapters.append(join([by_id[i] for i in group["ids"]], WORK / f"chapter-{group['id']}.mp4"))
    return join(chapters, WORK / "picture-master.mp4")["path"]