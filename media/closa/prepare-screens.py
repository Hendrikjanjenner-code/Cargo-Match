#!/usr/bin/env python3
"""Extract supplied screenshots without trusting archive paths; derive film mats."""
from pathlib import Path
import hashlib
import io
import json
import zipfile
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "attached_assets/closa/screens-source"
ARCHIVES = [
    ("WhatsApp_Unknown_2026-09-17_at_21.49.55_1789674629714.zip",
     ["20.56.51", "20.56.52", "20.56.53", "20.56.53 (1)", "20.56.54"]),
    ("WhatsApp_Unknown_2026-09-17_at_21.49.58_1789674629713.zip",
     ["20.56.55", "20.56.55 (1)", "20.56.56", "20.56.56 (1)"]),
]
TITLES = ["Deal Directory", "Confidential Opportunity", "Acquisition Mandates",
          "Professionals", "Dashboard", "Secure Data Room",
          "AI Document Intelligence", "Homepage", "Explore Closa"]


def main():
    (OUT / "originals").mkdir(parents=True, exist_ok=True)
    (OUT / "screens").mkdir(parents=True, exist_ok=True)
    records = []
    for archive, members in ARCHIVES:
        with zipfile.ZipFile(ROOT / "attached_assets" / archive) as z:
            for suffix in members:
                n = len(records) + 1
                name = f"WhatsApp Image 2026-09-17 at {suffix}.jpeg"
                info = z.getinfo(name)
                if info.file_size > 10_000_000:
                    raise ValueError("Unexpected image size")
                data = z.read(info)
                raw = OUT / "originals" / f"{n:02}.jpg"
                if raw.exists() and raw.read_bytes() != data:
                    raise ValueError(f"Original would change: {raw}")
                raw.write_bytes(data)
                im = Image.open(io.BytesIO(data)).convert("RGB")
                w, h = im.size
                redactions = []

                def blur(box, reason):
                    rect = tuple(round(v * (w if i % 2 == 0 else h))
                                 for i, v in enumerate(box))
                    im.paste(im.crop(rect).filter(ImageFilter.GaussianBlur(20)), rect)
                    redactions.append({"box": rect, "reason": reason})

                # Only the irrelevant signed-in account panel, not profile cards.
                if n <= 7:
                    blur((0.0, 0.78, 0.167, 1.0), "Signed-in account identity/contact")
                if n == 5:
                    blur((0.184, 0.11, 0.39, 0.15), "Personal dashboard greeting")
                    blur((0.189, 0.249, 0.99, 0.302), "Private account metric values")
                    blur((0.753, 0.612, 0.993, 1), "Named recent account activity")
                dest = OUT / "screens" / f"{n:02}.png"
                im.save(dest)
                records.append({"id": n, "title": TITLES[n - 1],
                                "archive": archive, "member": name,
                                "original": str(raw.relative_to(ROOT)),
                                "presentation": str(dest.relative_to(ROOT)),
                                "width": w, "height": h,
                                "originalSha256": hashlib.sha256(data).hexdigest(),
                                "redactions": redactions})
    # Exact original raster logo, including its original background. No AI tracing.
    home = Image.open(OUT / "originals/08.jpg").convert("RGB")
    home.crop((40, 7, 165, 48)).save(OUT / "logo.png")
    (OUT / "inventory.json").write_text(json.dumps({
        "source": "Nine screenshots supplied by the user; no live application inspection",
        "palette": {"background": "#0B0D0E", "accent": "#16A883", "text": "#F5F5F1"},
        "logo": "Original raster crop from screenshot 08, not a redrawn logo",
        "screens": records}, indent=2))
    contact = Image.new("RGB", (1440, 840), "#0B0D0E")
    draw = ImageDraw.Draw(contact)
    for j, row in enumerate(records):
        tile = Image.open(ROOT / row["presentation"])
        tile.thumbnail((470, 238), Image.Resampling.LANCZOS)
        x, y = (j % 3) * 480, (j // 3) * 280
        draw.text((x + 8, y + 6), f'{row["id"]:02}  {row["title"]}', fill="white")
        contact.paste(tile, (x + 5, y + 29))
    contact.save(OUT / "screen-contact.jpg", quality=92)
    print(f"Prepared {len(records)} originals and safe presentation copies.")


if __name__ == "__main__":
    main()