import {
  type AisFreshness,
  type AisProviderObservation,
  type NormalizedVesselTelemetry,
} from "./model";

function nullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length > 0 ? result : null;
}

function nullableNumber(value: unknown, minimum?: number, maximum?: number): number | null {
  const result =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isFinite(result)) return null;
  if (minimum !== undefined && result < minimum) return null;
  if (maximum !== undefined && result > maximum) return null;
  return result;
}

function nullableTimestamp(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeAisObservation(
  provider: string,
  observation: AisProviderObservation,
  receivedAt: Date,
  now: Date,
  freshForSeconds: number,
  staleAfterSeconds: number,
): NormalizedVesselTelemetry {
  const observedAt = nullableTimestamp(observation.observedAt);
  const observationTime = observedAt ? Date.parse(observedAt) : Number.NaN;
  const nowMs = now.getTime();
  const ageSeconds = Number.isFinite(observationTime)
    ? (nowMs - observationTime) / 1_000
    : Number.NaN;

  // A future observation is retained only as an unknown observation time. A
  // future timestamp must never make a record appear fresh.
  const safeObservedAt =
    Number.isFinite(ageSeconds) && ageSeconds >= 0 ? observedAt : null;
  const safeAgeSeconds = safeObservedAt ? ageSeconds : Number.NaN;
  let dataFreshness: AisFreshness = "UNKNOWN";
  if (Number.isFinite(safeAgeSeconds)) {
    if (safeAgeSeconds <= freshForSeconds) dataFreshness = "FRESH";
    else if (safeAgeSeconds <= staleAfterSeconds) dataFreshness = "AGING";
    else dataFreshness = "STALE";
  }

  return {
    provider,
    providerVesselId: nullableString(observation.providerVesselId),
    mmsi: nullableString(observation.mmsi),
    imo: nullableString(observation.imo),
    eni: nullableString(observation.eni),
    vesselName: nullableString(observation.vesselName),
    latitude: nullableNumber(observation.latitude, -90, 90),
    longitude: nullableNumber(observation.longitude, -180, 180),
    speedKnots: nullableNumber(observation.speedKnots, 0),
    // AIS bearings are represented as [0, 360), matching the API contract.
    courseDegrees: nullableNumber(observation.courseDegrees, 0, 359.999999),
    headingDegrees: nullableNumber(observation.headingDegrees, 0, 359.999999),
    navigationStatus: nullableString(observation.navigationStatus),
    reportedDestination: nullableString(observation.reportedDestination),
    reportedEta: nullableTimestamp(observation.reportedEta),
    reportedDraughtMeters: nullableNumber(observation.reportedDraughtMeters, 0),
    observedAt: safeObservedAt,
    receivedAt: receivedAt.toISOString(),
    sourceType: nullableString(observation.sourceType),
    dataFreshness,
    rawDataReference: nullableString(observation.rawDataReference),
  };
}

export function hasUsableLivePosition(telemetry: NormalizedVesselTelemetry): boolean {
  return telemetry.latitude !== null && telemetry.longitude !== null;
}