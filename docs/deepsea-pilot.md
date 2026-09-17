# CargoMatch Deepsea Dry Bulk pilot

CargoMatch now has an additive `DEEPSEA_BULK` vertical alongside the
backward-compatible `INLAND_WATERWAY` default. The pilot covers:

- dry-bulk vessel profiles (class, DWT, optional summer draft and gear);
- cargo requirements (quantity tolerance, DWT/draft/gear/class constraints);
- future vessel open-position capacity extensions with explicit manual route
  intentions, travel-day estimates, departure uncertainty, and safety buffers;
- mode-isolated eligibility, explainable scoring, mutual consent, and the
  existing connected-message workflow.

## Manual pilot rules

Operators enter and maintain deepsea data manually. `EXPECTED` and `CONFIRMED`
are separate availability confidence values; publishing an expected position
is deliberate user input. AIS is not connected to deepsea publication and
never turns a suggestion into a commercial capacity listing.

Matching uses a geodesic distance as an **approximate positioning distance**,
not sailing distance, voyage duration, bunker estimate, cost, or CO2 result.
Every manual match remains provisional, including when all estimates are
entered and availability is `CONFIRMED`. Date arithmetic does not verify a
route. A known
required draft or gear capability with an unknown vessel value excludes the
pair. Vessel DWT is checked separately from offered cargo tonnage. A preferred
vessel class changes scoring only; it is not an eligibility exclusion.
The requested vessel type remains a hard eligibility constraint.
Required gear is an exact trimmed, case-insensitive label match, so `geared`
does not match `ungeared`. Quantity tolerance is owner-entered, defaults to
zero when omitted, and must be below 100%.

Before connection, marketplace and match views expose only broad region,
window, class/tonnage bands, and uncertainty-safe explanations. Exact vessel
identity/IMO, ports, tonnage, dates, commercial notes, and company details
remain owner/connected views according to the existing privacy workflow.

`CONNECTED` means both companies consented to an introduction and may discuss
the opportunity through CargoMatch; it is intentionally preserved when a
listing later changes state and does not represent a booking, reservation,
route verification, or freight contract. Pending consent is reset when a
material listing edit changes eligibility, while withdrawn/invalid pairs
become stale/expired and cannot accept old consent.

## Migration and seed

Review the additive migration, then apply exactly that reviewed SQL file (it
is intentionally not a destructive schema push):

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f lib/db/migrations/0003_deepsea_bulk_vertical.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f lib/db/migrations/0004_deepsea_reachability_manual_fields.sql
```

This migration adds columns, enums, and mode-specific extension tables; it
does not drop or reset existing inland data. Seed the curated approximate
deepsea port fixtures (idempotently) with the existing location seed command
used by the environment:

```sh
pnpm --filter @workspace/scripts run seed-locations
```

No external paid port, route or AIS API is required for the manual pilot.
The reachability migration adds nullable assumptions and widens the existing
manual-day value to support fractional days without discarding old estimates.
Apply reviewed migrations to each target environment before running the new
server; do not replace this step with a destructive schema reset.


## Separate liner pilot and excluded future modes

Conventional/breakbulk liner opportunities now have a separate service/sailing
workflow, described in [the liner pilot guide](liner-pilot.md). They are not
deepsea bulk open positions and never use vessel position as proof of a service.

Road, rail, air cargo, automatic multimodal orchestration, AIS-assisted
publication, and automatic mode recommendation remain outside this pilot.
They require their own mode-specific strategies and contracts rather than
being inferred from the deepsea or inland rules.
## Reachability and laycan

The capacity form separates these operator inputs:

- **Route intention:** unspecified, direct, Suez, Panama, Cape of Good Hope,
  or other. This records a preference, not a generated or validated sea route.
  Optional route notes describe the assumption. Selecting a canal does not
  confirm it is open or that the vessel can transit it.
- **Earliest open/departure:** the capacity's available-from timestamp.
  Departure uncertainty is an additional number of days to the latest
  estimated departure. A blank uncertainty is unknown, not zero.
- **Manual travel days:** the existing `manualPositioningDays` field remains
  backward compatible and is an operator estimate, not distance divided by
  an invented speed.
- **Positioning buffer:** additional safety days, separate from travel time
  and departure uncertainty. Blank means unknown; zero must be deliberate.

Arrival arithmetic uses the later of the earliest open time and assessment
time, plus manual travel time and the positioning buffer. Where departure
uncertainty is known, it also produces a latest estimated arrival. Fractional
days retain their precision. Early arrival can wait for laycan to open; an
arrival at the laycan closing boundary is allowed. Definitely late arrivals
are excluded; incomplete assumptions or an arrival interval straddling the
deadline remain visibly provisional. Capacity availability must also support
the loading window being assessed.

Cargo-incompatible offers are excluded before scoring. Timing ranking uses
100 for an estimated interval within laycan, 50 for an uncertain interval,
25 for unknown timing, and 0 for definitely late timing (which is excluded
from new eligible matches). These are ranking weights, not probabilities or
route-verification confidence.

`UNKNOWN` means insufficient operator inputs. `USER_ESTIMATED` means the
assessment uses operator estimates, even though the date arithmetic is
computed. `CALCULATED` is reserved for a future assessment using licensed
route-engine data. `VERIFIED` is separately reserved for evidenced operational
verification; neither licensed routing nor a confirmed open position would
automatically prove actual feasibility. The manual pilot never emits either
of these latter two provenance statuses.

The match list and detail view show privacy-safe laycan and uncertainty
summaries. Exact route intentions, route notes, and input values follow the
existing owner/connected disclosure rules, not the public match explanation.
An estimate on a capacity offer is not independently validated for every
candidate loading port: operators must check the specific positioning leg
with the counterparty. No fuel, freight cost, CO2, or navigational-safety claim
is produced.

## Explicitly excluded future modes

Conventional/breakbulk, liner, road, rail, air cargo, automatic multimodal
orchestration, activated maritime route engines, AIS-assisted publication, and automatic
mode recommendation remain future work. They should receive their own
mode-specific strategies and contracts rather than being inferred from the
deepsea or inland rules.

## Licensed route access — not activated

On 2026-09-17, an integration-catalog search for maritime routing, Searoutes,
and Dataloy returned no matching connector. No existing route subscription,
API access, or commercial redistribution rights were confirmed. The application
therefore stays in manual mode; there are no paid route requests or silent
fallbacks to synthetic routes.

Public sources checked:

- [Searoutes sea-route API](https://developer.searoutes.com/reference/getsearoute):
  supports coordinates or UN/LOCODEs, departure, vessel/draft/speed inputs,
  and route restrictions including blocked canal areas.
- [Searoutes pricing](https://searoutes.com/pricing): lists a separate Ocean
  routing product. Published offers are not evidence that this project has
  a subscription or permission to store and share its outputs.

Before activating any provider, separately obtain the user's approval for the
subscription, spending limits, licensed users, permitted storage/caching and
redistribution, and the actual contracted product. Only then request credentials
through the workspace secrets flow. Validate the real response contract, units,
route restrictions, timestamps and failures against authorized live samples.
Persist provider/product provenance and input snapshots; invalid, unavailable
or stale provider data must not silently become a verified result. A provider
route calculation must remain distinct from independent operational
verification and from a commercial booking.
