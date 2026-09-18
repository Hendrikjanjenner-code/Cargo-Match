---
name: Media verification boundaries
description: Separate exported-media validity from browser-probe correctness.
---

Do not regenerate an already verified media export merely because its browser verification harness fails.

**Why:** A browser can successfully decode and seek a valid film while a probe still reports failure because of event ordering or evidence parsing. Repeating the expensive export does not address that category of failure.

**How to apply:** Keep codec/duration/full-stream decoding evidence separate from browser playback and visual review. If decoding succeeds, inspect what the browser probe actually observed before changing the media. Preserve successful renders while repairing the probe, and report player coverage accurately rather than claiming universal compatibility.

Budget downloadable video size before final encoding. The asset-card upload
service enforced a 100 MiB limit in September 2026.

**Why:** A technically valid Full HD sales film could not be registered because
its high-quality export exceeded that service limit.

**How to apply:** Allow room for audio and container overhead when choosing a
capped video bitrate. Keep reusable sources, verify the delivery's byte size,
and confirm registration succeeds before calling the downloadable asset ready.
Re-check the service limit if the platform changes.