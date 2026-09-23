# Secure demo role and module matrix

This document is the authorization and coverage contract for the CargoMatch
development demo. It is deliberately separate from the production membership
matrix in `cargomatch-architecture.md`.

## Identity dimensions

Authorization must evaluate all of the following dimensions. None is an alias
for another:

- **Company activities** describe what the company does. The current seed uses
  `SHIPPER`, `RECEIVER`, `CARRIER`, `CHARTERER`, `FORWARDER`,
  `IMPORT_CONSOLIDATOR`, and `DEMO_PLATFORM`. Mode-specific operational
  capability is represented separately by company modes and permissions.
- **Membership role** describes authority inside the fictional company:
  `OWNER`, `ADMIN`, or `MEMBER`.
- **Operational profile** selects relevant terminology and work queues; it does
  not grant authority by itself.
- **Platform role** is `USER` or the implementation token `DEMO_ADMIN`.
  `DEMO_ADMIN` realizes the requested platform-administrator perspective but
  applies only to the shared fictional demo ecosystem; it is not a production
  `PLATFORM_ADMIN`.
- **Explicit permissions** are the final allow-list for an action. Company
  status, persisted demo membership, record ownership or assignment, mode, publication
  state, and match participation are additional mandatory checks.

Hiding a link is not authorization. Every read and mutation must enforce the
same rules on the server. In particular, `SKIPPER` and `DRIVER` are operational
profiles, not commercial mandates.

## Persona matrix

The eleven personas below are fictional. “Own” means the active demo company;
“assigned” means the named asset assignment, not every asset in the company.

| Persona | Company activities | Membership | Operational profile | Platform role | Modes/modules | Explicit permissions |
| --- | --- | --- | --- | --- | --- | --- |
| Andy Kers — NorthSea Chartering Demo | `CHARTERER` | `OWNER` | `CHARTERER` | `USER` | Maritime / Deepsea | `VIEW_MATCHES`, `SHOW_INTEREST`, `ACCEPT_CONNECTION`, `DECLINE_CONNECTION`, `MESSAGE_CONNECTED`, `CREATE_CARGO`, `EDIT_OWN_CARGO` |
| Sophie van Dijk — OceanBridge Bulk Demo | `CARRIER` | `ADMIN` | `OWNER_REPRESENTATIVE` | `USER` | Maritime / Deepsea | `VIEW_MATCHES`, `SHOW_INTEREST`, `ACCEPT_CONNECTION`, `DECLINE_CONNECTION`, `MESSAGE_CONNECTED`, `MANAGE_ASSETS`, `MANAGE_CAPACITY` |
| Mark de Jong — RhineFlow Shipping Demo | `CARRIER` | `MEMBER` | `SKIPPER` | `USER` | Maritime / Inland | `VIEW_ASSIGNED_ASSET`, `MANAGE_ASSIGNED_ASSET_AVAILABILITY`, `SEND_TO_PLANNER`, `VIEW_MATCHES` |
| Eva Jansen — RhineFlow Shipping Demo | `CARRIER` | `MEMBER` | `PLANNER` | `USER` | Maritime / Inland | `VIEW_MATCHES`, `SHOW_INTEREST`, `ACCEPT_CONNECTION`, `DECLINE_CONNECTION`, `MESSAGE_CONNECTED`, `MANAGE_ASSETS`, `MANAGE_CAPACITY`, `REVIEW_REFERRAL` |
| Laura Peters — EuroCommodities Demo | `SHIPPER`, `RECEIVER` | `OWNER` | `SHIPPER` | `USER` | Primary Inland; company demo coverage also Deepsea, Road, Rail, Air, Liner, and addressed Import receiver access | `VIEW_MATCHES`, `SHOW_INTEREST`, `ACCEPT_CONNECTION`, `DECLINE_CONNECTION`, `MESSAGE_CONNECTED`, `CREATE_CARGO`, `EDIT_OWN_CARGO`, `VIEW_IMPORT_RECEIVER` |
| Thomas Becker — TransRoute Logistics Demo | `CARRIER` | `MEMBER` | `PLANNER` | `USER` | Road | `VIEW_MATCHES`, `SHOW_INTEREST`, `ACCEPT_CONNECTION`, `DECLINE_CONNECTION`, `MESSAGE_CONNECTED`, `MANAGE_ASSETS`, `MANAGE_CAPACITY`, `REVIEW_REFERRAL` |
| Jan Müller — TransRoute Logistics Demo | `CARRIER` | `MEMBER` | `DRIVER` | `USER` | Road | `VIEW_ASSIGNED_ASSET`, `MANAGE_ASSIGNED_ASSET_AVAILABILITY`, `SEND_TO_PLANNER`, `VIEW_MATCHES` |
| Anna Schmidt — EuroRail Cargo Demo | `CARRIER` | `MEMBER` | `RAIL_OPERATOR` | `USER` | Rail | `VIEW_MATCHES`, `SHOW_INTEREST`, `ACCEPT_CONNECTION`, `DECLINE_CONNECTION`, `MESSAGE_CONNECTED`, `MANAGE_ASSETS`, `MANAGE_CAPACITY` |
| Sarah Williams — SkyFreight Demo | `CARRIER` | `MEMBER` | `AIR_CARGO_OPERATOR` | `USER` | Air Cargo | `VIEW_MATCHES`, `SHOW_INTEREST`, `ACCEPT_CONNECTION`, `DECLINE_CONNECTION`, `MESSAGE_CONNECTED`, `MANAGE_ASSETS`, `MANAGE_CAPACITY` |
| David Chen — GlobalLine Logistics Demo | `FORWARDER`, `CARRIER`, `IMPORT_CONSOLIDATOR` | `MEMBER` | `FORWARDER` | `USER` | Primary Liner; company demo coverage also Air Cargo and separate Import module | `VIEW_MATCHES`, `SHOW_INTEREST`, `ACCEPT_CONNECTION`, `DECLINE_CONNECTION`, `MESSAGE_CONNECTED`, `CREATE_CARGO`, `EDIT_OWN_CARGO`, `MANAGE_ASSETS`, `MANAGE_CAPACITY`, `MANAGE_IMPORT` |
| Emma de Vries — CargoMatch demo-beheer | `DEMO_PLATFORM` | `ADMIN` | `COMPANY_MANAGER` | `DEMO_ADMIN` | Demo Admin | `VIEW_ADMIN`, `RESET_DEMO`; no production company, provider-secret, credential, payment, or impersonation permission |

These names are the current server seed tokens. UI labels may present
`MANAGE_ASSETS` as mode-appropriate vessel, vehicle, rail, or flight management
and `MESSAGE_CONNECTED` as messaging connected companies, but clients must send
and servers must check the canonical tokens above. `DECLINE_CONNECTION` is an
independent commercial permission: it only permits responding to incoming
`INTEREST_SENT` when the counterparty has consented and the actor has not.
It cannot cancel the sender's own interest or revoke a connected match.

### Explicit denials that must remain visible in tests

- Mark cannot accept or decline commercial connections, administer RhineFlow,
  edit an unassigned vessel, or access demo administration.
- Jan cannot publish capacity, give commercial consent, administer TransRoute,
  or read/update any truck other than Truck 42.
- Andy cannot update OceanBridge vessels or open positions.
- Sarah cannot read Anna's private rail capacity.
- Emma's `DEMO_ADMIN` role cannot cross from the demo namespace into real
  users, companies, listings, provider credentials, or production reset paths.
- A real OIDC principal cannot call demo administration merely because a demo
  cookie exists, and a demo principal is never accepted by real company routes.

Operational confirmation records evidence and may adjust an availability
estimate. It never publishes a listing, sends interest, accepts disclosure, or
creates a booking.

## Expected shared-state chains

All actors in a chain view different server projections of one underlying
   record set shared between all demo visitors. Person switching must not clone a
match, interest, connection, conversation, notification, or planner referral.

1. **Deepsea (priority):** Andy's 75,000 mt Indonesia–China cargo is eligible
   for Sophie's 82,000 DWT Kamsarmax, MV OceanBridge Atlas, expected open in
   Malaysia. Andy sees a redacted opportunity and sends interest. Sophie sees
   the incoming interest and accepts. One match becomes `CONNECTED`, one
   conversation is created, and only then may each participant receive the
   other's authorized identity/contact projection. `CONNECTED` is not a
   booking or capacity reservation.
2. **Inland:** Mark sees a suitable next cargo for assigned MS RhineFlow One
   and sends it to Eva. Eva receives the same planner referral, reviews it, and
   exercises commercial interest/consent. Mark's operational action does not
   exercise Eva's commercial authority.
3. **Road:** Jan confirms the estimated empty state for assigned Truck 42
   (current Cologne–Eindhoven job, expected delivery 13:30 and empty Eindhoven
   14:00) and sends the suitable next load to Thomas. Thomas receives the same
   referral and alone continues the commercial flow.
4. **Rail:** Anna manages twelve compatible wagons available at Duisburg
   tomorrow 06:00, sees strong and weaker eligible cargo plus an incompatible
   example, and completes interest/acceptance with Laura as the authorized
   cargo counterparty.
5. **Air Cargo:** Sarah manages fictional B777F AMS–DXB capacity departing
   tomorrow 21:30 with 4,800 kg and 28 m³ remaining. David/GlobalLine's 3,600 kg
   shipment ready at 15:00 is the authorized forwarder counterparty. Weight,
   volume, route, cutoff, and special-handling mismatches must be real
   eligibility failures.
6. **Liner:** David manages fictional services/sailings and can progress a
   suitable conventional/project-cargo match with Laura. Container terminology
   must not replace the existing conventional/breakbulk matching semantics.
7. **Import:** David progresses one fictional LCL shipment through creation,
   explicitly addressed receiver access for Laura, arrival, documents,
   authorized local charges, simulated payment, release, and pickup. These are
   demo status transitions only: no money movement, customs release, external
   document delivery, or physical handling occurs.

The initial priority deepsea chain must not start connected. Seeded historical
conversations may exist for other records, but must observe the same participant
privacy checks.

## Module flags

`ACTIVE` means existing supported product functionality, `PILOT` means a
functional but explicitly limited experience, `COMING_LATER` is non-clickable
status text, and `HIDDEN` is absent. A flag state never grants permission.

| Flag | Development demo | Production | Notes |
| --- | --- | --- | --- |
| `INLAND` | `ACTIVE` | `ACTIVE` | Reuse existing vessel, capacity, marketplace, match, consent, message, and notification flows. |
| `DEEPSEA` | `ACTIVE` | `ACTIVE` | Reuse deepsea services and privacy projections; manual positioning remains provisional and not route-verified. |
| `LINER` | `ACTIVE` | `ACTIVE` | Reuse conventional/breakbulk services, sailings, cargo, and match actions. |
| `ROAD` | `PILOT` | Existing Road Pilot | Reuse road assets, availability, matching, flags, and planner/driver authority boundary. |
| `RAIL` | `PILOT` | `HIDDEN` | Functional fictional demo matching only; not a production rail system. |
| `AIR_CARGO` | `PILOT` | `HIDDEN` | Functional fictional demo matching only; no external airline or booking integration. |
| `CARGOMATCH_IMPORT` | `PILOT` | `HIDDEN` | Separate LCL workflow; simulated payments/releases only. Never mix into capacity navigation. |
| `DEMO_MODE` | `ACTIVE` in explicitly demo-enabled development | `HIDDEN` and server-disabled | Start, switch, reset, and demo APIs must fail closed outside the explicit environment gate. |
| `GUIDED_DEMO` | `PILOT` when enabled; otherwise `HIDDEN` | `HIDDEN` | Guidance follows completed real demo actions; it never performs consent or creates presentation-only results. |

Rail, Air Cargo, and Import may be shown as `COMING_LATER` rather than `HIDDEN`
in a non-demo preview only when the item is non-clickable and does not imply
availability. The default production posture is `HIDDEN`; changing it requires
an explicit production release decision and must not happen as a side effect of
this demo.

## Existing implementation reuse map

- `artifacts/api-server/src/routes/listings.ts`, `vessels.ts`, and
  `marketplace.ts` contain tenant ownership, listing lifecycle, and discovery
  patterns.
- `routes/matches.ts`, `routes/conversations.ts`, `routes/notifications.ts`,
  and `services/consent.ts` provide the production consent/communication
  semantics to preserve without accepting a demo principal on those routes.
- `services/matching.ts`, `services/deepsea.ts`, and `services/liner.ts` contain
  reusable pure eligibility/scoring concepts. Reuse must not couple isolated
  demo persistence to real tables.
- `routes/road.ts`, `services/roadTelematics.ts`, and the road schema preserve
  the separation between driver evidence and planner commercial authority.
- `lib/privacy.ts` demonstrates server-built owner, anonymous, participant, and
  connected projections; the demo API must likewise project, not return its
  complete world to the browser.
- `artifacts/cargomatch/src/App.tsx` and the mode-specific pages remain the real
  application. The secure demo is an additional entry/session boundary, not a
  replacement for those routes.
