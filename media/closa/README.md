# Closa film production

The deliverables are in `attached_assets/closa/delivery/`:

- `closa-nl-1080p.mp4`: Dutch narration.
- `closa-en-1080p.mp4`: English narration; optional Dutch `mov_text` subtitles, not marked as default or forced.
- `closa-en-nl.srt` and `closa-en-nl.vtt`: Dutch subtitles translated and timed for the English narration.
- `closa-script-en-toelichting.pdf` and `.html`: bilingual script, storyboard, source disclosures, and usage notes.

Both films use the **same encoded picture track**: 75 seconds, 1920×1080, 24 fps, 16:9. The music is also sourced from the same recording. Spoken narration is the only language-dependent audio content. There is no spoken dialogue in the source shots.

## Important limitations

The people and luxury-property locations are photorealistic **AI-generated film footage**, not actual employees, clients, customer cases, or filmed actors. Voice-over and music are AI-generated too. The product capabilities come from the creator's description; the actual Closa application was not available to inspect.

No official Closa logo or website styling was supplied. The closing frame therefore uses **plain text “Closa”**, not a fabricated logo or a claim to match the official brand. This branding remains provisional until those materials are supplied.

An embedded subtitle track can be enabled/disabled in players that support MP4 text subtitles. Support is player/platform dependent. VLC can use the embedded track or the matching SRT. Web players generally use the supplied WebVTT file through a `<track>` element. The browser check validates the latter, not native MP4 subtitle support.

## Reproduce

Requirements: Python 3, FFmpeg with libx264/AAC/mov_text and the system DejaVu Sans font. No Python packages are required.

1. Keep all existing `attached_assets/closa/source/` MP4 and MP3 inputs.
2. Run `python3 media/closa/montage.py` from the workspace root.
3. The generated intermediate files, timings and production receipt are in the ignored `media/closa/build/` directory.

`production.json` is the canonical script and shot list. The montage script checks that the footage is native 1080p, fits reads into a fixed per-shot time slot, checks subtitle sentence correspondence and reading layout, produces both exports from one picture master, and saves source/output metadata.

Changing a script line requires regenerating the corresponding narration source and refreshing the script document; do not change the JSON alone and imply that the spoken audio changed.

## Scope boundaries

This is a standalone file-based media production. It does not change CargoMatch, register a new web application, or publish anything.