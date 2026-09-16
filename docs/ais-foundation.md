# AIS foundation (simulation only)

CargoMatch's AIS layer is an enhancement to the private, owned-vessel view. It
does not change manual capacity, location, availability windows, matching,
consent, or messaging. It also does not turn an observed vessel into a
CargoMatch participant.

## Contract and privacy

`GET /api/vessels/{vesselId}/ais` first authenticates an active company
membership and then loads the vessel with a company predicate. Anonymous
callers receive `401`; an unknown or other-tenant vessel receives `404`.
Responses are `Cache-Control: private, no-store` and vary on session
authorization. AIS is never included in marketplace, match, or
counterparty responses.

The normalized telemetry model retains provider, provider vessel ID, optional
identifiers and observations, observation/receipt times, freshness, source
type, and a non-payload raw-data reference. Missing values are `null`.
Identity always starts with the CargoMatch internal vessel UUID and an
explicit external mapping. Vessel names and unverified ENI values are not
used to identify a vessel.

## Providers and selection

The service exposes a provider-neutral `AISProvider` interface and two
explicitly simulated sources: `mock-alpha` and `mock-beta`. It also contains
separate, provider-specific commercial connectors:

- `vesselfinder` — the documented VesselFinder `VESSELS` method
  (`https://api.vesselfinder.com/vessels`), using a verified numeric MMSI or
  IMO.
- `marinetraffic` — the documented MarineTraffic Single Vessel Positions
  operation (`https://services.marinetraffic.com/api/exportvessel/{api_key}`,
  version 6), using a verified MarineTraffic ID, MMSI, or IMO.

The manager queries the configured order one source at a time:

1. capability checks happen before a provider request;
2. a provider may return a normalized, usable `FRESH` or `AGING` position;
3. failure, timeout, missing position data, `STALE`, or `UNKNOWN` observation
   time permits the next source;
4. if all sources fail, the response is `UNAVAILABLE` and manual CargoMatch
   continues normally.

Production configuration defaults to `vesselfinder,marinetraffic`; it does not
default to the mocks. `AIS_MODE=simulation` substitutes the mocks in
development/test so existing automated tests never make network calls or
spend AIS credits. `AIS_MODE=commercial` is an explicit production activation
switch. Credentials alone never activate a paid provider.

The current implementation intentionally does not call the newer
account-specific Kpler endpoint linked from the MarineTraffic documentation.
Only the publicly documented version-6 single-vessel operation is supported;
area monitoring, historical positions, port calls, fleet monitoring, and
predictive/voyage endpoints are not enabled.

### Route-to-manager identity contract

The route/identity worker must pass an explicit verified mapping; names and
unverified ENI values are never used. The exact provider-neutral shape is:

```ts
interface AisVesselIdentity {
  vesselId: string; // CargoMatch vessel UUID
  tenantId?: string; // required for commercial access
  mappingRevision?: string; // verified mapping revision
  externalIdentifiers?: readonly {
    identifierType:
      "ENI" | "MMSI" | "IMO" | "VESSELFINDER_ID" | "MARINETRAFFIC_ID" | "OTHER";
    identifierValue: string;
    provider?: string | null;
    verified: boolean;
  }[];
}
```

The connectors use only `MMSI`/`IMO` for VesselFinder and
`MARINETRAFFIC_ID`/`MMSI`/`IMO` for MarineTraffic. The manager's optional
`identityRevalidator` is called before cache access and after a provider
response; the route worker should use it to re-check active membership and
that `mappingRevision` is still current. A failed check discards the
observation and does not write it to cache.

### Identity trust boundary and operator procedure

Tenant OWNER/ADMIN users may submit and edit identity **claims**, but every
claim remains unverified. The HTTP create contract accepts only
`verified: false` (or omits the field), and an HTTP update may set
`verified: false` to revoke trust. A tenant cannot promote a claim. Editing a
claim's identifier, provider, or evidence clears its verification marker and
requires a new operator review. The `canManage` response flag only controls
claim editing; it is not an operator role.

Only the server-filesystem CLI can approve a claim after an operator has
reviewed external ownership evidence:

```sh
pnpm --filter @workspace/api-server verify-ais-identity -- \
  --company-id <company-uuid> \
  --vessel-id <vessel-uuid> \
  --mapping-id <mapping-uuid> \
  --source <reviewed-registry-or-document-source> \
  --reference <external-reference> \
  --notes <review-notes> \
  --captured-at <evidence-timestamp>
```

This procedure calls the non-HTTP `verifyAisIdentity` service and records the
operator-reviewed evidence plus an `operatorReviewedAt` trust marker. A label
in the evidence (for example, `reviewedBy`) is audit context only and is not
authentication or authorization. The command must run on the API server's
filesystem with its normal server database credentials; it is not exposed as
an API route and is not reachable by tenant sessions. Legacy rows without
that marker are demoted/non-operational during the trust-boundary migration.

Verification is atomic under the AIS identity domain lock. Verified identity
keys are globally unique, while every identity key is also unique within its
tenant (so identical unverified drafts are accepted across tenants). If
approval collides with an already-approved mapping, the command
returns a generic conflict and records a caller-local conflict audit row
without disclosing the other tenant. Operators resolve a known ownership
correction by first revoking the incorrect approved claim through the same
server-filesystem CLI:

```sh
pnpm --filter @workspace/api-server verify-ais-identity -- \
  --action revoke \
  --company-id <incorrect-claim-company-uuid> \
  --vessel-id <incorrect-claim-vessel-uuid> \
  --mapping-id <incorrect-claim-mapping-uuid>
```

Then rerun the verification command for the rightful claimant with its
reviewed evidence. The explicit IDs are an operator-side workflow and are
never returned by a cross-tenant HTTP response. Do not identify or contact
the other tenant through public responses.

### Commercial license gate

Commercial reads are fail-closed without an injected tenant-aware
`licenseGate`. It must authorize all of these scopes for the requested
provider and tenant, at the current time:

`COMMERCIAL`, `DISPLAY`, `THIRD_PARTY_ACCESS`, `STORAGE`, `RETENTION`,
`DERIVED_DATA`.

The manager evaluates this gate before both cache and network access. The
gate must reject missing, expired, revoked, provider-out-of-scope, or
tenant-out-of-scope grants. License decisions and identity checks are not
included in user-facing telemetry.

The current `EnvironmentAisLicenseGate` reads the server-only
`AIS_LICENSE_GRANTS` environment variable on every decision. Its value is a
JSON array; this is the complete shape of one approved grant (replace the
example values):

```json
[
  {
    "tenantId": "company-uuid",
    "provider": "vesselfinder",
    "enabled": true,
    "agreementReference": "contract-or-review-reference",
    "reviewedBy": "operator-or-team",
    "documentedProduct": "VesselFinder VESSELS AIS",
    "approvedAt": "2030-01-01T00:00:00.000Z",
    "expiresAt": "2031-01-01T00:00:00.000Z",
    "retentionMode": "TRANSIENT_ONLY",
    "redistribution": "DENIED",
    "areaMonitoring": false,
    "historicalStorage": false,
    "scopes": [
      "COMMERCIAL",
      "DISPLAY",
      "THIRD_PARTY_ACCESS",
      "STORAGE",
      "RETENTION",
      "DERIVED_DATA"
    ],
    "capabilities": [
      "LIVE_POSITION",
      "VESSEL_LOOKUP",
      "DRAUGHT",
      "DESTINATION",
      "ETA"
    ]
  }
]
```

Provider and tenant matching is exact. Missing/invalid JSON, duplicate
tenant/provider entries, disabled grants, future approval dates, expired
grants, unknown scope/capability values, or grants missing any requested
scope/capability are denied. The gate also requires both
`LIVE_POSITION` and `VESSEL_LOOKUP`, even if a future caller asks for less.
The manager passes the connector's full emitted capability set to the gate
(`LIVE_POSITION`, `VESSEL_LOOKUP`, `DESTINATION`, `ETA`, and `DRAUGHT` only for VesselFinder) so a
position-only grant cannot accidentally authorize unlicensed normalized
voyage fields.

`TRANSIENT_ONLY` is an enforced activation policy for this implementation:
completed commercial telemetry is not cached in memory or persisted. Only
in-flight request coalescing exists, and it is removed when the request
settles. The `STORAGE`/`RETENTION` scopes document the reviewed terms; they do
not enable storage. There is no raw-payload disk retention, history, area
monitoring, redistribution, or background polling.

## Development and commercial configuration

Simulation is enabled only when both conditions hold:

```text
NODE_ENV=development (or test)
AIS_MODE=simulation
```

It is disabled by default and is always disabled in production. The
development setup may set `AIS_MODE=simulation`; this is not a production
activation switch.

Optional settings:

| Variable                    |                      Default | Purpose                                                                                                                   |
| --------------------------- | ---------------------------: | ------------------------------------------------------------------------------------------------------------------------- |
| `AIS_PROVIDER_ORDER`        | `vesselfinder,marinetraffic` | Comma-separated primary/fallback order (simulation substitutes mock sources unless mock names are explicitly configured). |
| `AIS_FRESH_SECONDS`         |                        `300` | At or below this age, a valid observation is `FRESH`.                                                                     |
| `AIS_STALE_SECONDS`         |                       `1800` | Above this age, an observation is `STALE` and fallback is attempted.                                                      |
| `AIS_CACHE_SECONDS`         |                         `30` | Short on-demand cache lifetime; no background polling exists.                                                             |
| `AIS_CACHE_MAX_ENTRIES`     |                        `100` | Maximum in-memory cache entries.                                                                                          |
| `AIS_TIMEOUT_MS`            |                       `1500` | Per-provider bounded request timeout.                                                                                     |
| `AIS_MOCK_PRIMARY_SCENARIO` |                    `success` | Scenario for the first configured mock source.                                                                            |
| `AIS_MOCK_VESSEL_MAP`       |                        empty | JSON explicit mapping from internal UUID to provider IDs.                                                                 |

Commercial activation additionally requires:

| Variable                | Purpose                                                   |
| ----------------------- | --------------------------------------------------------- |
| `AIS_MODE=commercial`   | Explicitly enables commercial connectors.                 |
| `AIS_PROVIDER_ORDER`    | Optional order; defaults to `vesselfinder,marinetraffic`. |
| `VESSELFINDER_API_KEY`  | Server-only VesselFinder key; never sent to clients.      |
| `MARINETRAFFIC_API_KEY` | Server-only MarineTraffic key; never sent to clients.     |

Keys and provider payloads are never written to disk. The connector keeps only
the normalized result for the active request; completed commercial results are
not cached. Only in-flight request coalescing is retained for commercial
requests. Simulation keeps its bounded short-lived cache for development.
Commercial activation must inject the license and identity workers into
`AISProviderManager`; without those gates, every commercial attempt is denied.

Example mapping (use an actual CargoMatch vessel UUID):

```json
{
  "6b6f4f4a-86e6-4ea6-9e3c-6d8b4a4c3d10": {
    "mock-alpha": "alpha-vessel-001",
    "mock-beta": "beta-vessel-001"
  }
}
```

Tests and local fixtures can instead call
`registerMockVesselMapping(internalVesselId, { "mock-alpha": "..." })`.
Mappings are process-local and deliberately are not a persistent
verification/migration feature.

Supported mock scenarios include `success`, `moving`, `stationary`,
`port-arrival`, `port-departure`, `draught-change`, `aging`, `stale`,
`unknown-time`, `future`, `outage`, `timeout`, `not-found`, `incomplete`,
`malformed`, `rate-limit`, `auth`, and `unsupported`. An invalid or future
observation time is always `UNKNOWN`, never fresh.

The manager keeps only a bounded in-memory cache and deduplicates concurrent
requests for the same internal vessel and capability set. Cache and in-flight
state are process-local and are not telemetry history.

## Official API sources and activation review

The connector field mappings and endpoint parameters were checked against the
official provider documentation:

- [VesselFinder API overview](https://api.vesselfinder.com/docs/index.html)
- [VesselFinder VESSELS method](https://api.vesselfinder.com/docs/vessels.html)
- [VesselFinder AIS response fields](https://api.vesselfinder.com/docs/response-ais.html)
- [MarineTraffic AIS API](https://servicedocs.marinetraffic.com/tag/AIS-API)

Provider-specific caveats from those sources:

- VesselFinder's documented VESSELS method uses `userkey` and numeric
  `mmsi`/`imo` query parameters. Its AIS response documents position,
  course, speed, heading, navigation status, draught, destination, ETA,
  timestamp, source, MMSI, and IMO fields. It charges credits per response,
  so this connector performs only one primary/fallback request and no
  background polling.
  The full-date `ETA` field takes precedence over the manually entered
  yearless `ETA_AIS`. When only `ETA_AIS` is usable, its year is resolved to
  the nearest valid UTC occurrence around the AIS observation timestamp;
  invalid or ambiguous values remain null.
- MarineTraffic's documented Single Vessel Positions operation uses
  `/exportvessel/{api_key}`, version `6`, JSON protocol, and a default
  `timespan` of five minutes (maximum 1,440). The official page documents
  SPEED as knots x10, heading `-1`/`511` as unavailable, and `DSRC` as
  terrestrial/satellite/roaming source. Its sample uses `DRAUGHT: "95"` but
  the page does not state that field's unit. MarineTraffic draught therefore
  remains null and the connector does not advertise DRAUGHT capability.
  Supporting it requires documentation for the contracted product, not a
  guessed conversion from an example value.
  MarineTraffic links a newer account-specific Kpler endpoint from this page;
  it is intentionally unsupported here rather than guessed.

Before enabling production, an administrator must obtain and record the
provider's current commercial agreement, display and third-party access,
storage/retention, derived-data, tenant scope, geography, and expiry/revocation
terms in the license worker. No live or paid calls are part of automated tests.
