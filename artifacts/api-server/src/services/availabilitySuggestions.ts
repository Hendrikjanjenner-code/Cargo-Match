import { and, asc, eq, isNotNull } from "drizzle-orm";
import { createHash } from "node:crypto";

import {
  availabilitySuggestionsTable,
  vesselExternalIdentifiersTable,
} from "@workspace/db";

const EXPLANATION =
  "Manual operational plan supplied by the vessel operator; dates are uncertain and are not an ETA prediction.";
const UNKNOWNS = [
  "free tonnes",
  "commercial availability",
  "actual unloading",
  "ETA",
];

export type VerifiedSuggestionIdentity = {
  mappingId: string;
  revision: string;
};

/**
 * This is intentionally the same revision material used by the provider
 * identity gate. It must be called from the conversion transaction after
 * lockDomain, never from a provider request.
 */
export async function verifiedSuggestionIdentity(
  executor: any,
  companyId: string,
  vesselId: string,
): Promise<VerifiedSuggestionIdentity | null> {
  const rows = await executor
    .select()
    .from(vesselExternalIdentifiersTable)
    .where(
      and(
        eq(vesselExternalIdentifiersTable.companyId, companyId),
        eq(vesselExternalIdentifiersTable.vesselId, vesselId),
        eq(vesselExternalIdentifiersTable.verified, true),
        isNotNull(vesselExternalIdentifiersTable.operatorReviewedAt),
        isNotNull(vesselExternalIdentifiersTable.verifiedAt),
      ),
    )
    .orderBy(asc(vesselExternalIdentifiersTable.createdAt));
  if (!rows.length) return null;
  const canonicalMappings = rows
    .map((row: typeof vesselExternalIdentifiersTable.$inferSelect) => ({
      id: row.id,
      identifierType: row.identifierType,
      identifierValue: row.identifierValue,
      provider: row.provider,
      updatedAt: row.updatedAt.toISOString(),
      operatorReviewedAt: row.operatorReviewedAt?.toISOString() ?? null,
    }))
    .sort((left: { id: string }, right: { id: string }) =>
      left.id.localeCompare(right.id),
    );
  return {
    mappingId: canonicalMappings[0].id,
    revision: createHash("sha256")
      .update(JSON.stringify(canonicalMappings))
      .digest("hex"),
  };
}

export function suggestionResponse(
  row: typeof availabilitySuggestionsTable.$inferSelect,
  now: Date,
  identity: VerifiedSuggestionIdentity | null,
  vesselActive: boolean,
  locationActive: boolean,
) {
  let status: "PENDING" | "DISMISSED" | "CONVERTED" | "EXPIRED" | "INVALIDATED" =
    row.status;
  if (row.status === "PENDING") {
    if (now >= row.expiresAt) status = "EXPIRED";
    else if (
      !vesselActive ||
      !locationActive ||
      !identity ||
      identity.revision !== row.identityMappingRevision ||
      row.expectedAvailableFrom <= now ||
      row.expectedAvailableUntil <= row.expectedAvailableFrom
    ) {
      status = "INVALIDATED";
    }
  }
  return {
    id: row.id,
    vesselId: row.vesselId,
    locationId: row.locationId,
    expectedAvailableFrom: row.expectedAvailableFrom,
    expectedAvailableUntil: row.expectedAvailableUntil,
    sourceReference: row.sourceReference,
    sourceObservedAt: row.sourceObservedAt,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    status,
    uncertainty: "UNCERTAIN" as const,
    explanation: EXPLANATION,
    unknowns: UNKNOWNS,
    capacityOfferId: row.capacityOfferId,
    canConfirm: status === "PENDING",
  };
}

export { EXPLANATION, UNKNOWNS };