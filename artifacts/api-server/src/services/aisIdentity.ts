import { and, asc, desc, eq, isNotNull, ne } from "drizzle-orm";
import { createHash } from "node:crypto";

import {
  companyMembersTable,
  companiesTable,
  db,
  vesselExternalIdentifiersTable,
  vesselIdentityConflictsTable,
  vesselsTable,
} from "@workspace/db";

import { lockDomain } from "./matching";
import type { AisExternalIdentifierType, AisVesselIdentity } from "./ais/model";

export const AIS_IDENTITY_IDENTIFIER_TYPES = [
  "ENI",
  "MMSI",
  "IMO",
  "VESSELFINDER_ID",
  "MARINETRAFFIC_ID",
  "OTHER",
] as const;

export type AisIdentityIdentifierType =
  (typeof AIS_IDENTITY_IDENTIFIER_TYPES)[number];

export type AisIdentityEvidence = {
  source: string;
  reference?: string;
  notes?: string;
  capturedAt?: string | Date;
};

type StoredAisIdentityEvidence = {
  source: string;
  reference?: string;
  notes?: string;
  capturedAt?: string;
};

export type AisIdentityMapping = {
  id: string;
  companyId: string;
  vesselId: string;
  identifierType: AisIdentityIdentifierType;
  identifierValue: string;
  provider: string | null;
  verified: boolean;
  evidence: StoredAisIdentityEvidence | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AisIdentityConflict = {
  id: string;
  vesselId: string;
  identifierType: AisIdentityIdentifierType;
  identifierValue: string;
  provider: string | null;
  reason: string;
  status: "OPEN" | "RESOLVED";
  createdAt: Date;
};

export type AisIdentityCollection = {
  items: AisIdentityMapping[];
  conflicts: AisIdentityConflict[];
};

export type RegisterAisIdentityInput = {
  actorUserId: string;
  companyId: string;
  vesselId: string;
  identifierType: AisIdentityIdentifierType;
  identifierValue: string;
  provider?: string | null;
  verified?: boolean;
  evidence?: AisIdentityEvidence | null;
};

export type UpdateAisIdentityInput = {
  actorUserId: string;
  companyId: string;
  vesselId: string;
  mappingId: string;
  identifierType?: AisIdentityIdentifierType;
  identifierValue?: string;
  provider?: string | null;
  verified?: boolean;
  evidence?: AisIdentityEvidence | null;
};

type IdentityExecutor = typeof db;

export class AisIdentityError extends Error {
  readonly code:
    | "INVALID_IDENTITY"
    | "MUTATION_FORBIDDEN"
    | "VESSEL_NOT_FOUND"
    | "IDENTITY_CONFLICT"
    | "IDENTITY_NOT_FOUND";

  constructor(
    code: AisIdentityError["code"],
    message: string = "AIS identity operation failed",
  ) {
    super(message);
    this.name = "AisIdentityError";
    this.code = code;
  }
}

function isIdentifierType(value: unknown): value is AisIdentityIdentifierType {
  return (
    typeof value === "string" &&
    (AIS_IDENTITY_IDENTIFIER_TYPES as readonly string[]).includes(value)
  );
}

function cleanProvider(provider: string | null | undefined): string | null {
  if (provider === undefined || provider === null || provider.trim() === "") {
    return null;
  }
  const value = provider.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) {
    throw new AisIdentityError("INVALID_IDENTITY", "Invalid AIS provider");
  }
  return value;
}

function normalizeIdentifier(
  identifierType: AisIdentityIdentifierType,
  value: string,
): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new AisIdentityError(
      "INVALID_IDENTITY",
      "AIS identifier value is invalid",
    );
  }
  if (identifierType === "ENI" && !/^[0-9]{8}$/.test(normalized)) {
    throw new AisIdentityError("INVALID_IDENTITY", "Invalid ENI");
  }
  if (identifierType === "MMSI" && !/^[0-9]{9}$/.test(normalized)) {
    throw new AisIdentityError("INVALID_IDENTITY", "Invalid MMSI");
  }
  if (identifierType === "IMO" && !/^[0-9]{7}$/.test(normalized)) {
    throw new AisIdentityError("INVALID_IDENTITY", "Invalid IMO");
  }
  // Provider identifiers are opaque stable IDs. They are never inferred from
  // a vessel name, and whitespace-only/name-only requests do not reach here.
  return normalized.toLowerCase();
}

function providerKey(
  identifierType: AisIdentityIdentifierType,
  provider: string | null,
): string {
  // ENI, MMSI, and IMO are provider-neutral. A provider supplied alongside
  // one is retained as evidence in the row but cannot create a second link.
  if (
    identifierType === "ENI" ||
    identifierType === "MMSI" ||
    identifierType === "IMO"
  ) {
    return "";
  }
  if (!provider) {
    throw new AisIdentityError(
      "INVALID_IDENTITY",
      "Provider-specific AIS identifiers require a provider",
    );
  }
  if (identifierType === "VESSELFINDER_ID" && provider !== "vesselfinder") {
    throw new AisIdentityError(
      "INVALID_IDENTITY",
      "VESSELFINDER_ID requires the VesselFinder provider",
    );
  }
  if (identifierType === "MARINETRAFFIC_ID" && provider !== "marinetraffic") {
    throw new AisIdentityError(
      "INVALID_IDENTITY",
      "MARINETRAFFIC_ID requires the MarineTraffic provider",
    );
  }
  return provider;
}

function normalizeEvidence(
  evidence: AisIdentityEvidence | null | undefined,
): StoredAisIdentityEvidence | null {
  if (evidence === undefined || evidence === null) return null;
  const source =
    typeof evidence.source === "string" ? evidence.source.trim() : "";
  if (!source || source.length > 200) {
    throw new AisIdentityError(
      "INVALID_IDENTITY",
      "Verification evidence must include a source",
    );
  }
  const result: StoredAisIdentityEvidence = { source };
  for (const field of ["reference", "notes"] as const) {
    const value = evidence[field];
    if (value !== undefined) {
      if (
        typeof value !== "string" ||
        value.length > (field === "notes" ? 2_000 : 1_000)
      ) {
        throw new AisIdentityError(
          "INVALID_IDENTITY",
          "Invalid verification evidence",
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
        "Invalid evidence timestamp",
      );
    }
    result.capturedAt = capturedAt.toISOString();
  }
  return result;
}

function prepareIdentity(input: {
  identifierType: unknown;
  identifierValue: unknown;
  provider?: string | null;
  verified?: boolean;
  evidence?: AisIdentityEvidence | null;
}) {
  if (!isIdentifierType(input.identifierType)) {
    throw new AisIdentityError(
      "INVALID_IDENTITY",
      "Invalid AIS identifier type",
    );
  }
  if (typeof input.identifierValue !== "string") {
    throw new AisIdentityError(
      "INVALID_IDENTITY",
      "Invalid AIS identifier value",
    );
  }
  const provider = cleanProvider(input.provider);
  const identifierValue = input.identifierValue.trim();
  const normalizedIdentifierValue = normalizeIdentifier(
    input.identifierType,
    identifierValue,
  );
  const keyProvider = providerKey(input.identifierType, provider);
  const evidence = normalizeEvidence(input.evidence);
  const verified = input.verified === true;
  if (verified && !evidence) {
    throw new AisIdentityError(
      "INVALID_IDENTITY",
      "Verified AIS identities require verification evidence",
    );
  }
  return {
    identifierType: input.identifierType,
    identifierValue,
    normalizedIdentifierValue,
    provider,
    providerKey: keyProvider,
    verified,
    verificationEvidence: evidence,
    verifiedAt: verified ? new Date() : null,
  };
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

function conflictResponse(
  row: typeof vesselIdentityConflictsTable.$inferSelect,
): AisIdentityConflict {
  return {
    id: row.id,
    vesselId: row.vesselId,
    identifierType: row.identifierType,
    // This value belongs to the current tenant's attempted registration. No
    // conflicting tenant's row is returned or joined by this API.
    identifierValue: row.normalizedIdentifierValue,
    provider: row.provider,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt,
  };
}

async function vesselBelongsToCompany(
  executor: IdentityExecutor | any,
  companyId: string,
  vesselId: string,
): Promise<boolean> {
  const [vessel] = await executor
    .select({ id: vesselsTable.id })
    .from(vesselsTable)
    .where(
      and(eq(vesselsTable.id, vesselId), eq(vesselsTable.companyId, companyId)),
    )
    .limit(1);
  return Boolean(vessel);
}

async function mutationAuthorized(
  executor: IdentityExecutor | any,
  actorUserId: string,
  companyId: string,
): Promise<boolean> {
  const [membership] = await executor
    .select({
      memberCompanyId: companyMembersTable.companyId,
      role: companyMembersTable.role,
      active: companyMembersTable.active,
      companyStatus: companiesTable.status,
    })
    .from(companyMembersTable)
    .innerJoin(
      companiesTable,
      eq(companiesTable.id, companyMembersTable.companyId),
    )
    .where(
      and(
        eq(companyMembersTable.userId, actorUserId),
        eq(companyMembersTable.companyId, companyId),
      ),
    )
    .for("update")
    .limit(1);
  return Boolean(
    membership &&
    membership.memberCompanyId === companyId &&
    membership.active &&
    membership.companyStatus === "ACTIVE" &&
    (membership.role === "OWNER" || membership.role === "ADMIN"),
  );
}

async function recordConflict(
  executor: IdentityExecutor | any,
  input: {
    companyId: string;
    vesselId: string;
    identifierType: AisIdentityIdentifierType;
    normalizedIdentifierValue: string;
    providerKey: string;
    provider: string | null;
    reason?: string;
  },
) {
  await executor.insert(vesselIdentityConflictsTable).values({
    companyId: input.companyId,
    vesselId: input.vesselId,
    identifierType: input.identifierType,
    normalizedIdentifierValue: input.normalizedIdentifierValue,
    providerKey: input.providerKey,
    provider: input.provider,
    reason: input.reason ?? "DUPLICATE_IDENTIFIER",
  });
}

export async function listAisIdentities(
  companyId: string,
  vesselId: string,
): Promise<AisIdentityCollection> {
  const [items, conflicts] = await Promise.all([
    db
      .select()
      .from(vesselExternalIdentifiersTable)
      .where(
        and(
          eq(vesselExternalIdentifiersTable.companyId, companyId),
          eq(vesselExternalIdentifiersTable.vesselId, vesselId),
        ),
      )
      .orderBy(asc(vesselExternalIdentifiersTable.createdAt)),
    db
      .select()
      .from(vesselIdentityConflictsTable)
      .where(
        and(
          eq(vesselIdentityConflictsTable.companyId, companyId),
          eq(vesselIdentityConflictsTable.vesselId, vesselId),
        ),
      )
      .orderBy(desc(vesselIdentityConflictsTable.createdAt))
      .limit(100),
  ]);
  return {
    items: items.map(mappingResponse),
    conflicts: conflicts.map(conflictResponse),
  };
}

export async function registerAisIdentity(
  input: RegisterAisIdentityInput,
): Promise<AisIdentityMapping> {
  if (input.verified === true) {
    throw new AisIdentityError(
      "MUTATION_FORBIDDEN",
      "Tenant members cannot verify AIS identities",
    );
  }
  const prepared = prepareIdentity({ ...input, verified: false });
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    if (!(await mutationAuthorized(tx, input.actorUserId, input.companyId))) {
      return { kind: "forbidden" as const };
    }
    if (!(await vesselBelongsToCompany(tx, input.companyId, input.vesselId))) {
      throw new AisIdentityError("VESSEL_NOT_FOUND", "Vessel not found");
    }
    // The draft unique index is tenant-local. onConflictDoNothing avoids
    // aborting the transaction, allowing the caller-local conflict audit row
    // to be written atomically when this tenant repeats a draft claim.
    const [created] = await tx
      .insert(vesselExternalIdentifiersTable)
      .values({
        companyId: input.companyId,
        vesselId: input.vesselId,
        ...prepared,
      })
      .onConflictDoNothing()
      .returning();
    if (created) {
      return { kind: "created" as const, mapping: mappingResponse(created) };
    }

    await recordConflict(tx, {
      companyId: input.companyId,
      vesselId: input.vesselId,
      identifierType: prepared.identifierType,
      normalizedIdentifierValue: prepared.normalizedIdentifierValue,
      providerKey: prepared.providerKey,
      provider: prepared.provider,
    });
    return { kind: "conflict" as const };
  });
  if (result.kind === "forbidden") {
    throw new AisIdentityError(
      "MUTATION_FORBIDDEN",
      "Company membership is no longer authorized",
    );
  }
  if (result.kind === "conflict") {
    throw new AisIdentityError(
      "IDENTITY_CONFLICT",
      "AIS identifier conflicts with an existing mapping",
    );
  }
  return result.mapping;
}

export async function updateAisIdentity(
  input: UpdateAisIdentityInput,
): Promise<AisIdentityMapping> {
  if (input.verified === true) {
    throw new AisIdentityError(
      "MUTATION_FORBIDDEN",
      "Tenant members cannot verify AIS identities",
    );
  }
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    if (!(await mutationAuthorized(tx, input.actorUserId, input.companyId))) {
      return { kind: "forbidden" as const };
    }
    const [existing] = await tx
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
    if (!existing) {
      throw new AisIdentityError(
        "IDENTITY_NOT_FOUND",
        "AIS identity not found",
      );
    }

    const keyInputChanged =
      input.identifierType !== undefined ||
      input.identifierValue !== undefined ||
      input.provider !== undefined;
    const evidenceInputChanged = input.evidence !== undefined;
    const prepared = prepareIdentity({
      identifierType: input.identifierType ?? existing.identifierType,
      identifierValue: input.identifierValue ?? existing.identifierValue,
      provider:
        input.provider !== undefined ? input.provider : existing.provider,
      // A tenant can revoke verification, but can never retain or create
      // verification when changing the key or evidence. The operator service
      // is the only path that can subsequently promote this claim.
      verified:
        input.verified === false
          ? false
          : existing.verified &&
            existing.operatorReviewedAt !== null &&
            existing.verifiedAt !== null &&
            !keyInputChanged &&
            !evidenceInputChanged,
      evidence: evidenceInputChanged
        ? input.evidence
        : keyInputChanged
          ? null
          : existing.verificationEvidence,
    });

    const keyChanged =
      keyInputChanged ||
      prepared.identifierType !== existing.identifierType ||
      prepared.normalizedIdentifierValue !==
        existing.normalizedIdentifierValue ||
      prepared.providerKey !== existing.providerKey;
    const verifiedAt = prepared.verified
      ? existing.verified
        ? (existing.verifiedAt ?? new Date())
        : new Date()
      : null;
    if (keyChanged) {
      const [conflicting] = await tx
        .select({ id: vesselExternalIdentifiersTable.id })
        .from(vesselExternalIdentifiersTable)
        .where(
          and(
            eq(vesselExternalIdentifiersTable.companyId, input.companyId),
            eq(
              vesselExternalIdentifiersTable.identifierType,
              prepared.identifierType,
            ),
            eq(
              vesselExternalIdentifiersTable.normalizedIdentifierValue,
              prepared.normalizedIdentifierValue,
            ),
            eq(
              vesselExternalIdentifiersTable.providerKey,
              prepared.providerKey,
            ),
            ne(vesselExternalIdentifiersTable.id, existing.id),
          ),
        )
        .limit(1);
      if (conflicting) {
        await recordConflict(tx, {
          companyId: input.companyId,
          vesselId: input.vesselId,
          identifierType: prepared.identifierType,
          normalizedIdentifierValue: prepared.normalizedIdentifierValue,
          providerKey: prepared.providerKey,
          provider: prepared.provider,
        });
        return { kind: "conflict" as const };
      }
    }

    // A concurrent direct writer can still win after the preflight above. A
    // nested savepoint lets us audit that race without losing the outer tx.
    const updated = await tx.transaction(async (savepoint) => {
      try {
        const [row] = await savepoint
          .update(vesselExternalIdentifiersTable)
          .set({
            identifierType: prepared.identifierType,
            identifierValue: prepared.identifierValue,
            normalizedIdentifierValue: prepared.normalizedIdentifierValue,
            provider: prepared.provider,
            providerKey: prepared.providerKey,
            verified: prepared.verified,
            verificationEvidence: prepared.verificationEvidence,
            verifiedAt,
            operatorReviewedAt:
              prepared.verified &&
              !keyInputChanged &&
              !evidenceInputChanged &&
              input.verified !== false
                ? existing.operatorReviewedAt
                : null,
            updatedAt: new Date(),
          })
          .where(eq(vesselExternalIdentifiersTable.id, existing.id))
          .returning();
        return row ? mappingResponse(row) : null;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return null;
      }
    });
    if (updated) return { kind: "updated" as const, mapping: updated };
    await recordConflict(tx, {
      companyId: input.companyId,
      vesselId: input.vesselId,
      identifierType: prepared.identifierType,
      normalizedIdentifierValue: prepared.normalizedIdentifierValue,
      providerKey: prepared.providerKey,
      provider: prepared.provider,
    });
    return { kind: "conflict" as const };
  });
  if (result.kind === "forbidden") {
    throw new AisIdentityError(
      "MUTATION_FORBIDDEN",
      "Company membership is no longer authorized",
    );
  }
  if (result.kind === "conflict") {
    throw new AisIdentityError(
      "IDENTITY_CONFLICT",
      "AIS identifier conflicts with an existing mapping",
    );
  }
  return result.mapping;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

export async function deleteAisIdentity(input: {
  actorUserId: string;
  companyId: string;
  vesselId: string;
  mappingId: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockDomain(tx);
    if (!(await mutationAuthorized(tx, input.actorUserId, input.companyId))) {
      throw new AisIdentityError(
        "MUTATION_FORBIDDEN",
        "Company membership is no longer authorized",
      );
    }
    const deleted = await tx
      .delete(vesselExternalIdentifiersTable)
      .where(
        and(
          eq(vesselExternalIdentifiersTable.id, input.mappingId),
          eq(vesselExternalIdentifiersTable.companyId, input.companyId),
          eq(vesselExternalIdentifiersTable.vesselId, input.vesselId),
        ),
      )
      .returning({ id: vesselExternalIdentifiersTable.id });
    return Boolean(deleted[0]);
  });
}

/**
 * Provider-neutral, verified-only identity used by AIS connectors. This query
 * is always tenant and vessel scoped; an unknown or cross-tenant vessel
 * returns null and is indistinguishable from a vessel without verification.
 */
export async function getVerifiedAisIdentity(
  companyId: string,
  vesselId: string,
): Promise<AisVesselIdentity | null> {
  const [vessel] = await db
    .select({ id: vesselsTable.id })
    .from(vesselsTable)
    .where(
      and(eq(vesselsTable.id, vesselId), eq(vesselsTable.companyId, companyId)),
    )
    .limit(1);
  if (!vessel) return null;

  const rows = await db
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
  if (rows.length === 0) return null;
  const canonicalMappings = rows
    .map((row) => ({
      id: row.id,
      identifierType: row.identifierType,
      identifierValue: row.identifierValue,
      provider: row.provider,
      updatedAt: row.updatedAt.toISOString(),
      operatorReviewedAt: row.operatorReviewedAt?.toISOString() ?? null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const mappingRevision = createHash("sha256")
    .update(JSON.stringify(canonicalMappings))
    .digest("hex");
  return {
    vesselId,
    tenantId: companyId,
    mappingRevision,
    externalIdentifiers: rows.map((row) => ({
      identifierType: row.identifierType as AisExternalIdentifierType,
      identifierValue: row.identifierValue,
      provider: row.provider,
      verified: true,
    })),
  };
}
