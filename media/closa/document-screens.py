#!/usr/bin/env python3
"""Create the self-contained bilingual Closa screens script HTML/PDF and ZIP."""
from __future__ import annotations

import argparse
import base64
import html
import json
import mimetypes
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT / "media/closa/screens-production.json"
CONFIG = json.loads(CONFIG_PATH.read_text())
DELIVERY = ROOT / "attached_assets/closa/delivery/screens"
SCREEN_SOURCE = ROOT / "attached_assets/closa/screens-source"
HTML_NAME = "closa-script-en-toelichting.html"
PDF_NAME = "closa-script-en-toelichting.pdf"
ZIP_NAME = "closa-ondertitels-en-script.zip"
SCREENSHOTS = [Path("screens") / f"{i:02}.png" for i in range(1, 10)]


def data_uri(path: Path) -> str:
    kind = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return f"data:{kind};base64,{base64.b64encode(path.read_bytes()).decode()}"


def chromium() -> str:
    candidates = [
        "/repl/tools/bin/chromium",
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
        shutil.which("google-chrome"),
    ]
    found = next((str(path) for path in candidates if path and Path(path).is_file()), None)
    if not found:
        raise FileNotFoundError("Chromium is required to print the bilingual PDF.")
    return found


def image_block(source: str, uris: dict[str, str]) -> str:
    if Path(source).suffix.lower() not in (".png", ".jpg", ".jpeg"):
        return ""
    key = Path(source).relative_to("attached_assets/closa/screens-source").as_posix()
    if key not in uris:
        return ""
    return (
        f'<figure><img src="{uris[key]}" alt="{html.escape(key)}">'
        f"<figcaption>{html.escape(key)}</figcaption></figure>"
    )


def make_html(receipt: dict, uris: dict[str, str]) -> str:
    timing_by_scene = {voice["scene"]: voice for voice in receipt["voices"]
                       if voice["lang"] == "en"}
    rows = []
    for scene in CONFIG["scenes"]:
        number = scene["scene"]
        narration = CONFIG["narration"][number - 1]
        voice = timing_by_scene.get(number)
        timing = (f"Voice {voice['start']:.3f}–"
                  f"{voice['start'] + voice['duration']:.3f} s") if voice else scene["time"]
        figures = "".join(image_block(source, uris) for source in scene["sources"])
        rows.append(f"""
          <article class="scene">
            <header><span class="number">{number:02}</span><span>{html.escape(scene["time"])}</span>
              <span>{html.escape(timing)}</span></header>
            <div class="visuals">{figures or '<div class="film">Original / AI-generated film footage</div>'}</div>
            <p class="description">{html.escape(scene["visual"])}</p>
            <div class="languages">
              <div><b>NL</b><p>{html.escape(narration["nl"])}</p></div>
              <div><b>EN</b><p lang="en">{html.escape(narration["en"])}</p></div>
            </div>
          </article>""")
    logo = uris["logo.png"]
    return f"""<!doctype html>
<html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Closa — script en toelichting</title>
<style>
:root{{--ink:#17221d;--green:#12886f;--cream:#f5f5f1;--line:#d5d6cf;--muted:#657068}}
*{{box-sizing:border-box}}html{{background:#e9ebe7}}body{{margin:0;background:var(--cream);color:var(--ink);font:14px/1.45 Arial,sans-serif}}
main{{max-width:1100px;margin:auto;padding:48px 58px 64px}}.mast{{display:flex;justify-content:space-between;align-items:center;border-top:5px solid var(--green);padding-top:20px}}
.logo{{width:150px;max-height:56px;object-fit:contain;object-position:left center}}.eyebrow{{text-transform:uppercase;letter-spacing:.14em;font-size:10px;color:var(--muted);font-weight:700}}
h1{{font:700 40px/1.08 Georgia,serif;margin:40px 0 12px;max-width:700px}}.lead{{font-size:17px;max-width:760px;color:#445048}}
.facts{{display:grid;grid-template-columns:repeat(4,1fr);border-block:1px solid var(--line);margin:30px 0;padding:14px 0}}.facts b{{display:block;font-size:17px}}
.notice{{border-left:4px solid var(--green);background:#e9ece6;padding:17px 20px;margin:26px 0}}h2{{font:700 25px Georgia,serif;margin:40px 0 17px}}
.scene{{break-inside:avoid;border-top:1px solid var(--line);padding:18px 0}}.scene header{{display:grid;grid-template-columns:60px 1fr 1fr;color:var(--muted);font-size:11px;gap:12px}}
.number{{font:700 22px Georgia,serif;color:var(--green)}}.visuals{{display:flex;gap:10px;margin:12px 0}}figure{{margin:0;flex:1}}figure img{{display:block;width:100%;height:170px;object-fit:contain;background:#dde1dc;border:1px solid var(--line)}}
figcaption{{font-size:10px;color:var(--muted);margin-top:4px}}.film{{background:#e3e6e0;padding:38px 20px;width:100%;color:var(--muted)}}.description{{font-size:12px;color:var(--muted)}}
.languages{{display:grid;grid-template-columns:1fr 1fr;gap:22px}}.languages>div+div{{border-left:1px solid var(--line);padding-left:22px}}.languages b{{font-size:10px;letter-spacing:.12em;color:var(--green)}}.languages p{{margin:4px 0}}
table{{border-collapse:collapse;width:100%}}td,th{{text-align:left;border-bottom:1px solid var(--line);padding:10px}}th{{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}}footer{{border-top:1px solid var(--line);margin-top:40px;padding-top:14px;font-size:10px;color:var(--muted)}}
@media(max-width:700px){{main{{padding:28px 20px}}.facts,.languages{{grid-template-columns:1fr}}.languages>div+div{{border:0;padding:0}}.visuals{{display:block}}}}
@media print{{@page{{size:A4;margin:13mm}}html,body{{background:white}}main{{padding:0;max-width:none}}h1{{margin-top:22mm}}figure img{{height:115px}}.scene{{font-size:11px}}}}
</style></head><body><main>
<div class="mast"><img class="logo" src="{logo}" alt="Door gebruiker aangeleverd Closa-logo"><span class="eyebrow">Screens film · productiescript</span></div>
<h1>Closa met aangeleverde productschermen</h1>
<p class="lead">Tweetalig script, beeldmapping, ondertiteling en bronverantwoording voor twee films met exact dezelfde beeldmontage.</p>
<div class="facts"><div><span class="eyebrow">Duur</span><b>75 seconden</b></div><div><span class="eyebrow">Beeld</span><b>1920 × 1080</b></div><div><span class="eyebrow">Tempo</span><b>24 fps</b></div><div><span class="eyebrow">Talen</span><b>NL + EN</b></div></div>
<div class="notice"><b>Bronnen en beperking / Sources and limitation</b>
<p>De negen productschermen en het logo zijn door de gebruiker aangeleverd. Ze zijn niet onafhankelijk geverifieerd als de actuele applicatie of als bewijs van werkelijk appgedrag. Mensen en vastgoedbeelden zijn AI-gegenereerd; voice-over en muziek zijn eveneens AI-gegenereerd.</p>
<p>De presentatiekopieën maken de identiteit/contactgegevens van het ingelogde account onleesbaar. In het dashboard zijn ook de begroeting, metriekwaarden en recente activiteit onleesbaar gemaakt. De oorspronkelijke screenshots blijven intact.</p>
<p lang="en">The nine product screens and logo were supplied by the user. They were not independently verified as the current application or as evidence of actual application behavior. People and property footage are AI-generated; voice-over and music are AI-generated as well.</p>
<p lang="en">Presentation copies obscure the signed-in account identity/contact. The dashboard copy also obscures its greeting, metric values and recent activity. The original screenshots remain intact.</p></div>
<h2>Storyboard en voice-over</h2>
{"".join(rows)}
<h2>Oplevering / Delivery</h2>
<table><thead><tr><th>Bestand</th><th>Inhoud</th></tr></thead><tbody>
<tr><td>closa-nl-1080p.mp4</td><td>Nederlandse voice-over, gedeelde beeldmaster en muziek</td></tr>
<tr><td>closa-en-1080p.mp4</td><td>English voice-over; optional Dutch subtitle track, default off</td></tr>
<tr><td>closa-en-nl.srt / .vtt</td><td>Nederlandse sidecar-ondertiteling voor de Engelse film</td></tr>
</tbody></table>
<p>De WebVTT-ondertitels staan bovenin om de belangrijkste scherminhoud vrij te houden. Plaatsing en ondersteuning van ingebedde MP4-ondertitels en SRT hangen af van de videospeler; deze staan standaard uit in de Engelse MP4.</p>
<p lang="en">WebVTT captions are positioned at the top to keep the main interface clear. Embedded MP4 and SRT caption placement and support depend on the player; the English MP4 subtitle track is off by default.</p>
<div class="notice"><b>AI Document Intelligence</b><p>Scène 07 toont lege bevindingen en noemt alleen documenten en opties voor beoordeling door professionals. Er wordt niet beweerd dat bevindingen al zijn gegenereerd en er wordt geen automatische juridische advisering geclaimd.</p><p lang="en">Scene 07 shows empty findings and mentions documents and options for review by professionals only. It does not assert that findings have already been generated, and no automatic legal-advice capability is claimed.</p></div>
<footer>Closa screens delivery · bron/source: media/closa/screens-production.json · 10 × 7,5 s</footer>
</main></body></html>"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    if not args.receipt.is_file():
        raise FileNotFoundError(f"Missing assembled timing receipt: {args.receipt}")
    required = [SCREEN_SOURCE / name for name in SCREENSHOTS]
    required.append(SCREEN_SOURCE / "logo.png")
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise FileNotFoundError(
            "Documents require all nine supplied screenshots and the supplied logo:\n"
            + "\n".join(missing))
    receipt = json.loads(args.receipt.read_text())
    DELIVERY.mkdir(parents=True, exist_ok=True)
    uris = {path.relative_to(SCREEN_SOURCE).as_posix(): data_uri(path)
            for path in required}
    html_path, pdf_path = DELIVERY / HTML_NAME, DELIVERY / PDF_NAME
    html_path.write_text(make_html(receipt, uris))
    with tempfile.TemporaryDirectory(prefix="closa-pdf-") as profile:
        result = subprocess.run([
            chromium(), "--headless=new", "--no-sandbox", "--disable-gpu",
            f"--user-data-dir={profile}", "--no-pdf-header-footer",
            f"--print-to-pdf={pdf_path.resolve()}", html_path.resolve().as_uri(),
        ], text=True, capture_output=True)
        if result.returncode or not pdf_path.is_file():
            raise RuntimeError("Could not print script PDF:\n" + result.stderr[-4000:])
    archive = DELIVERY / ZIP_NAME
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
        for name in ("closa-en-nl.srt", "closa-en-nl.vtt", HTML_NAME, PDF_NAME):
            path = DELIVERY / name
            if not path.is_file():
                raise FileNotFoundError(f"Cannot package missing delivery file: {path}")
            zipped.write(path, arcname=name)
    print(f"Wrote {html_path}, {pdf_path} and {archive}")


if __name__ == "__main__":
    main()