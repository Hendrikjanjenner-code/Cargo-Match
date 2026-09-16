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
explicitly simulated sources: `mock-alpha` and `mock-beta`. The manager
queries the configured order one source at a time:

1. capability checks happen before a provider request;
2. a provider may return a normalized, usable `FRESH` or `AGING` position;
3. failure, timeout, missing position data, `STALE`, or `UNKNOWN` observation
   time permits the next source;
4. if all sources fail, the response is `UNAVAILABLE` and manual CargoMatch
   continues normally.

No VesselFinder, MarineTraffic, or other commercial network connector exists
in this pilot. The mock providers do not make network calls or spend
commercial AIS credits.

## Development configuration

Simulation is enabled only when both conditions hold:

```text
NODE_ENV=development (or test)
AIS_MODE=simulation
```

It is disabled by default and is always disabled in production. The
development setup may set `AIS_MODE=simulation`; this is not a production
activation switch.

Optional settings:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `AIS_PROVIDER_ORDER` | `mock-alpha,mock-beta` | Comma-separated primary/fallback order. |
| `AIS_FRESH_SECONDS` | `300` | At or below this age, a valid observation is `FRESH`. |
| `AIS_STALE_SECONDS` | `1800` | Above this age, an observation is `STALE` and fallback is attempted. |
| `AIS_CACHE_SECONDS` | `30` | Short on-demand cache lifetime; no background polling exists. |
| `AIS_CACHE_MAX_ENTRIES` | `100` | Maximum in-memory cache entries. |
| `AIS_TIMEOUT_MS` | `1500` | Per-provider bounded request timeout. |
| `AIS_MOCK_PRIMARY_SCENARIO` | `success` | Scenario for the first configured mock source. |
| `AIS_MOCK_VESSEL_MAP` | empty | JSON explicit mapping from internal UUID to provider IDs. |

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

## Later production work

Adding a real source requires a separate connector, capability declaration,
credential handling, provider-specific normalization, licensing review,
retention/redistribution approval, rate-limit policy, and tests. Those gates
are intentionally not part of this foundation and should not be bypassed by
adding a commercial call to the mock connectors.