#!/usr/bin/env python3
"""Run approved exhaustive verifier against isolated new film outputs."""
import sys
import produce

name = sys.argv[1]
assert name in ("brokerage", "groupage")
produce.configure(name)
source_path = produce.ROOT / "media/cargomatch-import/flow/verify.py"
source = source_path.read_text().replace("import render as r", "from produce import r")
source = source.replace('"cargomatch-en-nl-1080p.mp4"', f'"cargomatch-{name}-en-nl-1080p.mp4"')
exec(compile(source, str(source_path), "exec"), {"__name__": "__main__", "__file__": str(source_path)})