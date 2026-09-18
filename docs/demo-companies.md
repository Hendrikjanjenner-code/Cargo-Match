# Secure server demo company matrix

The current multi-persona demonstration is deliberately fictitious and
server-authoritative. Its data lives in an isolated namespace per visitor and
is shared only between persona perspectives inside that namespace. It is never
written to or resolved through real OIDC users, memberships, customer tables,
provider integrations, or production marketplace records.

The older `artifacts/cargomatch/src/demo/world*.ts` browser-only world is a
legacy demo format. It must not be silently uploaded or imported into either
the secure demo or production tables. A user receives an explicit reset or
transition choice.

| Fictional company | Activities | Persona(s) | Seeded coverage |
| --- | --- | --- | --- |
| NorthSea Chartering Demo | `CHARTERER` | Andy Kers | Deepsea cargo orders including the 75,000 mt Indonesia–China priority scenario |
| OceanBridge Bulk Demo | `CARRIER` | Sophie van Dijk | Capesize/Kamsarmax/Panamax/Supramax/Handysize coverage; MV OceanBridge Atlas is the priority 82,000 DWT Kamsarmax |
| RhineFlow Shipping Demo | `CARRIER` | Mark de Jong, Eva Jansen | Multiple inland vessels; Mark is assigned only MS RhineFlow One; skipper-to-planner referral |
| EuroCommodities Demo | `SHIPPER`, `RECEIVER` | Laura Peters | Fictional grain, minerals, steel and project cargo across supported demo modes; authorized rail/liner counterparty and addressed Import receiver |
| TransRoute Logistics Demo | `CARRIER` | Thomas Becker, Jan Müller | Multiple tractors and curtain-side/box/reefer trailers; Jan is assigned only Truck 42 |
| EuroRail Cargo Demo | `CARRIER` | Anna Schmidt | Twelve-wagon group at Duisburg, a rail service, eligible and incompatible cargo fixtures |
| SkyFreight Demo | `CARRIER` | Sarah Williams | B777F AMS–DXB capacity and a belly-capacity example |
| GlobalLine Logistics Demo | `FORWARDER`, `CARRIER`, `IMPORT_CONSOLIDATOR` | David Chen | Primary 3,600 kg AMS–DXB air-shipment counterparty; conventional/liner service, sailing and trade lane; separate fictional LCL Import flow |
| CargoMatch demo-beheer | `DEMO_PLATFORM` | Emma de Vries | Current-sandbox statistics, safe provider-status summaries, feature states, audit summaries, confirmed sandbox reset |

Activities, membership roles, operational profiles, platform role, exact
permissions, and expected actor chains are specified in
`docs/demo-role-matrix.md`.

## Discovery and projections

Privacy-safe discovery filters each cargo, offer, departure, rail capacity, and
flight capacity independently:
active company, active asset where applicable, `ACTIVE` publication,
`OPEN_NETWORK` visibility, and a future relative end/departure date. It never
requires a compatible counterpart listing. Anonymous projections contain
regions, date bands, and capacity/requirement bands, not company identity or
free text. Owners see their own records; connected parties see the two
connected records with full projections.

Skippers and drivers receive only operationally relevant projections for their
assigned asset and eligible/referrable opportunities. They cannot use those
projections for commercial consent. An operational observation or
`SEND_TO_PLANNER` action never publishes capacity or authorizes disclosure.

## Consent and persistence

An explicitly authorized match party can send interest. The counterparty can
accept or decline, and the initiator can withdraw. Repeating a terminal action
or pending interest is idempotent. Every interest or acceptance atomically
revalidates listing, capacity, ownership, permission, and expiry before
changing the shared match. Connected conversations are visible only to the two
participating companies.

The server stores one durable exercise state per visitor sandbox. Refresh and
persona switching retain that state; another browser does not receive it.
Persona start/switch changes the server principal and invalidates stale client
context. Only an authorized demo administrator may reset the current sandbox
after confirmation. Demo start, switch, reset, and data endpoints are disabled
outside the explicit development/demo gate.