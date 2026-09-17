import {
  ListMyCapacityResponse,
  ListMyCargoResponse,
  CloseMyCapacityParams,
  CloseMyCapacityResponse,
  CloseMyCargoParams,
  CloseMyCargoResponse,
  CreateMyCapacityBody,
  CreateMyCapacityResponse,
  CreateMyCargoBody,
  CreateMyCargoResponse,
  GetMyCapacityParams,
  GetMyCapacityResponse,
  GetMyCargoParams,
  GetMyCargoResponse,
  ListMyCapacityQueryParams,
  ListMyCargoQueryParams,
  UpdateMyCapacityBody,
  UpdateMyCapacityParams,
  UpdateMyCapacityResponse,
  UpdateMyCargoBody,
  UpdateMyCargoParams,
  UpdateMyCargoResponse,
  WithdrawMyCapacityParams,
  WithdrawMyCapacityResponse,
  WithdrawMyCargoParams,
  WithdrawMyCargoResponse,
} from "@workspace/api-zod";
import {
  and,
  count,
  eq,
  inArray,
} from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  capacityOffersTable,
  cargoListingsTable,
  deepseaCapacityExtensionsTable,
  deepseaCargoRequirementsTable,
  deepseaVesselProfilesTable,
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
import { capacityResponse, cargoResponse } from "../lib/privacy";
import {
  lockDomain,
  isCapacityWithinVessel,
  recalculateMatchesWithin,
} from "../services/matching";
import {
  deepseaDetailsForCapacity,
  deepseaDetailsForCargo,
  replaceDeepseaCapacityExtension,
  replaceDeepseaCargoRequirement,
  validateDeepseaCargoRequirement,
} from "../services/deepsea";

const router: IRouter = Router();

function dateOnly(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : value === null ? null : undefined;
}

function validWindow(from: Date, until: Date) {
  return from.getTime() < until.getTime();
}

function validListingTransition(
  current: "DRAFT" | "ACTIVE" | "WITHDRAWN" | "EXPIRED" | "CLOSED",
  next: "DRAFT" | "ACTIVE" | "WITHDRAWN" | "EXPIRED" | "CLOSED",
) {
  if (current === "DRAFT") return next === "DRAFT" || next === "ACTIVE";
  if (current === "ACTIVE") {
    return next === "ACTIVE" || next === "WITHDRAWN" || next === "CLOSED";
  }
  return current === next;
}

async function listingWriteMembership(tx: any, userId: string) {
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

router.get("/cargo", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = ListMyCargoQueryParams.safeParse(req.query);
  if (!parsed.success) {
    error(res, 400, "Invalid cargo filters");
    return;
  }
  const { page, pageSize, offset } = pageParams(
    parsed.data.page,
    parsed.data.pageSize,
  );
  const where = parsed.data.listingStatus
    ? and(
        eq(cargoListingsTable.companyId, current.company.id),
        eq(cargoListingsTable.listingStatus, parsed.data.listingStatus),
        eq(cargoListingsTable.transportMode, parsed.data.transportMode ?? "INLAND_WATERWAY"),
      )
    : and(
        eq(cargoListingsTable.companyId, current.company.id),
        eq(cargoListingsTable.transportMode, parsed.data.transportMode ?? "INLAND_WATERWAY"),
      );
  const [items, [{ total }]] = await Promise.all([
    db.select().from(cargoListingsTable).where(where).limit(pageSize).offset(offset),
    db.select({ total: count() }).from(cargoListingsTable).where(where),
  ]);
  const requirements = await db
    .select()
    .from(deepseaCargoRequirementsTable)
    .where(inArray(deepseaCargoRequirementsTable.cargoListingId, items.map((item) => item.id)));
  const requirementByCargo = new Map(
    requirements.map((requirement) => [requirement.cargoListingId, requirement]),
  );
  res.json(
    ListMyCargoResponse.parse({
      items: items.map((item) => cargoResponse(item, requirementByCargo.get(item.id))),
      page,
      pageSize,
      total,
    }),
  );
});

router.post("/cargo", async (req, res) => {
  const current = await requireMembership(req, res, {
    roles: ["OWNER", "ADMIN"],
  });
  if (!current) return;
  const parsed = CreateMyCargoBody.safeParse(req.body);
  if (!parsed.success || !validWindow(parsed.data.loadingFrom, parsed.data.loadingUntil)) {
    error(res, 400, "Invalid cargo data or loading window");
    return;
  }
  if (
    parsed.data.transportMode === "DEEPSEA_BULK" &&
    !validateDeepseaCargoRequirement(parsed.data.deepseaRequirement)
  ) {
    error(res, 400, "Deepsea cargo requires valid deepsea requirements");
    return;
  }
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const writeMembership = await listingWriteMembership(tx, req.user!.id);
    if (!writeMembership) return { kind: "forbidden" as const };
    const locations = await tx
      .select({ id: locationsTable.id })
      .from(locationsTable)
      .where(
        and(
          inArray(locationsTable.id, [
            parsed.data.loadingLocationId,
            parsed.data.destinationLocationId,
          ]),
          eq(locationsTable.active, true),
        ),
      )
      .for("update");
    if (locations.length !== 2) {
      return { kind: "invalid-location" as const };
    }
    const { deepseaRequirement, ...base } = parsed.data;
    const [created] = await tx
      .insert(cargoListingsTable)
      .values({
        ...base,
        transportMode: base.transportMode ?? "INLAND_WATERWAY",
        companyId: writeMembership.company.id,
        expectedUnloadingDate: dateOnly(parsed.data.expectedUnloadingDate),
      })
      .returning();
    if (created && deepseaRequirement) {
      await replaceDeepseaCargoRequirement(tx, created.id, deepseaRequirement);
    }
    if (created.listingStatus === "ACTIVE") {
      await recalculateMatchesWithin(tx, { changedCargoIds: [created.id] });
    }
    return { kind: "created" as const, cargo: created };
  });
  if (result.kind === "forbidden") {
    error(res, 403, "Company membership is no longer authorized");
    return;
  }
  if (result.kind === "invalid-location") {
    error(res, 400, "Unknown or inactive catalogue location");
    return;
  }
  res
    .status(201)
    .json(
      CreateMyCargoResponse.parse(
        cargoResponse(
          result.cargo,
          await deepseaDetailsForCargo(db, result.cargo.id),
        ),
      ),
    );
});

router.get("/cargo/:cargoId", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = GetMyCargoParams.safeParse(req.params);
  if (!parsed.success) {
    error(res, 400, "Invalid cargo id");
    return;
  }
  const [existing] = await db
    .select()
    .from(cargoListingsTable)
    .where(
      and(
        eq(cargoListingsTable.id, parsed.data.cargoId),
        eq(cargoListingsTable.companyId, current.company.id),
      ),
    );
  if (!existing) {
    error(res, 404, "Cargo listing not found");
    return;
  }
  const [cargo] = await db
    .select()
    .from(cargoListingsTable)
    .where(
      and(
        eq(cargoListingsTable.id, parsed.data.cargoId),
        eq(cargoListingsTable.companyId, current.company.id),
      ),
    );
  if (!cargo) {
    error(res, 404, "Cargo listing not found");
    return;
  }
  res.json(
    GetMyCargoResponse.parse(
      cargoResponse(cargo, await deepseaDetailsForCargo(db, cargo.id)),
    ),
  );
});

router.patch("/cargo/:cargoId", async (req, res) => {
  const current = await requireMembership(req, res, {
    roles: ["OWNER", "ADMIN"],
  });
  if (!current) return;
  const params = UpdateMyCargoParams.safeParse(req.params);
  const parsed = UpdateMyCargoBody.safeParse(req.body);
  if (!params.success || !parsed.success || Object.keys(parsed.data).length === 0) {
    error(res, 400, "Invalid cargo data");
    return;
  }
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const writeMembership = await listingWriteMembership(tx, req.user!.id);
    if (!writeMembership) return { kind: "forbidden" as const };
    const [existing] = await tx
      .select()
      .from(cargoListingsTable)
      .where(
        and(
          eq(cargoListingsTable.id, params.data.cargoId),
          eq(cargoListingsTable.companyId, writeMembership.company.id),
        ),
      )
      .for("update");
    if (!existing) return { kind: "missing" as const };
    const nextMode = parsed.data.transportMode ?? existing.transportMode;
    if (nextMode === "DEEPSEA_BULK") {
      const requirement =
        parsed.data.deepseaRequirement === undefined
          ? await deepseaDetailsForCargo(tx, existing.id)
          : parsed.data.deepseaRequirement;
      if (!validateDeepseaCargoRequirement(requirement)) {
        return { kind: "invalid-deepsea-requirement" as const };
      }
    }
    const loadingFrom = parsed.data.loadingFrom ?? existing.loadingFrom;
    const loadingUntil = parsed.data.loadingUntil ?? existing.loadingUntil;
    const nextStatus = parsed.data.listingStatus ?? existing.listingStatus;
    if (!validListingTransition(existing.listingStatus, nextStatus)) {
      return { kind: "invalid-transition" as const };
    }
    if (!validWindow(loadingFrom, loadingUntil)) {
      return { kind: "invalid-window" as const };
    }
    const locationIds = [
      parsed.data.loadingLocationId,
      parsed.data.destinationLocationId,
    ].filter((id): id is string => !!id);
    if (locationIds.length) {
      const locations = await tx
        .select({ id: locationsTable.id })
        .from(locationsTable)
        .where(
          and(
            inArray(locationsTable.id, locationIds),
            eq(locationsTable.active, true),
          ),
        )
        .for("update");
      if (locations.length !== locationIds.length) {
        return { kind: "invalid-location" as const };
      }
    }
    const { deepseaRequirement, ...base } = parsed.data;
    const [updated] = await tx
      .update(cargoListingsTable)
      .set({
        ...base,
        transportMode: nextMode,
        expectedUnloadingDate: dateOnly(parsed.data.expectedUnloadingDate),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(cargoListingsTable.id, params.data.cargoId),
          eq(cargoListingsTable.companyId, writeMembership.company.id),
        ),
      )
      .returning();
    if (updated) {
      if (nextMode === "DEEPSEA_BULK") {
        if (deepseaRequirement !== undefined) {
          await replaceDeepseaCargoRequirement(tx, updated.id, deepseaRequirement);
        }
      } else {
        await replaceDeepseaCargoRequirement(tx, updated.id, null);
      }
      await recalculateMatchesWithin(tx, { changedCargoIds: [updated.id] });
    }
    return updated
      ? { kind: "updated" as const, cargo: updated }
      : { kind: "missing" as const };
  });
  if (result.kind === "forbidden") {
    error(res, 403, "Company membership is no longer authorized");
    return;
  }
  if (result.kind === "missing") {
    error(res, 404, "Cargo listing not found");
    return;
  }
  if (result.kind === "invalid-deepsea-requirement") {
    error(res, 400, "Deepsea cargo requires valid deepsea requirements");
    return;
  }
  if (result.kind === "invalid-transition") {
    error(res, 409, "Listing status transition is not allowed");
    return;
  }
  if (result.kind === "invalid-window") {
    error(res, 400, "Invalid loading window");
    return;
  }
  if (result.kind === "invalid-location") {
    error(res, 400, "Unknown or inactive catalogue location");
    return;
  }
  res.json(
    UpdateMyCargoResponse.parse(
      cargoResponse(
        result.cargo,
        await deepseaDetailsForCargo(db, result.cargo.id),
      ),
    ),
  );
});

async function setCargoStatus(
  req: Request,
  res: Response,
  status: "WITHDRAWN" | "CLOSED",
) {
  const current = await requireMembership(req, res, {
    roles: ["OWNER", "ADMIN"],
  });
  if (!current) return;
  const parsed =
    status === "WITHDRAWN"
      ? WithdrawMyCargoParams.safeParse(req.params)
      : CloseMyCargoParams.safeParse(req.params);
  if (!parsed.success) {
    error(res, 400, "Invalid cargo id");
    return;
  }
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const writeMembership = await listingWriteMembership(tx, req.user!.id);
    if (!writeMembership) return { kind: "forbidden" as const };
    const [existing] = await tx
      .select()
      .from(cargoListingsTable)
      .where(
        and(
          eq(cargoListingsTable.id, parsed.data.cargoId),
          eq(cargoListingsTable.companyId, writeMembership.company.id),
        ),
      )
      .for("update");
    if (!existing) return { kind: "missing" as const };
    if (!validListingTransition(existing.listingStatus, status)) {
      return { kind: "invalid" as const };
    }
    const [updated] = await tx
      .update(cargoListingsTable)
      .set({ listingStatus: status, updatedAt: new Date() })
      .where(eq(cargoListingsTable.id, existing.id))
      .returning();
    if (updated) {
      await recalculateMatchesWithin(tx, { changedCargoIds: [updated.id] });
    }
    return { kind: "updated" as const, cargo: updated };
  });
  if (result.kind === "forbidden") {
    error(res, 403, "Company membership is no longer authorized");
    return;
  }
  if (result.kind === "missing") {
    error(res, 404, "Cargo listing not found");
    return;
  }
  if (result.kind === "invalid" || !result.cargo) {
    error(res, 409, "Listing status transition is not allowed");
    return;
  }
  const cargo = result.cargo;
  const response =
    status === "WITHDRAWN"
      ? WithdrawMyCargoResponse
      : CloseMyCargoResponse;
  res.json(
    response.parse(
      cargoResponse(cargo, await deepseaDetailsForCargo(db, cargo.id)),
    ),
  );
}

router.post("/cargo/:cargoId/withdraw", (req, res) =>
  setCargoStatus(req, res, "WITHDRAWN"),
);
router.post("/cargo/:cargoId/close", (req, res) =>
  setCargoStatus(req, res, "CLOSED"),
);

router.get("/capacity", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = ListMyCapacityQueryParams.safeParse(req.query);
  if (!parsed.success) {
    error(res, 400, "Invalid capacity filters");
    return;
  }
  const { page, pageSize, offset } = pageParams(
    parsed.data.page,
    parsed.data.pageSize,
  );
  const where = parsed.data.listingStatus
    ? and(
        eq(capacityOffersTable.companyId, current.company.id),
        eq(capacityOffersTable.listingStatus, parsed.data.listingStatus),
        eq(capacityOffersTable.transportMode, parsed.data.transportMode ?? "INLAND_WATERWAY"),
      )
    : and(
        eq(capacityOffersTable.companyId, current.company.id),
        eq(capacityOffersTable.transportMode, parsed.data.transportMode ?? "INLAND_WATERWAY"),
      );
  const [items, [{ total }]] = await Promise.all([
    db.select().from(capacityOffersTable).where(where).limit(pageSize).offset(offset),
    db.select({ total: count() }).from(capacityOffersTable).where(where),
  ]);
  const extensions = await db
    .select()
    .from(deepseaCapacityExtensionsTable)
    .where(inArray(deepseaCapacityExtensionsTable.capacityOfferId, items.map((item) => item.id)));
  const extensionByCapacity = new Map(
    extensions.map((extension) => [extension.capacityOfferId, extension]),
  );
  res.json(
    ListMyCapacityResponse.parse({
      items: items.map((item) => capacityResponse(item, extensionByCapacity.get(item.id))),
      page,
      pageSize,
      total,
    }),
  );
});

router.post("/capacity", async (req, res) => {
  const current = await requireMembership(req, res, {
    roles: ["OWNER", "ADMIN"],
  });
  if (!current) return;
  const parsed = CreateMyCapacityBody.safeParse(req.body);
  if (
    !parsed.success ||
    !validWindow(parsed.data.availableFrom, parsed.data.availableUntil)
  ) {
    error(res, 400, "Invalid capacity data or availability window");
    return;
  }
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const writeMembership = await listingWriteMembership(tx, req.user!.id);
    if (!writeMembership) return { kind: "forbidden" as const };
    const [vessel] = await tx
      .select()
      .from(vesselsTable)
      .where(
        and(
          eq(vesselsTable.id, parsed.data.vesselId),
          eq(vesselsTable.companyId, writeMembership.company.id),
          eq(vesselsTable.active, true),
        ),
      )
      .for("update");
    if (!vessel) return { kind: "invalid-vessel" as const };
    const requestedMode = parsed.data.transportMode ?? "INLAND_WATERWAY";
    if (vessel.transportMode !== requestedMode) {
      return { kind: "mode-mismatch" as const };
    }
    if (requestedMode === "DEEPSEA_BULK") {
      const [profile] = await tx
        .select()
        .from(deepseaVesselProfilesTable)
        .where(eq(deepseaVesselProfilesTable.vesselId, vessel.id))
        .for("update");
      if (!profile) return { kind: "invalid-deepsea-profile" as const };
      if (parsed.data.availableCapacityTonnes > profile.dwtTonnes) {
        return { kind: "invalid-capacity" as const };
      }
    }
    if (
      !isCapacityWithinVessel(
        parsed.data.availableCapacityTonnes,
        vessel.totalCapacityTonnes,
      )
    ) {
      return { kind: "invalid-capacity" as const };
    }
    const [location] = await tx
      .select()
      .from(locationsTable)
      .where(
        and(
          eq(locationsTable.id, parsed.data.locationId),
          eq(locationsTable.active, true),
        ),
      )
      .for("update");
    if (!location) return { kind: "invalid-location" as const };
    const { deepseaExtension, ...base } = parsed.data;
    const [created] = await tx
      .insert(capacityOffersTable)
      .values({
        ...base,
        transportMode: requestedMode,
        companyId: writeMembership.company.id,
        availabilityConfidence:
          base.availabilityConfidence ?? "CONFIRMED",
      })
      .returning();
    if (created && deepseaExtension) {
      await replaceDeepseaCapacityExtension(tx, created.id, deepseaExtension);
    }
    if (created.listingStatus === "ACTIVE") {
      await recalculateMatchesWithin(tx, { changedCapacityIds: [created.id] });
    }
    return { kind: "created" as const, capacity: created };
  });
  if (result.kind === "forbidden") {
    error(res, 403, "Company membership is no longer authorized");
    return;
  }
  if (result.kind === "invalid-vessel") {
    error(res, 400, "Vessel is not active or is not owned by the company");
    return;
  }
  if (result.kind === "mode-mismatch") {
    error(res, 400, "Capacity transport mode must match its vessel");
    return;
  }
  if (result.kind === "invalid-deepsea-profile") {
    error(res, 400, "Deepsea capacity requires a vessel profile");
    return;
  }
  if (result.kind === "invalid-capacity") {
    error(res, 400, "Offered capacity cannot exceed vessel total capacity");
    return;
  }
  if (result.kind === "invalid-location") {
    error(res, 400, "Unknown or inactive catalogue location");
    return;
  }
  res
    .status(201)
    .json(
      CreateMyCapacityResponse.parse(
        capacityResponse(
          result.capacity,
          await deepseaDetailsForCapacity(db, result.capacity.id),
        ),
      ),
    );
});

router.get("/capacity/:capacityId", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = GetMyCapacityParams.safeParse(req.params);
  if (!parsed.success) {
    error(res, 400, "Invalid capacity id");
    return;
  }
  const [existing] = await db
    .select()
    .from(capacityOffersTable)
    .where(
      and(
        eq(capacityOffersTable.id, parsed.data.capacityId),
        eq(capacityOffersTable.companyId, current.company.id),
      ),
    );
  if (!existing) {
    error(res, 404, "Capacity offer not found");
    return;
  }
  const [capacity] = await db
    .select()
    .from(capacityOffersTable)
    .where(
      and(
        eq(capacityOffersTable.id, parsed.data.capacityId),
        eq(capacityOffersTable.companyId, current.company.id),
      ),
    );
  if (!capacity) {
    error(res, 404, "Capacity offer not found");
    return;
  }
  res.json(
    GetMyCapacityResponse.parse(
      capacityResponse(
        capacity,
        await deepseaDetailsForCapacity(db, capacity.id),
      ),
    ),
  );
});

router.patch("/capacity/:capacityId", async (req, res) => {
  const current = await requireMembership(req, res, {
    roles: ["OWNER", "ADMIN"],
  });
  if (!current) return;
  const params = UpdateMyCapacityParams.safeParse(req.params);
  const parsed = UpdateMyCapacityBody.safeParse(req.body);
  if (!params.success || !parsed.success || Object.keys(parsed.data).length === 0) {
    error(res, 400, "Invalid capacity data");
    return;
  }
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const writeMembership = await listingWriteMembership(tx, req.user!.id);
    if (!writeMembership) return { kind: "forbidden" as const };
    const [existing] = await tx
      .select()
      .from(capacityOffersTable)
      .where(
        and(
          eq(capacityOffersTable.id, params.data.capacityId),
          eq(capacityOffersTable.companyId, writeMembership.company.id),
        ),
      )
      .for("update");
    if (!existing) return { kind: "missing" as const };
    const availableFrom = parsed.data.availableFrom ?? existing.availableFrom;
    const availableUntil = parsed.data.availableUntil ?? existing.availableUntil;
    const nextStatus = parsed.data.listingStatus ?? existing.listingStatus;
    const nextAvailableCapacity =
      parsed.data.availableCapacityTonnes ?? existing.availableCapacityTonnes;
    if (!validListingTransition(existing.listingStatus, nextStatus)) {
      return { kind: "invalid-transition" as const };
    }
    if (!validWindow(availableFrom, availableUntil)) {
      return { kind: "invalid-window" as const };
    }
    const nextVesselId = parsed.data.vesselId ?? existing.vesselId;
    const [vessel] = await tx
      .select()
      .from(vesselsTable)
      .where(
        and(
          eq(vesselsTable.id, nextVesselId),
          eq(vesselsTable.companyId, writeMembership.company.id),
          eq(vesselsTable.active, true),
        ),
      )
      .for("update");
    if (!vessel) return { kind: "invalid-vessel" as const };
    const nextMode = parsed.data.transportMode ?? existing.transportMode;
    if (vessel.transportMode !== nextMode) {
      return { kind: "mode-mismatch" as const };
    }
    if (nextMode === "DEEPSEA_BULK") {
      const [profile] = await tx
        .select()
        .from(deepseaVesselProfilesTable)
        .where(eq(deepseaVesselProfilesTable.vesselId, vessel.id))
        .for("update");
      if (!profile) return { kind: "invalid-deepsea-profile" as const };
      if (nextAvailableCapacity > profile.dwtTonnes) {
        return { kind: "invalid-capacity" as const };
      }
    }
    if (
      !isCapacityWithinVessel(
        nextAvailableCapacity,
        vessel.totalCapacityTonnes,
      )
    ) {
      return { kind: "invalid-capacity" as const };
    }
    if (parsed.data.locationId) {
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
    }
    const { deepseaExtension, ...base } = parsed.data;
    const [updated] = await tx
      .update(capacityOffersTable)
      .set({
        ...base,
        transportMode: nextMode,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(capacityOffersTable.id, params.data.capacityId),
          eq(capacityOffersTable.companyId, writeMembership.company.id),
        ),
      )
      .returning();
    if (updated) {
      if (nextMode === "DEEPSEA_BULK") {
        if (deepseaExtension !== undefined) {
          await replaceDeepseaCapacityExtension(tx, updated.id, deepseaExtension);
        }
      } else {
        await replaceDeepseaCapacityExtension(tx, updated.id, null);
      }
      await recalculateMatchesWithin(tx, { changedCapacityIds: [updated.id] });
    }
    return updated
      ? { kind: "updated" as const, capacity: updated }
      : { kind: "missing" as const };
  });
  if (result.kind === "forbidden") {
    error(res, 403, "Company membership is no longer authorized");
    return;
  }
  if (result.kind === "missing") {
    error(res, 404, "Capacity offer not found");
    return;
  }
  if (result.kind === "invalid-transition") {
    error(res, 409, "Listing status transition is not allowed");
    return;
  }
  if (result.kind === "invalid-window") {
    error(res, 400, "Invalid availability window");
    return;
  }
  if (result.kind === "invalid-vessel") {
    error(res, 400, "Vessel is not active or is not owned by the company");
    return;
  }
  if (result.kind === "mode-mismatch") {
    error(res, 400, "Capacity transport mode must match its vessel");
    return;
  }
  if (result.kind === "invalid-deepsea-profile") {
    error(res, 400, "Deepsea capacity requires a vessel profile");
    return;
  }
  if (result.kind === "invalid-capacity") {
    error(res, 400, "Offered capacity cannot exceed vessel total capacity");
    return;
  }
  if (result.kind === "invalid-location") {
    error(res, 400, "Unknown or inactive catalogue location");
    return;
  }
  res.json(
    UpdateMyCapacityResponse.parse(
      capacityResponse(
        result.capacity,
        await deepseaDetailsForCapacity(db, result.capacity.id),
      ),
    ),
  );
});

async function setCapacityStatus(
  req: Request,
  res: Response,
  status: "WITHDRAWN" | "CLOSED",
) {
  const current = await requireMembership(req, res, {
    roles: ["OWNER", "ADMIN"],
  });
  if (!current) return;
  const parsed =
    status === "WITHDRAWN"
      ? WithdrawMyCapacityParams.safeParse(req.params)
      : CloseMyCapacityParams.safeParse(req.params);
  if (!parsed.success) {
    error(res, 400, "Invalid capacity id");
    return;
  }
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const writeMembership = await listingWriteMembership(tx, req.user!.id);
    if (!writeMembership) return { kind: "forbidden" as const };
    const [existing] = await tx
      .select()
      .from(capacityOffersTable)
      .where(
        and(
          eq(capacityOffersTable.id, parsed.data.capacityId),
          eq(capacityOffersTable.companyId, writeMembership.company.id),
        ),
      )
      .for("update");
    if (!existing) return { kind: "missing" as const };
    if (!validListingTransition(existing.listingStatus, status)) {
      return { kind: "invalid" as const };
    }
    const [updated] = await tx
      .update(capacityOffersTable)
      .set({ listingStatus: status, updatedAt: new Date() })
      .where(eq(capacityOffersTable.id, existing.id))
      .returning();
    if (updated) {
      await recalculateMatchesWithin(tx, { changedCapacityIds: [updated.id] });
    }
    return { kind: "updated" as const, capacity: updated };
  });
  if (result.kind === "forbidden") {
    error(res, 403, "Company membership is no longer authorized");
    return;
  }
  if (result.kind === "missing") {
    error(res, 404, "Capacity offer not found");
    return;
  }
  if (result.kind === "invalid" || !result.capacity) {
    error(res, 409, "Listing status transition is not allowed");
    return;
  }
  const capacity = result.capacity;
  const response =
    status === "WITHDRAWN"
      ? WithdrawMyCapacityResponse
      : CloseMyCapacityResponse;
  res.json(
    response.parse(
      capacityResponse(
        capacity,
        await deepseaDetailsForCapacity(db, capacity.id),
      ),
    ),
  );
}

router.post("/capacity/:capacityId/withdraw", (req, res) =>
  setCapacityStatus(req, res, "WITHDRAWN"),
);
router.post("/capacity/:capacityId/close", (req, res) =>
  setCapacityStatus(req, res, "CLOSED"),
);

export default router;