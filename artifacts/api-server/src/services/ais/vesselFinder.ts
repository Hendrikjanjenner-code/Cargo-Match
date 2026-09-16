import {
  fetchJson,
  httpResult,
  numberField,
  record,
  matchesVerifiedCanonicalIdentifiers,
  sameNumericIdentifier,
  selectIdentifier,
  stringField,
  timestampField,
  type JsonRecord,
  type ConnectorFetch,
} from "./connector-utils";
import {
  type AisCapability,
  type AISProvider,
  type AisProviderObservation,
  type AisProviderRequest,
  type AisProviderResult,
} from "./model";
import { normalizeVesselFinderEta } from "./vesselFinderEta";

const VESSELFINDER_CAPABILITIES: readonly AisCapability[] = [
  "LIVE_POSITION",
  "VESSEL_LOOKUP",
  "DRAUGHT",
  "DESTINATION",
  "ETA",
];

const DEFAULT_ENDPOINT = "https://api.vesselfinder.com/vessels";

export interface VesselFinderConnectorOptions {
  apiKey?: string;
  fetch?: ConnectorFetch;
  /**
   * Test-only endpoint override. Production uses the documented endpoint
   * above; callers must not use this to select undocumented APIs.
   */
  endpoint?: string;
}

/**
 * VesselFinder's documented VESSELS method. It accepts IMO and/or MMSI
 * integer lists and returns the AIS dataset in a JSON array. This connector
 * intentionally does not use names, ENI, area monitoring, or undocumented
 * provider IDs for latest-vessel lookup.
 */
export class VesselFinderConnector implements AISProvider {
  readonly provider = "vesselfinder";
  readonly capabilities = VESSELFINDER_CAPABILITIES;
  readonly commercial = true;

  private readonly apiKey: string | undefined;
  private readonly fetchImpl: ConnectorFetch;
  private readonly endpoint: string;

  constructor(options: VesselFinderConnectorOptions = {}) {
    this.apiKey = options.apiKey?.trim() || undefined;
    this.fetchImpl = options.fetch ?? fetch;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  }

  async lookup(request: AisProviderRequest): Promise<AisProviderResult> {
    if (!this.apiKey) return { kind: "authentication_failed" };
    const identifier = selectIdentifier(request, this.provider, ["MMSI", "IMO"]);
    if (!identifier) return { kind: "identifier_unavailable" };

    const url = new URL(this.endpoint);
    url.searchParams.set("userkey", this.apiKey);
    url.searchParams.set("format", "json");
    url.searchParams.set(identifier.identifierType === "MMSI" ? "mmsi" : "imo", identifier.identifierValue);

    const fetched = await fetchJson(this.fetchImpl, url, request.signal);
    if (fetched.kind === "unavailable") return { kind: "unavailable" };
    const result = httpResult(fetched.response.status);
    if (result !== "ok") return { kind: result };

    let body: unknown;
    try {
      body = await fetched.response.json();
    } catch {
      return { kind: "success", observation: null };
    }
    if (!Array.isArray(body)) {
      return { kind: "success", observation: body };
    }
    if (body.length === 0) return { kind: "not_found" };
    const vessel = findVesselRecord(
      body,
      identifier.identifierType as "MMSI" | "IMO",
      identifier.identifierValue,
    );
    if (!vessel) return { kind: "success", observation: body };
    if (
      !matchesRequestedIdentifier(
        vessel,
        identifier.identifierType as "MMSI" | "IMO",
        identifier.identifierValue,
      ) ||
      !matchesVerifiedCanonicalIdentifiers(vessel, request)
    ) {
      return { kind: "identifier_mismatch" };
    }
    return { kind: "success", observation: body };
  }

  normalize(
    observation: unknown,
    _receivedAt: Date,
    request: AisProviderRequest,
  ): AisProviderObservation | null {
    const identifier = selectIdentifier(request, this.provider, ["MMSI", "IMO"]);
    const vessel = identifier
      ? findVesselRecord(
          observation,
          identifier.identifierType as "MMSI" | "IMO",
          identifier.identifierValue,
        )
      : null;
    if (!vessel || !identifier) return null;
    if (
      !matchesRequestedIdentifier(
        vessel,
        identifier.identifierType as "MMSI" | "IMO",
        identifier.identifierValue,
      ) ||
      !matchesVerifiedCanonicalIdentifiers(vessel, request)
    ) {
      return null;
    }

    return {
      // VesselFinder's documented VESSELS response exposes IMO and MMSI but
      // no separate provider vessel ID. Do not relabel an IMO/MMSI as one.
      providerVesselId: null,
      mmsi: identifierOrNull(vessel.MMSI),
      imo: identifierOrNull(vessel.IMO),
      eni: null,
      vesselName: stringField(vessel.NAME),
      latitude: numberField(vessel.LATITUDE),
      longitude: numberField(vessel.LONGITUDE),
      speedKnots: numberField(vessel.SPEED),
      courseDegrees: numberField(vessel.COURSE),
      headingDegrees: normalizeHeading(vessel.HEADING),
      navigationStatus: stringField(vessel.NAVSTAT),
      reportedDestination: stringField(vessel.DESTINATION),
      reportedEta: normalizeVesselFinderEta(vessel.ETA, vessel.ETA_AIS, timestampField(vessel.TIMESTAMP, true)),
      reportedDraughtMeters: numberField(vessel.DRAUGHT),
      observedAt: timestampField(vessel.TIMESTAMP, true),
      sourceType: stringField(vessel.SRC),
      rawDataReference: `vesselfinder:vessels:${identifier.identifierType.toLowerCase()}:${identifier.identifierValue}`,
    };
  }
}

function findVesselRecord(
  value: unknown,
  identifierType: "MMSI" | "IMO",
  identifierValue: string,
): JsonRecord | null {
  if (!Array.isArray(value)) return null;
  let first: JsonRecord | null = null;
  for (const entryValue of value) {
    const entry = record(entryValue);
    const vessel = record(entry?.AIS);
    if (!vessel) continue;
    first ??= vessel;
    if (matchesRequestedIdentifier(vessel, identifierType, identifierValue)) {
      return vessel;
    }
  }
  return first;
}

function matchesRequestedIdentifier(
  vessel: Record<string, unknown>,
  identifierType: "MMSI" | "IMO",
  identifierValue: string,
): boolean {
  return sameNumericIdentifier(
    vessel[identifierType],
    identifierValue,
  );
}

function identifierOrNull(value: unknown): string | null {
  const result = stringField(value);
  return result === null || result === "0" ? null : result;
}

function normalizeHeading(value: unknown): number | null {
  const heading = numberField(value);
  // VesselFinder documents 511 as no heading data.
  return heading === null || heading === 511 ? null : heading;
}

export function createVesselFinderConnector(
  env: NodeJS.ProcessEnv = process.env,
): VesselFinderConnector {
  return new VesselFinderConnector({ apiKey: env.VESSELFINDER_API_KEY });
}