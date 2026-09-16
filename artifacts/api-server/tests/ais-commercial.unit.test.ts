import assert from "node:assert/strict";
import test from "node:test";

import {
  AISProviderManager,
  loadAisConfiguration,
  MarineTrafficConnector,
  VesselFinderConnector,
  type AisConfiguration,
  type AisProviderObservation,
  type AisProviderRequest,
  type AisProviderResult,
  type AISProvider,
} from "../src/services/ais";

test("commercial configuration defaults to the real primary/fallback names", () => {
  const configured = loadAisConfiguration({
    NODE_ENV: "production",
    AIS_MODE: "commercial",
  });
  assert.equal(configured.enabled, true);
  assert.equal(configured.commercial, true);
  assert.deepEqual(configured.providerOrder, [
    "vesselfinder",
    "marinetraffic",
  ]);
});

const vessel = {
  vesselId: "6b6f4f4a-86e6-4ea6-9e3c-6d8b4a4c3d10",
  tenantId: "tenant-fixture",
  mappingRevision: "mapping-revision-1",
  externalIdentifiers: [
    {
      identifierType: "MMSI" as const,
      identifierValue: "244000001",
      provider: "vesselfinder",
      verified: true,
    },
  ],
};

function configuration(overrides: Partial<AisConfiguration> = {}): AisConfiguration {
  return {
    enabled: true,
    simulation: false,
    commercial: true,
    providerOrder: ["vesselfinder"],
    freshForSeconds: 300,
    staleAfterSeconds: 1_800,
    cacheSeconds: 30,
    cacheMaxEntries: 10,
    timeoutMs: 100,
    primaryScenario: "success",
    ...overrides,
  };
}

function provider(calls: { count: number }): AISProvider {
  return {
    provider: "vesselfinder",
    commercial: true,
    capabilities: [
      "LIVE_POSITION",
      "VESSEL_LOOKUP",
      "DRAUGHT",
      "DESTINATION",
      "ETA",
    ],
    async lookup(_request: AisProviderRequest): Promise<AisProviderResult> {
      calls.count += 1;
      return {
        kind: "success",
        observation: {
          providerVesselId: "provider-fixture",
          mmsi: "244000001",
          latitude: 51.9,
          longitude: 4.4,
          observedAt: "2030-01-01T11:59:30.000Z",
        },
      };
    },
    normalize(
      observation: unknown,
    ): AisProviderObservation {
      return observation as AisProviderObservation;
    },
  };
}

test("commercial provider license denial happens before any network read", async () => {
  const calls = { count: 0 };
  const manager = new AISProviderManager({
    providers: [provider(calls)],
    configuration: configuration(),
    licenseGate: {
      authorize(request) {
        assert.equal(request.tenantId, "tenant-fixture");
        assert.deepEqual(request.scopes, [
          "COMMERCIAL",
          "DISPLAY",
          "THIRD_PARTY_ACCESS",
          "STORAGE",
          "RETENTION",
          "DERIVED_DATA",
        ]);
        assert.deepEqual(request.capabilities, [
          "LIVE_POSITION",
          "VESSEL_LOOKUP",
          "DRAUGHT",
          "DESTINATION",
          "ETA",
        ]);
        return { allowed: false, reason: "LICENSE_EXPIRED" };
      },
    },
    now: () => new Date("2030-01-01T12:00:00.000Z"),
  });
  const result = await manager.getLatestTelemetry(vessel);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.telemetry, null);
  assert.deepEqual(result.attempts, [
    { provider: "vesselfinder", outcome: "LICENSE_DENIED" },
  ]);
  assert.equal(calls.count, 0);
});

test("license revocation cannot reveal an already cached commercial position", async () => {
  const calls = { count: 0 };
  let allowed = true;
  const manager = new AISProviderManager({
    providers: [provider(calls)],
    configuration: configuration(),
    licenseGate: {
      authorize() {
        return { allowed, reason: allowed ? undefined : "LICENSE_REVOKED" };
      },
    },
    now: () => new Date("2030-01-01T12:00:00.000Z"),
  });

  const first = await manager.getLatestTelemetry(vessel);
  assert.equal(first.status, "AVAILABLE");
  assert.equal(first.cacheHit, false);
  assert.equal(calls.count, 1);

  allowed = false;
  const revoked = await manager.getLatestTelemetry(vessel);
  assert.equal(revoked.status, "UNAVAILABLE");
  assert.equal(revoked.telemetry, null);
  assert.equal(revoked.cacheHit, false);
  assert.deepEqual(revoked.attempts, [
    { provider: "vesselfinder", outcome: "LICENSE_DENIED" },
  ]);
  assert.equal(calls.count, 1);
});

test("commercial completed telemetry is not cached even when the grant remains valid", async () => {
  const calls = { count: 0 };
  const manager = new AISProviderManager({
    providers: [provider(calls)],
    configuration: configuration(),
    licenseGate: { authorize: () => ({ allowed: true }) },
    now: () => new Date("2030-01-01T12:00:00.000Z"),
  });
  const first = await manager.getLatestTelemetry(vessel);
  const second = await manager.getLatestTelemetry(vessel);
  assert.equal(first.status, "AVAILABLE");
  assert.equal(second.status, "AVAILABLE");
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, false);
  assert.equal(calls.count, 2);
});

test("license revoked during a successful request suppresses its exact telemetry", async () => {
  const calls = { count: 0 };
  let allowed = true;
  const source = provider(calls);
  const originalLookup = source.lookup;
  source.lookup = async (request) => {
    const result = await originalLookup(request);
    allowed = false;
    return result;
  };
  const manager = new AISProviderManager({
    providers: [source],
    configuration: configuration(),
    licenseGate: { authorize: () => ({ allowed }) },
    now: () => new Date("2030-01-01T12:00:00.000Z"),
  });
  const result = await manager.getLatestTelemetry(vessel);
  assert.equal(calls.count, 1);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.telemetry, null);
  assert.deepEqual(result.attempts, [{ provider: "vesselfinder", outcome: "LICENSE_DENIED" }]);
});

test("a fallback license expiring during the primary request prevents fallback network access", async () => {
  let milliseconds = Date.parse("2030-01-01T12:00:00.000Z");
  const expiresAt = milliseconds + 1_000;
  let fallbackCalls = 0;
  const primary: AISProvider = {
    ...provider({ count: 0 }),
    async lookup() {
      milliseconds += 2_000;
      return { kind: "unavailable" };
    },
  };
  const fallback: AISProvider = {
    ...provider({ count: 0 }),
    provider: "marinetraffic",
    async lookup() {
      fallbackCalls++;
      return { kind: "unavailable" };
    },
  };
  const manager = new AISProviderManager({
    providers: [primary, fallback],
    configuration: configuration({ providerOrder: ["vesselfinder", "marinetraffic"] }),
    licenseGate: { authorize: (request) => ({ allowed: request.provider === "vesselfinder" || request.now.getTime() < expiresAt }) },
    now: () => new Date(milliseconds),
  });
  const result = await manager.getLatestTelemetry(vessel);
  assert.equal(result.telemetry, null);
  assert.equal(fallbackCalls, 0);
  assert.deepEqual(result.attempts, [
    { provider: "vesselfinder", outcome: "UNAVAILABLE" },
    { provider: "marinetraffic", outcome: "LICENSE_DENIED" },
  ]);
});

test("identity membership and mapping revision are rechecked after a slow response", async () => {
  const calls = { count: 0 };
  let fallbackCalls = 0;
  const fallback: AISProvider = {
    provider: "marinetraffic",
    capabilities: ["LIVE_POSITION", "VESSEL_LOOKUP"],
    async lookup() {
      fallbackCalls += 1;
      return { kind: "unavailable" };
    },
    normalize() {
      return null;
    },
  };
  let checks = 0;
  const manager = new AISProviderManager({
    providers: [provider(calls), fallback],
    configuration: configuration({
      providerOrder: ["vesselfinder", "marinetraffic"],
    }),
    licenseGate: { authorize: () => ({ allowed: true }) },
    identityRevalidator: async () => {
      checks += 1;
      return checks <= 2
        ? { allowed: true, mappingRevision: "mapping-revision-1" }
        : { allowed: false, reason: "MAPPING_REVOKED" };
    },
    now: () => new Date("2030-01-01T12:00:00.000Z"),
  });

  const result = await manager.getLatestTelemetry(vessel);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.telemetry, null);
  assert.deepEqual(result.attempts, [
    { provider: "vesselfinder", outcome: "IDENTITY_REVOKED" },
  ]);
  assert.equal(calls.count, 1);
  assert.equal(fallbackCalls, 0);
  assert.equal(checks, 3);
});

test("primary identifier mismatch is a fallback-eligible provider error", async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const primary: AISProvider = {
    provider: "vesselfinder",
    commercial: true,
    capabilities: ["LIVE_POSITION", "VESSEL_LOOKUP"],
    async lookup() {
      primaryCalls += 1;
      return { kind: "identifier_mismatch" };
    },
    normalize() {
      return null;
    },
  };
  const fallback: AISProvider = {
    provider: "marinetraffic",
    commercial: true,
    capabilities: ["LIVE_POSITION", "VESSEL_LOOKUP"],
    async lookup() {
      fallbackCalls += 1;
      return {
        kind: "success",
        observation: {
          providerVesselId: "mt-fixture",
          latitude: 51.91,
          longitude: 4.41,
          observedAt: "2030-01-01T11:59:30.000Z",
        },
      };
    },
    normalize(value) {
      return value as AisProviderObservation;
    },
  };
  const result = await new AISProviderManager({
    providers: [primary, fallback],
    configuration: configuration({
      providerOrder: ["vesselfinder", "marinetraffic"],
    }),
    licenseGate: { authorize: () => ({ allowed: true }) },
    now: () => new Date("2030-01-01T12:00:00.000Z"),
  }).getLatestTelemetry(vessel);

  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.telemetry?.provider, "marinetraffic");
  assert.deepEqual(result.attempts, [
    { provider: "vesselfinder", outcome: "IDENTIFIER_MISMATCH" },
    { provider: "marinetraffic", outcome: "SUCCESS" },
  ]);
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 1);
});

test("real connector fallback accepts provider-neutral MMSI evidence and nested VesselFinder AIS", async () => {
  const requests: URL[] = [];
  const vesselFinder = new VesselFinderConnector({
    apiKey: "vf-fixture-key",
    fetch: async (input) => {
      requests.push(new URL(String(input)));
      return new Response(
        JSON.stringify([
          {
            AIS: {
              MMSI: 244000999,
              TIMESTAMP: "2030-01-01 11:59:30 UTC",
              LATITUDE: 51.9,
              LONGITUDE: 4.4,
              SPEED: 6.2,
              HEADING: 90,
              IMO: 9876543,
            },
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  const marineTraffic = new MarineTrafficConnector({
    apiKey: "mt-fixture-key",
    fetch: async (input) => {
      requests.push(new URL(String(input)));
      return new Response(
        JSON.stringify([
          {
            MMSI: "244000001",
            IMO: "9876543",
            SHIP_ID: "713139",
            LAT: "51.91",
            LON: "4.41",
            SPEED: "62",
            HEADING: "90",
            TIMESTAMP: "2030-01-01T11:59:44.000Z",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  const result = await new AISProviderManager({
    providers: [vesselFinder, marineTraffic],
    configuration: configuration({
      providerOrder: ["vesselfinder", "marinetraffic"],
    }),
    licenseGate: { authorize: () => ({ allowed: true }) },
    now: () => new Date("2030-01-01T12:00:00.000Z"),
  }).getLatestTelemetry({
    ...vessel,
    externalIdentifiers: [
      {
        // Deliberately labeled with MarineTraffic evidence: MMSI remains
        // provider-neutral and must be usable by VesselFinder first.
        identifierType: "MMSI",
        identifierValue: "244000001",
        provider: "marinetraffic",
        verified: true,
      },
      {
        identifierType: "IMO",
        identifierValue: "9876543",
        provider: "marinetraffic",
        verified: true,
      },
      {
        identifierType: "MARINETRAFFIC_ID",
        identifierValue: "713139",
        provider: "marinetraffic",
        verified: true,
      },
    ],
  });

  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.telemetry?.provider, "marinetraffic");
  assert.equal(result.telemetry?.mmsi, "244000001");
  assert.deepEqual(result.attempts, [
    { provider: "vesselfinder", outcome: "IDENTIFIER_MISMATCH" },
    { provider: "marinetraffic", outcome: "SUCCESS" },
  ]);
  assert.equal(requests[0]?.searchParams.get("mmsi"), "244000001");
  assert.equal(requests[1]?.searchParams.get("shipid"), "713139");
});

test("provider timeout aborts the underlying request, not only the manager promise", async () => {
  let aborted = false;
  const slow: AISProvider = {
    provider: "slow-fixture",
    capabilities: ["LIVE_POSITION", "VESSEL_LOOKUP"],
    async lookup(request) {
      return await new Promise<AisProviderResult>((resolve) => {
        request.signal?.addEventListener("abort", () => {
          aborted = true;
          resolve({ kind: "unavailable" });
        });
      });
    },
    normalize() {
      return null;
    },
  };
  const result = await new AISProviderManager({
    providers: [slow],
    configuration: configuration({
      simulation: false,
      commercial: false,
      providerOrder: ["slow-fixture"],
      timeoutMs: 5,
    }),
    now: () => new Date("2030-01-01T12:00:00.000Z"),
  }).getLatestTelemetry(vessel);
  assert.equal(result.status, "UNAVAILABLE");
  assert.deepEqual(result.attempts, [
    { provider: "slow-fixture", outcome: "TIMEOUT" },
  ]);
  assert.equal(aborted, true);
});