#!/usr/bin/env python3
"""Measured live-action screen replacement; original application pixels only."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "attached_assets/cargomatch/source"
SCREENS = ROOT / "attached_assets/cargomatch/screens"
BUILD = ROOT / "media/cargomatch/build"
SIZE, FPS = (1920, 1080), 24
cv2.setNumThreads(2)


def chroma(frame):
    return cv2.inRange(cv2.cvtColor(frame, cv2.COLOR_BGR2HSV),
                       np.array([135, 65, 60]), np.array([175, 255, 255]))


def measure(frame):
    contours, _ = cv2.findContours(chroma(frame), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        raise ValueError("No replacement display")
    contour = max(contours, key=cv2.contourArea)
    hull = cv2.convexHull(contour)
    poly = cv2.approxPolyDP(hull, .018 * cv2.arcLength(hull, True), True)
    if len(poly) != 4 or cv2.contourArea(contour) < 15000:
        raise ValueError("Display is occluded, too small or non-quadrilateral")
    p = poly.reshape(4, 2).astype(np.float32)
    sums, diff = p.sum(axis=1), np.diff(p, axis=1).ravel()
    p = p[[np.argmin(sums), np.argmin(diff), np.argmax(sums), np.argmax(diff)]]
    boundary, lines = contour.reshape(-1, 2).astype(np.float32), []
    for i in range(4):
        a, b = p[i], p[(i + 1) % 4]
        delta, length = b - a, np.linalg.norm(b - a)
        rel = boundary - a
        distance = np.abs(delta[0] * rel[:, 1] - delta[1] * rel[:, 0]) / length
        along = rel @ delta / length ** 2
        samples = boundary[(distance < 5) & (along > .08) & (along < .92)]
        if len(samples) < length * .45:
            # Rounded phone corners bias the initial polygon inwards. Broaden
            # the edge-fit band, still excluding the curved corner endpoints.
            samples = boundary[(distance < 16) & (along > .12) & (along < .88)]
        if len(samples) < 8:
            raise ValueError("Insufficient edge samples")
        vx, vy, x, y = cv2.fitLine(samples, cv2.DIST_L2, 0, .01, .01).ravel()
        lines.append((np.array([x, y]), np.array([vx, vy])))
    refined = []
    for i in range(4):
        a, u = lines[(i - 1) % 4]
        b, v = lines[i]
        t = np.linalg.solve(np.column_stack([u, -v]), b - a)[0]
        refined.append(a + t * u)
    q = np.array(refined, dtype=np.float32)
    fill = cv2.contourArea(contour) / cv2.contourArea(q)
    if not .93 < fill < 1.04:
        raise ValueError(f"Unreliable screen-plane fill: {fill}")
    if np.any(q < 0) or np.any(q[:, 0] > 1919) or np.any(q[:, 1] > 1079):
        raise ValueError("Screen corner outside source frame")
    return q, fill


def track(plate):
    BUILD.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(plate.read_bytes()).hexdigest()
    cache = BUILD / f"{plate.stem}-tracking.json"
    if cache.exists():
        data = json.loads(cache.read_text())
        if data["sourceSha256"] == digest:
            return np.array(data["corners"], dtype=np.float32)
    cap = cv2.VideoCapture(str(plate))
    actual = (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    if actual != SIZE or abs(cap.get(cv2.CAP_PROP_FPS) - FPS) > .01:
        raise ValueError(f"Unexpected video geometry or rate: {plate}")
    quads, fills = [], []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        try:
            q, fill = measure(frame)
        except ValueError as error:
            raise ValueError(f"{plate.name}, frame {len(quads)}: {error}") from error
        quads.append(q)
        fills.append(fill)
    cap.release()
    raw = np.array(quads)
    if len(raw) < 96:
        raise ValueError("Source too short")
    padded = np.pad(raw, ((2, 2), (0, 0), (0, 0)), mode="edge")
    smooth = sum(padded[i:i + len(raw)] * w for i, w in enumerate([1, 2, 3, 2, 1])) / 9
    jump = float(np.linalg.norm(np.diff(smooth, axis=0), axis=2).max())
    if jump > 40:
        raise ValueError(f"Discontinuous screen movement: {jump}")
    cache.write_text(json.dumps({
        "source": str(plate.relative_to(ROOT)), "sourceSha256": digest,
        "fps": FPS, "frames": len(raw), "corners": smooth.tolist(),
        "minimumFillRatio": min(fills), "maxCornerStepPx": jump,
        "method": "Four chroma edge fits on every frame, five-frame temporal smoothing"
    }, indent=2))
    return smooth


def fit_panel(filename, panel_size):
    path = SCREENS / filename
    image = cv2.imread(str(path))
    if image is None:
        raise FileNotFoundError(path)
    h, w = image.shape[:2]
    scale = min(panel_size[0] / w, panel_size[1] / h)
    resized = cv2.resize(image, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    panel = np.full((panel_size[1], panel_size[0], 3), (24, 17, 15), np.uint8)
    rh, rw = resized.shape[:2]
    y, x = (panel_size[1] - rh) // 2, (panel_size[0] - rw) // 2
    panel[y:y + rh, x:x + rw] = resized
    return panel, hashlib.sha256(path.read_bytes()).hexdigest()


def reframe(frame, q, progress):
    # Reframe the entire live-action image, never an independently floating UI.
    strength = np.clip(progress, 0, 1)
    strength = strength ** 2 * (3 - 2 * strength)
    width, height = np.ptp(q[:, 0]), np.ptp(q[:, 1])
    target_zoom = min(1.8, 1460 / width, 740 / height)
    zoom = 1 + (max(1, target_zoom) - 1) * strength
    desired = np.array([960, 455]) - zoom * q.mean(axis=0)
    # The bottom 150px are the film's subtitle matte, so a downward source gap
    # in that matte is permitted; no source gap enters the photographic area.
    minimum = np.array(SIZE) * (1 - zoom)
    minimum[1] -= 150
    translation = np.maximum(minimum, np.minimum(desired * strength, 0))
    if (q[:, 1] * zoom + translation[1]).max() > 916:
        translation[1] = max(minimum[1], 916 - float(q[:, 1].max()) * zoom)
    matrix = np.float32([[zoom, 0, translation[0]], [0, zoom, translation[1]]])
    return cv2.warpAffine(frame, matrix, SIZE, flags=cv2.INTER_CUBIC), q * zoom + translation


def replace(frame, q, panel):
    h, w = panel.shape[:2]
    matrix = cv2.getPerspectiveTransform(np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]]), q.astype(np.float32))
    warped = cv2.warpPerspective(panel, matrix, SIZE, flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    polygon = np.zeros(frame.shape[:2], np.uint8)
    cv2.fillConvexPoly(polygon, np.round(q).astype(np.int32), 255)
    observed = cv2.bitwise_and(chroma(frame), cv2.dilate(polygon, np.ones((5, 5), np.uint8)))
    matte = cv2.bitwise_or(polygon, observed)
    alpha = cv2.GaussianBlur(matte, (3, 3), .4)[..., None].astype(np.float32) / 255
    return np.clip(warped * alpha + frame * (1 - alpha), 0, 255).astype(np.uint8)


def render(plate_name, screens, output, seconds=7, panel_size=(1600, 1000), source_start=.125, source_end=7.625):
    plate = SOURCE / f"plate-{plate_name}.mp4"
    points = track(plate)
    panels = {name: fit_panel(name, panel_size) for _, name in screens}
    output.parent.mkdir(parents=True, exist_ok=True)
    review = BUILD / "review"
    review.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(plate))
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo",
               "-pix_fmt", "bgr24", "-s", "1920x1080", "-r", "24", "-i", "-", "-an",
               "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-threads", "2",
               "-pix_fmt", "yuv420p", "-g", "48", "-movflags", "+faststart", str(output)]
    proc = subprocess.Popen(command, stdin=subprocess.PIPE)
    last, frame, audit = -1, None, []
    try:
        count = round(seconds * FPS)
        for i in range(count):
            t = i / FPS
            time = np.interp(t, [0, min(3.2, seconds / 2), seconds - 1 / FPS],
                             [source_start, (source_start + source_end) / 2 + .5, source_end])
            index = round(time * FPS)
            if index >= len(points):
                raise ValueError("Requested time exceeds source")
            while last < index:
                ok, frame = cap.read()
                if not ok:
                    raise ValueError("Cannot decode source frame")
                last += 1
            screen = max((item for item in screens if item[0] <= t), key=lambda x: x[0])[1]
            base, q = reframe(frame, points[index], (t - .3) / 2.7)
            composed = replace(base, q, panels[screen][0])
            proc.stdin.write(composed.tobytes())
            audit.append({"frame": i, "sourceFrame": index, "screen": screen,
                          "screenBounds": [float(q[:, 0].min()), float(q[:, 1].min()), float(q[:, 0].max()), float(q[:, 1].max())]})
            if i % FPS == 0 or i == count - 1:
                cv2.imwrite(str(review / f"{output.stem}-{i:03}.jpg"), composed, [cv2.IMWRITE_JPEG_QUALITY, 94])
    finally:
        cap.release()
        proc.stdin.close()
        result = proc.wait()
    if result:
        raise RuntimeError(f"Encoding failed: {result}")
    output.with_suffix(".json").write_text(json.dumps({
        "plate": plate_name, "seconds": seconds, "panelSize": panel_size,
        "sourceSha256": hashlib.sha256(plate.read_bytes()).hexdigest(),
        "screens": {name: digest for name, (_, digest) in panels.items()},
        "fitting": "contain, preserving original captured aspect ratio",
        "frames": audit
    }, indent=2))
    print(f"Rendered {output.relative_to(ROOT)}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--plate", default="planner")
    parser.add_argument("--screen", default="deepsea-capacity.png")
    parser.add_argument("--output", default="proof-planner.mp4")
    parser.add_argument("--panel", default="1600,1000")
    args = parser.parse_args()
    render(args.plate, [(0, args.screen)], BUILD / args.output,
           panel_size=tuple(map(int, args.panel.split(","))))