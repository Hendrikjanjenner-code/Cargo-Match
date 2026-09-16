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

/**
 * The internal vessel UUID is the authoritative identity. External provider
 * IDs are supplied only by an explicit mapping; names and unverified ENIs are
 * intentionally absent from this request contract.
 */
export interface AisVesselIdentity {
  vesselId: string;
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
}

export type AisProviderResult =
  | { kind: "success"; observation: unknown }
  | { kind: "not_found" }
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
  "enabled" | "simulation"
> = {
  providerOrder: ["mock-alpha", "mock-beta"],
  freshForSeconds: 300,
  staleAfterSeconds: 1_800,
  cacheSeconds: 30,
  cacheMaxEntries: 100,
  timeoutMs: 1_500,
  primaryScenario: "success",
};