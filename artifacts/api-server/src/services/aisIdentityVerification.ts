import { and, eq, isNotNull, ne } from "drizzle-orm";

import {
  db,
  vesselExternalIdentifiersTable,
  vesselIdentityConflictsTable,
  vesselsTable,
} from "@workspace/db";

import { lockDomain } from "./matching";
import {
  AisIdentityError,
  type AisIdentityEvidence,
  type AisIdentityMapping,
} from "./aisIdentity";

/**
 * This module intentionally has no HTTP route or request-user dependency.
 * The only supported caller is the server-filesystem operator CLI, after an
 * operator has reviewed external ownership evidence.
 */
export type VerifyAisIdentityInput = {
  companyId: string;
  vesselId: string;
  mappingId: string;
  evidence: AisIdentityEvidence;
};

function normalizeOperatorEvidence(
  evidence: AisIdentityEvidence,
): NonNullable<
  typeof vesselExternalIdentifiersTable.$inferInsert.verificationEvidence
> {
  const source =
    typeof evidence.source === "string" ? evidence.source.trim() : "";
  if (!source || source.length > 200) {
    throw new AisIdentityError(
      "INVALID_IDENTITY",
      "Operator verification evidence must include a source",
    );
  }
  const result: {
    source: string;
    reference?: string;
    notes?: string;
    capturedAt?: string;
  } = { source };
  for (const field of ["reference", "notes"] as const) {
    const value = evidence[field];
    if (value !== undefined) {
      if (
        typeof value !== "string" ||
        value.length > (field === "notes" ? 2_000 : 1_000)
      ) {
        throw new AisIdentityError(
          "INVALID_IDENTITY",
          "Invalid operator verification evidence",
        );
      }
      result[field] = value.trim();
    }
  }
  if (evidence.capturedAt !== undefined) {
    const capturedAt = new Date(evidence.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) {
      throw new AisIdentityError(
        "INVALID_IDENTITY",
        "Invalid operator evidence timestamp",
      );
    }
    result.capturedAt = capturedAt.toISOString();
  }
  return result;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function mappingResponse(
  row: typeof vesselExternalIdentifiersTable.$inferSelect,
): AisIdentityMapping {
  const trusted =
    row.verified && row.operatorReviewedAt !== null && row.verifiedAt !== null;
  return {
    id: row.id,
    companyId: row.companyId,
    vesselId: row.vesselId,
    identifierType: row.identifierType,
    identifierValue: row.identifierValue,
    provider: row.provider,
    verified: trusted,
    evidence: row.verificationEvidence,
    verifiedAt: trusted ? row.verifiedAt : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function recordVerificationConflict(
  executor: any,
  mapping: typeof vesselExternalIdentifiersTable.$inferSelect,
) {
  await executor.insert(vesselIdentityConflictsTable).values({
    companyId: mapping.companyId,
    vesselId: mapping.vesselId,
    identifierType: mapping.identifierType,
    normalizedIdentifierValue: mapping.normalizedIdentifierValue,
    providerKey: mapping.providerKey,
    provider: mapping.provider,
    reason: "VERIFICATION_CONFLICT",
  });
}

export async function verifyAisIdentity(
  input: VerifyAisIdentityInput,
): Promise<AisIdentityMapping> {
  const verificationEvidence = normalizeOperatorEvidence(input.evidence);
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const [vessel] = await tx
      .select({ id: vesselsTable.id })
      .from(vesselsTable)
      .where(
        and(
          eq(vesselsTable.id, input.vesselId),
          eq(vesselsTable.companyId, input.companyId),
        ),
      )
      .for("update")
      .limit(1);
    if (!vessel) {
      throw new AisIdentityError("VESSEL_NOT_FOUND", "Vessel not found");
    }
    const [mapping] = await tx
      .select()
      .from(vesselExternalIdentifiersTable)
      .where(
        and(
          eq(vesselExternalIdentifiersTable.id, input.mappingId),
          eq(vesselExternalIdentifiersTable.companyId, input.companyId),
          eq(vesselExternalIdentifiersTable.vesselId, input.vesselId),
        ),
      )
      .for("update");
    if (!mapping) {
      throw new AisIdentityError(
        "IDENTITY_NOT_FOUND",
        "AIS identity not found",
      );
    }

    const [conflicting] = await tx
      .select()
      .from(vesselExternalIdentifiersTable)
      .where(
        and(
          eq(
            vesselExternalIdentifiersTable.identifierType,
            mapping.identifierType,
          ),
          eq(
            vesselExternalIdentifiersTable.normalizedIdentifierValue,
            mapping.normalizedIdentifierValue,
          ),
          eq(vesselExternalIdentifiersTable.providerKey, mapping.providerKey),
          eq(vesselExternalIdentifiersTable.verified, true),
          isNotNull(vesselExternalIdentifiersTable.operatorReviewedAt),
          isNotNull(vesselExternalIdentifiersTable.verifiedAt),
          ne(vesselExternalIdentifiersTable.id, mapping.id),
        ),
      )
      .for("update")
      .limit(1);
    if (conflicting) {
      await recordVerificationConflict(tx, mapping);
      return { kind: "conflict" as const };
    }

    // Keep the collision audit row in the outer transaction while allowing a
    // raced partial-index violation to be handled without aborting it.
    const verified = await tx.transaction(async (savepoint) => {
      try {
        const [updated] = await savepoint
          .update(vesselExternalIdentifiersTable)
          .set({
            verified: true,
            verificationEvidence,
            verifiedAt: new Date(),
            operatorReviewedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(vesselExternalIdentifiersTable.id, mapping.id))
          .returning();
        return updated ? mappingResponse(updated) : null;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return null;
      }
    });
    if (!verified) {
      await recordVerificationConflict(tx, mapping);
      return { kind: "conflict" as const };
    }
    return { kind: "verified" as const, mapping: verified };
  });

  if (result.kind === "conflict") {
    throw new AisIdentityError(
      "IDENTITY_CONFLICT",
      "AIS identifier conflicts with an existing mapping",
    );
  }
  return result.mapping;
}

/**
 * Filesystem-only operator remediation for an incorrect approval. This is
 * deliberately separate from tenant PATCH semantics so an operator can
 * correct a mapping without impersonating a tenant user.
 */
export async function revokeAisIdentityTrust(input: {
  companyId: string;
  vesselId: string;
  mappingId: string;
}): Promise<AisIdentityMapping> {
  return db.transaction(async (tx) => {
    await lockDomain(tx);
    const [vessel] = await tx
      .select({ id: vesselsTable.id })
      .from(vesselsTable)
      .where(
        and(
          eq(vesselsTable.id, input.vesselId),
          eq(vesselsTable.companyId, input.companyId),
        ),
      )
      .for("update")
      .limit(1);
    if (!vessel) {
      throw new AisIdentityError("VESSEL_NOT_FOUND", "Vessel not found");
    }
    const [mapping] = await tx
      .select()
      .from(vesselExternalIdentifiersTable)
      .where(
        and(
          eq(vesselExternalIdentifiersTable.id, input.mappingId),
          eq(vesselExternalIdentifiersTable.companyId, input.companyId),
          eq(vesselExternalIdentifiersTable.vesselId, input.vesselId),
        ),
      )
      .for("update");
    if (!mapping) {
      throw new AisIdentityError(
        "IDENTITY_NOT_FOUND",
        "AIS identity not found",
      );
    }
    const [revoked] = await tx
      .update(vesselExternalIdentifiersTable)
      .set({
        verified: false,
        verifiedAt: null,
        operatorReviewedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(vesselExternalIdentifiersTable.id, mapping.id))
      .returning();
    if (!revoked) {
      throw new AisIdentityError(
        "IDENTITY_NOT_FOUND",
        "AIS identity not found",
      );
    }
    return mappingResponse(revoked);
  });
}
