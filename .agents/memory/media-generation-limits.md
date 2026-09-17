---
name: Media generation dispatch limits
description: Avoid excessive parallel audio dispatch and duplicate paid generations after transient failures.
---

Use bounded batches for generated audio rather than starting a large array of speech requests at once.

**Why:** The audio-generation proxy has returned a per-Repl limit of 10 requests per second. Starting twenty narration segments together caused only the tail requests to fail with HTTP 429; retrying those failed requests later succeeded. Limits can change, so trust the current error's retry guidance rather than assuming unlimited concurrency.

**How to apply:** Dispatch comfortably below the observed limit, retain individual job results and output paths, and retry only failed items after the stated delay. For paid video generation, likewise retain successful clips when a subset of requests returns a transient service-unavailable error; never rerun an entire scene batch merely because one shot failed.