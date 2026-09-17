# Browser demo company matrix

The multi-company demonstration is a deliberately fictitious, browser-only
world. It is implemented in `artifacts/cargomatch/src/demo/world*.ts`; it does
not import API, authentication, database, or network code.

| Company | Mode/activity | Persona(s) | Seeded positive | Seeded negative |
| --- | --- | --- | --- | --- |
| Demo Transportplanning (Andy Kers) | Charterer / inland coordination | Andy (`andy`) owner | Andy dry bulk ↔ Delta Pioneer | Same-company pair is rejected |
| Northstar Materials | Shipper | Nora (`shipper-planner`) owner | Aggregates ↔ Delta Pioneer; export bulk ↔ Blue Meridian; pallets ↔ Rijnland 42; breakbulk ↔ Atlas sailing | Private road cargo is not anonymous |
| Delta Barge Logistics | Inland carrier | Ivo (`inland-planner`) owner | Rotterdam–Duisburg dry bulk, relative day 1–7 | Wrong mode, insufficient capacity, expired offer |
| BlueHarbor Bulk | Deepsea carrier | Dani (`deepsea-planner`) owner | Singapore–Hamburg dry bulk, relative day 1–20 | Route/type/timing/capacity mismatch |
| Atlas Conventional Lines | Breakbulk / liner | Lina (`liner-planner`) owner | Shanghai–Hamburg cargo cutoff and departure | Public Antwerp destination does not serve Hamburg; private sailing is hidden |
| Rijnland Road Freight | Road carrier | Ruben (`road-planner`) planner; Rosa (`road-driver`) driver | Assigned curtainsider, Utrecht–Eindhoven and return Eindhoven–Utrecht | Public 8-tonne offer is too small; draft capacity is not discoverable |

## Discovery and projections

Anonymous discovery filters each cargo, offer, and departure independently:
active company, active asset where applicable, `ACTIVE` publication,
`OPEN_NETWORK` visibility, and a future relative end/departure date. It never
requires a compatible counterpart listing. Anonymous projections contain
regions, date bands, and capacity/requirement bands, not company identity or
free text. Owners see their own records; connected parties see the two
connected records with full projections.

Road drivers have no commercial projections, matches, consent, or messages.
They can only confirm or flag the assigned offer's operational status. A driver
observation never publishes capacity and never authorises commercial consent.

## Consent and persistence

Either match party can send interest. The other party can accept, reject, or
the initiator can withdraw. Repeating a terminal action or an already pending
interest is idempotent; connected conversations are visible only to the two
companies. Every interest/accept operation revalidates the current listing and
turns a stale offer into `STALE` rather than silently connecting it.

State is stored under `cargomatch.demo.world.v2`. Loading returns an explicit
`LEGACY`, `CORRUPT`, or `UNAVAILABLE` result. The caller must choose
`RESET_LEGACY`, `RESET_CORRUPT`, or `KEEP`; malformed or old data is never
silently overwritten.