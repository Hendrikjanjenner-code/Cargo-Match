import assert from "node:assert/strict";
import test from "node:test";

import {
  AISProviderManager,
  MockAISProvider,
  loadAisConfiguration,
  normalizeAisObservation,
  type AisConfiguration,
  type AisProviderObservation,
  type AisProviderRequest,
  type AisProviderResult,
  type AISProvider,
} from "../src/services/ais";

const vesselId = "6b6f4f4a-86e6-4ea6-9e3c-6d8b4a4c3d10";
const providerIds = new Map([[vesselId, "mock-vessel-001"]]);

function configuration(
  overrides: Partial<AisConfiguration> = {},
): AisConfiguration {
  return {
    enabled: true,
    simulation: true,
    providerOrder: ["mock-alpha", "mock-beta"],
    freshForSeconds: 300,
    staleAfterSeconds: 1_800,
    cacheSeconds: 30,
    cacheMaxEntries: 100,
    timeoutMs: 50,
    primaryScenario: "success",
    ...overrides,
  };
}

const identity = { vesselId };

test("environment thresholds are bounded whole seconds and production disables simulation", () => {
  const configured = loadAisConfiguration({
    NODE_ENV: "development",
    AIS_MODE: "simulation",
    AIS_FRESH_SECONDS: "12.9",
    AIS_STALE_SECONDS: "1800.9",
    AIS_CACHE_SECONDS: "30.9",
    AIS_CACHE_MAX_ENTRIES: "3.9",
    AIS_TIMEOUT_MS: "15.9",
  });
  assert.equal(configured.freshForSeconds, 12);
  assert.equal(configured.staleAfterSeconds, 1_800);
  assert.equal(configured.cacheSeconds, 30);
  assert.equal(configured.cacheMaxEntries, 3);
  assert.equal(configured.timeoutMs, 15);
  assert.equal(configured.simulation, true);

  const production = loadAisConfiguration({
    NODE_ENV: "production",
    AIS_MODE: "simulation",
  });
  assert.equal(production.enabled, false);
  assert.equal(production.simulation, false);
});

test("normalization keeps missing values null and future observations unknown", () => {
  const now = new Date("2030-01-01T12:00:00.000Z");
  const telemetry = normalizeAisObservation(
    "mock-alpha",
    {
      providerVesselId: "alpha-1",
      latitude: "51.9",
      longitude: "not-a-coordinate",
      speedKnots: undefined,
      observedAt: "2030-01-01T12:01:00.000Z",
      sourceType: "SIMULATION",
    },
    now,
    now,
    300,
    1_800,
  );
  assert.equal(telemetry.latitude, 51.9);
  assert.equal(telemetry.longitude, null);
  assert.equal(telemetry.speedKnots, null);
  assert.equal(telemetry.observedAt, null);
  assert.equal(telemetry.dataFreshness, "UNKNOWN");
  assert.equal(telemetry.receivedAt, now.toISOString());
});

test("normal operation uses only the primary source", async () => {
  let alphaCalls = 0;
  let betaCalls = 0;
  const alpha = new MockAISProvider({
    provider: "mock-alpha",
    mappings: providerIds,
  });
  const beta = new MockAISProvider({
    provider: "mock-beta",
    mappings: providerIds,
  });
  const alphaLookup = alpha.lookup.bind(alpha);
  const betaLookup = beta.lookup.bind(beta);
  alpha.lookup = async (request) => {
    alphaCalls += 1;
    return alphaLookup(request);
  };
  beta.lookup = async (request) => {
    betaCalls += 1;
    return betaLookup(request);
  };
  const manager = new AISProviderManager({
    providers: [alpha, beta],
    configuration: configuration(),
    now: () => new Date("2030-01-01T12:00:00.000Z"),
  });

  const result = await manager.getLatestTelemetry(identity);
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.telemetry?.provider, "mock-alpha");
  assert.deepEqual(result.attempts, [
    { provider: "mock-alpha", outcome: "SUCCESS" },
  ]);
  assert.equal(alphaCalls, 1);
  assert.equal(betaCalls, 0);
});

test("primary outage falls back to the secondary source", async () => {
  const alpha = new MockAISProvider({
    provider: "mock-alpha",
    mappings: providerIds,
    scenario: "outage",
  });
  const beta = new MockAISProvider({
    provider: "mock-beta",
    mappings: providerIds,
  });
  const result = await new AISProviderManager({
    providers: [alpha, beta],
    configuration: configuration(),
  }).getLatestTelemetry(identity);
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.telemetry?.provider, "mock-beta");
  assert.deepEqual(result.attempts, [
    { provider: "mock-alpha", outcome: "UNAVAILABLE" },
    { provider: "mock-beta", outcome: "SUCCESS" },
  ]);
});

test("stale primary data falls back and both failures stay unavailable", async () => {
  const primaryStale = new MockAISProvider({
    provider: "mock-alpha",
    mappings: providerIds,
    scenario: "stale",
  });
  const secondaryOutage = new MockAISProvider({
    provider: "mock-beta",
    mappings: providerIds,
    scenario: "outage",
  });
  const result = await new AISProviderManager({
    providers: [primaryStale, secondaryOutage],
    configuration: configuration(),
  }).getLatestTelemetry(identity);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.telemetry, null);
  assert.deepEqual(result.attempts, [
    { provider: "mock-alpha", outcome: "STALE" },
    { provider: "mock-beta", outcome: "UNAVAILABLE" },
  ]);
});

test("incomplete and malformed responses are not treated as positions", async () => {
  const incomplete = new MockAISProvider({
    provider: "mock-alpha",
    mappings: providerIds,
    scenario: "incomplete",
  });
  const malformed = new MockAISProvider({
    provider: "mock-beta",
    mappings: providerIds,
    scenario: "malformed",
  });
  const result = await new AISProviderManager({
    providers: [incomplete, malformed],
    configuration: configuration(),
  }).getLatestTelemetry(identity);
  assert.equal(result.status, "UNAVAILABLE");
  assert.deepEqual(result.attempts, [
    { provider: "mock-alpha", outcome: "NO_DATA" },
    { provider: "mock-beta", outcome: "MALFORMED" },
  ]);
});

test("unknown timestamps fall back while aging telemetry remains visible", async () => {
  const unknown = new MockAISProvider({
    provider: "mock-alpha",
    mappings: providerIds,
    scenario: "unknown-time",
  });
  const aging = new MockAISProvider({
    provider: "mock-beta",
    mappings: providerIds,
    scenario: "aging",
  });
  const result = await new AISProviderManager({
    providers: [unknown, aging],
    configuration: configuration(),
  }).getLatestTelemetry(identity);
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.telemetry?.provider, "mock-beta");
  assert.equal(result.telemetry?.dataFreshness, "AGING");
  assert.deepEqual(result.attempts, [
    { provider: "mock-alpha", outcome: "UNKNOWN_TIMESTAMP" },
    { provider: "mock-beta", outcome: "SUCCESS" },
  ]);
});

test("timeout, rate limit, authentication and capability guards are bounded failures", async () => {
  const timeoutProvider = new MockAISProvider({
    provider: "mock-alpha",
    mappings: providerIds,
    scenario: "timeout",
  });
  const rateLimitedProvider = new MockAISProvider({
    provider: "mock-beta",
    mappings: providerIds,
    scenario: "rate-limit",
  });
  const result = await new AISProviderManager({
    providers: [timeoutProvider, rateLimitedProvider],
    configuration: configuration({ timeoutMs: 5 }),
  }).getLatestTelemetry(identity);
  assert.equal(result.status, "UNAVAILABLE");
  assert.deepEqual(result.attempts, [
    { provider: "mock-alpha", outcome: "TIMEOUT" },
    { provider: "mock-beta", outcome: "RATE_LIMITED" },
  ]);

  const unsupported = new MockAISProvider({
    provider: "mock-alpha",
    mappings: providerIds,
    capabilities: ["VESSEL_LOOKUP"],
  });
  const guarded = await new AISProviderManager({
    providers: [unsupported],
    configuration: configuration({ providerOrder: ["mock-alpha"] }),
  }).getLatestTelemetry(identity);
  assert.deepEqual(guarded.attempts, [
    { provider: "mock-alpha", outcome: "UNSUPPORTED_CAPABILITY" },
  ]);

  const authFailure = new MockAISProvider({
    provider: "mock-alpha",
    mappings: providerIds,
    scenario: "auth",
  });
  const fallback = new MockAISProvider({
    provider: "mock-beta",
    mappings: providerIds,
  });
  const authenticationResult = await new AISProviderManager({
    providers: [authFailure, fallback],
    configuration: configuration(),
  }).getLatestTelemetry(identity);
  assert.equal(authenticationResult.status, "AVAILABLE");
  assert.deepEqual(authenticationResult.attempts, [
    { provider: "mock-alpha", outcome: "AUTHENTICATION_FAILED" },
    { provider: "mock-beta", outcome: "SUCCESS" },
  ]);
});

test("unknown internal IDs never match by name or ENI", async () => {
  const provider = new MockAISProvider({
    provider: "mock-alpha",
    mappings: providerIds,
  });
  const result = await new AISProviderManager({
    providers: [provider],
    configuration: configuration({ providerOrder: ["mock-alpha"] }),
  }).getLatestTelemetry({
    vesselId: "3f86b76f-cd02-4e6e-9a5d-3ac2d6ef5c2a",
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.telemetry, null);
  assert.deepEqual(result.attempts, [
    { provider: "mock-alpha", outcome: "NOT_FOUND" },
  ]);
});

test("disabled simulation returns an explicit not-configured envelope", async () => {
  const manager = new AISProviderManager({
    providers: [],
    configuration: configuration({ enabled: false, simulation: false }),
  });
  const result = await manager.getLatestTelemetry(identity);
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.equal(result.simulation, false);
  assert.deepEqual(result.attempts, []);
});

test("cache and in-flight dedup bound duplicate provider work", async () => {
  let calls = 0;
  const fixedNow = new Date("2030-01-01T12:00:00.000Z");
  const provider: AISProvider = {
    provider: "mock-alpha",
    capabilities: ["LIVE_POSITION", "VESSEL_LOOKUP"],
    async lookup(_request: AisProviderRequest): Promise<AisProviderResult> {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        kind: "success",
        observation: {
          providerVesselId: "alpha-1",
          latitude: 51,
          longitude: 4,
          observedAt: fixedNow.toISOString(),
        },
      };
    },
    normalize(observation) {
      return observation as AisProviderObservation;
    },
  };
  const manager = new AISProviderManager({
    providers: [provider],
    configuration: configuration({ providerOrder: ["mock-alpha"] }),
    now: () => fixedNow,
  });
  const [first, second] = await Promise.all([
    manager.getLatestTelemetry(identity),
    manager.getLatestTelemetry(identity),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, false);
  const cached = await manager.getLatestTelemetry(identity);
  assert.equal(calls, 1);
  assert.equal(cached.cacheHit, true);
});