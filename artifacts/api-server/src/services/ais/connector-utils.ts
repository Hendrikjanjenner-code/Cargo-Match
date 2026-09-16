import {
  type AisExternalIdentifier,
  type AisExternalIdentifierType,
  type AisProviderRequest,
} from "./model";

export type JsonRecord = Record<string, unknown>;

export interface SelectedAisIdentifier {
  identifierType: AisExternalIdentifierType;
  identifierValue: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function record(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

/**
 * The two documented latest-vessel APIs accept numeric IMO/MMSI values. ENI
 * and vessel names are intentionally not used as a fallback.
 */
export function selectIdentifier(
  request: AisProviderRequest,
  provider: string,
  supportedTypes: readonly AisExternalIdentifierType[],
): SelectedAisIdentifier | null {
  // Canonical identifiers are provider-neutral. An identity containing
  // conflicting verified values must never be made deterministic by choosing
  // whichever value happens to be listed first.
  if (hasAmbiguousVerifiedCanonicalIdentifier(request)) return null;
  const candidates = request.vessel.externalIdentifiers ?? [];
  for (const supportedType of supportedTypes) {
    const candidate = candidates.find(
      (identifier) =>
        identifier.verified === true &&
        identifier.identifierType === supportedType &&
        providerMatches(identifier, provider) &&
        isNumericIdentifier(identifier.identifierValue),
    );
    if (candidate) {
      return {
        identifierType: candidate.identifierType,
        identifierValue: candidate.identifierValue.trim(),
      };
    }
  }
  return null;
}

export function providerMatches(
  identifier: AisExternalIdentifier,
  provider: string,
): boolean {
  if (
    identifier.identifierType === "MMSI" ||
    identifier.identifierType === "IMO" ||
    identifier.identifierType === "ENI"
  ) {
    return true;
  }
  if (!identifier.provider) return true;
  return identifier.provider.trim().toLowerCase() === provider.trim().toLowerCase();
}

function verifiedNumericValues(
  request: AisProviderRequest,
  identifierType: AisExternalIdentifierType,
): string[] {
  return [
    ...new Set(
      (request.vessel.externalIdentifiers ?? [])
        .filter(
          (identifier) =>
            identifier.verified === true &&
            identifier.identifierType === identifierType &&
            isNumericIdentifier(identifier.identifierValue),
        )
        .map((identifier) => identifier.identifierValue.trim()),
    ),
  ];
}

function hasAmbiguousVerifiedCanonicalIdentifier(
  request: AisProviderRequest,
): boolean {
  return (["MMSI", "IMO", "ENI"] as const).some(
    (identifierType) => verifiedNumericValues(request, identifierType).length > 1,
  );
}

/**
 * Validate every canonical identifier emitted by a provider against every
 * verified mapping of that type. Canonical mappings intentionally ignore the
 * provider evidence label, because MMSI/IMO/ENI identify the vessel rather
 * than a provider's record.
 */
export function matchesVerifiedCanonicalIdentifiers(
  recordValue: JsonRecord,
  request: AisProviderRequest,
): boolean {
  for (const identifierType of ["MMSI", "IMO"] as const) {
    const expected = verifiedNumericValues(request, identifierType);
    if (expected.length === 0) continue;
    const actual = stringField(recordValue[identifierType]);
    if (actual !== null && !expected.includes(actual)) return false;
  }
  return true;
}

function isNumericIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9]+$/.test(value.trim()) &&
    value.trim().length > 0
  );
}

export function firstArrayRecord(value: unknown): JsonRecord | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return record(value[0]);
}

export function stringField(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function numberField(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function timestampField(
  value: unknown,
  assumeUtc = false,
): string | null {
  const text = stringField(value);
  if (!text) return null;
  const normalizedText =
    assumeUtc && !hasTimezone(text) ? `${text}Z` : text;
  const date = new Date(normalizedText);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hasTimezone(value: string): boolean {
  return (
    /(?:Z|UTC|GMT)$/i.test(value) ||
    /[+-]\d{2}:?\d{2}$/.test(value)
  );
}

export function sameNumericIdentifier(
  value: unknown,
  expected: string,
): boolean {
  const actual = stringField(value);
  return actual !== null && actual === expected;
}

export type ConnectorFetch = typeof fetch;

export interface ConnectorResponse {
  status: number;
  json(): Promise<unknown>;
}

export async function fetchJson(
  fetchImpl: ConnectorFetch,
  url: URL,
  signal?: AbortSignal,
): Promise<
  | { kind: "response"; response: ConnectorResponse }
  | { kind: "unavailable" }
> {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal,
    });
    return { kind: "response", response };
  } catch {
    // Never return the URL or request options: provider credentials must not
    // reach logs or user-visible AIS attempts.
    return { kind: "unavailable" };
  }
}

export function httpResult(status: number):
  | "ok"
  | "not_found"
  | "rate_limited"
  | "authentication_failed"
  | "unavailable" {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "authentication_failed";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "unavailable";
}