# CargoMatch breakbulk / liner pilot

This is a manually maintained introduction workflow for participating carriers
and shippers. It is separate from inland shipping and Deepsea Dry Bulk
open-position matching.

## Carrier journey

1. Open **Breakbulk / liner → Services** and register the actual vessel and IMO.
2. Create a named service and trade lane.
3. Add a sailing with its voyage reference, departure, cargo cutoff and ordered
   port calls, including arrival and departure times.
4. Enter the commercial tonnage offered on that sailing, accepted cargo types,
   maximum piece weight and dimensions, lifting capacity and deck/hold capability.
5. Publish both service and sailing to the open network. Draft or private
   records are not discoverable or eligible for new introductions.

A vessel registration is an identity record, not commercial availability.
Neither an AIS position nor a vessel's nominal capacity publishes a sailing.
The carrier explicitly maintains the offered commercial capacity.

## Shipper / charterer journey

1. Open **Breakbulk / liner → Cargo**.
2. Enter breakbulk, project cargo, heavy lift, steel, machinery or applicable RoRo
   requirements: piece count, total weight, heaviest piece weight, maximum piece
   length/width/height, required lifting capacity and deck/hold requirement.
3. Select origin, destination and readiness time, then publish to the open network.
4. Review eligible matches. Either participant can express interest; the other
   must accept before exact counterpart details and messages become available.

Piece fields describe the most demanding piece, not a full packing list. Ensure
the maximum dimensions and weight cover every piece. Engineering feasibility,
securing, dangerous-goods clearance and final carriage terms still require
agreement with the carrier.

## Matching and disclosure

- Liner cargo is only compared with liner sailings; no cross-mode matches.
- Origin must occur before destination in the sailing's ordered rotation.
- Cargo readiness must meet cutoff; expired cutoff/departure is not eligible.
- Total cargo must fit the offered commercial tonnes. Piece weight, all three
  dimensions, lifting, cargo type and stowage are separate compatibility checks.
- Pre-consent discovery uses broad regions, time windows and capacity bands.
  Exact ports, dates, piece requirements, vessel/service identity, company contact
  details are restricted to owners and mutually connected parties. Internal notes
  remain owner-only, including after connection.
- Material edits invalidate the earlier pending-consent context. A stale
  opportunity cannot be accepted using an earlier match.
- Existing connected conversations survive withdrawal: **CONNECTED** records
  consent to communicate, not a current capacity guarantee.

CargoMatch never books transport, reserves or deducts tonnage, or creates a
freight contract. More than one cargo may be individually compatible with the
same offered capacity; the carrier must maintain availability as negotiations
progress.

## Scope boundary

No automatic bookings, timetable import, other transport modes, AIS-triggered
publication or generic database rebuild is included. Shared consent and messages
remain common across the product; liner service compatibility is independent
from inland and dry-bulk vessel-position eligibility.

## Migration and checks

The existing CargoMatch database is extended by the reviewed, idempotent
`lib/db/migrations/0004_liner_breakbulk_vertical.sql`. Apply it transactionally:

```sh
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
  -f lib/db/migrations/0004_liner_breakbulk_vertical.sql
```

This creates liner-specific records and extends the existing match references
with an exactly-one-domain constraint. It does not drop data, rebuild core
tables or repurpose existing cargo/vessel-position offers. The post-merge script
uses reviewed additive SQL rather than a generic schema push.

Run `pnpm run typecheck` and `pnpm --filter @workspace/api-server test` for static
and API/privacy regression checks, including the existing inland/deepsea suites.
The idempotent location seed includes Bilbao, Dakar and Tema alongside Antwerp
and Rotterdam, so the example North Europe–West Africa rotation can be entered.
These are approximate catalogue points, not a route or berth-verification source.