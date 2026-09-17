---
name: Conflict reconstruction
description: Why conflict resolution must inspect clean git stages rather than only marker blocks.
---

Compare the complete stage-2 and stage-3 sources before resolving generated conflict blocks.

**Why:** A concurrent-task rebase produced a GET cargo handler with a capacity-update body parser outside the marked conflicts. Removing markers alone would have preserved broken code.

**How to apply:** Reconstruct from the clean stage that contains the intended implementation, incorporate genuine changes from the other stage, and regenerate OpenAPI outputs. During rebase, stage 2 is incoming main and stage 3 is task work; do not assume the labels mean the opposite.