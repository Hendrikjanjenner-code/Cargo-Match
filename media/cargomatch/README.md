# CargoMatch sales film production

`assemble.py` creates the final 168-second, 1920×1080, 24 fps CargoMatch film after the silent picture master is ready. It uses Python’s standard library plus the existing FFmpeg and FFprobe executables; no additional Python packages or external accounts are required.

`picture.py` builds that master from the preserved AI-generated live-action clips
and current server-demo screenshots. `composite.py` measures all four physical
display edges on every source frame and perspective-maps the real UI pixels.
The picture tools use the project's existing NumPy, OpenCV and Pillow packages.
No CargoMatch application functionality, production flag, or real record was
changed for this film. The Closa productions remain separate and unchanged.

## Required inputs

- `media/cargomatch/build/picture-master.mp4` — exactly one silent video stream, 1920×1080, 24 fps, 168 seconds
- `media/cargomatch/production.json` — 24 fixed seven-second narration/subtitle slots
- `media/cargomatch/audio-manifest.json`
- `attached_assets/cargomatch/audio/voice-01.mp3` through `voice-24.mp3`
- `attached_assets/cargomatch/audio/music.mp3`
- `attached_assets/cargomatch/audio/port.mp3`
- `attached_assets/cargomatch/audio/road.mp3`

Missing assets, source audio in the picture master, or incorrect geometry, frame rate, duration, slot count, or narration text cause an explicit failure. The assembler does not create fallback footage or audio.

## Reproduce

From the repository root:

```bash
python3 media/cargomatch/picture.py
python3 media/cargomatch/assemble.py
python3 media/cargomatch/verify.py
node media/cargomatch/verify-browser.cjs
```

The captured UI is static, edited between real authorized demo states, not a
screen recording of a cursor clicking. `capture.cjs` can make a fresh isolated
demo session for later updates while the app is running. It does not preserve
cookies or tokens. Re-capturing changes inputs, so rerun the picture build and
assembly; never reuse an old exported master after changing a screenshot.

Sources are preserved in `attached_assets/cargomatch/source/`, `screens/` and
`audio/`. The actual rendered app logo is `attached_assets/cargomatch/logo.png`.
`production.json` holds the bilingual script/storyboard, `video-prompts.json`
the clip directions, `audio-manifest.json` the voice/score provenance, and
`capture-manifest.json` the UI routes, personas and disclosure states.
Disposable encodes and review frames live under ignored `media/cargomatch/build/`.

To use an explicitly selected picture master or delivery directory:

```bash
python3 media/cargomatch/assemble.py \
  --picture media/cargomatch/build/picture-master.mp4 \
  --delivery-dir attached_assets/cargomatch/delivery
```

Expected outputs:

- `attached_assets/cargomatch/delivery/cargomatch-en-nl-1080p.mp4`
- `attached_assets/cargomatch/delivery/cargomatch-nl.srt`
- `attached_assets/cargomatch/delivery/cargomatch-nl.ass`
- `attached_assets/cargomatch/delivery/subtitle-cues.json`
- `attached_assets/cargomatch/delivery/production-receipt.json`

The editable SRT, ASS and JSON cue files are regenerated on each run. English narration begins 0.6 seconds into each seven-second slot. Voice files are silence-trimmed, normalized to -18 LUFS/−3 dBTP, and accelerated only when needed to fit 6.15 seconds, never beyond 1.15×. Dutch sentence boundaries are derived from the corresponding English sentences and snapped to nearby measured voice silences. The script enforces at most two lines and 58 characters per line.

The mix uses the original score at -30 LUFS, subdued port ambience at 0.2 seconds, and road ambience at 77.2 and 147.2 seconds at -38 LUFS. The final stereo 48 kHz mix targets -16 LUFS/−1.5 dBTP. Dutch ASS subtitles are burned into a full-width dark navy matte from y=930 through the bottom edge, leaving the guaranteed UI area above y=930 unobscured. Final picture fades make the first and last frames black, including the matte and subtitles.

The downloadable H.264 export uses capped CRF 20, a 4.2 Mbit/s video ceiling,
and an 8.4 Mbit buffer so the 168-second 1080p film fits the asset library's
100 MiB upload limit. Verification rejects an oversized delivery. Source clips
and the high-quality picture master are preserved for later edits.

## Content, provenance and usage boundaries

The disclosures in `production.json` are part of the production requirements:

- People and location footage are photorealistic AI-generated scenes, not actual customers and not evidence of customer outcomes.
- Product screens are captures from the isolated CargoMatch server demo and use fictional personas and records. They are actual UI captures of that demo, not proof of live customer activity.
- Mutual consent enables an introduction and discussion only. It is not a booking or reservation.
- Availability is manually estimated. It is not independently verified live AIS, telemetry, or licensed routing.
- Rail and air are functional fictional demo pilots, not released production modules or external airline booking integrations.
- Live-action-style clips, narration, original music, and ambient effects were generated through Replit-managed media tools. No stock downloads or separately subscribed external services were used. The tool documentation describes generated outputs as created for the user's use; provider terms still apply, and no exclusivity or third-party endorsement is asserted. These are not recordings of factual customers, operations, or locations.

Any later use must preserve these demo, pilot, non-booking, provenance, and licensing boundaries. Do not imply endorsement by real customers, live tracking coverage, released airline/rail booking capability, or rights beyond the generated assets and captured CargoMatch demo UI.

## Verification scope

The final delivery includes technical and browser receipts. Visual review covers
representative frames throughout every chapter, the important product close-ups,
and the opening/closing frames; screen-plane measurements cover every frame of
the device sources. All final video and audio frames are decoded by FFmpeg as
a corruption check. Loudness and subtitle timing are measured, not a claim of
an independent human listening session or a frame-by-frame human video review.
Playback is checked in Chromium, not in every version of VLC, QuickTime,
PowerPoint, or every social-media transcoder. Dutch subtitles are burned into
the picture and therefore do not depend on player subtitle-track settings.