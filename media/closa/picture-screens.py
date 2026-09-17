#!/usr/bin/env python3
"""Render the shared picture edit; unchanged originals remain untouched."""
from concurrent.futures import ThreadPoolExecutor
import argparse
import json
import subprocess
from pathlib import Path
from screen_composite import ROOT, SOURCE, BUILD, render

OLD = ROOT / "attached_assets/closa/source"
SCENES = {
    2: ("profile", [(0, 8), (3.5, 5)], 7.5, .125, 7.625),
    3: ("profile", [(0, 4)], 7.5, .125, 7.625),
    4: ("listings", [(0, 1)], 7.5, .125, 7.625),
    5: ("listings", [(0, 2)], 7.5, 5.5, 7.8),
    6: ("vault", [(0, 6)], 7.5, .125, 7.625),
    7: ("vault", [(0, 7)], 7.5, 5.5, 7.8),
    8: ("listings", [(0, 3)], 7.5, .125, 7.625),
    10: ("profile", [(0, 9)], 4, 5.5, 7.8),
}
ENCODE = ["-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
          "-threads", "2", "-pix_fmt", "yuv420p", "-r", "24", "-g", "48",
          "-video_track_timescale", "12288", "-movflags", "+faststart"]


def ffmpeg(args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    *map(str, args)], check=True)


def concat(paths, destination):
    manifest = destination.with_suffix(".txt")
    manifest.write_text("".join(f"file '{p.as_posix()}'\n" for p in paths))
    ffmpeg(["-f", "concat", "-safe", "0", "-i", manifest, "-map", "0:v:0",
            "-c:v", "copy", "-an", "-movflags", "+faststart", destination])


def scene(number):
    out = BUILD / f"scene-{number:02}.mp4"
    if number in (1, 9):
        original = 1 if number == 1 else 8
        ffmpeg(["-ss", "0.2", "-i", OLD / f"shot-{original:02}.mp4",
                "-t", "7.5", "-vf", "fps=24,setsar=1", *ENCODE, out])
    else:
        plate, screens, seconds, start, end = SCENES[number]
        target = BUILD / "closing-explore.mp4" if number == 10 else out
        render(plate, screens, target, seconds, start, end)
        if number == 10:
            final = BUILD / "closing-logo.mp4"
            # Static real logo over retained luxury-property footage.
            filters = (
                "[0:v]fps=24,setsar=1,drawbox=x=0:y=0:w=iw:h=ih:"
                "color=black@0.65:t=fill,"
                "drawbox=x=670:y=410:w=580:h=260:color=0x0B0D0E@0.97:t=fill[b];"
                "[1:v]scale=320:-1:flags=lanczos,format=rgba[l];"
                "[b][l]overlay=x=(W-w)/2:y=(H-h)/2:format=auto[v]"
            )
            ffmpeg(["-ss", "3", "-i", OLD / "shot-10.mp4",
                    "-loop", "1", "-i", SOURCE / "logo.png",
                    "-filter_complex_threads", "1", "-filter_complex", filters,
                    "-map", "[v]", "-t", "3.5", *ENCODE, final])
            concat([target, final], out)
    print(f"Scene {number:02} ready", flush=True)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scene", type=int, choices=range(1, 11))
    parser.add_argument("--reuse-scenes", action="store_true",
                        help="Reuse complete scene files ONLY when their picture inputs are unchanged.")
    args = parser.parse_args()
    BUILD.mkdir(parents=True, exist_ok=True)
    if args.scene:
        scene(args.scene)
        return
    def prepare(i):
        path = BUILD / f"scene-{i:02}.mp4"
        if args.reuse_scenes and path.is_file():
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "csv=p=0", str(path)], text=True, capture_output=True)
            if result.returncode == 0 and abs(float(result.stdout) - 7.5) < .01:
                print(f"Reused complete scene {i:02}", flush=True)
                return path
        return scene(i)
    with ThreadPoolExecutor(max_workers=2) as pool:
        paths = list(pool.map(prepare, range(1, 11)))
    concat(paths, BUILD / "picture-master.mp4")
    (BUILD / "picture-edit.json").write_text(json.dumps({
        "duration": 75, "fps": 24, "scenes": {
            str(i): {"start": (i - 1) * 7.5, "end": i * 7.5,
                     "file": str(p.relative_to(ROOT))}
            for i, p in enumerate(paths, 1)},
        "screenIds": sorted({n for spec in SCENES.values() for _, n in spec[1]}),
        "disclosure": "Photorealistic AI human footage; actual supplied screenshot pixels",
    }, indent=2))
    print("Shared 75-second picture master ready.", flush=True)


if __name__ == "__main__":
    main()