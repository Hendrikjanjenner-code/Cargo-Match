---
name: Commercial AIS licensing boundary
description: Why paid AIS activation and retention are intentionally conservative.
---
Treat public API documentation as a technical contract, not evidence of purchased access or commercial reuse rights.

**Why:** Fixtures establish parser behavior, not licensed rights or live coverage. Development authorization does not authorize provider subscriptions or paid requests.

**How to apply:** Before widening storage, caching, datasets, or user access, review the actual provider agreement and documented product. Keep unsupported units null rather than inferring them from sample values. Verify reviewer claims about API fields against the vendor documentation before changing fixtures; review feedback has confused raw AIS fields with enriched API fields. Cost/coverage work must not silently relax this boundary.

Tenant ownership of a CargoMatch record is not proof of ownership of the physical vessel.

**Why:** A tenant can create a record named after any vessel and copy its public MMSI. Treating tenant-authored evidence as authoritative would permit tracking another company's exact location.

**How to apply:** Keep tenant claims separate from independent operator/provider ownership verification. Unverified claims must not reserve global identifiers or authorize paid telemetry access.

Independent vessel identity verification is not verification of a planner's operational information.

**Why:** Ownership evidence establishes who may participate, not whether unloading times, remaining tonnage, or future commercial availability are accurate. Combining these trust levels would make a manual plan appear independently verified.

**How to apply:** Keep operational-source provenance and uncertainty separate from identity confidence when adding future prediction sources. A permitted identity or AIS license alone cannot establish permission to reuse operational data.