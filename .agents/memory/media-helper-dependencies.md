---
name: Media helper dependency ownership
description: Avoid dependency cleanup races between parallel media-production helpers.
---

Give shared Python dependency management a single owner when parallel media
helpers add reusable processing scripts. Helpers should not restore or clean up
the project package manifest after another worker has installed a needed package.

**Why:** A speech-alignment helper's temporary-install cleanup removed a recognizer
that the main worker had just installed for reproducibility. The successful
alignment output remained valid, but the reusable command could no longer import
its dependency.

**How to apply:** Have helpers report required packages, keep required media-tool
dependencies declared and locked, and perform any shared dependency changes only
after other package-management work has joined.