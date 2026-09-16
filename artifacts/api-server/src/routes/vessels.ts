import {
  CreateMyVesselBody,
  CreateMyVesselResponse,
  DeactivateMyVesselParams,
  DeactivateMyVesselResponse,
  GetMyVesselParams,
  GetMyVesselResponse,
  ListMyVesselsQueryParams,
  ListMyVesselsResponse,
  UpdateMyVesselBody,
  UpdateMyVesselParams,
  UpdateMyVesselResponse,
} from "@workspace/api-zod";
import { and, count, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  capacityOffersTable,
  db,
  vesselsTable,
} from "@workspace/db";

import {
  error,
  getMembershipWithin,
  pageParams,
  requireMembership,
} from "../lib/http";
import { vesselResponse } from "../lib/privacy";
import {
  isCapacityWithinVessel,
  lockDomain,
  recalculateMatchesWithin,
} from "../services/matching";

const router: IRouter = Router();

async function vesselWriteMembership(tx: any, userId: string) {
  const current = await getMembershipWithin(tx, userId, true);
  if (
    !current ||
    !current.membership.active ||
    !["OWNER", "ADMIN"].includes(current.membership.role) ||
    current.company.status !== "ACTIVE"
  ) {
    return null;
  }
  return current;
}

router.get("/vessels", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = ListMyVesselsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    error(res, 400, "Invalid vessel filters");
    return;
  }
  const { page, pageSize, offset } = pageParams(
    parsed.data.page,
    parsed.data.pageSize,
  );
  const where = parsed.data.activeOnly
    ? and(
        eq(vesselsTable.companyId, current.company.id),
        eq(vesselsTable.active, true),
      )
    : eq(vesselsTable.companyId, current.company.id);
  const [items, [{ total }]] = await Promise.all([
    db.select().from(vesselsTable).where(where).limit(pageSize).offset(offset),
    db.select({ total: count() }).from(vesselsTable).where(where),
  ]);
  res.json(
    ListMyVesselsResponse.parse({
      items: items.map(vesselResponse),
      page,
      pageSize,
      total,
    }),
  );
});

router.post("/vessels", async (req, res) => {
  const current = await requireMembership(req, res, {
    roles: ["OWNER", "ADMIN"],
  });
  if (!current) return;
  const parsed = CreateMyVesselBody.safeParse(req.body);
  if (!parsed.success) {
    error(res, 400, "Invalid vessel data");
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      await lockDomain(tx);
      const writeMembership = await vesselWriteMembership(tx, req.user!.id);
      if (!writeMembership) return { kind: "forbidden" as const };
      const [created] = await tx
        .insert(vesselsTable)
        .values({ ...parsed.data, companyId: writeMembership.company.id })
        .returning();
      return { kind: "created" as const, vessel: created };
    });
    if (result.kind === "forbidden") {
      error(res, 403, "Company membership is no longer authorized");
      return;
    }
    res
      .status(201)
      .json(CreateMyVesselResponse.parse(vesselResponse(result.vessel)));
  } catch {
    error(res, 409, "Vessel could not be created");
  }
});

router.get("/vessels/:vesselId", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = GetMyVesselParams.safeParse(req.params);
  if (!parsed.success) {
    error(res, 400, "Invalid vessel id");
    return;
  }
  const [vessel] = await db
    .select()
    .from(vesselsTable)
    .where(
      and(
        eq(vesselsTable.id, parsed.data.vesselId),
        eq(vesselsTable.companyId, current.company.id),
      ),
    );
  if (!vessel) {
    error(res, 404, "Vessel not found");
    return;
  }
  res.json(GetMyVesselResponse.parse(vesselResponse(vessel)));
});

router.patch("/vessels/:vesselId", async (req, res) => {
  const current = await requireMembership(req, res, {
    roles: ["OWNER", "ADMIN"],
  });
  if (!current) return;
  const params = UpdateMyVesselParams.safeParse(req.params);
  const parsed = UpdateMyVesselBody.safeParse(req.body);
  if (
    !params.success ||
    !parsed.success ||
    Object.keys(parsed.data).length === 0
  ) {
    error(res, 400, "Invalid vessel data");
    return;
  }
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const writeMembership = await vesselWriteMembership(tx, req.user!.id);
    if (!writeMembership) return { kind: "forbidden" as const };
    const [existing] = await tx
      .select()
      .from(vesselsTable)
      .where(
        and(
          eq(vesselsTable.id, params.data.vesselId),
          eq(vesselsTable.companyId, writeMembership.company.id),
        ),
      )
      .for("update");
    if (!existing) return { kind: "missing" as const };
    if (!existing.active && parsed.data.active === true) {
      return { kind: "invalid" as const };
    }
    const nextTotalCapacity =
      parsed.data.totalCapacityTonnes ?? existing.totalCapacityTonnes;
    if (nextTotalCapacity < existing.totalCapacityTonnes) {
      const outstandingOffers = await tx
        .select({
          id: capacityOffersTable.id,
          availableCapacityTonnes: capacityOffersTable.availableCapacityTonnes,
        })
        .from(capacityOffersTable)
        .where(
          and(
            eq(capacityOffersTable.vesselId, existing.id),
            inArray(capacityOffersTable.listingStatus, ["DRAFT", "ACTIVE"]),
          ),
        )
        .for("update");
      if (
        outstandingOffers.some(
          (offer) =>
            !isCapacityWithinVessel(
              offer.availableCapacityTonnes,
              nextTotalCapacity,
            ),
        )
      ) {
        return { kind: "capacity-conflict" as const };
      }
    }
    const [updated] = await tx
      .update(vesselsTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(vesselsTable.id, existing.id))
      .returning();
    if (updated) {
      await recalculateMatchesWithin(tx, { changedVesselIds: [updated.id] });
    }
    return { kind: "updated" as const, vessel: updated };
  });
  if (result.kind === "forbidden") {
    error(res, 403, "Company membership is no longer authorized");
    return;
  }
  if (result.kind === "missing") {
    error(res, 404, "Vessel not found");
    return;
  }
  if (result.kind === "capacity-conflict") {
    error(
      res,
      409,
      "Vessel capacity cannot be reduced below an outstanding capacity offer",
    );
    return;
  }
  if (result.kind === "invalid" || !result.vessel) {
    error(res, 409, "Deactivated vessels cannot be reactivated");
    return;
  }
  const vessel = result.vessel;
  res.json(UpdateMyVesselResponse.parse(vesselResponse(vessel)));
});

router.post("/vessels/:vesselId/deactivate", async (req, res) => {
  const current = await requireMembership(req, res, {
    roles: ["OWNER", "ADMIN"],
  });
  if (!current) return;
  const params = DeactivateMyVesselParams.safeParse(req.params);
  if (!params.success) {
    error(res, 400, "Invalid vessel id");
    return;
  }
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const writeMembership = await vesselWriteMembership(tx, req.user!.id);
    if (!writeMembership) return { kind: "forbidden" as const };
    const [updated] = await tx
      .update(vesselsTable)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(
          eq(vesselsTable.id, params.data.vesselId),
          eq(vesselsTable.companyId, writeMembership.company.id),
        ),
      )
      .returning();
    if (updated) {
      await recalculateMatchesWithin(tx, { changedVesselIds: [updated.id] });
    }
    return updated
      ? { kind: "updated" as const, vessel: updated }
      : { kind: "missing" as const };
  });
  if (result.kind === "forbidden") {
    error(res, 403, "Company membership is no longer authorized");
    return;
  }
  if (result.kind === "missing") {
    error(res, 404, "Vessel not found");
    return;
  }
  res.json(
    DeactivateMyVesselResponse.parse(vesselResponse(result.vessel)),
  );
});

export default router;