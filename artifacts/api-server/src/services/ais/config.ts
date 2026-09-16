import {
  DEFAULT_AIS_CONFIGURATION,
  type AisConfiguration,
  type MockAisScenario,
} from "./model";

const MOCK_SCENARIOS = new Set<MockAisScenario>([
  "success",
  "moving",
  "stationary",
  "port-arrival",
  "port-departure",
  "draught-change",
  "aging",
  "stale",
  "unknown-time",
  "future",
  "outage",
  "timeout",
  "not-found",
  "incomplete",
  "malformed",
  "rate-limit",
  "auth",
  "unsupported",
]);

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function parseProviderOrder(value: unknown): string[] {
  if (typeof value !== "string" || value.trim() === "") {
    return [...DEFAULT_AIS_CONFIGURATION.providerOrder];
  }
  const names = value
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(names)].slice(0, 8);
}

function parseScenario(value: unknown): MockAisScenario {
  const scenario = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MOCK_SCENARIOS.has(scenario as MockAisScenario)
    ? (scenario as MockAisScenario)
    : DEFAULT_AIS_CONFIGURATION.primaryScenario;
}

export function loadAisConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): AisConfiguration {
  const simulation =
    env.AIS_MODE === "simulation" &&
    (env.NODE_ENV === "development" || env.NODE_ENV === "test");
  // Commercial mode is an explicit activation switch. Credentials alone
  // never activate a paid provider, and license authorization remains a
  // separate manager gate.
  const commercial = env.AIS_MODE === "commercial";
  const freshForSeconds = Math.floor(
    boundedNumber(
      env.AIS_FRESH_SECONDS,
      DEFAULT_AIS_CONFIGURATION.freshForSeconds,
      1,
      86_400,
    ),
  );
  const staleAfterSeconds = Math.max(
    freshForSeconds,
    Math.floor(
      boundedNumber(
        env.AIS_STALE_SECONDS,
        DEFAULT_AIS_CONFIGURATION.staleAfterSeconds,
        1,
        604_800,
      ),
    ),
  );
  return {
    enabled: simulation || commercial,
    simulation,
    commercial,
    providerOrder: parseProviderOrder(env.AIS_PROVIDER_ORDER),
    freshForSeconds,
    staleAfterSeconds,
    cacheSeconds: Math.floor(
      boundedNumber(
        env.AIS_CACHE_SECONDS,
        DEFAULT_AIS_CONFIGURATION.cacheSeconds,
        0,
        3_600,
      ),
    ),
    cacheMaxEntries: Math.floor(
      boundedNumber(
        env.AIS_CACHE_MAX_ENTRIES,
        DEFAULT_AIS_CONFIGURATION.cacheMaxEntries,
        1,
        1_000,
      ),
    ),
    timeoutMs: Math.floor(
      boundedNumber(
        env.AIS_TIMEOUT_MS,
        DEFAULT_AIS_CONFIGURATION.timeoutMs,
        1,
        10_000,
      ),
    ),
    primaryScenario: parseScenario(env.AIS_MOCK_PRIMARY_SCENARIO),
  };
}

export function parseMockVesselMap(
  value: unknown,
): Map<string, Map<string, string>> {
  const output = new Map<string, Map<string, string>>();
  if (typeof value !== "string" || value.trim() === "") return output;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [vesselId, providerValues] of Object.entries(parsed)) {
        if (
          !providerValues ||
          typeof providerValues !== "object" ||
          Array.isArray(providerValues)
        ) {
          continue;
        }
        const map = new Map<string, string>();
        for (const [provider, providerVesselId] of Object.entries(providerValues)) {
          if (typeof providerVesselId === "string" && providerVesselId.trim()) {
            map.set(provider.toLowerCase(), providerVesselId.trim());
          }
        }
        if (map.size > 0) output.set(vesselId, map);
      }
    }
  } catch {
    // Invalid optional configuration means no explicit mappings, never a
    // guessed identity.
  }
  return output;
}