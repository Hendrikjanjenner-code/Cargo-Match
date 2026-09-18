# CargoMatch pilot architecture

This document describes the contract-first core flow only. The pilot is a
European inland-shipping discovery and introduction product, not a booking,
reservation, pricing, routing, or freight-contract system.

## Scope invariants

- A company may have one or more activities (`SHIPPER`, `CARRIER`,
  `CHARTERER`). Activities are not permissions.
- The pilot has only `PRIVATE` and `OPEN_NETWORK` visibility. Trusted-network
  discovery is deliberately not represented in the API yet.
- Matching is whole-load: one cargo listing is paired with one capacity offer.
  Cargo is never silently split across vessels.
- A vessel is a persistent company asset; a capacity offer is a time-bounded
  marketplace listing. Vessel deletion is represented by deactivation.
- `CONNECTED` means mutual consent to disclose authorized identity and
  communicate. It is never a booking, capacity reservation, contract, or price
  agreement.
- Catalogue locations are used instead of arbitrary addresses. MVP geography
  is approximate positioning, not navigable or sailing distance.

## Entities and ownership

| Entity | Key fields | Ownership and relationship |
| --- | --- | --- |
| User | auth identity, profile | Managed by Replit Auth; may belong to one active company membership in the pilot. |
| Company | name, country, activities, contact, status | Current-user tenant. A company has members, vessels, cargo, capacity, matches, and notifications. |
| Membership | user, company, `OWNER`/`ADMIN`/`MEMBER` | Separates operational permission from company activity. |
| Vessel | name, ENI, type, dimensions, total capacity, compatibility, active | Persistent asset owned by one company; referenced by many capacity offers. |
| Location | catalogue name, country, region, exact and privacy coordinates, type | Curated shared catalogue. Exact coordinates are not listing response data. |
| Cargo listing | cargo/type/weight, load and destination locations, window, required vessel, visibility, status | Owned by one company. Exact owner response is tenant-scoped. |
| Capacity offer | vessel/location, availability window/type, available tonnes, compatibility, direction, positioning limit, visibility, status | Owned by one company and one vessel. |
| Match | cargo, capacity, status, score snapshot/version | Unique on `(cargoListingId, capacityOfferId)`. Only an eligible pair can be a normal match. |
| Interest | match, company, created time | Unique on `(matchId, companyId)`; records consent to a possible disclosure. |
| Conversation | match, two connected companies | Unique on `matchId`; created transactionally on acceptance. |
| Message/read state | conversation, sender, body, per-user read | Only members of the connected match can read or send. |
| Notification | recipient user, type, related match/conversation, read time | User-scoped; never used to bypass listing privacy. |

All domain entity IDs in the API are UUIDs. Date/time values are ISO
date-time strings. Request and response fields use camelCase. Company, vessel,
listing, match, conversation, message, and notification access must be checked
server-side even when a UI does not expose a link.

## Permission matrix

| Operation | OWNER | ADMIN | MEMBER | Unauthenticated |
| --- | --- | --- | --- | --- |
| Read/update current company | Read/update | Read/update | Read | No |
| Create/edit/withdraw/close cargo or capacity | Yes | Yes | No | No |
| Create/edit/deactivate vessels | Yes | Yes | No | No |
| View own listings, matches, and conversations | Yes | Yes | Yes | No |
| Show interest / accept / decline | Yes | Yes | Yes, as company participant | No |
| Send/read conversation messages | Yes | Yes | Yes, as company participant | No |
| Read own notifications | Yes | Yes | Yes | No |
| Read active catalogue locations | Yes | Yes | Yes | Yes |
| Read open marketplace | Yes | Yes | Yes | Yes |

The company activity list is not a permission check. Company status is an
additional guard: `SUSPENDED` or `CLOSED` companies cannot publish, show
interest, or participate in new matches. Platform-admin controls are outside
this first contract.

The secure development demo has a richer, independent permission model; see
`docs/demo-role-matrix.md`. Its roles do not widen this production matrix.

## Privacy and response views

The API owns redaction; clients must not fetch an exact object and hide fields
with CSS or client-side filtering.

| Requester and state | Allowed representation |
| --- | --- |
| Anonymous visitor | No marketplace listings. The pilot requires an authenticated active company for discovery. |
| Authenticated unrelated company | Same anonymous marketplace representation; no private listing, match, exact location, identity, notes, or conversation access. |
| Listing owner | Full owned company, vessel, cargo, and capacity response, including private fields belonging to that tenant. |
| Match participant before connection | Anonymous cargo/capacity representations and display-safe score/components. |
| Connected participant | Authorized connected companies and exact connected cargo/capacity fields; private owner notes remain excluded unless separately authorized. |

Anonymous listing representations are separate schemas, not a partial
serialization of private models. They use broad strings for `tonnageBand`,
`timeBand`, and `distanceBand`; they do not return exact tonnage, timestamps,
coordinates, company/vessel identifiers, contacts, ENI, dimensions, or
free-text notes. The marketplace endpoint returns only active open listings.
Match detail may include nullable `ownedCargo`/`ownedCapacity` or
`connectedCargo`/`connectedCapacity` only when the response policy permits it.

## Eligibility and deterministic scoring

Eligibility runs before scoring and returns machine-readable failure reasons
internally. A pair is not scored or shown as a normal match when either
listing is not `ACTIVE`, expired, missing required data, owned by a suspended
company, not discoverable under visibility rules, below required capacity,
vessel-incompatible, cargo-incompatible, outside the capacity positioning
limit, or unable to satisfy the loading window. The engine uses the catalogue
locations through a replaceable geography service; the MVP implementation may
use great-circle distance but must label it **Approximate positioning
distance**.

For every eligible pair, calculate each component on a normalized 0–100 scale:

```text
rawTotal =
  distanceScore          * 0.30
  + timingScore           * 0.25
  + capacityScore         * 0.20
  + vesselTypeScore      * 0.10
  + directionScore        * 0.10
  + cargoCompatibilityScore * 0.05
```

Keep full precision in the persisted calculation snapshot where practical.
Round only the displayed `totalScore` to the nearest integer (for example,
96.6 displays as 97). Store `calculationVersion` and `calculatedAt`; a
material listing change either recalculates affected matches or marks them
stale and prevents stale scores from being presented as current.

Marketplace and pre-connection match responses include the component scores
but explain their inputs only as anonymized bands. This prevents a score from
being used to infer exact capacity, time, or location. Explanations must be
descriptive and supported by the six components; they must not claim
guaranteed suitability, savings, routing, ETA, or booking.

## State rules

### Listing lifecycle

Both cargo and capacity use:

```text
DRAFT -> ACTIVE -> WITHDRAWN
                  -> CLOSED
                  -> EXPIRED
```

An owner may edit a draft or active listing. Withdrawal and closure remove a
listing from discovery without deleting its history. A scheduled expiry marks
an active listing `EXPIRED` after its relevant time window. Expired,
withdrawn, and closed listings do not create new matches. A material edit
invalidates or recalculates affected match snapshots.

### Match lifecycle and actions

```text
NEW -> INTEREST_SENT -> CONNECTED
                    \-> DECLINED
NEW -----------------> EXPIRED
INTEREST_SENT --------> EXPIRED
```

`INTEREST` is idempotent per company and match; duplicate interests are
rejected or safely treated as the existing interest. `ACCEPT` is available to
the counterparty after interest and `DECLINE` is available to the
counterparty. Invalid transitions, expired listings, suspended companies, and
stale versions fail with a safe conflict response.

Acceptance is one transaction:

1. lock and validate the match and current state;
2. transition to `CONNECTED` and persist mutual consent;
3. insert the unique conversation (`matchId` is unique);
4. create the relevant notifications;
5. commit or roll back the entire operation.

Concurrent acceptance cannot create a second conversation. Connected status
does not reserve any capacity and does not imply transport took place.

### Communication

Only connected match participants can list a conversation, read messages, send
messages, or mark messages read. Read state is per user (not one shared
company-level flag). An unrelated company receives the same not-found/forbidden
behavior as any other unauthorized caller and never receives message content.

## Secure development-demo boundary

The role-based multi-persona demo is an additive application surface, not an
authentication shortcut for this production architecture.

- A demo visitor receives an opaque, secure demo session and a server-owned
  sandbox namespace. The server derives the active persona, company, platform
  role, permissions, and namespace; actor/company identifiers supplied by the
  client are never authoritative.
- Persona switching changes that server authorization context. It preserves
  one shared exercise state inside the visitor's sandbox while incrementing or
  replacing the principal context so stale requests and late responses cannot
  act as a previous persona.
- Demo persistence is physically/logically separate from real OIDC identities,
  memberships, companies, listings, matches, conversations, notifications, and
  provider data. A demo principal is rejected by real company routes, and a
  real principal receives no implicit demo-admin authority.
- Demo endpoints and shortcuts fail closed unless the server's explicit
  development/demo environment gate is enabled. The UI flag alone is not a
  security control. Production does not expose demo start, switch, reset, or
  administration.
- The server returns persona-specific projections, never the complete sandbox.
  Before mutual consent, protected company/person/asset identity, contacts,
  exact positions, private records, conversations, and recipient-specific
  notifications are omitted at serialization time. UI hiding is not privacy.
- `CONNECTED` retains its production meaning: authorized introduction and
  communication only, never booking, capacity reservation, payment, release,
  routing verification, or transport completion.
- Demo administration is sandbox-scoped. Emma may inspect safe fictional
  summaries and reset only the current visitor's demo after confirmation. Raw
  provider credentials, secrets, external identifiers, real audit data, and
  customer data are never part of a demo projection.
- Rail, Air Cargo, and CargoMatch Import are functional fictional demo pilots,
  not production modules. Import payment/release/pickup values are simulated
  status transitions; no external payment, customs, document-delivery, or
  physical-handling side effect exists.

The previous browser-only world under
`artifacts/cargomatch/src/demo/world*.ts` remains a legacy data format, not an
authority source. Existing local data requires an explicit reset/transition
choice and is never silently imported into the secure demo or real tables.
Production OIDC behavior and existing Inland, Deepsea, Liner, and Road routes
remain unchanged.

The exact demo HTTP/session contract is documented separately in
`docs/demo-server-contract.md`; the company/persona and module-state contract is
in `docs/demo-role-matrix.md`.
