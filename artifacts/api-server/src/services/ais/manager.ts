import {
  parseMockVesselMap,
  loadAisConfiguration,
} from "./config";
import { hasUsableLivePosition, normalizeAisObservation } from "./normalize";
import { createMockProviders } from "./mock";
import { createMarineTrafficConnector } from "./marineTraffic";
import { createVesselFinderConnector } from "./vesselFinder";
import {
  type AisAttempt,
  type AisCapability,
  type AisConfiguration,
  type AisEnvelope,
  DEFAULT_AIS_LICENSE_SCOPES,
  type AisIdentityDecision,
  type AisIdentityRevalidator,
  type AisLicenseDecision,
  type AisLicenseGate,
  type AisLicenseRequest,
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
  /**
   * Tenant-aware license worker. Commercial providers are denied when this
   * gate is absent or returns a false/expired/revoked decision.
   */
  licenseGate?: AisLicenseGate;
  /**
   * Route/identity-worker hook. It runs before cache access and again after a
   * provider response to prevent membership or mapping-revocation races.
   */
  identityRevalidator?: AisIdentityRevalidator;
}

const runtimeMockMappings = new Map<string, Map<string, string>>();

const DENY_COMMERCIAL_ACCESS: AisLicenseGate = {
  authorize(): AisLicenseDecision {
    return { allowed: false, reason: "NO_TENANT_LICENSE_GRANT" };
  },
};

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
    case "identifier_unavailable":
      return "IDENTIFIER_UNAVAILABLE";
    case "identifier_mismatch":
      return "IDENTIFIER_MISMATCH";
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
  private readonly licenseGate: AisLicenseGate;
  private readonly identityRevalidator: AisIdentityRevalidator | undefined;
  private readonly cache = new Map<string, CachedResult>();
  private readonly inFlight = new Map<string, Promise<AisEnvelope>>();

  constructor(options: AisProviderManagerOptions = {}) {
    this.configuredProviders = options.providers ?? null;
    this.configuredConfiguration = options.configuration;
    this.now = options.now ?? (() => new Date());
    this.licenseGate = options.licenseGate ?? DENY_COMMERCIAL_ACCESS;
    this.identityRevalidator = options.identityRevalidator;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private configuration(): AisConfiguration {
    return this.configuredConfiguration ?? loadAisConfiguration();
  }

  private selectionOrder(configuration: AisConfiguration): readonly string[] {
    // Simulation remains deterministic and credit-free even though production
    // configuration defaults to the commercial provider names.
    if (
      configuration.simulation &&
      !configuration.providerOrder.some((provider) =>
        provider.startsWith("mock-"),
      )
    ) {
      return ["mock-alpha", "mock-beta"];
    }
    return configuration.providerOrder;
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
    if (configuration.simulation) {
      return createMockProviders(
        new Map(
          [...mappings.entries()].map(([vesselId, providerIds]) => [
            vesselId,
            providerIds,
          ]),
        ),
        configuration.primaryScenario,
        this.selectionOrder(configuration),
      );
    }

    // No provider is activated by credentials alone. Commercial mode is
    // explicit and each resulting request still passes the license gate.
    return [
      createVesselFinderConnector(),
      createMarineTrafficConnector(),
    ];
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

  private async revalidateIdentity(
    vessel: AisVesselIdentity,
  ): Promise<AisIdentityDecision> {
    if (!this.identityRevalidator) return { allowed: true };
    try {
      const decision = await this.identityRevalidator(vessel);
      if (!decision || decision.allowed !== true) {
        return {
          allowed: false,
          reason: decision?.reason ?? "IDENTITY_REVOKED",
        };
      }
      // A route can return a newer mapping revision while the request is in
      // flight. Treat that as a revocation of this request, not as permission
      // to silently switch identifiers.
      if (
        vessel.mappingRevision !== undefined &&
        decision.mappingRevision !== undefined &&
        decision.mappingRevision !== vessel.mappingRevision
      ) {
        return { allowed: false, reason: "MAPPING_REVISION_CHANGED" };
      }
      return decision;
    } catch {
      return { allowed: false, reason: "IDENTITY_RECHECK_FAILED" };
    }
  }

  private async authorizeProvider(
    provider: AISProvider,
    vessel: AisVesselIdentity,
    now: Date,
  ): Promise<AisLicenseDecision> {
    if (!provider.commercial) return { allowed: true };
    if (!vessel.tenantId) {
      return { allowed: false, reason: "TENANT_REQUIRED" };
    }
    const request: AisLicenseRequest = {
      provider: provider.provider,
      tenantId: vessel.tenantId,
      scopes: DEFAULT_AIS_LICENSE_SCOPES,
      // A connector normalizes every field present in its documented latest
      // vessel response. Authorize the provider's full emitted capability
      // set, not only the route's minimum position requirement.
      capabilities: providerCapabilities(provider),
      now,
    };
    try {
      const decision = await this.licenseGate.authorize(request);
      if (!decision || decision.allowed !== true) {
        return {
          allowed: false,
          reason: decision?.reason ?? "LICENSE_NOT_AUTHORIZED",
        };
      }
      return decision;
    } catch {
      return { allowed: false, reason: "LICENSE_RECHECK_FAILED" };
    }
  }

  private async authorizedProviders(
    providers: readonly AISProvider[],
    vessel: AisVesselIdentity,
    now: Date,
  ): Promise<ReadonlySet<string>> {
    const allowed = new Set<string>();
    for (const provider of providers) {
      const decision = await this.authorizeProvider(
        provider,
        vessel,
        now,
      );
      if (decision.allowed) allowed.add(provider.provider);
    }
    return allowed;
  }

  private async lookup(
    vessel: AisVesselIdentity,
    requiredCapabilities: readonly AisCapability[],
    configuration: AisConfiguration,
    providers: readonly AISProvider[],
    authorizedProviders: ReadonlySet<string>,
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
    const providersByName = new Map(
      providers.map((provider) => [provider.provider, provider]),
    );

    for (const providerName of this.selectionOrder(configuration)) {
      const provider = providersByName.get(providerName);
      if (!provider) {
        attempts.push({ provider: providerName, outcome: "UNKNOWN_PROVIDER" });
        continue;
      }
      if (!authorizedProviders.has(providerName)) {
        attempts.push({ provider: providerName, outcome: "LICENSE_DENIED" });
        continue;
      }
      const capabilities = providerCapabilities(provider);
      if (requiredCapabilities.some((capability) => !capabilities.includes(capability))) {
        attempts.push({ provider: providerName, outcome: "UNSUPPORTED_CAPABILITY" });
        continue;
      }
      // Eligibility may change while a previous provider is timing out.
      const currentIdentity = await this.revalidateIdentity(vessel);
      if (!currentIdentity.allowed) {
        attempts.push({ provider: providerName, outcome: "IDENTITY_REVOKED" });
        break;
      }
      const beforeRequest = await this.authorizeProvider(provider, vessel, this.now());
      if (!beforeRequest.allowed) {
        attempts.push({ provider: providerName, outcome: "LICENSE_DENIED" });
        continue;
      }
      const abortController = new AbortController();
      const request: AisProviderRequest = {
        vessel,
        requiredCapabilities,
        now: checkedAt,
        signal: abortController.signal,
      };
      let providerResult: AisProviderResult;
      try {
        providerResult = await this.withTimeout(
          provider.lookup(request),
          configuration.timeoutMs,
          () => abortController.abort(),
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
          "identifier_unavailable",
          "identifier_mismatch",
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
      const identityDecision = await this.revalidateIdentity(vessel);
      if (!identityDecision.allowed) {
        attempts.push({ provider: providerName, outcome: "IDENTITY_REVOKED" });
        // A mapping/membership revocation invalidates the whole request; do
        // not issue a fallback request with the same now-revoked identity.
        break;
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
      const beforeDisplay = await this.authorizeProvider(provider, vessel, this.now());
      if (!beforeDisplay.allowed) {
        telemetry = null;
        attempts.push({ provider: providerName, outcome: "LICENSE_DENIED" });
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

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    onTimeout?: () => void,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => {
            onTimeout?.();
            reject(new AisProviderTimeout());
          }, timeoutMs);
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
    const identifiers = [...(vessel.externalIdentifiers ?? [])]
      .map((identifier) => [
        identifier.identifierType,
        identifier.identifierValue,
        identifier.provider ?? "",
        identifier.verified ? "1" : "0",
      ])
      .sort((left, right) => left.join("|").localeCompare(right.join("|")));
    return [
      vessel.vesselId,
      vessel.tenantId ?? "",
      vessel.mappingRevision ?? "",
      identifiers.map((identifier) => identifier.join("|")).join(","),
      [...requiredCapabilities].sort().join(","),
      this.selectionOrder(configuration).join(","),
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
      return this.lookup(
        vessel,
        requiredCapabilities,
        configuration,
        [],
        new Set(),
      );
    }
    const providers = this.providers(configuration);
    const identityDecision = await this.revalidateIdentity(vessel);
    if (!identityDecision.allowed) {
      return this.envelope(
        vessel.vesselId,
        configuration,
        now,
        {
          storedAt: now.getTime(),
          status: "UNAVAILABLE",
          simulation: configuration.simulation,
          telemetry: null,
          attempts: [{ provider: "identity", outcome: "IDENTITY_REVOKED" }],
        },
        false,
      );
    }
    // This check is intentionally before cache access. A revoked/expired
    // tenant grant must not reveal a previously cached commercial position.
    const authorizedProviders = await this.authorizedProviders(
      providers,
      vessel,
      now,
    );
    const key = this.key(vessel, requiredCapabilities, configuration);
    const completedCacheEnabled = !this.selectionOrder(configuration).some(
      (providerName) =>
        providers.find((provider) => provider.provider === providerName)
          ?.commercial === true,
    );
    // Commercial payloads are never retained as completed results. The
    // in-flight map below still coalesces concurrent calls without retaining
    // telemetry after the request settles.
    const cached = completedCacheEnabled ? this.cache.get(key) : undefined;
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
    const cachedProvider = cached?.telemetry
      ? providers.find(
          (provider) => provider.provider === cached.telemetry?.provider,
        )
      : undefined;
    const cachedProviderIsCommercial =
      cachedProvider?.commercial === true ||
      cached?.telemetry?.provider === "vesselfinder" ||
      cached?.telemetry?.provider === "marinetraffic";
    const cachedLicenseUsable =
      !cachedProviderIsCommercial ||
      (cachedProvider !== undefined &&
        authorizedProviders.has(cachedProvider.provider));
    const cacheUsable = !cached?.telemetry ||
      (cachedLicenseUsable &&
      (cached.telemetry.dataFreshness !== "STALE" &&
        cached.telemetry.dataFreshness !== "UNKNOWN"));
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

    const request = this.lookup(
      vessel,
      requiredCapabilities,
      configuration,
      providers,
      authorizedProviders,
    ).then(
      (envelope) => {
        const storedAt = Date.parse(envelope.checkedAt);
        const cacheResult: CachedResult = {
          storedAt: Number.isFinite(storedAt) ? storedAt : this.now().getTime(),
          status: envelope.status,
          simulation: envelope.simulation,
          telemetry: cloneTelemetry(envelope.telemetry),
          attempts: envelope.attempts.map((attempt) => ({ ...attempt })),
        };
        if (configuration.cacheSeconds > 0 && completedCacheEnabled) {
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