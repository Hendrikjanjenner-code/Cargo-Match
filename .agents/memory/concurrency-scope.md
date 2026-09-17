---
name: Pilot concurrency tradeoff
description: Why the initial core serializes domain mutations and what must survive future scaling.
---
The initial core favors a shared transaction-level advisory lock over parallel domain mutation throughput.

**Why:** Matching can otherwise read listings before a concurrent withdrawal or vessel edit and grant consent against stale eligibility. Pilot traffic does not justify more complex lock ordering yet.

**How to apply:** If replacing coarse serialization for scale, preserve atomic revalidation across consent actions and listing, vessel, and company mutations. Pending interests must survive unrelated recalculation, but material edits must invalidate the earlier consent context.

Database-backed test fixtures must participate in the same domain serialization when deleting companies or listings.

**Why:** Integration suites share a database and matching can scan across their independently owned fixtures. Unlocked cascade cleanup can delete another request's matching inputs mid-transaction, causing intermittent foreign-key failures rather than a product-rule failure.

**How to apply:** Preserve the shared lock in fixture teardown and any new parallel test cleanup; unique fixture names alone do not prevent this race.