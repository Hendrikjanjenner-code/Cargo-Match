# Closa film production

## Updated screens delivery

The updated delivery is written to `attached_assets/closa/delivery/screens/`:

- `closa-nl-1080p.mp4`: Dutch narration.
- `closa-en-1080p.mp4`: English narration; optional Dutch `mov_text` subtitles, not marked as default or forced.
- `closa-en-nl.srt` and `closa-en-nl.vtt`: Dutch subtitles translated and timed for the English narration.
- `closa-script-en-toelichting.pdf` and `.html`: bilingual script, storyboard, source disclosures, and usage notes.
- `closa-ondertitels-en-script.zip`: both subtitle sidecars and both script documents.

Both films use the **same encoded picture track**: 75 seconds, 1920×1080, 24 fps, 16:9. The music is also sourced from the same recording. Spoken narration is the only language-dependent audio content. There is no spoken dialogue in the source shots.

## Important limitations

The nine application screenshots and logo were supplied by the user. They have not been independently verified as the current application or as evidence of actual application behavior. The people and luxury-property locations are photorealistic **AI-generated film footage**, not actual employees, clients, customer cases, or filmed actors. Voice-over and music are AI-generated too.

Presentation copies obscure signed-in account identity/contact. The dashboard presentation copy also obscures its greeting, metric values and recent activity. The screenshot originals remain intact.

Scene 03 shows the Professionals directory overview; it does not show an opened profile or My Profile. Scene 07 shows empty AI Document Intelligence findings and mentions documents and options for review by professionals only. It does not assert that findings have already been generated or claim automatic legal advice.

An embedded subtitle track can be enabled/disabled in players that support MP4 text subtitles. Support is player/platform dependent. VLC can use the embedded track or the matching SRT. Web players generally use the supplied WebVTT file through a `<track>` element. The browser check validates the latter, not native MP4 subtitle support.

WebVTT captions are positioned at the top to avoid the main screen content. SRT/native MP4 positioning depends on the player; captions can remain off while reading the interface.

## Rebuild the updated films

Requirements: Python 3, NumPy, OpenCV-headless and Pillow (declared in the root Python project), FFmpeg with libx264/AAC/`mov_text`, and Chromium for PDF output.

1. Keep the original `attached_assets/closa/source/` and original `attached_assets/closa/delivery/` files unchanged.
2. Keep the three generated `plate-*.mp4` files in `attached_assets/closa/screens-source/` and the two original screenshot ZIPs in `attached_assets/`.
3. Keep all 20 narration files plus `music.mp3` in `attached_assets/closa/screens-source/audio/`. Slots 01, 06, 09 and 10 reuse original narration 01, 05, 09 and 10 respectively; only the other slots are newly voiced.
4. From the workspace root run:

   ```sh
   python3 media/closa/prepare-screens.py
   python3 media/closa/picture-screens.py
   python3 media/closa/assemble-screens.py
   ```

The picture process produces a silent 75-second master. It measures all four screen edges on every source frame, rejects missing/occluded/off-frame screens, fits the original screenshot aspect ratio inside a 16:10 display mat, and perspective-maps the actual pixels. The physical camera dolly is retained, with modest whole-shot reframing for legibility and a longer readable close-up. No UI is AI-redrawn, scrolled, or clicked.

Tracking measurements, frame-to-source mappings and review stills are under the ignored `media/closa/build-screens/` directory. `--scene N` renders a single scene; `--reuse-scenes` is only for recovering an interrupted export when all picture inputs remain unchanged, not for incorporating changed screenshots.

The assembler fails explicitly if the master or any audio source is missing or invalid. It cleans and normalizes each read, checks slot fit, derives Dutch subtitle timing from the final English reads, mixes the shared music, stream-copies the same picture master into both MP4s, clears the embedded subtitle default-track flag, then creates the self-contained HTML/PDF and ZIP. Timings and output probes/hashes are recorded in `media/closa/build-screens/production-receipt.json`.

`screens-production.json` is the canonical updated script, source mapping and disclosure. Changing narration text requires regenerating the corresponding MP3; changing JSON alone does not change spoken audio.

## Browser subtitle check

The default still checks the untouched original delivery:

```sh
node media/closa/verify-browser.cjs
```

After the updated delivery exists, select it explicitly with either accepted form:

```sh
node media/closa/verify-browser.cjs --delivery attached_assets/closa/delivery/screens
node media/closa/verify-browser.cjs attached_assets/closa/delivery/screens
```

The loopback-only checker verifies 1080p/75-second browser playback and WebVTT captions default-off, on, off, and on again near the final scene. It does not prove native MP4 `mov_text` support.

## Original delivery

The pre-existing films, subtitle files and documents remain in `attached_assets/closa/delivery/`. They are reproduced only by the original `media/closa/montage.py` and `media/closa/production.json`, which are intentionally separate from this screens update.

## Scope boundaries

This is a standalone file-based media production. It does not change CargoMatch, register a new web application, or publish anything.