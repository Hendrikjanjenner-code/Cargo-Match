# CargoMatch Deepsea Dry Bulk pilot

CargoMatch now has an additive `DEEPSEA_BULK` vertical alongside the
backward-compatible `INLAND_WATERWAY` default. The pilot covers:

- dry-bulk vessel profiles (class, DWT, optional summer draft and gear);
- cargo requirements (quantity tolerance, DWT/draft/gear/class constraints);
- future vessel open-position capacity extensions with optional manual
  repositioning-day estimates;
- mode-isolated eligibility, explainable scoring, mutual consent, and the
  existing connected-message workflow.

## Manual pilot rules

Operators enter and maintain deepsea data manually. `EXPECTED` and `CONFIRMED`
are separate availability confidence values; publishing an expected position
is deliberate user input. AIS is not connected to deepsea publication and
never turns a suggestion into a commercial capacity listing.

Matching uses a geodesic distance as an **approximate positioning distance**,
not sailing distance, voyage duration, bunker estimate, cost, or CO2 result.
When no manual repositioning estimate is entered, a match may be marked
provisional in the scoring explanation and is not a verified route. A known
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
```

This migration adds columns, enums, and mode-specific extension tables; it
does not drop or reset existing inland data. Seed the curated approximate
deepsea port fixtures (idempotently) with the existing location seed command
used by the environment:

```sh
pnpm --filter @workspace/scripts run seed-locations
```

No external paid port or AIS API is required for this pilot.

## Explicitly excluded future modes

Conventional/breakbulk, liner, road, rail, air cargo, automatic multimodal
orchestration, maritime route engines, AIS-assisted publication, and automatic
mode recommendation remain future work. They should receive their own
mode-specific strategies and contracts rather than being inferred from the
deepsea or inland rules.