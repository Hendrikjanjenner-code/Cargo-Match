import { timestampField } from "./connector-utils";

/** The API-enriched ETA includes a year and takes precedence over ETA_AIS. */
export function normalizeVesselFinderEta(
  eta: unknown,
  etaAis: unknown,
  observedAt: string | null,
): string | null {
  const fullDate = typeof eta === "string" && /^\d{4}-\d{2}-\d{2}[ T]/.test(eta.trim())
    ? timestampField(eta, true) : null;
  return fullDate ?? vesselFinderEta(etaAis, observedAt);
}

/**
 * VesselFinder reports ETA_AIS as MM-DD HH:MM, with no year. Resolve against the
 * AIS observation timestamp (not today's clock) using the nearest valid UTC
 * annual occurrence. This preserves recently overdue ETAs and rolls Dec/Jan
 * correctly. Missing/invalid anchors and ambiguous half-year dates stay null.
 */
export function vesselFinderEta(value: unknown, observedAt: string | null): string | null {
  if (typeof value !== "string" || !observedAt) return null;
  const match = /^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, monthText, dayText, hourText, minuteText] = match;
  const [month, day, hour, minute] = [monthText, dayText, hourText, minuteText].map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const anchor = new Date(observedAt);
  if (!Number.isFinite(anchor.getTime())) return null;
  const year = anchor.getUTCFullYear();
  const candidates = [year - 1, year, year + 1].map((candidateYear) => {
    const candidate = new Date(Date.UTC(candidateYear, month - 1, day, hour, minute));
    return candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day
      ? candidate : null;
  }).filter((candidate): candidate is Date => candidate !== null)
    .sort((a, b) => Math.abs(a.getTime() - anchor.getTime()) - Math.abs(b.getTime() - anchor.getTime()));
  if (!candidates[0]) return null;
  const distance = Math.abs(candidates[0].getTime() - anchor.getTime());
  if (distance > 183 * 86_400_000 ||
    (candidates[1] && distance === Math.abs(candidates[1].getTime() - anchor.getTime()))) return null;
  return candidates[0].toISOString();
}