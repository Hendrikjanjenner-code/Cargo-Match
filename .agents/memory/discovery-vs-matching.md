---
name: Discovery versus matching
description: Privacy and completeness tradeoff when separating standalone listing discovery from compatible-pair matching.
---

Listing discovery and match eligibility are different decisions. Discovery must
not depend on the existence of compatible counterpart cargo or capacity, but
must still enforce publication, company, asset and expiration eligibility.

**Why:** A correctly filtered query does not protect another response-emission
path. Even a band-only response leaks the existence of a private listing.
Conversely, requiring a compatible pair hides genuinely published supply
whenever matching demand has not yet been entered.

**How to apply:** When changing a marketplace data source, check every path that
adds response items. Include positive discovery without any counterpart and
negative PRIVATE/DRAFT/service-private/expired/inactive-company fixtures.
Never publish owner-entered free text as an anonymous route band; use catalogue
regions instead.