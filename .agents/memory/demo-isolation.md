---
name: Demo isolation tradeoff
description: Why the local demonstration mirrors matching rules rather than importing the server service.
---

Keep the demonstration separate from server services and authenticated application state, even when a real session already exists.

**Why:** The demo was authorized specifically as a fictitious browser-only environment, not an authentication bypass. Its implementation must not expand or silently complete the separate core-build scope. Importing the server's database-backed service into the browser would break this boundary.

**How to apply:** When changing core eligibility or scoring, deliberately synchronize and compare the browser-safe calculation. A future shared pure module is appropriate only if it preserves the server behavior and cannot import database, authentication, or network code into the demo.