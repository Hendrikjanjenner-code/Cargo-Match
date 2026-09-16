import {
  type AisCapability,
  type AISProvider,
  type AisProviderObservation,
  type AisProviderRequest,
  type AisProviderResult,
  type MockAisScenario,
} from "./model";

const MOCK_CAPABILITIES: readonly AisCapability[] = [
  "LIVE_POSITION",
  "VESSEL_LOOKUP",
  "DRAUGHT",
  "DESTINATION",
  "ETA",
];

export type MockVesselMapping = ReadonlyMap<string, string>;

export interface MockAisProviderOptions {
  provider: string;
  mappings: MockVesselMapping;
  scenario?: MockAisScenario;
  capabilities?: readonly AisCapability[];
}

function observationForScenario(
  provider: string,
  providerVesselId: string,
  scenario: MockAisScenario,
  now: Date,
): AisProviderObservation | null | "timeout" {
  if (scenario === "outage") return null;
  if (scenario === "timeout") return "timeout";
  if (
    scenario === "not-found" ||
    scenario === "rate-limit" ||
    scenario === "auth" ||
    scenario === "unsupported"
  ) {
    return null;
  }
  if (scenario === "malformed") {
    return { providerVesselId, latitude: { malformed: true } };
  }

  const observedAt = new Date(now.getTime() - 30_000).toISOString();
  const agingAt = new Date(now.getTime() - 600_000).toISOString();
  const staleAt = new Date(now.getTime() - 7_200_000).toISOString();
  const base: AisProviderObservation = {
    providerVesselId,
    mmsi: provider === "mock-alpha" ? "244000001" : "244000002",
    imo: null,
    eni: null,
    vesselName: provider === "mock-alpha" ? "Simulation Alpha" : "Simulation Beta",
    latitude: provider === "mock-alpha" ? 51.9244 : 51.23,
    longitude: provider === "mock-alpha" ? 4.4777 : 4.4025,
    speedKnots: 6.2,
    courseDegrees: 92,
    headingDegrees: 90,
    navigationStatus: "UNDER_WAY",
    reportedDestination: "Simulation destination",
    reportedEta: new Date(now.getTime() + 7_200_000).toISOString(),
    reportedDraughtMeters: 2.1,
    observedAt,
    sourceType: "SIMULATION",
    rawDataReference: `${provider}:${providerVesselId}`,
  };

  switch (scenario) {
    case "moving":
      base.latitude = 51.95;
      base.longitude = 4.52;
      base.speedKnots = 7.8;
      base.courseDegrees = 105;
      break;
    case "stationary":
      base.speedKnots = 0;
      base.navigationStatus = "AT_ANCHOR";
      break;
    case "port-arrival":
      base.speedKnots = 1.2;
      base.navigationStatus = "MANEUVERING";
      base.reportedDestination = "Simulation arrival port";
      break;
    case "port-departure":
      base.speedKnots = 4.5;
      base.navigationStatus = "UNDER_WAY";
      base.reportedDestination = "Simulation departure port";
      break;
    case "draught-change":
      base.reportedDraughtMeters = 3.4;
      break;
    case "aging":
      base.observedAt = agingAt;
      break;
    case "stale":
      base.observedAt = staleAt;
      break;
    case "unknown-time":
      base.observedAt = "not-a-timestamp";
      break;
    case "future":
      base.observedAt = new Date(now.getTime() + 60_000).toISOString();
      break;
    case "incomplete":
      base.latitude = null;
      base.longitude = null;
      base.speedKnots = null;
      base.courseDegrees = null;
      base.headingDegrees = null;
      base.reportedDestination = null;
      base.reportedEta = null;
      base.reportedDraughtMeters = null;
      break;
    default:
      break;
  }
  return base;
}

export class MockAISProvider implements AISProvider {
  readonly provider: string;
  readonly capabilities: readonly AisCapability[];
  private readonly mappings: MockVesselMapping;
  private readonly scenario: MockAisScenario;

  constructor(options: MockAisProviderOptions) {
    this.provider = options.provider;
    this.capabilities = options.capabilities ?? MOCK_CAPABILITIES;
    this.mappings = options.mappings;
    this.scenario = options.scenario ?? "success";
  }

  async lookup(request: AisProviderRequest): Promise<AisProviderResult> {
    const providerVesselId = this.mappings.get(request.vessel.vesselId);
    const scenario = this.scenario;
    if (!providerVesselId && scenario !== "timeout") return { kind: "not_found" };
    if (scenario === "rate-limit") return { kind: "rate_limited" };
    if (scenario === "auth") return { kind: "authentication_failed" };
    if (scenario === "unsupported") return { kind: "unsupported_capability" };
    if (scenario === "outage") return { kind: "unavailable" };
    if (scenario === "not-found" || !providerVesselId) return { kind: "not_found" };
    const observation = observationForScenario(
      this.provider,
      providerVesselId,
      scenario,
      request.now,
    );
    if (observation === "timeout") {
      // There is deliberately no network call. The manager's bounded timeout
      // controls this simulated hung provider.
      return await new Promise<AisProviderResult>(() => undefined);
    }
    if (!observation) return { kind: "unavailable" };
    return { kind: "success", observation };
  }

  normalize(
    observation: unknown,
    _receivedAt: Date,
    _request: AisProviderRequest,
  ): AisProviderObservation | null {
    if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
      return null;
    }
    const candidate = observation as Record<string, unknown>;
    // An optional field may be absent or null, but a provider response with a
    // value of the wrong primitive shape is malformed rather than merely
    // incomplete. Unknown timestamps are intentionally allowed and are
    // classified as UNKNOWN by the shared normalizer.
    for (const field of [
      "latitude",
      "longitude",
      "speedKnots",
      "courseDegrees",
      "headingDegrees",
      "reportedDraughtMeters",
    ]) {
      const value = candidate[field];
      if (
        value !== undefined &&
        value !== null &&
        typeof value !== "number" &&
        !(typeof value === "string" && value.trim() !== "")
      ) {
        return null;
      }
    }
    return candidate as AisProviderObservation;
  }
}

export class MockAlphaAISProvider extends MockAISProvider {
  constructor(options: Omit<MockAisProviderOptions, "provider">) {
    super({ ...options, provider: "mock-alpha" });
  }
}

export class MockBetaAISProvider extends MockAISProvider {
  constructor(options: Omit<MockAisProviderOptions, "provider">) {
    super({ ...options, provider: "mock-beta" });
  }
}

export function createMockProviders(
  mappings: ReadonlyMap<string, MockVesselMapping>,
  primaryScenario: MockAisScenario,
  providerOrder: readonly string[],
): AISProvider[] {
  const providers = providerOrder.map((provider, index) => {
    const map = new Map<string, string>();
    for (const [vesselId, providerIds] of mappings) {
      const providerId = providerIds.get(provider);
      if (providerId) map.set(vesselId, providerId);
    }
    const options = {
      mappings: map,
      scenario: index === 0 ? primaryScenario : "success" as const,
    };
    if (provider === "mock-beta") return new MockBetaAISProvider(options);
    if (provider === "mock-alpha") return new MockAlphaAISProvider(options);
    return null;
  });
  return providers.filter((provider) => provider !== null) as AISProvider[];
}