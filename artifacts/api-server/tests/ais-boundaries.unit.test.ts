import assert from "node:assert/strict";
import test from "node:test";
import {
  AISProviderManager,
  type AISProvider,
  type AisConfiguration,
  type AisProviderObservation,
} from "../src/services/ais";

const vesselId = "6b6f4f4a-86e6-4ea6-9e3c-6d8b4a4c3d10";
const configuration: AisConfiguration = {
  enabled: true,
  simulation: true,
  providerOrder: ["mock-alpha", "mock-beta"],
  freshForSeconds: 5,
  staleAfterSeconds: 10,
  cacheSeconds: 30,
  cacheMaxEntries: 10,
  timeoutMs: 50,
  primaryScenario: "success",
};

function provider(name: string, observation: () => AisProviderObservation): AISProvider {
  return {
    provider: name,
    capabilities: ["LIVE_POSITION", "VESSEL_LOOKUP"],
    async lookup() { return { kind: "success", observation: observation() }; },
    normalize(value) { return value as AisProviderObservation; },
  };
}

test("cached observations age and stale cached positions trigger a new lookup", async () => {
  const start = Date.parse("2030-01-01T00:00:00Z");
  let now = start;
  let alphaCalls = 0;
  let betaCalls = 0;
  const manager = new AISProviderManager({
    configuration,
    now: () => new Date(now),
    providers: [
      provider("mock-alpha", () => {
        alphaCalls++;
        return { latitude: 51, longitude: 4, observedAt: new Date(start).toISOString() };
      }),
      provider("mock-beta", () => {
        betaCalls++;
        return { latitude: 52, longitude: 5, observedAt: new Date(now).toISOString() };
      }),
    ],
  });
  assert.equal((await manager.getLatestPosition({ vesselId })).telemetry?.dataFreshness, "FRESH");
  now += 6_000;
  const aging = await manager.getLatestPosition({ vesselId });
  assert.equal(aging.cacheHit, true);
  assert.equal(aging.telemetry?.dataFreshness, "AGING");
  assert.equal(alphaCalls, 1);
  now += 5_000;
  const renewed = await manager.getLatestPosition({ vesselId });
  assert.equal(renewed.cacheHit, false);
  assert.equal(renewed.telemetry?.provider, "mock-beta");
  assert.equal(alphaCalls, 2);
  assert.equal(betaCalls, 1);
});

test("a provider parser exception permits fallback without escaping the AIS layer", async () => {
  const now = new Date("2030-01-01T00:00:00Z");
  const alpha = provider("mock-alpha", () => ({}));
  alpha.normalize = () => { throw new Error("Malformed vendor response"); };
  const manager = new AISProviderManager({
    configuration,
    now: () => now,
    providers: [
      alpha,
      provider("mock-beta", () => ({ latitude: 52, longitude: 5, observedAt: now.toISOString() })),
    ],
  });
  const result = await manager.getLatestPosition({ vesselId });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.telemetry?.provider, "mock-beta");
  assert.deepEqual(result.attempts, [
    { provider: "mock-alpha", outcome: "MALFORMED" },
    { provider: "mock-beta", outcome: "SUCCESS" },
  ]);
});