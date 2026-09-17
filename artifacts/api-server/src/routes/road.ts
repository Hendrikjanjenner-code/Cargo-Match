import {
  CreateRoadAssetBody,
  CreateRoadAssetResponse,
  DeactivateRoadAssetParams,
  DeactivateRoadAssetResponse,
  GetRoadAssetParams,
  GetRoadAssetResponse,
  ListRoadAssetsQueryParams,
  ListRoadAssetsResponse,
  ListRoadDriversResponse,
  UpdateRoadAssetBody,
  UpdateRoadAssetParams,
  UpdateRoadAssetResponse,
  CreateRoadCargoBody,
  CreateRoadCargoResponse,
  GetRoadCargoParams,
  GetRoadCargoResponse,
  ListRoadCargoQueryParams,
  ListRoadCargoResponse,
  UpdateRoadCargoBody,
  UpdateRoadCargoParams,
  UpdateRoadCargoResponse,
  WithdrawRoadCargoParams,
  WithdrawRoadCargoResponse,
  CloseRoadCargoParams,
  CloseRoadCargoResponse,
  CreateRoadCapacityBody,
  CreateRoadCapacityResponse,
  GetRoadCapacityParams,
  GetRoadCapacityResponse,
  ListRoadCapacityQueryParams,
  ListRoadCapacityResponse,
  UpdateRoadCapacityBody,
  UpdateRoadCapacityParams,
  UpdateRoadCapacityResponse,
  WithdrawRoadCapacityParams,
  WithdrawRoadCapacityResponse,
  CloseRoadCapacityParams,
  CloseRoadCapacityResponse,
  AssignRoadDriverBody,
  AssignRoadDriverParams,
  AssignRoadDriverResponse,
  ConfirmRoadAssignmentParams,
  ConfirmRoadAssignmentResponse,
  ConfirmRoadAssignmentBody,
  FlagRoadAssignmentParams,
  FlagRoadAssignmentResponse,
  FlagRoadAssignmentBody,
  ListRoadMatchesQueryParams,
  ListRoadMatchesResponse,
  GetRoadMatchParams,
  GetRoadMatchResponse,
} from "@workspace/api-zod";
import { and, count, eq, inArray, or } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  capacityOffersTable,
  cargoListingsTable,
  companyMembersTable,
  db,
  locationsTable,
  matchesTable,
  roadAssetsTable,
  roadCargoRequirementsTable,
  roadCapacityExtensionsTable,
  roadDriverAssignmentsTable,
  roadOperationalFlagsTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import {
  error,
  getMembershipWithin,
  hasRoadCommercialAuthority,
  pageParams,
  requireMembership,
} from "../lib/http";
import {
  evaluateRoadEligibility,
  listPairRows,
  lockDomain,
  recalculateMatchesWithin,
} from "../services/matching";
import { matchScore, roadOpportunityProjection } from "../lib/privacy";

const router: IRouter = Router();
type Executor = any;
type RoadAsset = typeof roadAssetsTable.$inferSelect;
type RoadCargo = typeof cargoListingsTable.$inferSelect;
type RoadCapacity = typeof capacityOffersTable.$inferSelect;
const listingStatuses = ["DRAFT", "ACTIVE", "WITHDRAWN", "EXPIRED", "CLOSED"] as const;

function validWindow(from: Date, until: Date) {
  return from.getTime() < until.getTime();
}
function validTransition(current: typeof listingStatuses[number], next: typeof listingStatuses[number]) {
  return current === "DRAFT"
    ? next === "DRAFT" || next === "ACTIVE"
    : current === "ACTIVE"
      ? ["ACTIVE", "WITHDRAWN", "CLOSED"].includes(next)
      : current === next;
}
async function planner(tx: Executor, userId: string) {
  const member = await getMembershipWithin(tx, userId, true);
  return member && member.company.status === "ACTIVE" && hasRoadCommercialAuthority(member)
    ? member
    : null;
}
async function activeLocations(tx: Executor, ids: string[]) {
  const rows = await tx.select({ id: locationsTable.id }).from(locationsTable)
    .where(and(inArray(locationsTable.id, ids), eq(locationsTable.active, true))).for("update");
  return rows.length === new Set(ids).size;
}
function assetResponse(asset: RoadAsset) {
  return asset;
}
function assignedAssetCondition(companyId: string, userId: string) {
  return inArray(roadAssetsTable.id, db.select({ id: roadCapacityExtensionsTable.roadAssetId })
    .from(roadCapacityExtensionsTable)
    .innerJoin(capacityOffersTable, eq(capacityOffersTable.id, roadCapacityExtensionsTable.capacityOfferId))
    .innerJoin(roadDriverAssignmentsTable, eq(roadDriverAssignmentsTable.capacityOfferId, capacityOffersTable.id))
    .where(and(
      eq(capacityOffersTable.companyId, companyId),
      eq(roadDriverAssignmentsTable.companyId, companyId),
      eq(roadDriverAssignmentsTable.driverUserId, userId),
    )));
}
async function cargoResponse(executor: Executor, cargo: RoadCargo) {
  const [roadRequirements] = await executor.select().from(roadCargoRequirementsTable)
    .where(eq(roadCargoRequirementsTable.cargoListingId, cargo.id));
  return { ...cargo, roadRequirements };
}
async function capacityResponse(executor: Executor, capacity: RoadCapacity, driverUserId?: string) {
  const [roadExtension] = await executor.select().from(roadCapacityExtensionsTable)
    .where(eq(roadCapacityExtensionsTable.capacityOfferId, capacity.id));
  const assignments = await executor.select({
    id: roadDriverAssignmentsTable.id,
    capacityOfferId: roadDriverAssignmentsTable.capacityOfferId,
    companyId: roadDriverAssignmentsTable.companyId,
    driverUserId: roadDriverAssignmentsTable.driverUserId,
    assignedByUserId: roadDriverAssignmentsTable.assignedByUserId,
    status: roadDriverAssignmentsTable.status,
    operationalNote: roadDriverAssignmentsTable.operationalNote,
    flaggedReason: roadDriverAssignmentsTable.flaggedReason,
    confirmedAt: roadDriverAssignmentsTable.confirmedAt,
    createdAt: roadDriverAssignmentsTable.createdAt,
    updatedAt: roadDriverAssignmentsTable.updatedAt,
  }).from(roadDriverAssignmentsTable).where(and(
    eq(roadDriverAssignmentsTable.capacityOfferId, capacity.id),
    ...(driverUserId ? [eq(roadDriverAssignmentsTable.driverUserId, driverUserId)] : []),
  ));
  return { ...capacity, roadExtension, assignments };
}

router.get("/road/assets", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = ListRoadAssetsQueryParams.safeParse(req.query);
  if (!parsed.success) return error(res, 400, "Invalid road asset filters");
  const { page, pageSize, offset } = pageParams(parsed.data.page, parsed.data.pageSize);
  const where = and(eq(roadAssetsTable.companyId, current.company.id),
    hasRoadCommercialAuthority(current) ? undefined : assignedAssetCondition(current.company.id, req.user!.id),
    ...(parsed.data.activeOnly ? [eq(roadAssetsTable.active, true)] : []));
  const [items, totals] = await Promise.all([
    db.select().from(roadAssetsTable).where(where).limit(pageSize).offset(offset),
    db.select({ total: count() }).from(roadAssetsTable).where(where),
  ]);
  res.json(ListRoadAssetsResponse.parse({ items: items.map((asset) => hasRoadCommercialAuthority(current) ? assetResponse(asset) : { ...asset, notes: null }), page, pageSize, total: totals[0]?.total ?? 0 }));
});

router.post("/road/assets", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const parsed = CreateRoadAssetBody.safeParse(req.body);
  if (!parsed.success) return error(res, 400, "Invalid road asset");
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const member = await planner(tx, req.user!.id);
    if (!member) return { kind: "forbidden" as const };
    if (parsed.data.temperatureMinCelsius != null && parsed.data.temperatureMaxCelsius != null &&
      parsed.data.temperatureMinCelsius > parsed.data.temperatureMaxCelsius) return { kind: "invalid" as const };
    const [asset] = await tx.insert(roadAssetsTable).values({
      ...parsed.data,
      companyId: member.company.id,
      assetName: parsed.data.assetName.trim(),
      equipment: parsed.data.equipment ?? [],
      adrClasses: parsed.data.adrClasses ?? [],
    }).returning();
    return { kind: "created" as const, asset };
  });
  if (result.kind === "forbidden") return error(res, 403, "Road commercial authority is required");
  if (result.kind === "invalid") return error(res, 400, "Invalid temperature range");
  res.status(201).json(CreateRoadAssetResponse.parse(assetResponse(result.asset)));
});

router.get("/road/assets/:roadAssetId", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const params = GetRoadAssetParams.safeParse(req.params);
  if (!params.success) return error(res, 400, "Invalid road asset id");
  const [asset] = await db.select().from(roadAssetsTable).where(and(
    eq(roadAssetsTable.id, params.data.roadAssetId),
    eq(roadAssetsTable.companyId, current.company.id),
    hasRoadCommercialAuthority(current) ? undefined : assignedAssetCondition(current.company.id, req.user!.id),
  ));
  if (!asset) return error(res, 404, "Road asset not found");
  res.json(GetRoadAssetResponse.parse(hasRoadCommercialAuthority(current) ? assetResponse(asset) : { ...asset, notes: null }));
});

router.patch("/road/assets/:roadAssetId", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const params = UpdateRoadAssetParams.safeParse(req.params);
  const parsed = UpdateRoadAssetBody.safeParse(req.body);
  if (!params.success || !parsed.success || !Object.keys(parsed.data).length) return error(res, 400, "Invalid road asset");
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const member = await planner(tx, req.user!.id);
    if (!member) return { kind: "forbidden" as const };
    const [existing] = await tx.select().from(roadAssetsTable).where(and(eq(roadAssetsTable.id, params.data.roadAssetId), eq(roadAssetsTable.companyId, member.company.id))).for("update");
    if (!existing) return { kind: "missing" as const };
    const next = {
      payloadTonnes: parsed.data.payloadTonnes ?? existing.payloadTonnes,
      volumeCubicMetres: parsed.data.volumeCubicMetres ?? existing.volumeCubicMetres,
      loadingMetres: parsed.data.loadingMetres ?? existing.loadingMetres,
      palletPositions: parsed.data.palletPositions ?? existing.palletPositions,
    };
    const [offers] = await Promise.all([tx.select().from(roadCapacityExtensionsTable)
      .innerJoin(capacityOffersTable, eq(capacityOffersTable.id, roadCapacityExtensionsTable.capacityOfferId))
      .where(and(eq(roadCapacityExtensionsTable.roadAssetId, existing.id), inArray(capacityOffersTable.listingStatus, ["DRAFT", "ACTIVE"]))).for("update")]);
    if (offers.some(({ road_capacity_extensions: extension, capacity_offers: offer }) =>
      offer.availableCapacityTonnes > next.payloadTonnes ||
      extension.availableVolumeCubicMetres > next.volumeCubicMetres ||
      extension.availableLoadingMetres > next.loadingMetres ||
      extension.availablePalletPositions > next.palletPositions)) return { kind: "capacity-conflict" as const };
    const minimumTemperature = parsed.data.temperatureMinCelsius === undefined
      ? existing.temperatureMinCelsius : parsed.data.temperatureMinCelsius;
    const maximumTemperature = parsed.data.temperatureMaxCelsius === undefined
      ? existing.temperatureMaxCelsius : parsed.data.temperatureMaxCelsius;
    if (minimumTemperature != null && maximumTemperature != null &&
      minimumTemperature > maximumTemperature) return { kind: "invalid" as const };
    const [asset] = await tx.update(roadAssetsTable).set({
      ...parsed.data,
      equipment: parsed.data.equipment ?? existing.equipment,
      adrClasses: parsed.data.adrClasses ?? existing.adrClasses,
      updatedAt: new Date(),
    }).where(eq(roadAssetsTable.id, existing.id)).returning();
    if (asset) await recalculateMatchesWithin(tx, { changedRoadAssetIds: [asset.id] });
    return { kind: "updated" as const, asset };
  });
  if (result.kind === "forbidden") return error(res, 403, "Road commercial authority is required");
  if (result.kind === "missing") return error(res, 404, "Road asset not found");
  if (result.kind === "capacity-conflict") return error(res, 409, "Asset limits cannot be reduced below an active road offer");
  if (result.kind === "invalid") return error(res, 400, "Invalid temperature range");
  res.json(UpdateRoadAssetResponse.parse(assetResponse(result.asset)));
});

router.post("/road/assets/:roadAssetId/deactivate", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const params = DeactivateRoadAssetParams.safeParse(req.params);
  if (!params.success) return error(res, 400, "Invalid road asset id");
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const member = await planner(tx, req.user!.id);
    if (!member) return null;
    const [asset] = await tx.update(roadAssetsTable).set({ active: false, updatedAt: new Date() })
      .where(and(eq(roadAssetsTable.id, params.data.roadAssetId), eq(roadAssetsTable.companyId, member.company.id))).returning();
    if (asset) await recalculateMatchesWithin(tx, { changedRoadAssetIds: [asset.id] });
    return asset;
  });
  if (!result) return error(res, 404, "Road asset not found");
  res.json(DeactivateRoadAssetResponse.parse(assetResponse(result)));
});

router.get("/road/cargo", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const parsed = ListRoadCargoQueryParams.safeParse(req.query);
  if (!parsed.success) return error(res, 400, "Invalid road cargo filters");
  const { page, pageSize, offset } = pageParams(parsed.data.page, parsed.data.pageSize);
  const where = and(eq(cargoListingsTable.companyId, current.company.id), eq(cargoListingsTable.transportMode, "ROAD"),
    ...(parsed.data.listingStatus ? [eq(cargoListingsTable.listingStatus, parsed.data.listingStatus)] : []));
  const [items, totals] = await Promise.all([
    db.select().from(cargoListingsTable).where(where).limit(pageSize).offset(offset),
    db.select({ total: count() }).from(cargoListingsTable).where(where),
  ]);
  res.json(ListRoadCargoResponse.parse({ items: await Promise.all(items.map((item) => cargoResponse(db, item))), page, pageSize, total: totals[0]?.total ?? 0 }));
});

router.post("/road/cargo", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const parsed = CreateRoadCargoBody.safeParse(req.body);
  if (!parsed.success || !validWindow(parsed.data.loadingFrom, parsed.data.loadingUntil)) return error(res, 400, "Invalid road cargo or loading window");
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const member = await planner(tx, req.user!.id);
    if (!member) return { kind: "forbidden" as const };
    if (parsed.data.loadingLocationId === parsed.data.destinationLocationId ||
      !await activeLocations(tx, [parsed.data.loadingLocationId, parsed.data.destinationLocationId])) return { kind: "location" as const };
    const [cargo] = await tx.insert(cargoListingsTable).values({
      cargoName: parsed.data.cargoName.trim(),
      cargoType: parsed.data.cargoType.trim(),
      weightTonnes: parsed.data.weightTonnes,
      loadingLocationId: parsed.data.loadingLocationId,
      destinationLocationId: parsed.data.destinationLocationId,
      loadingFrom: parsed.data.loadingFrom,
      loadingUntil: parsed.data.loadingUntil,
      expectedUnloadingDate: null,
      requiredVesselType: null,
      specialRequirements: parsed.data.roadRequirements?.notes ?? null,
      visibility: parsed.data.visibility,
      notes: parsed.data.notes ?? null,
      listingStatus: parsed.data.listingStatus ?? "DRAFT",
      transportMode: "ROAD",
      companyId: member.company.id,
    }).returning();
    await tx.insert(roadCargoRequirementsTable).values({
      cargoListingId: cargo.id,
      ...(parsed.data.roadRequirements ?? {}),
      requiredEquipment: parsed.data.roadRequirements?.requiredEquipment ?? [],
      adrClasses: parsed.data.roadRequirements?.adrClasses ?? [],
    });
    if (cargo.listingStatus === "ACTIVE") await recalculateMatchesWithin(tx, { changedCargoIds: [cargo.id] });
    return { kind: "created" as const, cargo };
  });
  if (result.kind === "forbidden") return error(res, 403, "Road commercial authority is required");
  if (result.kind === "location") return error(res, 400, "Unknown, inactive, or duplicate road location");
  res.status(201).json(CreateRoadCargoResponse.parse(await cargoResponse(db, result.cargo)));
});

router.get("/road/cargo/:cargoId", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const params = GetRoadCargoParams.safeParse(req.params);
  if (!params.success) return error(res, 400, "Invalid road cargo id");
  const [cargo] = await db.select().from(cargoListingsTable).where(and(eq(cargoListingsTable.id, params.data.cargoId), eq(cargoListingsTable.companyId, current.company.id), eq(cargoListingsTable.transportMode, "ROAD")));
  if (!cargo) return error(res, 404, "Road cargo not found");
  res.json(GetRoadCargoResponse.parse(await cargoResponse(db, cargo)));
});

async function updateRoadCargo(req: Request, res: Response) {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const params = UpdateRoadCargoParams.safeParse(req.params);
  const parsed = UpdateRoadCargoBody.safeParse(req.body);
  if (!params.success || !parsed.success || !Object.keys(parsed.data).length) return error(res, 400, "Invalid road cargo");
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const member = await planner(tx, req.user!.id);
    if (!member) return { kind: "forbidden" as const };
    const [old] = await tx.select().from(cargoListingsTable).where(and(eq(cargoListingsTable.id, params.data.cargoId), eq(cargoListingsTable.companyId, member.company.id), eq(cargoListingsTable.transportMode, "ROAD"))).for("update");
    if (!old) return { kind: "missing" as const };
    const from = parsed.data.loadingFrom ?? old.loadingFrom;
    const until = parsed.data.loadingUntil ?? old.loadingUntil;
    const status = parsed.data.listingStatus ?? old.listingStatus;
    if (!validWindow(from, until)) return { kind: "window" as const };
    if (!validTransition(old.listingStatus, status)) return { kind: "transition" as const };
    const locationIds = [parsed.data.loadingLocationId, parsed.data.destinationLocationId].filter((id): id is string => !!id);
    if (locationIds.length && !await activeLocations(tx, locationIds)) return { kind: "location" as const };
    const { roadRequirements, ...base } = parsed.data;
    const [cargo] = await tx.update(cargoListingsTable).set({
      ...base,
      transportMode: "ROAD",
      requiredVesselType: null,
      updatedAt: new Date(),
    }).where(eq(cargoListingsTable.id, old.id)).returning();
    if (roadRequirements !== undefined) {
      await tx.update(roadCargoRequirementsTable).set({
        ...roadRequirements,
        requiredEquipment: roadRequirements.requiredEquipment ?? [],
        adrClasses: roadRequirements.adrClasses ?? [],
        updatedAt: new Date(),
      }).where(eq(roadCargoRequirementsTable.cargoListingId, old.id));
    }
    await recalculateMatchesWithin(tx, { changedCargoIds: [old.id] });
    return { kind: "updated" as const, cargo };
  });
  if (result.kind === "forbidden") return error(res, 403, "Road commercial authority is required");
  if (result.kind === "missing") return error(res, 404, "Road cargo not found");
  if (result.kind === "window") return error(res, 400, "Invalid loading window");
  if (result.kind === "transition") return error(res, 409, "Listing status transition is not allowed");
  if (result.kind === "location") return error(res, 400, "Unknown or inactive road location");
  res.json(UpdateRoadCargoResponse.parse(await cargoResponse(db, result.cargo)));
}
router.patch("/road/cargo/:cargoId", updateRoadCargo);

async function setRoadCargoStatus(req: Request, res: Response, status: "WITHDRAWN" | "CLOSED") {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const params = (status === "WITHDRAWN" ? WithdrawRoadCargoParams : CloseRoadCargoParams).safeParse(req.params);
  if (!params.success) return error(res, 400, "Invalid road cargo id");
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const member = await planner(tx, req.user!.id);
    if (!member) return null;
    const [old] = await tx.select().from(cargoListingsTable).where(and(eq(cargoListingsTable.id, params.data.cargoId), eq(cargoListingsTable.companyId, member.company.id), eq(cargoListingsTable.transportMode, "ROAD"))).for("update");
    if (!old || !validTransition(old.listingStatus, status)) return undefined;
    const [cargo] = await tx.update(cargoListingsTable).set({ listingStatus: status, updatedAt: new Date() }).where(eq(cargoListingsTable.id, old.id)).returning();
    await recalculateMatchesWithin(tx, { changedCargoIds: [old.id] });
    return cargo;
  });
  if (result === null) return error(res, 403, "Road commercial authority is required");
  if (!result) return error(res, 404, "Road cargo not found or status transition is not allowed");
  const response = status === "WITHDRAWN" ? WithdrawRoadCargoResponse : CloseRoadCargoResponse;
  res.json(response.parse(await cargoResponse(db, result)));
}
router.post("/road/cargo/:cargoId/withdraw", (req, res) => setRoadCargoStatus(req, res, "WITHDRAWN"));
router.post("/road/cargo/:cargoId/close", (req, res) => setRoadCargoStatus(req, res, "CLOSED"));

router.get("/road/capacity", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = ListRoadCapacityQueryParams.safeParse(req.query);
  if (!parsed.success) return error(res, 400, "Invalid road capacity filters");
  const { page, pageSize, offset } = pageParams(parsed.data.page, parsed.data.pageSize);
  const statusFilter = parsed.data.listingStatus
    ? [eq(capacityOffersTable.listingStatus, parsed.data.listingStatus)]
    : [];
  const isPlanner = hasRoadCommercialAuthority(current);
  const rows = isPlanner
    ? await db.select().from(capacityOffersTable).where(and(
      eq(capacityOffersTable.companyId, current.company.id),
      eq(capacityOffersTable.transportMode, "ROAD"),
      ...statusFilter,
    )).limit(pageSize).offset(offset)
    : (await db.select({ capacity: capacityOffersTable }).from(capacityOffersTable)
      .innerJoin(roadDriverAssignmentsTable, eq(roadDriverAssignmentsTable.capacityOfferId, capacityOffersTable.id))
      .where(and(
        eq(capacityOffersTable.companyId, current.company.id),
        eq(capacityOffersTable.transportMode, "ROAD"),
        eq(roadDriverAssignmentsTable.driverUserId, req.user!.id),
        eq(roadDriverAssignmentsTable.companyId, current.company.id),
        eq(roadDriverAssignmentsTable.companyId, current.company.id),
        ...statusFilter,
      )).limit(pageSize).offset(offset)).map(({ capacity }) => capacity);
  const totalRows = isPlanner
    ? await db.select({ total: count() }).from(capacityOffersTable).where(and(
      eq(capacityOffersTable.companyId, current.company.id),
      eq(capacityOffersTable.transportMode, "ROAD"),
      ...statusFilter,
    ))
    : await db.select({ total: count() }).from(capacityOffersTable)
      .innerJoin(roadDriverAssignmentsTable, eq(roadDriverAssignmentsTable.capacityOfferId, capacityOffersTable.id))
      .where(and(
        eq(capacityOffersTable.companyId, current.company.id),
        eq(capacityOffersTable.transportMode, "ROAD"),
        eq(roadDriverAssignmentsTable.driverUserId, req.user!.id),
        eq(roadDriverAssignmentsTable.companyId, current.company.id),
        ...statusFilter,
      ));
  const projections = await Promise.all(rows.map((item) => capacityResponse(db, item, isPlanner ? undefined : req.user!.id)));
  const operationalItems = isPlanner ? projections : projections.map((item) => ({
    ...item,
    notes: null,
    roadExtension: item.roadExtension ? { ...item.roadExtension, notes: null } : item.roadExtension,
  }));
  res.json(ListRoadCapacityResponse.parse({ items: operationalItems, page, pageSize, total: totalRows[0]?.total ?? 0 }));
});

function capacityTimes(expectedAt: Date, uncertaintyMinutes: number) {
  return {
    availableFrom: new Date(expectedAt.getTime() - uncertaintyMinutes * 60_000),
    availableUntil: new Date(expectedAt.getTime() + 24 * 60 * 60_000),
  };
}
async function validateRoadCapacity(tx: Executor, companyId: string, body: any, existingAssetId?: string) {
  const [asset] = await tx.select().from(roadAssetsTable).where(and(eq(roadAssetsTable.id, body.roadAssetId ?? existingAssetId), eq(roadAssetsTable.companyId, companyId), eq(roadAssetsTable.active, true))).for("update");
  if (!asset) return { kind: "asset" as const };
  const ids = [body.currentDeliveryLocationId, body.expectedAvailabilityLocationId].filter(Boolean);
  if (ids.length !== 2 || !await activeLocations(tx, ids)) return { kind: "location" as const };
  if (new Date(body.currentDeliveryExpectedAt).getTime() > new Date(body.expectedAvailabilityAt).getTime()) return { kind: "sequence" as const };
  const values = {
    tonnes: body.availableCapacityTonnes,
    volume: body.availableVolumeCubicMetres,
    loading: body.availableLoadingMetres,
    pallets: body.availablePalletPositions,
  };
  if (
    ![values.tonnes, values.volume, values.loading, values.pallets].every(
      (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
    ) ||
    typeof body.availabilityUncertaintyMinutes !== "number" ||
    !Number.isFinite(body.availabilityUncertaintyMinutes) ||
    body.availabilityUncertaintyMinutes < 0
  ) return { kind: "capacity" as const };
  if (values.tonnes > asset.payloadTonnes || values.volume > asset.volumeCubicMetres || values.loading > asset.loadingMetres || values.pallets > asset.palletPositions) return { kind: "capacity" as const };
  if (body.temperatureMinCelsius != null && body.temperatureMaxCelsius != null && body.temperatureMinCelsius > body.temperatureMaxCelsius) return { kind: "temperature" as const };
  return { kind: "ok" as const, asset };
}

router.post("/road/capacity", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const parsed = CreateRoadCapacityBody.safeParse(req.body);
  if (!parsed.success) return error(res, 400, "Invalid road capacity");
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const member = await planner(tx, req.user!.id);
    if (!member) return { kind: "forbidden" as const };
    const validation = await validateRoadCapacity(tx, member.company.id, parsed.data);
    if (validation.kind !== "ok") return validation;
    const uncertainty = parsed.data.availabilityUncertaintyMinutes ?? 0;
    const times = capacityTimes(parsed.data.expectedAvailabilityAt, uncertainty);
    const [capacity] = await tx.insert(capacityOffersTable).values({
      companyId: member.company.id,
      transportMode: "ROAD",
      vesselId: null,
      locationId: parsed.data.expectedAvailabilityLocationId,
      availableFrom: times.availableFrom,
      availableUntil: times.availableUntil,
      availabilityType: "FULLY_EMPTY",
      availableCapacityTonnes: parsed.data.availableCapacityTonnes,
      cargoCompatibility: parsed.data.cargoCompatibility ?? ["ALL"],
      preferredDirection: parsed.data.preferredDirection ?? "",
      maximumPositioningDistanceKm: parsed.data.maximumPositioningDistanceKm ?? 100,
      visibility: parsed.data.visibility,
      availabilityConfidence: "EXPECTED",
      notes: parsed.data.notes ?? null,
      listingStatus: parsed.data.listingStatus ?? "DRAFT",
    }).returning();
    await tx.insert(roadCapacityExtensionsTable).values({
      capacityOfferId: capacity.id,
      roadAssetId: parsed.data.roadAssetId,
      currentDeliveryLocationId: parsed.data.currentDeliveryLocationId,
      currentDeliveryExpectedAt: parsed.data.currentDeliveryExpectedAt,
      expectedAvailabilityLocationId: parsed.data.expectedAvailabilityLocationId,
      expectedAvailabilityAt: parsed.data.expectedAvailabilityAt,
      availabilityUncertaintyMinutes: uncertainty,
      availabilitySource: parsed.data.availabilitySource ?? "MANUAL",
      availableVolumeCubicMetres: parsed.data.availableVolumeCubicMetres,
      availableLoadingMetres: parsed.data.availableLoadingMetres,
      availablePalletPositions: parsed.data.availablePalletPositions,
      trailerType: parsed.data.trailerType ?? null,
      equipment: parsed.data.equipment ?? [],
      temperatureMinCelsius: parsed.data.temperatureMinCelsius ?? null,
      temperatureMaxCelsius: parsed.data.temperatureMaxCelsius ?? null,
      adrClasses: parsed.data.adrClasses ?? [],
      preferredDirection: parsed.data.preferredDirection ?? null,
      notes: parsed.data.notes ?? null,
    });
    if (capacity.listingStatus === "ACTIVE") await recalculateMatchesWithin(tx, { changedCapacityIds: [capacity.id] });
    return { kind: "created" as const, capacity };
  });
  if (result.kind === "forbidden") return error(res, 403, "Road commercial authority is required");
  if (result.kind === "asset") return error(res, 400, "Road asset is not active or not owned by the company");
  if (result.kind === "location") return error(res, 400, "Unknown or inactive road location");
  if (result.kind === "sequence") return error(res, 400, "Expected availability cannot precede current delivery");
  if (result.kind === "capacity") return error(res, 400, "All road capacity limits must fit the registered asset");
  if (result.kind === "temperature") return error(res, 400, "Invalid temperature range");
  res.status(201).json(CreateRoadCapacityResponse.parse(await capacityResponse(db, result.capacity)));
});

router.get("/road/capacity/:capacityId", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const params = GetRoadCapacityParams.safeParse(req.params);
  if (!params.success) return error(res, 400, "Invalid road capacity id");
  const capacityRows = hasRoadCommercialAuthority(current)
    ? await db.select().from(capacityOffersTable).where(and(
      eq(capacityOffersTable.id, params.data.capacityId),
      eq(capacityOffersTable.companyId, current.company.id),
      eq(capacityOffersTable.transportMode, "ROAD"),
    ))
    : (await db.select({ capacity: capacityOffersTable }).from(capacityOffersTable)
      .innerJoin(roadDriverAssignmentsTable, eq(roadDriverAssignmentsTable.capacityOfferId, capacityOffersTable.id))
      .where(and(
        eq(capacityOffersTable.id, params.data.capacityId),
        eq(capacityOffersTable.companyId, current.company.id),
        eq(capacityOffersTable.transportMode, "ROAD"),
        eq(roadDriverAssignmentsTable.driverUserId, req.user!.id),
      ))).map(({ capacity }) => capacity);
  const [capacity] = capacityRows;
  if (!capacity) return error(res, 404, "Road capacity not found");
  const projection = await capacityResponse(db, capacity, hasRoadCommercialAuthority(current) ? undefined : req.user!.id);
  res.json(GetRoadCapacityResponse.parse(hasRoadCommercialAuthority(current)
    ? projection
    : { ...projection, notes: null, roadExtension: projection.roadExtension ? { ...projection.roadExtension, notes: null } : projection.roadExtension }));
});

router.get("/road/drivers", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const members = await db.select({
    userId: usersTable.id,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    email: usersTable.email,
  }).from(companyMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, companyMembersTable.userId))
    .where(and(
      eq(companyMembersTable.companyId, current.company.id),
      eq(companyMembersTable.role, "MEMBER"),
      eq(companyMembersTable.active, true),
    ));
  res.json(ListRoadDriversResponse.parse({ items: members }));
});

router.patch("/road/capacity/:capacityId", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const params = UpdateRoadCapacityParams.safeParse(req.params);
  const parsed = UpdateRoadCapacityBody.safeParse(req.body);
  if (!params.success || !parsed.success || !Object.keys(parsed.data).length) return error(res, 400, "Invalid road capacity");
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const member = await planner(tx, req.user!.id);
    if (!member) return { kind: "forbidden" as const };
    const [old] = await tx.select().from(capacityOffersTable).where(and(eq(capacityOffersTable.id, params.data.capacityId), eq(capacityOffersTable.companyId, member.company.id), eq(capacityOffersTable.transportMode, "ROAD"))).for("update");
    if (!old) return { kind: "missing" as const };
    const [oldExtension] = await tx.select().from(roadCapacityExtensionsTable).where(eq(roadCapacityExtensionsTable.capacityOfferId, old.id)).for("update");
    if (!oldExtension) return { kind: "extension" as const };
    const merged = {
      ...oldExtension,
      ...parsed.data,
      availableCapacityTonnes: parsed.data.availableCapacityTonnes ?? old.availableCapacityTonnes,
    };
    const validation = await validateRoadCapacity(tx, member.company.id, merged, oldExtension.roadAssetId);
    if (validation.kind !== "ok") return validation;
    const status = parsed.data.listingStatus ?? old.listingStatus;
    if (!validTransition(old.listingStatus, status)) return { kind: "transition" as const };
    const uncertainty = parsed.data.availabilityUncertaintyMinutes ?? oldExtension.availabilityUncertaintyMinutes;
    const expectedAt = parsed.data.expectedAvailabilityAt ?? oldExtension.expectedAvailabilityAt;
    const times = capacityTimes(expectedAt, uncertainty);
    const [capacity] = await tx.update(capacityOffersTable).set({
      locationId: parsed.data.expectedAvailabilityLocationId ?? old.locationId,
      availableFrom: times.availableFrom,
      availableUntil: times.availableUntil,
      availableCapacityTonnes: parsed.data.availableCapacityTonnes ?? old.availableCapacityTonnes,
      cargoCompatibility: parsed.data.cargoCompatibility ?? old.cargoCompatibility,
      preferredDirection: parsed.data.preferredDirection ?? old.preferredDirection,
      maximumPositioningDistanceKm: parsed.data.maximumPositioningDistanceKm ?? old.maximumPositioningDistanceKm,
      visibility: parsed.data.visibility ?? old.visibility,
      notes: parsed.data.notes ?? old.notes,
      listingStatus: status,
      updatedAt: new Date(),
    }).where(eq(capacityOffersTable.id, old.id)).returning();
    const { roadAssetId, ...extension } = parsed.data;
    await tx.update(roadCapacityExtensionsTable).set({
      ...extension,
      roadAssetId: roadAssetId ?? oldExtension.roadAssetId,
      currentDeliveryLocationId: parsed.data.currentDeliveryLocationId ?? oldExtension.currentDeliveryLocationId,
      currentDeliveryExpectedAt: parsed.data.currentDeliveryExpectedAt ?? oldExtension.currentDeliveryExpectedAt,
      expectedAvailabilityLocationId: parsed.data.expectedAvailabilityLocationId ?? oldExtension.expectedAvailabilityLocationId,
      expectedAvailabilityAt: expectedAt,
      availabilityUncertaintyMinutes: uncertainty,
      availabilitySource: parsed.data.availabilitySource ?? oldExtension.availabilitySource,
      availableVolumeCubicMetres: parsed.data.availableVolumeCubicMetres ?? oldExtension.availableVolumeCubicMetres,
      availableLoadingMetres: parsed.data.availableLoadingMetres ?? oldExtension.availableLoadingMetres,
      availablePalletPositions: parsed.data.availablePalletPositions ?? oldExtension.availablePalletPositions,
      updatedAt: new Date(),
    }).where(eq(roadCapacityExtensionsTable.capacityOfferId, old.id));
    await recalculateMatchesWithin(tx, { changedCapacityIds: [old.id] });
    return { kind: "updated" as const, capacity };
  });
  if (result.kind === "forbidden") return error(res, 403, "Road commercial authority is required");
  if (result.kind === "missing") return error(res, 404, "Road capacity not found");
  if (result.kind === "extension") return error(res, 409, "Road capacity extension is missing");
  if (result.kind === "transition") return error(res, 409, "Listing status transition is not allowed");
  if (result.kind === "asset") return error(res, 400, "Road asset is not active or not owned by the company");
  if (result.kind === "location") return error(res, 400, "Unknown or inactive road location");
  if (result.kind === "sequence") return error(res, 400, "Expected availability cannot precede current delivery");
  if (result.kind === "capacity") return error(res, 400, "All road capacity limits must fit the registered asset");
  if (result.kind === "temperature") return error(res, 400, "Invalid temperature range");
  res.json(UpdateRoadCapacityResponse.parse(await capacityResponse(db, result.capacity)));
});

async function setRoadCapacityStatus(req: Request, res: Response, status: "WITHDRAWN" | "CLOSED") {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const params = (status === "WITHDRAWN" ? WithdrawRoadCapacityParams : CloseRoadCapacityParams).safeParse(req.params);
  if (!params.success) return error(res, 400, "Invalid road capacity id");
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const member = await planner(tx, req.user!.id);
    if (!member) return null;
    const [old] = await tx.select().from(capacityOffersTable).where(and(eq(capacityOffersTable.id, params.data.capacityId), eq(capacityOffersTable.companyId, member.company.id), eq(capacityOffersTable.transportMode, "ROAD"))).for("update");
    if (!old || !validTransition(old.listingStatus, status)) return undefined;
    const [capacity] = await tx.update(capacityOffersTable).set({ listingStatus: status, updatedAt: new Date() }).where(eq(capacityOffersTable.id, old.id)).returning();
    await recalculateMatchesWithin(tx, { changedCapacityIds: [old.id] });
    return capacity;
  });
  if (result === null) return error(res, 403, "Road commercial authority is required");
  if (!result) return error(res, 404, "Road capacity not found or status transition is not allowed");
  const response = status === "WITHDRAWN" ? WithdrawRoadCapacityResponse : CloseRoadCapacityResponse;
  res.json(response.parse(await capacityResponse(db, result)));
}
router.post("/road/capacity/:capacityId/withdraw", (req, res) => setRoadCapacityStatus(req, res, "WITHDRAWN"));
router.post("/road/capacity/:capacityId/close", (req, res) => setRoadCapacityStatus(req, res, "CLOSED"));

router.post("/road/capacity/:capacityId/assignments", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] });
  if (!current) return;
  const params = AssignRoadDriverParams.safeParse(req.params);
  const parsed = AssignRoadDriverBody.safeParse(req.body);
  if (!params.success || !parsed.success) return error(res, 400, "Invalid driver assignment");
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const member = await planner(tx, req.user!.id);
    if (!member) return { kind: "forbidden" as const };
    const [capacity] = await tx.select({ id: capacityOffersTable.id }).from(capacityOffersTable).where(and(eq(capacityOffersTable.id, params.data.capacityId), eq(capacityOffersTable.companyId, member.company.id), eq(capacityOffersTable.transportMode, "ROAD"))).for("update");
    if (!capacity) return { kind: "missing" as const };
    const [driver] = await tx.select().from(companyMembersTable).where(and(eq(companyMembersTable.userId, parsed.data.driverUserId), eq(companyMembersTable.companyId, member.company.id), eq(companyMembersTable.role, "MEMBER"), eq(companyMembersTable.active, true))).for("update");
    if (!driver) return { kind: "driver" as const };
    const [assignment] = await tx.insert(roadDriverAssignmentsTable).values({ capacityOfferId: capacity.id, companyId: member.company.id, driverUserId: parsed.data.driverUserId, assignedByUserId: req.user!.id, operationalNote: parsed.data.operationalNote ?? null }).onConflictDoUpdate({ target: [roadDriverAssignmentsTable.capacityOfferId, roadDriverAssignmentsTable.driverUserId], set: { assignedByUserId: req.user!.id, operationalNote: parsed.data.operationalNote ?? null, status: "ASSIGNED", updatedAt: new Date() } }).returning({
      id: roadDriverAssignmentsTable.id,
      capacityOfferId: roadDriverAssignmentsTable.capacityOfferId,
      companyId: roadDriverAssignmentsTable.companyId,
      driverUserId: roadDriverAssignmentsTable.driverUserId,
      assignedByUserId: roadDriverAssignmentsTable.assignedByUserId,
      status: roadDriverAssignmentsTable.status,
      operationalNote: roadDriverAssignmentsTable.operationalNote,
      flaggedReason: roadDriverAssignmentsTable.flaggedReason,
      confirmedAt: roadDriverAssignmentsTable.confirmedAt,
      createdAt: roadDriverAssignmentsTable.createdAt,
      updatedAt: roadDriverAssignmentsTable.updatedAt,
    });
    return { kind: "created" as const, assignment };
  });
  if (result.kind === "forbidden") return error(res, 403, "Road commercial authority is required");
  if (result.kind === "missing") return error(res, 404, "Road capacity not found");
  if (result.kind === "driver") return error(res, 400, "Assignment requires an active MEMBER driver in the company");
  res.status(201).json(AssignRoadDriverResponse.parse(result.assignment));
});

async function roadAssignmentAction(req: Request, res: Response, action: "CONFIRMED" | "FLAGGED") {
  const current = await requireMembership(req, res);
  if (!current) return;
  const params = (action === "CONFIRMED" ? ConfirmRoadAssignmentParams : FlagRoadAssignmentParams).safeParse(req.params);
  const parsed = (action === "CONFIRMED" ? ConfirmRoadAssignmentBody : FlagRoadAssignmentBody).safeParse(req.body ?? {});
  if (!params.success || !parsed.success) return error(res, 400, "Invalid operational assignment action");
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const member = await getMembershipWithin(tx, req.user!.id, true);
    if (!member || !member.membership.active || member.company.status !== "ACTIVE") return { kind: "forbidden" as const };
    const [assignment] = await tx.select().from(roadDriverAssignmentsTable).where(and(eq(roadDriverAssignmentsTable.id, params.data.assignmentId), eq(roadDriverAssignmentsTable.companyId, member.company.id))).for("update");
    if (!assignment) return { kind: "missing" as const };
    if (assignment.driverUserId !== req.user!.id || member.membership.role !== "MEMBER") return { kind: "driver" as const };
    let flaggedMatchId: string | null = assignment.flaggedMatchId;
    if (action === "FLAGGED") {
      const requestedMatchId = parsed.data.matchId;
      if (!requestedMatchId) return { kind: "invalid-match" as const };
      const [match] = await tx.select().from(matchesTable).where(and(
        eq(matchesTable.id, requestedMatchId),
        eq(matchesTable.capacityOfferId, assignment.capacityOfferId),
      )).for("update");
      const pair = match
        ? (await listPairRows(tx)).find((candidate) =>
          candidate.cargo.id === match.cargoListingId &&
          candidate.capacity.id === match.capacityOfferId)
        : undefined;
      if (!match || !pair || match.status === "CONNECTED" || match.status === "EXPIRED" ||
        match.isStale || !evaluateRoadEligibility(pair).eligible) {
        return { kind: "invalid-match" as const };
      }
      flaggedMatchId = match.id;
      await tx.insert(roadOperationalFlagsTable).values({
        assignmentId: assignment.id,
        capacityOfferId: assignment.capacityOfferId,
        matchId: match.id,
        driverUserId: req.user!.id,
        reason: parsed.data.reason ?? "Driver flagged opportunity",
      });
      const planners = await tx.select({ userId: companyMembersTable.userId })
        .from(companyMembersTable).where(and(
          eq(companyMembersTable.companyId, member.company.id),
          eq(companyMembersTable.active, true),
          inArray(companyMembersTable.role, ["OWNER", "ADMIN"]),
        ));
      if (planners.length) {
        await tx.insert(notificationsTable).values(planners.map(({ userId }) => ({
          userId,
          type: "ROAD_OPPORTUNITY_FLAGGED" as const,
          title: "Driver flagged a road opportunity",
          message: "An assigned driver flagged a specific road match for planner review.",
          relatedMatchId: match.id,
          relatedMatchDomain: "ROAD",
        })));
      }
    }
    const [updated] = await tx.update(roadDriverAssignmentsTable).set({
      status: action === "CONFIRMED" && assignment.flaggedMatchId ? "FLAGGED" : action,
      operationalNote: parsed.data.note ?? assignment.operationalNote,
      flaggedReason: action === "FLAGGED" ? (parsed.data.reason ?? "Driver flagged opportunity") : assignment.flaggedReason,
      flaggedMatchId,
      confirmedAt: action === "CONFIRMED" ? new Date() : assignment.confirmedAt,
      updatedAt: new Date(),
    }).where(eq(roadDriverAssignmentsTable.id, assignment.id)).returning();
    return { kind: "updated" as const, assignment: updated };
  });
  if (result.kind === "forbidden" || result.kind === "driver") return error(res, 403, "Only the assigned MEMBER driver may perform this operational action");
  if (result.kind === "missing") return error(res, 404, "Road assignment not found");
  if (result.kind === "invalid-match") return error(res, 409, "Flagging requires a current eligible road opportunity assigned to this driver");
  const response = action === "CONFIRMED" ? ConfirmRoadAssignmentResponse : FlagRoadAssignmentResponse;
  res.json(response.parse(result.assignment));
}
router.post("/road/assignments/:assignmentId/confirm", (req, res) => roadAssignmentAction(req, res, "CONFIRMED"));
router.post("/road/assignments/:assignmentId/flag", (req, res) => roadAssignmentAction(req, res, "FLAGGED"));

function roadMatchResponse(
  match: typeof matchesTable.$inferSelect,
  pair: Awaited<ReturnType<typeof listPairRows>>[number],
) {
  const score = matchScore(match);
  return {
    id: match.id,
    status: match.status,
    totalScore: score.totalScore,
    calculationVersion: match.calculationVersion,
    explanation: score.explanation,
    cargoListingId: match.cargoListingId!,
    capacityOfferId: match.capacityOfferId!,
    evaluationInputs: score.evaluationInputs,
    projection: roadOpportunityProjection(pair),
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
  };
}
async function roadMatchesForCompany(companyId: string, matchId?: string, driverUserId?: string) {
  const rows = await db.select({ match: matchesTable, cargo: cargoListingsTable, capacity: capacityOffersTable })
    .from(matchesTable)
    .innerJoin(cargoListingsTable, eq(cargoListingsTable.id, matchesTable.cargoListingId))
    .innerJoin(capacityOffersTable, eq(capacityOffersTable.id, matchesTable.capacityOfferId))
    .leftJoin(roadDriverAssignmentsTable, eq(roadDriverAssignmentsTable.capacityOfferId, capacityOffersTable.id))
    .where(and(
      ...(matchId ? [eq(matchesTable.id, matchId)] : []),
      eq(cargoListingsTable.transportMode, "ROAD"),
      eq(capacityOffersTable.transportMode, "ROAD"),
      ...(driverUserId
        ? [
          eq(roadDriverAssignmentsTable.driverUserId, driverUserId),
          eq(roadDriverAssignmentsTable.companyId, companyId),
          eq(capacityOffersTable.companyId, companyId),
        ]
        : [or(eq(cargoListingsTable.companyId, companyId), eq(capacityOffersTable.companyId, companyId))]),
    ));
  const pairs = await listPairRows(db);
  const pairByKey = new Map(pairs.map((pair) => [`${pair.cargo.id}:${pair.capacity.id}`, pair]));
  const seen = new Set<string>();
  return rows
    .filter(({ match }) => {
      if (seen.has(match.id)) return false;
      seen.add(match.id);
      if (match.status === "CONNECTED") return true;
      const pair = pairByKey.get(`${match.cargoListingId}:${match.capacityOfferId}`);
      return Boolean(
        pair &&
        !match.isStale &&
        pair.cargo.listingStatus === "ACTIVE" &&
        pair.cargo.visibility === "OPEN_NETWORK" &&
        pair.capacity.listingStatus === "ACTIVE" &&
        pair.capacity.visibility === "OPEN_NETWORK" &&
        evaluateRoadEligibility(pair).eligible,
      );
    })
    .map(({ match }) => {
      const pair = pairByKey.get(`${match.cargoListingId}:${match.capacityOfferId}`);
      return pair ? roadMatchResponse(match, pair) : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}
router.get("/road/matches", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = ListRoadMatchesQueryParams.safeParse(req.query);
  if (!parsed.success) return error(res, 400, "Invalid road match filters");
  const items = await roadMatchesForCompany(
    current.company.id,
    undefined,
    hasRoadCommercialAuthority(current) ? undefined : req.user!.id,
  );
  const { page, pageSize, offset } = pageParams(parsed.data.page, parsed.data.pageSize);
  res.json(ListRoadMatchesResponse.parse({ items: items.slice(offset, offset + pageSize), page, pageSize, total: items.length }));
});
router.get("/road/matches/:matchId", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = GetRoadMatchParams.safeParse(req.params);
  if (!parsed.success) return error(res, 400, "Invalid road match id");
  const [item] = await roadMatchesForCompany(
    current.company.id,
    parsed.data.matchId,
    hasRoadCommercialAuthority(current) ? undefined : req.user!.id,
  );
  if (!item) return error(res, 404, "Road match not found");
  res.json(GetRoadMatchResponse.parse(item));
});

export default router;