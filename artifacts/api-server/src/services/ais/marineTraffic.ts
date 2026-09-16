import {
  fetchJson,
  httpResult,
  matchesVerifiedCanonicalIdentifiers,
  numberField,
  record,
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

const MARINETRAFFIC_CAPABILITIES: readonly AisCapability[] = [
  "LIVE_POSITION",
  "VESSEL_LOOKUP",
  "DESTINATION",
  "ETA",
];

const DEFAULT_ENDPOINT = "https://services.marinetraffic.com/api/exportvessel";

export interface MarineTrafficConnectorOptions {
  apiKey?: string;
  fetch?: ConnectorFetch;
  /**
   * Test-only endpoint override. Production uses the documented
   * services.marinetraffic.com endpoint above.
   */
  endpoint?: string;
  /** Documented endpoint default, bounded by its 1,440-minute maximum. */
  timespanMinutes?: number;
}

/**
 * MarineTraffic's documented Single Vessel Positions operation
 * (`/exportvessel/{api_key}`, version 6). The newer Kpler endpoint linked by
 * MarineTraffic requires account-specific access and is intentionally not
 * guessed or called here.
 */
export class MarineTrafficConnector implements AISProvider {
  readonly provider = "marinetraffic";
  readonly capabilities = MARINETRAFFIC_CAPABILITIES;
  readonly commercial = true;

  private readonly apiKey: string | undefined;
  private readonly fetchImpl: ConnectorFetch;
  private readonly endpoint: string;
  private readonly timespanMinutes: number;

  constructor(options: MarineTrafficConnectorOptions = {}) {
    this.apiKey = options.apiKey?.trim() || undefined;
    this.fetchImpl = options.fetch ?? fetch;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.timespanMinutes = Math.min(
      1_440,
      Math.max(1, Math.floor(options.timespanMinutes ?? 5)),
    );
  }

  async lookup(request: AisProviderRequest): Promise<AisProviderResult> {
    if (!this.apiKey) return { kind: "authentication_failed" };
    const identifier = selectIdentifier(request, this.provider, [
      "MARINETRAFFIC_ID",
      "MMSI",
      "IMO",
    ]);
    if (!identifier) return { kind: "identifier_unavailable" };

    const url = new URL(
      `${this.endpoint.replace(/\/$/, "")}/${encodeURIComponent(this.apiKey)}`,
    );
    url.searchParams.set("v", "6");
    url.searchParams.set("protocol", "jsono");
    url.searchParams.set("timespan", String(this.timespanMinutes));
    const parameter =
      identifier.identifierType === "MARINETRAFFIC_ID"
        ? "shipid"
        : identifier.identifierType === "MMSI"
          ? "mmsi"
          : "imo";
    url.searchParams.set(parameter, identifier.identifierValue);

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
      identifier.identifierType as "MARINETRAFFIC_ID" | "MMSI" | "IMO",
      identifier.identifierValue,
    );
    if (!vessel) return { kind: "success", observation: body };
    if (
      !matchesRequestedIdentifier(
        vessel,
        identifier.identifierType as "MARINETRAFFIC_ID" | "MMSI" | "IMO",
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
    const identifier = selectIdentifier(request, this.provider, [
      "MARINETRAFFIC_ID",
      "MMSI",
      "IMO",
    ]);
    const vessel = identifier
      ? findVesselRecord(
          observation,
          identifier.identifierType as "MARINETRAFFIC_ID" | "MMSI" | "IMO",
          identifier.identifierValue,
        )
      : null;
    if (!vessel || !identifier) return null;
    if (
      !matchesRequestedIdentifier(
        vessel,
        identifier.identifierType as "MARINETRAFFIC_ID" | "MMSI" | "IMO",
        identifier.identifierValue,
      ) ||
      !matchesVerifiedCanonicalIdentifiers(vessel, request)
    ) {
      return null;
    }

    return {
      providerVesselId: identifierOrNull(vessel.SHIP_ID),
      mmsi: identifierOrNull(vessel.MMSI),
      imo: identifierOrNull(vessel.IMO),
      eni: null,
      vesselName: stringField(vessel.SHIPNAME),
      latitude: numberField(vessel.LAT),
      longitude: numberField(vessel.LON),
      // MarineTraffic documents SPEED as knots x10.
      speedKnots: divideByTen(vessel.SPEED),
      courseDegrees: numberField(vessel.COURSE),
      headingDegrees: normalizeHeading(vessel.HEADING),
      navigationStatus: stringField(vessel.STATUS),
      reportedDestination: stringField(vessel.DESTINATION),
      reportedEta: timestampField(vessel.ETA, true),
      // The public endpoint documentation does not specify the draught unit.
      // Do not guess a conversion from an example value or AIS encoding.
      reportedDraughtMeters: null,
      observedAt: timestampField(vessel.TIMESTAMP, true),
      sourceType: stringField(vessel.DSRC),
      rawDataReference: `marinetraffic:exportvessel:${identifier.identifierType.toLowerCase()}:${identifier.identifierValue}`,
    };
  }
}

function findVesselRecord(
  value: unknown,
  identifierType: "MARINETRAFFIC_ID" | "MMSI" | "IMO",
  identifierValue: string,
): JsonRecord | null {
  if (!Array.isArray(value)) return null;
  let first: JsonRecord | null = null;
  for (const entryValue of value) {
    const vessel = record(entryValue);
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
  identifierType: "MARINETRAFFIC_ID" | "MMSI" | "IMO",
  identifierValue: string,
): boolean {
  const field =
    identifierType === "MARINETRAFFIC_ID"
      ? vessel.SHIP_ID
      : vessel[identifierType];
  return sameNumericIdentifier(field, identifierValue);
}

function identifierOrNull(value: unknown): string | null {
  const result = stringField(value);
  return result === null || result === "0" ? null : result;
}

function divideByTen(value: unknown): number | null {
  const result = numberField(value);
  return result === null ? null : result / 10;
}

function normalizeHeading(value: unknown): number | null {
  const heading = numberField(value);
  // MarineTraffic documents -1 and 511 as no heading data.
  return heading === null || heading === -1 || heading === 511 ? null : heading;
}

export function createMarineTrafficConnector(
  env: NodeJS.ProcessEnv = process.env,
): MarineTrafficConnector {
  return new MarineTrafficConnector({ apiKey: env.MARINETRAFFIC_API_KEY });
}