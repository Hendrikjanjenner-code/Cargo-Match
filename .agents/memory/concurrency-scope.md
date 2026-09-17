---
name: Pilot concurrency tradeoff
description: Why the initial core serializes domain mutations and what must survive future scaling.
---
The initial core favors a shared transaction-level advisory lock over parallel domain mutation throughput.

**Why:** Matching can otherwise read listings before a concurrent withdrawal or vessel edit and grant consent against stale eligibility. Pilot traffic does not justify more complex lock ordering yet.

**How to apply:** If replacing coarse serialization for scale, preserve atomic revalidation across consent actions and listing, vessel, and company mutations. Pending interests must survive unrelated recalculation, but material edits must invalidate the earlier consent context.
