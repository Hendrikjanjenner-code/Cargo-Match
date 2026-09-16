/**
 * Provider-neutral AIS contracts.
 *
 * This module deliberately does not contain any provider SDK types. Provider
 * connectors turn their own responses into AisProviderObservation and the
 * manager is the only code that selects a source.
 */

export const AIS_CAPABILITIES = [
  "LIVE_POSITION",
  "VESSEL_LOOKUP",
  "DRAUGHT",
  "DESTINATION",
  "ETA",
] as const;

export type AisCapability = (typeof AIS_CAPABILITIES)[number];

export const AIS_FRESHNESS = ["FRESH", "AGING", "STALE", "UNKNOWN"] as const;
export type AisFreshness = (typeof AIS_FRESHNESS)[number];

export type AisStatus = "NOT_CONFIGURED" | "AVAILABLE" | "UNAVAILABLE";

export const AIS_EXTERNAL_IDENTIFIER_TYPES = [
  "ENI",
  "MMSI",
  "IMO",
  "VESSELFINDER_ID",
  "MARINETRAFFIC_ID",
  "OTHER",
] as const;

export type AisExternalIdentifierType =
  (typeof AIS_EXTERNAL_IDENTIFIER_TYPES)[number];

/**
 * A link between a CargoMatch vessel and an external AIS record. The route
 * (or its identity worker) must supply only verified mappings. Connectors
 * deliberately do not infer links from a vessel name.
 */
export interface AisExternalIdentifier {
  identifierType: AisExternalIdentifierType;
  identifierValue: string;
  provider?: string | null;
  verified: boolean;
}

/**
 * The internal vessel UUID is the authoritative identity. External provider
 * IDs are supplied only by an explicit mapping; names and unverified ENIs are
 * intentionally absent from this request contract.
 */
export interface AisVesselIdentity {
  vesselId: string;
  /**
   * Tenant/company UUID used by the licensing and identity guards. It is
   * intentionally optional for backwards-compatible internal callers; a
   * commercial request without it is denied by the default license gate.
   */
  tenantId?: string;
  /**
   * Revision of the verified external-identifier mapping read by the route.
   * Include this value in every request so cache entries cannot cross a
   * mapping revision.
   */
  mappingRevision?: string;
  externalIdentifiers?: readonly AisExternalIdentifier[];
}

export interface AisProviderObservation {
  providerVesselId?: unknown;
  mmsi?: unknown;
  imo?: unknown;
  eni?: unknown;
  vesselName?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  speedKnots?: unknown;
  courseDegrees?: unknown;
  headingDegrees?: unknown;
  navigationStatus?: unknown;
  reportedDestination?: unknown;
  reportedEta?: unknown;
  reportedDraughtMeters?: unknown;
  observedAt?: unknown;
  sourceType?: unknown;
  rawDataReference?: unknown;
}

export interface NormalizedVesselTelemetry {
  provider: string;
  providerVesselId: string | null;
  mmsi: string | null;
  imo: string | null;
  eni: string | null;
  vesselName: string | null;
  latitude: number | null;
  longitude: number | null;
  speedKnots: number | null;
  courseDegrees: number | null;
  headingDegrees: number | null;
  navigationStatus: string | null;
  reportedDestination: string | null;
  reportedEta: string | null;
  reportedDraughtMeters: number | null;
  observedAt: string | null;
  receivedAt: string;
  sourceType: string | null;
  dataFreshness: AisFreshness;
  rawDataReference: string | null;
}

export interface AisAttempt {
  provider: string;
  outcome: string;
}

export interface AisEnvelope {
  vesselId: string;
  status: AisStatus;
  simulation: boolean;
  telemetry: NormalizedVesselTelemetry | null;
  attempts: AisAttempt[];
  checkedAt: string;
  cacheHit: boolean;
  freshForSeconds: number;
  staleAfterSeconds: number;
}

export interface AisProviderRequest {
  vessel: AisVesselIdentity;
  requiredCapabilities: readonly AisCapability[];
  now: Date;
  /**
   * Manager-owned cancellation signal. Connectors must pass it to fetch so a
   * timeout stops the underlying billed request rather than only abandoning
   * its Promise.
   */
  signal?: AbortSignal;
}

export type AisProviderResult =
  | { kind: "success"; observation: unknown }
  | { kind: "not_found" }
  | { kind: "identifier_unavailable" }
  | { kind: "identifier_mismatch" }
  | { kind: "rate_limited" }
  | { kind: "authentication_failed" }
  | { kind: "unavailable" }
  | { kind: "unsupported_capability" };

/**
 * A connector owns lookup and provider-specific response parsing. It never
 * returns a provider response directly to a route.
 */
export interface AISProvider {
  readonly provider: string;
  readonly capabilities: readonly AisCapability[] | ReadonlySet<AisCapability>;
  /**
   * Commercial connectors must set this flag. It makes the manager require a
   * tenant-scoped license decision before either cache or network access.
   */
  readonly commercial?: boolean;
  lookup(request: AisProviderRequest): Promise<AisProviderResult>;
  normalize(
    observation: unknown,
    receivedAt: Date,
    request: AisProviderRequest,
  ): AisProviderObservation | null;
}

export interface AisConfiguration {
  enabled: boolean;
  simulation: boolean;
  commercial?: boolean;
  providerOrder: string[];
  freshForSeconds: number;
  staleAfterSeconds: number;
  cacheSeconds: number;
  cacheMaxEntries: number;
  timeoutMs: number;
  primaryScenario: MockAisScenario;
}

export type MockAisScenario =
  | "success"
  | "moving"
  | "stationary"
  | "port-arrival"
  | "port-departure"
  | "draught-change"
  | "aging"
  | "stale"
  | "unknown-time"
  | "future"
  | "outage"
  | "timeout"
  | "not-found"
  | "incomplete"
  | "malformed"
  | "rate-limit"
  | "auth"
  | "unsupported";

export const DEFAULT_AIS_CONFIGURATION: Omit<
  AisConfiguration,
  "enabled" | "simulation" | "commercial"
> = {
  // Commercial provider names are the production default. Simulation mode
  // substitutes mock-alpha/mock-beta inside the manager without changing the
  // production priority configuration.
  providerOrder: ["vesselfinder", "marinetraffic"],
  freshForSeconds: 300,
  staleAfterSeconds: 1_800,
  cacheSeconds: 30,
  cacheMaxEntries: 100,
  timeoutMs: 1_500,
  primaryScenario: "success",
};

export const AIS_LICENSE_SCOPES = [
  "COMMERCIAL",
  "DISPLAY",
  "THIRD_PARTY_ACCESS",
  "STORAGE",
  "RETENTION",
  "DERIVED_DATA",
] as const;

export type AisLicenseScope = (typeof AIS_LICENSE_SCOPES)[number];

export const DEFAULT_AIS_LICENSE_SCOPES: readonly AisLicenseScope[] = [
  "COMMERCIAL",
  "DISPLAY",
  "THIRD_PARTY_ACCESS",
  "STORAGE",
  "RETENTION",
  "DERIVED_DATA",
];

export interface AisLicenseRequest {
  provider: string;
  tenantId: string;
  scopes: readonly AisLicenseScope[];
  capabilities: readonly AisCapability[];
  now: Date;
}

export interface AisLicenseDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Production wiring supplies a tenant-aware implementation backed by the
 * identity/license worker. The default manager gate denies all commercial
 * access, fail-closed.
 */
export interface AisLicenseGate {
  authorize(
    request: AisLicenseRequest,
  ): AisLicenseDecision | Promise<AisLicenseDecision>;
}

export interface AisIdentityDecision {
  allowed: boolean;
  mappingRevision?: string;
  reason?: string;
}

/**
 * The route/identity worker may provide this guard to re-check membership and
 * the verified mapping revision before cache use and after a slow provider
 * response. A revoked mapping therefore cannot race a network request.
 */
export type AisIdentityRevalidator = (
  identity: AisVesselIdentity,
) => AisIdentityDecision | Promise<AisIdentityDecision>;