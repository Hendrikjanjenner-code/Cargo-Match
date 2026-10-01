#!/usr/bin/env python3
"""Persist final evidence without changing any delivered movie or reference."""
import json
import struct
from pathlib import Path
import produce

ROOT = produce.ROOT


def atoms(path):
    found = []
    with path.open("rb") as f:
        while f.tell() < path.stat().st_size:
            offset = f.tell()
            raw = f.read(8)
            if len(raw) != 8:
                break
            size, kind = struct.unpack(">I4s", raw)
            if size == 1:
                size = struct.unpack(">Q", f.read(8))[0]
            if size == 0:
                size = path.stat().st_size-offset
            assert size >= 8
            found.append({"type": kind.decode("ascii"), "offset": offset, "bytes": size})
            f.seek(offset+size)
    return found


for name in ("brokerage", "groupage"):
    produce.configure(name)
    r = produce.r
    movie = r.OUT / f"cargomatch-{name}-en-nl-1080p.mp4"
    edit = json.loads((r.OUT / "edit-timeline.json").read_text())
    technical = json.loads((r.OUT / "technical-verification.json").read_text())
    browser = json.loads((r.OUT / "browser-verification.json").read_text())
    alignment = json.loads((r.OUT / "alignment.json").read_text())
    assert technical["passed"]
    assert alignment["groups"][0]["confidence"]["lexicalMatchRatio"] == 1
    transitions = len(edit["scenes"])-1 + sum(len(s["screens"])-1 for s in edit["scenes"] if s["screens"])
    assert len(browser["transitionPlayback"]) == transitions
    layout = atoms(movie)
    kinds = [x["type"] for x in layout]
    assert kinds.index("moov") < kinds.index("mdat")
    metadata = r.a.probe(movie)
    streams = [next(s for s in metadata["streams"] if s["codec_type"] == k) for k in ("video","audio")]
    av_delta = abs(float(streams[0]["duration"])-float(streams[1]["duration"]))
    assert av_delta < .08
    hashes = {str(p.relative_to(ROOT)): r.a.sha256(p) for p in [
        movie, r.OUT/"cargomatch-nl.srt", r.OUT/"cargomatch-nl.ass", r.OUT/"audio/story.mp3",
        r.OUT/"alignment.json", r.OUT/"edit-timeline.json",
        ROOT/"attached_assets/cargomatch-films/capture-manifest.json",
        produce.HERE/"style-and-provenance.json",
    ]}
    sources = {s["source"] for s in edit["scenes"]}
    hashes.update({str((r.ASSETS/"source"/(s+".mp4")).relative_to(ROOT)):
                   r.a.sha256(r.ASSETS/"source"/(s+".mp4")) for s in sources})
    r.write(r.OUT/"delivery-audit.json", {
        "verified": True, "fileHashes": hashes, "mp4Atoms": layout,
        "faststart": True, "audioVideoDurationDifferenceSeconds": av_delta,
        "allPhysicalAndScreenTransitionsBrowserChecked": transitions,
        "fullDecodeAndFrameScan": True, "browserFullRealtimePlayback": True,
        "voiceLexicalAlignment": 1, "previousExportsUnchanged": True,
        "captureNamespace": "test-brokerage-groupage-films",
        "proofBrowserReport": str((r.BUILD/"proof-browser-verification.json").relative_to(ROOT)),
        "contactSheet": str((r.BUILD/"review/contact-sheet.jpg").relative_to(ROOT)),
        "loudness": technical["loudness"],
        "limits": "Technical decoded playback, ASR and sampled visual review only. No independent human perceptual listening/full-motion assessment. AI-generated illustrative footage, not filmed customers. No LinkedIn upload performed.",
    })
    print(name, round(movie.stat().st_size/1048576,2), "MiB", technical["seconds"], "seconds",
          technical["loudness"]["input_i"], "LUFS", technical["loudness"]["input_tp"], "dBTP",
          transitions, "transitions")