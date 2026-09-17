"""Measured screen-plane replacement. Actual UI pixels never pass through AI."""
from pathlib import Path
import hashlib
import json
import subprocess
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "attached_assets/closa/screens-source"
BUILD = ROOT / "media/closa/build-screens"
SIZE = (1920, 1080)
FPS = 24
PANEL = (1600, 1000)  # Physical 16:10 laptop display, not screenshot aspect ratio.
cv2.setNumThreads(2)


def ordered(points):
    points = np.asarray(points, dtype=np.float32).reshape(4, 2)
    sums = points.sum(axis=1)
    diff = np.diff(points, axis=1).ravel()
    return points[[np.argmin(sums), np.argmin(diff),
                   np.argmax(sums), np.argmax(diff)]]


def chroma(frame):
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    return cv2.inRange(hsv, np.array([135, 80, 65]), np.array([175, 255, 255]))


def measure(frame):
    mask = chroma(frame)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        raise ValueError("No replacement screen found")
    contour = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(contour)
    if area < 12000:
        raise ValueError("Replacement screen is too small or occluded")
    hull = cv2.convexHull(contour)
    poly = cv2.approxPolyDP(hull, 0.015 * cv2.arcLength(hull, True), True)
    if len(poly) != 4:
        raise ValueError(f"Expected four screen corners, found {len(poly)}")
    corners = ordered(poly)
    # Fit each long screen edge to all nearby chroma boundary samples. This
    # avoids rounded bezel corners biasing a simple four-point approximation.
    boundary = contour.reshape(-1, 2).astype(np.float32)
    lines = []
    for i in range(4):
        a, b = corners[i], corners[(i + 1) % 4]
        delta = b - a
        length = np.linalg.norm(delta)
        relative = boundary - a
        distance = np.abs(delta[0] * relative[:, 1] - delta[1] * relative[:, 0]) / length
        along = ((boundary - a) @ delta) / length**2
        samples = boundary[(distance < 5) & (along > .06) & (along < .94)]
        if len(samples) < 8:
            raise ValueError("Screen edge does not have enough measured samples")
        vx, vy, x, y = cv2.fitLine(samples, cv2.DIST_L2, 0, .01, .01).ravel()
        lines.append((np.array([x, y]), np.array([vx, vy])))
    refined = []
    for i in range(4):
        a, u = lines[(i - 1) % 4]
        b, v = lines[i]
        t = np.linalg.solve(np.column_stack([u, -v]), b - a)[0]
        refined.append(a + t * u)
    q = np.array(refined, dtype=np.float32)
    polygon_area = cv2.contourArea(q)
    if not .94 < area / polygon_area < 1.03:
        raise ValueError("Screen is occluded or not planar")
    if np.any(q < -2) or np.any(q[:, 0] > 1922) or np.any(q[:, 1] > 1082):
        raise ValueError("A screen corner escaped the frame")
    return q, float(area / polygon_area)


def track(plate):
    BUILD.mkdir(parents=True, exist_ok=True)
    cache = BUILD / f"{plate.stem}-tracking.json"
    sha = hashlib.sha256(plate.read_bytes()).hexdigest()
    if cache.exists():
        old = json.loads(cache.read_text())
        if old["sourceSha256"] == sha:
            return np.array(old["corners"], dtype=np.float32)
    cap = cv2.VideoCapture(str(plate))
    if (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))) != SIZE:
        raise ValueError("Plate is not native 1080p")
    if abs(cap.get(cv2.CAP_PROP_FPS) - FPS) > .01:
        raise ValueError("Plate must be 24 fps")
    corners, fills = [], []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        try:
            q, fill = measure(frame)
        except ValueError as e:
            raise ValueError(f"{plate.name} frame {len(corners)}: {e}") from e
        corners.append(q)
        fills.append(fill)
    cap.release()
    if len(corners) < 180:
        raise ValueError("Plate is shorter than a scene")
    raw = np.array(corners)
    # Gentle temporal smoothing; exact chroma matte still follows the true edge.
    padded = np.pad(raw, ((2, 2), (0, 0), (0, 0)), mode="edge")
    smooth = sum(padded[i:i + len(raw)] * weight
                 for i, weight in enumerate([1, 2, 3, 2, 1])) / 9
    jumps = np.linalg.norm(np.diff(smooth, axis=0), axis=2)
    if float(jumps.max()) > 35:
        raise ValueError("Discontinuous camera motion / unreliable screen track")
    cache.write_text(json.dumps({
        "source": str(plate.relative_to(ROOT)), "sourceSha256": sha,
        "frames": len(raw), "fps": FPS, "corners": smooth.tolist(),
        "minChromaFillRatio": min(fills), "maxCornerStepPx": float(jumps.max()),
        "maxSmoothingOffsetPx": float(np.linalg.norm(raw - smooth, axis=2).max()),
        "method": "Per-frame four-edge least-squares measurement; five-frame smoothing",
    }, indent=2))
    print(f"Tracked {plate.name}: {len(raw)} frames, all screen corners in frame", flush=True)
    return smooth


def screen_panel(number):
    image = cv2.imread(str(SOURCE / "screens" / f"{number:02}.png"))
    if image is None:
        raise FileNotFoundError(f"Screenshot {number}")
    h, w = image.shape[:2]
    factor = min(PANEL[0] / w, PANEL[1] / h)
    fitted = cv2.resize(image, (round(w * factor), round(h * factor)),
                        interpolation=cv2.INTER_AREA if factor < 1 else cv2.INTER_CUBIC)
    panel = np.empty((PANEL[1], PANEL[0], 3), dtype=np.uint8)
    panel[:] = (14, 13, 11)
    ph, pw = fitted.shape[:2]
    x, y = (PANEL[0] - pw) // 2, (PANEL[1] - ph) // 2
    panel[y:y + ph, x:x + pw] = fitted
    # Slight display attenuation, without blending the magenta backing into UI.
    return np.clip(panel.astype(np.float32) * .97, 0, 255).astype(np.uint8)


def replace(frame, corners, panel):
    source = np.float32([[0, 0], [PANEL[0] - 1, 0],
                         [PANEL[0] - 1, PANEL[1] - 1], [0, PANEL[1] - 1]])
    matrix = cv2.getPerspectiveTransform(source, corners.astype(np.float32))
    warped = cv2.warpPerspective(panel, matrix, SIZE, flags=cv2.INTER_CUBIC,
                                 borderMode=cv2.BORDER_REPLICATE)
    polygon = np.zeros(frame.shape[:2], np.uint8)
    cv2.fillConvexPoly(polygon, np.round(corners).astype(np.int32), 255)
    # Real chroma boundary provides edge coverage even with fractional tracking.
    observed = cv2.bitwise_and(chroma(frame), cv2.dilate(polygon, np.ones((7, 7), np.uint8)))
    matte = cv2.bitwise_or(polygon, observed)
    matte = cv2.dilate(matte, np.ones((3, 3), np.uint8))
    alpha = cv2.GaussianBlur(matte, (3, 3), .45).astype(np.float32)[..., None] / 255
    return np.clip(warped * alpha + frame * (1 - alpha), 0, 255).astype(np.uint8)


def reframe(frame, corners, progress):
    """Modest whole-film reframing; the underlying physical dolly is retained."""
    h = float(np.ptp(corners[:, 1]))
    strength = float(np.clip(progress, 0, 1))
    strength = strength * strength * (3 - 2 * strength)
    zoom = 1 + (max(1, min(1.6, 900 / h)) - 1) * strength
    centre = corners.mean(axis=0)
    target = np.array([960, 510], np.float32)
    desired = target - zoom * centre
    # No black border or newly invented off-camera pixels.
    translation = np.maximum(np.array(SIZE) * (1 - zoom),
                             np.minimum(desired * strength, 0))
    matrix = np.array([[zoom, 0, translation[0]],
                       [0, zoom, translation[1]]], dtype=np.float32)
    reframed = cv2.warpAffine(frame, matrix, SIZE, flags=cv2.INTER_CUBIC)
    return reframed, corners * zoom + translation


def render(plate_name, screens, output, seconds=7.5, source_start=.125, source_end=7.625):
    """screens: [(local second, screenshot id)]; no simulated interaction."""
    plate = SOURCE / f"plate-{plate_name}.mp4"
    points = track(plate)
    cap = cv2.VideoCapture(str(plate))
    panels = {n: screen_panel(n) for _, n in screens}
    output.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
           "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", "1920x1080", "-r", "24",
           "-i", "-", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
           "-threads", "2", "-pix_fmt", "yuv420p", "-g", "48",
           "-video_track_timescale", "12288", "-movflags", "+faststart", str(output)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    last_idx, frame = -1, None
    audit = []
    try:
        count = round(seconds * FPS)
        for i in range(count):
            t = i / FPS
            approach = source_start < 1 and seconds >= 7
            fraction = i / max(1, count - 1)
            if approach:
                source_time = float(np.interp(t, [0, 4, seconds - 1 / FPS],
                                             [source_start, 5.5, source_end]))
            else:
                source_time = source_start + (source_end - source_start) * fraction
            index = round(source_time * FPS)
            if index >= len(points):
                raise ValueError("Source range exceeds tracked plate")
            if index != last_idx:
                if index != last_idx + 1:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, index)
                ok, frame = cap.read()
                if not ok:
                    raise ValueError(f"Cannot read plate frame {index}")
                last_idx = index
            number = max((pair for pair in screens if pair[0] <= t), key=lambda x: x[0])[1]
            base, quad = reframe(frame, points[index], (t - 1.2) / 2.8 if approach else 1)
            composed = replace(base, quad, panels[number])
            proc.stdin.write(composed.tobytes())
            if i % 24 == 0 or i == count - 1:
                still = BUILD / "review" / f"{output.stem}-{i:03}.jpg"
                still.parent.mkdir(parents=True, exist_ok=True)
                cv2.imwrite(str(still), composed, [cv2.IMWRITE_JPEG_QUALITY, 93])
            audit.append({"frame": i, "sourceFrame": index, "screen": number})
    finally:
        cap.release()
        proc.stdin.close()
        code = proc.wait()
    if code:
        raise RuntimeError(f"FFmpeg failed: {code}")
    output.with_suffix(".json").write_text(json.dumps({
        "plate": plate_name, "seconds": seconds, "screens": screens,
        "panelSize": PANEL, "fitting": "contain; unchanged screenshot aspect ratio",
        "frames": audit}, indent=2))
    print(f"Rendered {output.name}", flush=True)


if __name__ == "__main__":
    render("profile", [(0, 4)], BUILD / "proof-profile.mp4")