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
  availabilitySuggestionsTable,
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
  validateDeepseaCapacityExtension,
  validateDeepseaCargoRequirement,
} from "../services/deepsea";
import {
  suggestionResponse,
  verifiedSuggestionIdentity,
} from "../services/availabilitySuggestions";

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
  if (!parsed.success) return error(res, 400, "Invalid cargo filters");
  const { page, pageSize, offset } = pageParams(parsed.data.page, parsed.data.pageSize);
  const where = and(
    eq(cargoListingsTable.companyId, current.company.id),
    eq(cargoListingsTable.transportMode, parsed.data.transportMode ?? "INLAND_WATERWAY"),
    ...(parsed.data.listingStatus ? [eq(cargoListingsTable.listingStatus, parsed.data.listingStatus)] : []),
  );
  const [items, [{ total }]] = await Promise.all([
    db.select().from(cargoListingsTable).where(where).limit(pageSize).offset(offset),
    db.select({ total: count() }).from(cargoListingsTable).where(where),
  ]);
  const requirements = await db.select().from(deepseaCargoRequirementsTable)
    .where(inArray(deepseaCargoRequirementsTable.cargoListingId, items.map(({ id }) => id)));
  const byCargo = new Map(requirements.map((row) => [row.cargoListingId, row]));
  res.json(ListMyCargoResponse.parse({
    items: items.map((item) => cargoResponse(item, byCargo.get(item.id))),
    page, pageSize, total,
  }));
});

router.post("/cargo", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const parsed = CreateMyCargoBody.safeParse(req.body);
  if (!parsed.success || !validWindow(parsed.data.loadingFrom, parsed.data.loadingUntil)) {
    return error(res, 400, "Invalid cargo data or loading window");
  }
  if (parsed.data.transportMode === "DEEPSEA_BULK" &&
    !validateDeepseaCargoRequirement(parsed.data.deepseaRequirement)) {
    return error(res, 400, "Deepsea cargo requires valid deepsea requirements");
  }
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const membership = await listingWriteMembership(tx, req.user!.id);
    if (!membership) return { kind: "forbidden" as const };
    const locations = await tx.select({ id: locationsTable.id }).from(locationsTable).where(and(
      inArray(locationsTable.id, [parsed.data.loadingLocationId, parsed.data.destinationLocationId]),
      eq(locationsTable.active, true),
    )).for("update");
    if (locations.length !== 2) return { kind: "invalid-location" as const };
    const { deepseaRequirement, ...base } = parsed.data;
    const [cargo] = await tx.insert(cargoListingsTable).values({
      ...base,
      transportMode: base.transportMode ?? "INLAND_WATERWAY",
      companyId: membership.company.id,
      expectedUnloadingDate: dateOnly(parsed.data.expectedUnloadingDate),
    }).returning();
    if (deepseaRequirement) await replaceDeepseaCargoRequirement(tx, cargo.id, deepseaRequirement);
    if (cargo.listingStatus === "ACTIVE") {
      await recalculateMatchesWithin(tx, { changedCargoIds: [cargo.id] });
    }
    return { kind: "created" as const, cargo };
  });
  if (result.kind === "forbidden") return error(res, 403, "Company membership is no longer authorized");
  if (result.kind === "invalid-location") return error(res, 400, "Unknown or inactive catalogue location");
  res.status(201).json(CreateMyCargoResponse.parse(
    cargoResponse(result.cargo, await deepseaDetailsForCargo(db, result.cargo.id)),
  ));
});

router.get("/cargo/:cargoId", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = GetMyCargoParams.safeParse(req.params);
  if (!parsed.success) return error(res, 400, "Invalid cargo id");
  const [cargo] = await db.select().from(cargoListingsTable).where(and(
    eq(cargoListingsTable.id, parsed.data.cargoId),
    eq(cargoListingsTable.companyId, current.company.id),
  ));
  if (!cargo) return error(res, 404, "Cargo listing not found");
  res.json(GetMyCargoResponse.parse(
    cargoResponse(cargo, await deepseaDetailsForCargo(db, cargo.id)),
  ));
});

router.patch("/cargo/:cargoId", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const params = UpdateMyCargoParams.safeParse(req.params);
  const parsed = UpdateMyCargoBody.safeParse(req.body);
  if (!params.success || !parsed.success || !Object.keys(parsed.data).length) {
    return error(res, 400, "Invalid cargo data");
  }
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const membership = await listingWriteMembership(tx, req.user!.id);
    if (!membership) return { kind: "forbidden" as const };
    const [existing] = await tx.select().from(cargoListingsTable).where(and(
      eq(cargoListingsTable.id, params.data.cargoId),
      eq(cargoListingsTable.companyId, membership.company.id),
    )).for("update");
    if (!existing) return { kind: "missing" as const };
    const mode = parsed.data.transportMode ?? existing.transportMode;
    const requirement = parsed.data.deepseaRequirement === undefined
      ? await deepseaDetailsForCargo(tx, existing.id) : parsed.data.deepseaRequirement;
    if (mode === "DEEPSEA_BULK" && !validateDeepseaCargoRequirement(requirement)) {
      return { kind: "invalid-deepsea-requirement" as const };
    }
    const loadingFrom = parsed.data.loadingFrom ?? existing.loadingFrom;
    const loadingUntil = parsed.data.loadingUntil ?? existing.loadingUntil;
    const status = parsed.data.listingStatus ?? existing.listingStatus;
    if (!validListingTransition(existing.listingStatus, status)) return { kind: "invalid-transition" as const };
    if (!validWindow(loadingFrom, loadingUntil)) return { kind: "invalid-window" as const };
    const locationIds = [parsed.data.loadingLocationId, parsed.data.destinationLocationId]
      .filter((id): id is string => !!id);
    if (locationIds.length) {
      const locations = await tx.select({ id: locationsTable.id }).from(locationsTable).where(and(
        inArray(locationsTable.id, locationIds), eq(locationsTable.active, true),
      )).for("update");
      if (locations.length !== locationIds.length) return { kind: "invalid-location" as const };
    }
    const { deepseaRequirement, ...base } = parsed.data;
    const [cargo] = await tx.update(cargoListingsTable).set({
      ...base, transportMode: mode,
      expectedUnloadingDate: dateOnly(parsed.data.expectedUnloadingDate),
      updatedAt: new Date(),
    }).where(and(
      eq(cargoListingsTable.id, existing.id),
      eq(cargoListingsTable.companyId, membership.company.id),
    )).returning();
    if (!cargo) return { kind: "missing" as const };
    if (mode === "DEEPSEA_BULK") {
      if (deepseaRequirement !== undefined) await replaceDeepseaCargoRequirement(tx, cargo.id, deepseaRequirement);
    } else {
      await replaceDeepseaCargoRequirement(tx, cargo.id, null);
    }
    await recalculateMatchesWithin(tx, { changedCargoIds: [cargo.id] });
    return { kind: "updated" as const, cargo };
  });
  if (result.kind === "forbidden") return error(res, 403, "Company membership is no longer authorized");
  if (result.kind === "missing") return error(res, 404, "Cargo listing not found");
  if (result.kind === "invalid-deepsea-requirement") return error(res, 400, "Deepsea cargo requires valid deepsea requirements");
  if (result.kind === "invalid-transition") return error(res, 409, "Listing status transition is not allowed");
  if (result.kind === "invalid-window") return error(res, 400, "Invalid loading window");
  if (result.kind === "invalid-location") return error(res, 400, "Unknown or inactive catalogue location");
  res.json(UpdateMyCargoResponse.parse(
    cargoResponse(result.cargo, await deepseaDetailsForCargo(db, result.cargo.id)),
  ));
});

async function setCargoStatus(req: Request, res: Response, status: "WITHDRAWN" | "CLOSED") {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const params = status === "WITHDRAWN"
    ? WithdrawMyCargoParams.safeParse(req.params) : CloseMyCargoParams.safeParse(req.params);
  if (!params.success) return error(res, 400, "Invalid cargo id");
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const membership = await listingWriteMembership(tx, req.user!.id);
    if (!membership) return { kind: "forbidden" as const };
    const [existing] = await tx.select().from(cargoListingsTable).where(and(
      eq(cargoListingsTable.id, params.data.cargoId),
      eq(cargoListingsTable.companyId, membership.company.id),
    )).for("update");
    if (!existing) return { kind: "missing" as const };
    if (!validListingTransition(existing.listingStatus, status)) return { kind: "invalid" as const };
    const [cargo] = await tx.update(cargoListingsTable).set({
      listingStatus: status, updatedAt: new Date(),
    }).where(eq(cargoListingsTable.id, existing.id)).returning();
    if (cargo) await recalculateMatchesWithin(tx, { changedCargoIds: [cargo.id] });
    return cargo ? { kind: "updated" as const, cargo } : { kind: "missing" as const };
  });
  if (result.kind === "forbidden") return error(res, 403, "Company membership is no longer authorized");
  if (result.kind === "missing") return error(res, 404, "Cargo listing not found");
  if (result.kind === "invalid") return error(res, 409, "Listing status transition is not allowed");
  const response = status === "WITHDRAWN" ? WithdrawMyCargoResponse : CloseMyCargoResponse;
  res.json(response.parse(cargoResponse(result.cargo, await deepseaDetailsForCargo(db, result.cargo.id))));
}

router.post("/cargo/:cargoId/withdraw", (req, res) => setCargoStatus(req, res, "WITHDRAWN"));
router.post("/cargo/:cargoId/close", (req, res) => setCargoStatus(req, res, "CLOSED"));

router.get("/capacity", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = ListMyCapacityQueryParams.safeParse(req.query);
  if (!parsed.success) return error(res, 400, "Invalid capacity filters");
  const { page, pageSize, offset } = pageParams(parsed.data.page, parsed.data.pageSize);
  const where = and(
    eq(capacityOffersTable.companyId, current.company.id),
    eq(capacityOffersTable.transportMode, parsed.data.transportMode ?? "INLAND_WATERWAY"),
    ...(parsed.data.listingStatus ? [eq(capacityOffersTable.listingStatus, parsed.data.listingStatus)] : []),
  );
  const [items, [{ total }]] = await Promise.all([
    db.select().from(capacityOffersTable).where(where).limit(pageSize).offset(offset),
    db.select({ total: count() }).from(capacityOffersTable).where(where),
  ]);
  const extensions = await db.select().from(deepseaCapacityExtensionsTable)
    .where(inArray(deepseaCapacityExtensionsTable.capacityOfferId, items.map(({ id }) => id)));
  const byCapacity = new Map(extensions.map((row) => [row.capacityOfferId, row]));
  res.json(ListMyCapacityResponse.parse({
    items: items.map((item) => capacityResponse(item, byCapacity.get(item.id))),
    page, pageSize, total,
  }));
});

router.post("/capacity", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const parsed = CreateMyCapacityBody.safeParse(req.body);
  if (!parsed.success || !validWindow(parsed.data.availableFrom, parsed.data.availableUntil)) {
    return error(res, 400, "Invalid capacity data or availability window");
  }
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const membership = await listingWriteMembership(tx, req.user!.id);
    if (!membership) return { kind: "forbidden" as const };
    const [vessel] = await tx.select().from(vesselsTable).where(and(
      eq(vesselsTable.id, parsed.data.vesselId),
      eq(vesselsTable.companyId, membership.company.id),
      eq(vesselsTable.active, true),
    )).for("update");
    if (!vessel) return { kind: "invalid-vessel" as const };
    const mode = parsed.data.transportMode ?? "INLAND_WATERWAY";
    if (vessel.transportMode !== mode) return { kind: "mode-mismatch" as const };
    if (mode === "DEEPSEA_BULK") {
      const [profile] = await tx.select().from(deepseaVesselProfilesTable)
        .where(eq(deepseaVesselProfilesTable.vesselId, vessel.id)).for("update");
      if (!profile) return { kind: "invalid-deepsea-profile" as const };
      if (parsed.data.availableCapacityTonnes > profile.dwtTonnes) return { kind: "invalid-capacity" as const };
    }
    if (!isCapacityWithinVessel(parsed.data.availableCapacityTonnes, vessel.totalCapacityTonnes)) {
      return { kind: "invalid-capacity" as const };
    }
    const [location] = await tx.select({ id: locationsTable.id }).from(locationsTable).where(and(
      eq(locationsTable.id, parsed.data.locationId), eq(locationsTable.active, true),
    )).for("update");
    if (!location) return { kind: "invalid-location" as const };

    const now = new Date();
    let suggestion: typeof availabilitySuggestionsTable.$inferSelect | undefined;
    if (parsed.data.availabilitySuggestionId) {
      if (parsed.data.suggestionConfirmed !== true) return { kind: "suggestion-not-confirmed" as const };
      if (parsed.data.listingStatus !== "DRAFT" || parsed.data.availabilityConfidence !== "EXPECTED") {
        return { kind: "suggestion-draft-required" as const };
      }
      const [existingSuggestion] = await tx.select().from(availabilitySuggestionsTable).where(and(
        eq(availabilitySuggestionsTable.id, parsed.data.availabilitySuggestionId),
        eq(availabilitySuggestionsTable.companyId, membership.company.id),
      )).for("update");
      if (!existingSuggestion) return { kind: "suggestion-missing" as const };
      const [suggestionVessel] = await tx.select({ active: vesselsTable.active }).from(vesselsTable)
        .where(and(eq(vesselsTable.id, existingSuggestion.vesselId),
          eq(vesselsTable.companyId, membership.company.id))).for("update");
      const [suggestionLocation] = await tx.select({ active: locationsTable.active }).from(locationsTable)
        .where(eq(locationsTable.id, existingSuggestion.locationId)).for("update");
      const identity = await verifiedSuggestionIdentity(tx, membership.company.id, existingSuggestion.vesselId);
      if (suggestionResponse(
        existingSuggestion, now, identity, suggestionVessel?.active === true,
        suggestionLocation?.active === true,
      ).status !== "PENDING") {
        return { kind: "suggestion-invalid" as const };
      }
      suggestion = existingSuggestion;
    }

    const {
      deepseaExtension,
      availabilitySuggestionId: _availabilitySuggestionId,
      suggestionConfirmed: _suggestionConfirmed,
      ...base
    } = parsed.data;
    const [capacity] = await tx.insert(capacityOffersTable).values({
      ...base,
      transportMode: mode,
      companyId: membership.company.id,
      availabilityConfidence: base.availabilityConfidence ?? "CONFIRMED",
    }).returning();
    if (deepseaExtension) await replaceDeepseaCapacityExtension(tx, capacity.id, deepseaExtension);
    if (suggestion) {
      await tx.update(availabilitySuggestionsTable).set({
        status: "CONVERTED",
        capacityOfferId: capacity.id,
        convertedBy: req.user!.id,
        reviewedAt: now,
      }).where(and(
        eq(availabilitySuggestionsTable.id, suggestion.id),
        eq(availabilitySuggestionsTable.status, "PENDING"),
      ));
    }
    if (capacity.listingStatus === "ACTIVE") {
      await recalculateMatchesWithin(tx, { changedCapacityIds: [capacity.id] });
    }
    return { kind: "created" as const, capacity };
  });
  if (result.kind === "forbidden") return error(res, 403, "Company membership is no longer authorized");
  if (result.kind === "invalid-vessel") return error(res, 400, "Vessel is not active or is not owned by the company");
  if (result.kind === "mode-mismatch") return error(res, 400, "Capacity transport mode must match its vessel");
  if (result.kind === "invalid-deepsea-profile") return error(res, 400, "Deepsea capacity requires a vessel profile");
  if (result.kind === "invalid-capacity") return error(res, 400, "Offered capacity cannot exceed vessel total capacity");
  if (result.kind === "invalid-location") return error(res, 400, "Unknown or inactive catalogue location");
  if (result.kind === "suggestion-not-confirmed") return error(res, 400, "suggestionConfirmed must be true");
  if (result.kind === "suggestion-draft-required") {
    return error(res, 400, "Suggestion confirmations must create DRAFT capacity with EXPECTED confidence");
  }
  if (result.kind === "suggestion-missing") return error(res, 404, "Availability suggestion not found");
  if (result.kind === "suggestion-invalid") {
    return error(res, 409, "Availability suggestion is expired, invalidated, or already converted");
  }
  res.status(201).json(CreateMyCapacityResponse.parse(
    capacityResponse(result.capacity, await deepseaDetailsForCapacity(db, result.capacity.id)),
  ));
});

router.get("/capacity/:capacityId", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = GetMyCapacityParams.safeParse(req.params);
  if (!parsed.success) return error(res, 400, "Invalid capacity id");
  const [capacity] = await db.select().from(capacityOffersTable).where(and(
    eq(capacityOffersTable.id, parsed.data.capacityId),
    eq(capacityOffersTable.companyId, current.company.id),
  ));
  if (!capacity) return error(res, 404, "Capacity offer not found");
  res.json(GetMyCapacityResponse.parse(
    capacityResponse(capacity, await deepseaDetailsForCapacity(db, capacity.id)),
  ));
});

router.patch("/capacity/:capacityId", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const params = UpdateMyCapacityParams.safeParse(req.params);
  const parsed = UpdateMyCapacityBody.safeParse(req.body);
  if (!params.success || !parsed.success || !Object.keys(parsed.data).length) {
    return error(res, 400, "Invalid capacity data");
  }
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const membership = await listingWriteMembership(tx, req.user!.id);
    if (!membership) return { kind: "forbidden" as const };
    const [existing] = await tx.select().from(capacityOffersTable).where(and(
      eq(capacityOffersTable.id, params.data.capacityId),
      eq(capacityOffersTable.companyId, membership.company.id),
    )).for("update");
    if (!existing) return { kind: "missing" as const };
    const availableFrom = parsed.data.availableFrom ?? existing.availableFrom;
    const availableUntil = parsed.data.availableUntil ?? existing.availableUntil;
    const status = parsed.data.listingStatus ?? existing.listingStatus;
    const availableCapacity = parsed.data.availableCapacityTonnes ?? existing.availableCapacityTonnes;
    if (!validListingTransition(existing.listingStatus, status)) return { kind: "invalid-transition" as const };
    if (!validWindow(availableFrom, availableUntil)) return { kind: "invalid-window" as const };
    const vesselId = parsed.data.vesselId ?? existing.vesselId;
    const [vessel] = await tx.select().from(vesselsTable).where(and(
      eq(vesselsTable.id, vesselId),
      eq(vesselsTable.companyId, membership.company.id),
      eq(vesselsTable.active, true),
    )).for("update");
    if (!vessel) return { kind: "invalid-vessel" as const };
    const mode = parsed.data.transportMode ?? existing.transportMode;
    if (vessel.transportMode !== mode) return { kind: "mode-mismatch" as const };
    if (mode === "DEEPSEA_BULK") {
      const [profile] = await tx.select().from(deepseaVesselProfilesTable)
        .where(eq(deepseaVesselProfilesTable.vesselId, vessel.id)).for("update");
      if (!profile) return { kind: "invalid-deepsea-profile" as const };
      if (availableCapacity > profile.dwtTonnes) return { kind: "invalid-capacity" as const };
      if (parsed.data.deepseaExtension !== undefined &&
        !validateDeepseaCapacityExtension(parsed.data.deepseaExtension)) {
        return { kind: "invalid-deepsea-extension" as const };
      }
    }
    if (!isCapacityWithinVessel(availableCapacity, vessel.totalCapacityTonnes)) {
      return { kind: "invalid-capacity" as const };
    }
    if (parsed.data.locationId) {
      const [location] = await tx.select({ id: locationsTable.id }).from(locationsTable).where(and(
        eq(locationsTable.id, parsed.data.locationId), eq(locationsTable.active, true),
      )).for("update");
      if (!location) return { kind: "invalid-location" as const };
    }
    const { deepseaExtension, ...base } = parsed.data;
    const [capacity] = await tx.update(capacityOffersTable).set({
      ...base, transportMode: mode, updatedAt: new Date(),
    }).where(and(
      eq(capacityOffersTable.id, existing.id),
      eq(capacityOffersTable.companyId, membership.company.id),
    )).returning();
    if (!capacity) return { kind: "missing" as const };
    if (mode === "DEEPSEA_BULK") {
      if (deepseaExtension !== undefined) await replaceDeepseaCapacityExtension(tx, capacity.id, deepseaExtension);
    } else {
      await replaceDeepseaCapacityExtension(tx, capacity.id, null);
    }
    await recalculateMatchesWithin(tx, { changedCapacityIds: [capacity.id] });
    return { kind: "updated" as const, capacity };
  });
  if (result.kind === "forbidden") return error(res, 403, "Company membership is no longer authorized");
  if (result.kind === "missing") return error(res, 404, "Capacity offer not found");
  if (result.kind === "invalid-transition") return error(res, 409, "Listing status transition is not allowed");
  if (result.kind === "invalid-window") return error(res, 400, "Invalid availability window");
  if (result.kind === "invalid-vessel") return error(res, 400, "Vessel is not active or is not owned by the company");
  if (result.kind === "mode-mismatch") return error(res, 400, "Capacity transport mode must match its vessel");
  if (result.kind === "invalid-deepsea-profile") return error(res, 400, "Deepsea capacity requires a vessel profile");
  if (result.kind === "invalid-deepsea-extension") return error(res, 400, "Invalid deepsea capacity extension");
  if (result.kind === "invalid-capacity") return error(res, 400, "Offered capacity cannot exceed vessel total capacity");
  if (result.kind === "invalid-location") return error(res, 400, "Unknown or inactive catalogue location");
  res.json(UpdateMyCapacityResponse.parse(
    capacityResponse(result.capacity, await deepseaDetailsForCapacity(db, result.capacity.id)),
  ));
});

async function setCapacityStatus(req: Request, res: Response, status: "WITHDRAWN" | "CLOSED") {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const params = status === "WITHDRAWN"
    ? WithdrawMyCapacityParams.safeParse(req.params) : CloseMyCapacityParams.safeParse(req.params);
  if (!params.success) return error(res, 400, "Invalid capacity id");
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const membership = await listingWriteMembership(tx, req.user!.id);
    if (!membership) return { kind: "forbidden" as const };
    const [existing] = await tx.select().from(capacityOffersTable).where(and(
      eq(capacityOffersTable.id, params.data.capacityId),
      eq(capacityOffersTable.companyId, membership.company.id),
    )).for("update");
    if (!existing) return { kind: "missing" as const };
    if (!validListingTransition(existing.listingStatus, status)) return { kind: "invalid" as const };
    const [capacity] = await tx.update(capacityOffersTable).set({
      listingStatus: status, updatedAt: new Date(),
    }).where(eq(capacityOffersTable.id, existing.id)).returning();
    if (capacity) await recalculateMatchesWithin(tx, { changedCapacityIds: [capacity.id] });
    return capacity ? { kind: "updated" as const, capacity } : { kind: "missing" as const };
  });
  if (result.kind === "forbidden") return error(res, 403, "Company membership is no longer authorized");
  if (result.kind === "missing") return error(res, 404, "Capacity offer not found");
  if (result.kind === "invalid") return error(res, 409, "Listing status transition is not allowed");
  const response = status === "WITHDRAWN" ? WithdrawMyCapacityResponse : CloseMyCapacityResponse;
  res.json(response.parse(
    capacityResponse(result.capacity, await deepseaDetailsForCapacity(db, result.capacity.id)),
  ));
}

router.post("/capacity/:capacityId/withdraw", (req, res) => setCapacityStatus(req, res, "WITHDRAWN"));
router.post("/capacity/:capacityId/close", (req, res) => setCapacityStatus(req, res, "CLOSED"));

export default router;