import {
  CreateAvailabilitySuggestionBody,
  CreateAvailabilitySuggestionResponse,
  DismissAvailabilitySuggestionParams,
  DismissAvailabilitySuggestionResponse,
  ListMyAvailabilitySuggestionsQueryParams,
  ListMyAvailabilitySuggestionsResponse,
} from "@workspace/api-zod";
import { and, count, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";

import {
  availabilitySuggestionsTable,
  db,
  locationsTable,
  vesselsTable,
} from "@workspace/db";

import {
  error,
  getMembershipWithin,
  pageParams,
  requireMembership,
} from "../lib/http";
import { lockDomain } from "../services/matching";
import {
  suggestionResponse,
  verifiedSuggestionIdentity,
} from "../services/availabilitySuggestions";

const router: IRouter = Router();

function noStore(res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Cookie, Authorization");
}

async function decorate(
  row: typeof availabilitySuggestionsTable.$inferSelect,
  executor: any,
  now = new Date(),
) {
  const [vessel] = await executor
    .select({ active: vesselsTable.active })
    .from(vesselsTable)
    .where(eq(vesselsTable.id, row.vesselId));
  const [location] = await executor
    .select({ active: locationsTable.active })
    .from(locationsTable)
    .where(eq(locationsTable.id, row.locationId));
  const identity = await verifiedSuggestionIdentity(
    executor,
    row.companyId,
    row.vesselId,
  );
  return suggestionResponse(
    row,
    now,
    identity,
    vessel?.active === true,
    location?.active === true,
  );
}

router.get("/availability-suggestions", async (req, res) => {
  noStore(res);
  const current = await requireMembership(req, res, {
    roles: ["OWNER", "ADMIN"],
  });
  if (!current) return;
  const parsed = ListMyAvailabilitySuggestionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    error(res, 400, "Invalid availability suggestion filters");
    return;
  }
  const { page, pageSize, offset } = pageParams(
    parsed.data.page,
    parsed.data.pageSize,
  );
  const where = eq(
    availabilitySuggestionsTable.companyId,
    current.company.id,
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(availabilitySuggestionsTable)
      .where(where)
      .orderBy(
        desc(availabilitySuggestionsTable.createdAt),
        desc(availabilitySuggestionsTable.id),
      )
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(availabilitySuggestionsTable)
      .where(where),
  ]);
  const items = await Promise.all(rows.map((row) => decorate(row, db)));
  const stillAuthorized = await getMembershipWithin(db, req.user!.id);
  if (
    !stillAuthorized ||
    !stillAuthorized.membership.active ||
    !["OWNER", "ADMIN"].includes(stillAuthorized.membership.role) ||
    stillAuthorized.company.status !== "ACTIVE" ||
    stillAuthorized.company.id !== current.company.id
  ) {
    error(res, 403, "Company membership is no longer authorized");
    return;
  }
  res.json(
    ListMyAvailabilitySuggestionsResponse.parse({
      items,
      page,
      pageSize,
      total,
    }),
  );
});

router.post("/availability-suggestions", async (req, res) => {
  noStore(res);
  const current = await requireMembership(req, res, {
    roles: ["OWNER", "ADMIN"],
  });
  if (!current) return;
  const parsed = CreateAvailabilitySuggestionBody.safeParse(req.body);
  if (!parsed.success) {
    error(res, 400, "Invalid operational availability plan");
    return;
  }
  const now = new Date();
  const sourceReference = parsed.data.sourceReference.trim();
  if (
    !sourceReference ||
    parsed.data.expectedAvailableFrom <= now ||
    parsed.data.expectedAvailableUntil <= now ||
    parsed.data.expectedAvailableFrom >= parsed.data.expectedAvailableUntil ||
    parsed.data.sourceObservedAt > now ||
    now.getTime() - parsed.data.sourceObservedAt.getTime() > 24 * 60 * 60 * 1000
  ) {
    error(res, 400, "Availability plan dates or recent source observation are invalid");
    return;
  }
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const membership = await getMembershipWithin(tx, req.user!.id, true);
    if (
      !membership ||
      !membership.membership.active ||
      !["OWNER", "ADMIN"].includes(membership.membership.role) ||
      membership.company.status !== "ACTIVE"
    ) {
      return { kind: "forbidden" as const };
    }
    const [vessel] = await tx
      .select()
      .from(vesselsTable)
      .where(
        and(
          eq(vesselsTable.id, parsed.data.vesselId),
          eq(vesselsTable.companyId, membership.company.id),
          eq(vesselsTable.active, true),
        ),
      )
      .for("update");
    if (!vessel) return { kind: "invalid-vessel" as const };
    const [location] = await tx
      .select({ id: locationsTable.id })
      .from(locationsTable)
      .where(
        and(
          eq(locationsTable.id, parsed.data.locationId),
          eq(locationsTable.active, true),
        ),
      )
      .for("update");
    if (!location) return { kind: "invalid-location" as const };
    const identity = await verifiedSuggestionIdentity(
      tx,
      membership.company.id,
      vessel.id,
    );
    if (!identity) return { kind: "invalid-identity" as const };
    const [created] = await tx
      .insert(availabilitySuggestionsTable)
      .values({
        companyId: membership.company.id,
        vesselId: vessel.id,
        locationId: location.id,
        createdBy: req.user!.id,
        expectedAvailableFrom: parsed.data.expectedAvailableFrom,
        expectedAvailableUntil: parsed.data.expectedAvailableUntil,
        sourceReference,
        sourceObservedAt: parsed.data.sourceObservedAt,
        participationConfirmed: true,
        sourceUseConfirmed: true,
        uncertaintyAcknowledged: true,
        identityMappingId: identity.mappingId,
        identityMappingRevision: identity.revision,
        expiresAt: new Date(
          Math.min(
            now.getTime() + 24 * 60 * 60 * 1000,
            parsed.data.expectedAvailableUntil.getTime(),
          ),
        ),
      })
      .returning();
    return created
      ? { kind: "created" as const, suggestion: created }
      : { kind: "failed" as const };
  });
  if (result.kind === "forbidden") {
    error(res, 403, "Company membership is no longer authorized");
    return;
  }
  if (result.kind === "invalid-vessel") {
    error(res, 400, "Vessel is not active or is not owned by the company");
    return;
  }
  if (result.kind === "invalid-location") {
    error(res, 400, "Unknown or inactive catalogue location");
    return;
  }
  if (result.kind === "invalid-identity") {
    error(res, 409, "An independently reviewed active AIS identity is required");
    return;
  }
  if (result.kind !== "created") {
    error(res, 500, "Availability suggestion could not be created");
    return;
  }
  res
    .status(201)
    .json(
      CreateAvailabilitySuggestionResponse.parse(
        await decorate(result.suggestion, db, now),
      ),
    );
});

router.post("/availability-suggestions/:suggestionId/dismiss", async (req, res) => {
  noStore(res);
  const current = await requireMembership(req, res, {
    roles: ["OWNER", "ADMIN"],
  });
  if (!current) return;
  const params = DismissAvailabilitySuggestionParams.safeParse(req.params);
  if (!params.success) {
    error(res, 400, "Invalid availability suggestion id");
    return;
  }
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const membership = await getMembershipWithin(tx, req.user!.id, true);
    if (
      !membership ||
      !membership.membership.active ||
      !["OWNER", "ADMIN"].includes(membership.membership.role) ||
      membership.company.status !== "ACTIVE"
    ) {
      return { kind: "forbidden" as const };
    }
    const [existing] = await tx
      .select()
      .from(availabilitySuggestionsTable)
      .where(
        and(
          eq(availabilitySuggestionsTable.id, params.data.suggestionId),
          eq(availabilitySuggestionsTable.companyId, membership.company.id),
        ),
      )
      .for("update");
    if (!existing) return { kind: "missing" as const };
    if (existing.status !== "PENDING" || existing.expiresAt <= new Date()) {
      return { kind: "conflict" as const };
    }
    const [updated] = await tx
      .update(availabilitySuggestionsTable)
      .set({ status: "DISMISSED", reviewedAt: new Date() })
      .where(eq(availabilitySuggestionsTable.id, existing.id))
      .returning();
    return updated
      ? { kind: "dismissed" as const, suggestion: updated }
      : { kind: "missing" as const };
  });
  if (result.kind === "forbidden") {
    error(res, 403, "Company membership is no longer authorized");
    return;
  }
  if (result.kind === "missing") {
    error(res, 404, "Availability suggestion not found");
    return;
  }
  if (result.kind === "conflict") {
    error(res, 409, "Availability suggestion is no longer pending");
    return;
  }
  res.json(
    DismissAvailabilitySuggestionResponse.parse(
      await decorate(result.suggestion, db),
    ),
  );
});

export default router;