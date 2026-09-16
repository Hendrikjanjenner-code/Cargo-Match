import {
  parseMockVesselMap,
  loadAisConfiguration,
} from "./config";
import { hasUsableLivePosition, normalizeAisObservation } from "./normalize";
import { createMockProviders } from "./mock";
import {
  type AisAttempt,
  type AisCapability,
  type AisConfiguration,
  type AisEnvelope,
  type AISProvider,
  type AisProviderRequest,
  type AisProviderResult,
  type AisVesselIdentity,
  type NormalizedVesselTelemetry,
} from "./model";

interface CachedResult {
  storedAt: number;
  status: AisEnvelope["status"];
  simulation: boolean;
  telemetry: NormalizedVesselTelemetry | null;
  attempts: AisAttempt[];
}

export interface AisProviderManagerOptions {
  providers?: readonly AISProvider[];
  configuration?: AisConfiguration;
  now?: () => Date;
}

const runtimeMockMappings = new Map<string, Map<string, string>>();

/**
 * Tests and development fixtures can explicitly register an internal UUID to
 * provider-ID mapping. This is intentionally process-local and non-persistent;
 * it is not an identity verification workflow.
 */
export function registerMockVesselMapping(
  vesselId: string,
  providerIds: Partial<Record<string, string>>,
): void {
  const mappings = new Map<string, string>();
  for (const [provider, providerId] of Object.entries(providerIds)) {
    if (typeof providerId === "string" && providerId.trim()) {
      mappings.set(provider.toLowerCase(), providerId.trim());
    }
  }
  if (mappings.size > 0) runtimeMockMappings.set(vesselId, mappings);
}

export function clearMockVesselMappings(): void {
  runtimeMockMappings.clear();
}

function providerCapabilities(provider: AISProvider): readonly AisCapability[] {
  return Array.isArray(provider.capabilities)
    ? provider.capabilities
    : [...provider.capabilities];
}

function resultOutcome(result: AisProviderResult): string {
  switch (result.kind) {
    case "not_found":
      return "NOT_FOUND";
    case "rate_limited":
      return "RATE_LIMITED";
    case "authentication_failed":
      return "AUTHENTICATION_FAILED";
    case "unsupported_capability":
      return "UNSUPPORTED_CAPABILITY";
    case "unavailable":
      return "UNAVAILABLE";
    default:
      return "UNAVAILABLE";
  }
}

function cloneTelemetry(
  telemetry: NormalizedVesselTelemetry | null,
): NormalizedVesselTelemetry | null {
  return telemetry ? { ...telemetry } : null;
}

export class AISProviderManager {
  private readonly configuredProviders: readonly AISProvider[] | null;
  private readonly configuredConfiguration: AisConfiguration | undefined;
  private readonly now: () => Date;
  private readonly cache = new Map<string, CachedResult>();
  private readonly inFlight = new Map<string, Promise<AisEnvelope>>();

  constructor(options: AisProviderManagerOptions = {}) {
    this.configuredProviders = options.providers ?? null;
    this.configuredConfiguration = options.configuration;
    this.now = options.now ?? (() => new Date());
  }

  clearCache(): void {
    this.cache.clear();
  }

  private configuration(): AisConfiguration {
    return this.configuredConfiguration ?? loadAisConfiguration();
  }

  private providers(configuration: AisConfiguration): readonly AISProvider[] {
    if (this.configuredProviders) return this.configuredProviders;
    const envMappings = parseMockVesselMap(process.env.AIS_MOCK_VESSEL_MAP);
    const mappings = new Map(envMappings);
    for (const [vesselId, providerIds] of runtimeMockMappings) {
      const current = new Map(mappings.get(vesselId) ?? []);
      for (const [provider, providerId] of providerIds) {
        current.set(provider, providerId);
      }
      mappings.set(vesselId, current);
    }
    return createMockProviders(
      new Map(
        [...mappings.entries()].map(([vesselId, providerIds]) => [
          vesselId,
          providerIds,
        ]),
      ),
      configuration.primaryScenario,
      configuration.providerOrder,
    );
  }

  private envelope(
    vesselId: string,
    configuration: AisConfiguration,
    checkedAt: Date,
    result: CachedResult,
    cacheHit: boolean,
  ): AisEnvelope {
    return {
      vesselId,
      status: result.status,
      simulation: result.simulation,
      telemetry: cloneTelemetry(result.telemetry),
      attempts: result.attempts.map((attempt) => ({ ...attempt })),
      checkedAt: checkedAt.toISOString(),
      cacheHit,
      freshForSeconds: configuration.freshForSeconds,
      staleAfterSeconds: configuration.staleAfterSeconds,
    };
  }

  private async lookup(
    vessel: AisVesselIdentity,
    requiredCapabilities: readonly AisCapability[],
    configuration: AisConfiguration,
  ): Promise<AisEnvelope> {
    const checkedAt = this.now();
    if (!configuration.enabled) {
      return this.envelope(
        vessel.vesselId,
        configuration,
        checkedAt,
        {
          storedAt: checkedAt.getTime(),
          status: "NOT_CONFIGURED",
          simulation: false,
          telemetry: null,
          attempts: [],
        },
        false,
      );
    }

    const attempts: AisAttempt[] = [];
    let telemetry: NormalizedVesselTelemetry | null = null;
    const providers = this.providers(configuration);
    const providersByName = new Map(
      providers.map((provider) => [provider.provider, provider]),
    );

    for (const providerName of configuration.providerOrder) {
      const provider = providersByName.get(providerName);
      if (!provider) {
        attempts.push({ provider: providerName, outcome: "UNKNOWN_PROVIDER" });
        continue;
      }
      const capabilities = providerCapabilities(provider);
      if (requiredCapabilities.some((capability) => !capabilities.includes(capability))) {
        attempts.push({ provider: providerName, outcome: "UNSUPPORTED_CAPABILITY" });
        continue;
      }
      const request: AisProviderRequest = {
        vessel,
        requiredCapabilities,
        now: checkedAt,
      };
      let providerResult: AisProviderResult;
      try {
        providerResult = await this.withTimeout(
          provider.lookup(request),
          configuration.timeoutMs,
        );
      } catch (error) {
        attempts.push({
          provider: providerName,
          outcome: error instanceof AisProviderTimeout ? "TIMEOUT" : "ERROR",
        });
        continue;
      }
      if (!providerResult || typeof providerResult !== "object") {
        attempts.push({ provider: providerName, outcome: "MALFORMED" });
        continue;
      }
      if (
        typeof providerResult.kind !== "string" ||
        ![
          "success",
          "not_found",
          "rate_limited",
          "authentication_failed",
          "unavailable",
          "unsupported_capability",
        ].includes(providerResult.kind)
      ) {
        attempts.push({ provider: providerName, outcome: "MALFORMED" });
        continue;
      }
      if (providerResult.kind !== "success") {
        attempts.push({ provider: providerName, outcome: resultOutcome(providerResult) });
        continue;
      }
      const receivedAt = this.now();
      let observation;
      try {
        observation = provider.normalize(
          providerResult.observation,
          receivedAt,
          request,
        );
      } catch {
        attempts.push({ provider: providerName, outcome: "MALFORMED" });
        continue;
      }
      if (!observation) {
        attempts.push({ provider: providerName, outcome: "MALFORMED" });
        continue;
      }
      telemetry = normalizeAisObservation(
        providerName,
        observation,
        receivedAt,
        // Compare observation age with the time the response was received,
        // not the time the request started. A provider may return an
        // observation generated during the request itself.
        receivedAt,
        configuration.freshForSeconds,
        configuration.staleAfterSeconds,
      );
      if (!hasUsableLivePosition(telemetry)) {
        attempts.push({ provider: providerName, outcome: "NO_DATA" });
        telemetry = null;
        continue;
      }
      if (telemetry.dataFreshness === "STALE") {
        attempts.push({ provider: providerName, outcome: "STALE" });
        telemetry = null;
        continue;
      }
      if (telemetry.dataFreshness === "UNKNOWN") {
        attempts.push({ provider: providerName, outcome: "UNKNOWN_TIMESTAMP" });
        telemetry = null;
        continue;
      }
      attempts.push({ provider: providerName, outcome: "SUCCESS" });
      break;
    }

    const result: CachedResult = {
      storedAt: checkedAt.getTime(),
      status: telemetry ? "AVAILABLE" : "UNAVAILABLE",
      simulation: configuration.simulation,
      telemetry,
      attempts,
    };
    return this.envelope(vessel.vesselId, configuration, checkedAt, result, false);
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new AisProviderTimeout()), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private key(
    vessel: AisVesselIdentity,
    requiredCapabilities: readonly AisCapability[],
    configuration: AisConfiguration,
  ): string {
    return [
      vessel.vesselId,
      [...requiredCapabilities].sort().join(","),
      configuration.providerOrder.join(","),
      configuration.freshForSeconds,
      configuration.staleAfterSeconds,
      configuration.primaryScenario,
    ].join(":");
  }

  async getLatestTelemetry(
    vessel: AisVesselIdentity,
    requiredCapabilities: readonly AisCapability[] = [
      "LIVE_POSITION",
      "VESSEL_LOOKUP",
    ],
  ): Promise<AisEnvelope> {
    const configuration = this.configuration();
    const now = this.now();
    // A cached simulation response must never survive a configuration change
    // that disables AIS (notably when a test or development process changes
    // AIS_MODE). Disabled mode is explicit and bypasses all provider state.
    if (!configuration.enabled) {
      return this.lookup(vessel, requiredCapabilities, configuration);
    }
    const key = this.key(vessel, requiredCapabilities, configuration);
    const cached = this.cache.get(key);
    // Freshness belongs to observation time, not the lifetime of a cache
    // entry. A cached record may cross the stale boundary before its TTL.
    if (cached?.telemetry) {
      cached.telemetry = normalizeAisObservation(
        cached.telemetry.provider,
        cached.telemetry,
        new Date(cached.telemetry.receivedAt),
        now,
        configuration.freshForSeconds,
        configuration.staleAfterSeconds,
      );
    }
    const cacheUsable = !cached?.telemetry ||
      (cached.telemetry.dataFreshness !== "STALE" &&
        cached.telemetry.dataFreshness !== "UNKNOWN");
    if (
      cached &&
      cacheUsable &&
      now.getTime() - cached.storedAt <= configuration.cacheSeconds * 1_000
    ) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return this.envelope(vessel.vesselId, configuration, now, cached, true);
    }
    if (cached) this.cache.delete(key);
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const request = this.lookup(vessel, requiredCapabilities, configuration).then(
      (envelope) => {
        const storedAt = Date.parse(envelope.checkedAt);
        const cacheResult: CachedResult = {
          storedAt: Number.isFinite(storedAt) ? storedAt : this.now().getTime(),
          status: envelope.status,
          simulation: envelope.simulation,
          telemetry: cloneTelemetry(envelope.telemetry),
          attempts: envelope.attempts.map((attempt) => ({ ...attempt })),
        };
        if (configuration.cacheSeconds > 0) {
          this.cache.set(key, cacheResult);
          while (this.cache.size > configuration.cacheMaxEntries) {
            const oldest = this.cache.keys().next().value;
            if (oldest === undefined) break;
            this.cache.delete(oldest);
          }
        }
        return envelope;
      },
    );
    this.inFlight.set(key, request);
    try {
      return await request;
    } finally {
      this.inFlight.delete(key);
    }
  }

  getLatestPosition(vessel: AisVesselIdentity): Promise<AisEnvelope> {
    return this.getLatestTelemetry(vessel);
  }
}

export class AisProviderTimeout extends Error {
  constructor() {
    super("AIS provider request timed out");
    this.name = "AisProviderTimeout";
  }
}