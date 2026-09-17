import {
  CreateMyLinerCargoBody, CreateMyLinerCargoResponse, CreateMyLinerSailingBody, CreateMyLinerSailingParams, CreateMyLinerSailingResponse,
  CreateMyLinerServiceBody, CreateMyLinerServiceResponse, CreateMyLinerVesselBody, CreateMyLinerVesselResponse,
  GetMyLinerCargoParams, GetMyLinerCargoResponse, GetMyLinerSailingParams, GetMyLinerSailingResponse, GetMyLinerServiceParams,
  GetMyLinerServiceResponse, GetMyLinerVesselParams, GetMyLinerVesselResponse, ListMyLinerCargoQueryParams, ListMyLinerCargoResponse,
  ListMyLinerSailingsParams, ListMyLinerSailingsResponse, ListMyLinerServicesQueryParams, ListMyLinerServicesResponse,
  ListMyLinerVesselsQueryParams, ListMyLinerVesselsResponse, UpdateMyLinerCargoBody, UpdateMyLinerCargoParams, UpdateMyLinerCargoResponse,
  UpdateMyLinerSailingBody, UpdateMyLinerSailingParams, UpdateMyLinerSailingResponse, UpdateMyLinerServiceBody, UpdateMyLinerServiceParams,
  UpdateMyLinerServiceResponse, UpdateMyLinerVesselBody, UpdateMyLinerVesselParams, UpdateMyLinerVesselResponse,
  WithdrawMyLinerCargoParams, WithdrawMyLinerCargoResponse, WithdrawMyLinerSailingParams, WithdrawMyLinerSailingResponse,
  WithdrawMyLinerServiceParams, WithdrawMyLinerServiceResponse,
  ActOnLinerMatchBody, ActOnLinerMatchParams, ActOnLinerMatchResponse, GetMyLinerMatchParams, GetMyLinerMatchResponse,
  ListLinerMarketplaceQueryParams, ListLinerMarketplaceResponse, ListMyLinerMatchesQueryParams, ListMyLinerMatchesResponse,
} from "@workspace/api-zod";
import { alias } from "drizzle-orm/pg-core";
import { and, count, eq, gt, inArray, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db, companiesTable, linerCargoTable, linerPortRotationsTable, linerSailingCapacitiesTable, linerSailingsTable, linerServicesTable, linerVesselsTable, locationsTable,
} from "@workspace/db";
import { error, getMembershipWithin, pageParams, requireMembership } from "../lib/http";
import { lockDomain } from "../services/matching";
import { recalculateLinerMatchesWithin } from "../services/liner";
import { evaluateLinerEligibility, listLinerPairs } from "../services/liner";
import { applyMatchConsent } from "../services/consent";
import { interestsTable, matchesTable } from "@workspace/db";

const router: IRouter = Router();
type Executor = any;
const statuses = ["DRAFT", "ACTIVE", "WITHDRAWN", "EXPIRED", "CLOSED"] as const;

function canTransition(current: typeof statuses[number], next: typeof statuses[number]) {
  return current === "DRAFT" ? next === "DRAFT" || next === "ACTIVE" : current === "ACTIVE" ? ["ACTIVE", "WITHDRAWN", "CLOSED"].includes(next) : current === next;
}
async function writeMember(tx: Executor, userId: string) {
  const current = await getMembershipWithin(tx, userId, true);
  return current && current.membership.active && ["OWNER", "ADMIN"].includes(current.membership.role) && current.company.status === "ACTIVE" ? current : null;
}
function hasCarrierActivity(member: NonNullable<Awaited<ReturnType<typeof writeMember>>>) {
  return member.company.activities.includes("CARRIER");
}
function hasCargoActivity(member: NonNullable<Awaited<ReturnType<typeof writeMember>>>) {
  return member.company.activities.some((activity) => activity === "SHIPPER" || activity === "CHARTERER");
}
function validImoNumber(value: string) {
  return /^\d{7}$/.test(value);
}
function validCargoTotals(value: { pieceCount: number; pieceWeightTonnes: number; totalWeightTonnes: number }) {
  // Piece weight is the heaviest piece, not an average or identical-piece claim.
  return value.totalWeightTonnes >= value.pieceWeightTonnes &&
    value.totalWeightTonnes <= value.pieceCount * value.pieceWeightTonnes;
}
function rotationValid(rotation: Array<{ sequence: number; estimatedArrival: Date; estimatedDeparture: Date }>, departureAt: Date) {
  const firstCall = rotation[0];
  return rotation.length >= 2 && !!firstCall && departureAt >= firstCall.estimatedArrival && departureAt <= firstCall.estimatedDeparture && rotation.every((call, index) =>
    call.sequence === index + 1 && call.estimatedArrival < call.estimatedDeparture &&
    (index === 0 || rotation[index - 1]!.estimatedDeparture <= call.estimatedArrival));
}
async function assertLocations(tx: Executor, ids: string[]) {
  const rows = await tx.select({ id: locationsTable.id }).from(locationsTable).where(and(inArray(locationsTable.id, ids), eq(locationsTable.active, true), eq(locationsTable.locationType, "PORT"))).for("update");
  return new Set(rows.map((row: { id: string }) => row.id)).size === new Set(ids).size;
}
async function sailingResponse(executor: Executor, sailing: typeof linerSailingsTable.$inferSelect) {
  const [capacity, rotation] = await Promise.all([
    executor.select().from(linerSailingCapacitiesTable).where(eq(linerSailingCapacitiesTable.sailingId, sailing.id)).then((rows: any[]) => rows[0]),
    executor.select().from(linerPortRotationsTable).where(eq(linerPortRotationsTable.sailingId, sailing.id)).orderBy(linerPortRotationsTable.sequence),
  ]);
  return { ...sailing, portRotation: rotation.map((call: any) => ({ locationId: call.locationId, sequence: call.sequence, estimatedArrival: call.estimatedArrival, estimatedDeparture: call.estimatedDeparture })), commercialCapacity: capacity && {
    availableCommercialTonnes: capacity.availableCommercialTonnes, maximumPieceWeightTonnes: capacity.maximumPieceWeightTonnes, maximumPieceLengthMetres: capacity.maximumPieceLengthMetres,
    maximumPieceWidthMetres: capacity.maximumPieceWidthMetres, maximumPieceHeightMetres: capacity.maximumPieceHeightMetres, liftingCapacityTonnes: capacity.liftingCapacityTonnes,
    stowage: capacity.stowage, acceptedCargoTypes: capacity.acceptedCargoTypes,
  }};
}

router.get("/liner/vessels", async (req, res) => {
  const current = await requireMembership(req, res); if (!current) return;
  const parsed = ListMyLinerVesselsQueryParams.safeParse(req.query); if (!parsed.success) return error(res, 400, "Invalid vessel filters");
  const { page, pageSize, offset } = pageParams(parsed.data.page, parsed.data.pageSize);
  const where = eq(linerVesselsTable.companyId, current.company.id);
  const [items, totals] = await Promise.all([db.select().from(linerVesselsTable).where(where).limit(pageSize).offset(offset), db.select({ total: count() }).from(linerVesselsTable).where(where)]);
  res.json(ListMyLinerVesselsResponse.parse({ items, page, pageSize, total: totals[0]?.total ?? 0 }));
});
router.post("/liner/vessels", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] }); if (!current) return;
  const parsed = CreateMyLinerVesselBody.safeParse(req.body); if (!parsed.success || !validImoNumber(parsed.data.imoNumber)) return error(res, 400, "Invalid actual vessel IMO number");
  const result = await db.transaction(async tx => { await lockDomain(tx); const member = await writeMember(tx, req.user!.id); if (!member || !hasCarrierActivity(member)) return null; const [row] = await tx.insert(linerVesselsTable).values({ ...parsed.data, vesselName: parsed.data.vesselName.trim(), imoNumber: parsed.data.imoNumber.trim(), companyId: member.company.id }).returning(); return row; });
  if (!result) return error(res, 403, "Company membership is no longer authorized");
  res.status(201).json(CreateMyLinerVesselResponse.parse(result));
});
router.get("/liner/vessels/:linerVesselId", async (req, res) => {
  const current = await requireMembership(req, res); if (!current) return; const params = GetMyLinerVesselParams.safeParse(req.params); if (!params.success) return error(res, 400, "Invalid vessel id");
  const [row] = await db.select().from(linerVesselsTable).where(and(eq(linerVesselsTable.id, params.data.linerVesselId), eq(linerVesselsTable.companyId, current.company.id)));
  if (!row) return error(res, 404, "Liner vessel not found"); res.json(GetMyLinerVesselResponse.parse(row));
});
router.patch("/liner/vessels/:linerVesselId", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] }); if (!current) return; if (!current.company.activities.includes("CARRIER")) return error(res, 403, "Carrier activity is required"); const params = UpdateMyLinerVesselParams.safeParse(req.params); const body = UpdateMyLinerVesselBody.safeParse(req.body);
  if (!params.success || !body.success || !Object.keys(body.data).length) return error(res, 400, "Invalid vessel data");
  const result = await db.transaction(async tx => { await lockDomain(tx); const member = await writeMember(tx, req.user!.id); if (!member || !hasCarrierActivity(member)) return null; const [row] = await tx.update(linerVesselsTable).set({ ...body.data, vesselName: body.data.vesselName?.trim(), updatedAt: new Date() }).where(and(eq(linerVesselsTable.id, params.data.linerVesselId), eq(linerVesselsTable.companyId, member.company.id))).returning(); if (row) await recalculateLinerMatchesWithin(tx); return row; });
  if (!result) return error(res, 404, "Liner vessel not found"); res.json(UpdateMyLinerVesselResponse.parse(result));
});

router.get("/liner/services", async (req, res) => {
  const current = await requireMembership(req, res); if (!current) return; const parsed = ListMyLinerServicesQueryParams.safeParse(req.query); if (!parsed.success) return error(res, 400, "Invalid service filters");
  const { page, pageSize, offset } = pageParams(parsed.data.page, parsed.data.pageSize); const where = parsed.data.listingStatus ? and(eq(linerServicesTable.companyId, current.company.id), eq(linerServicesTable.listingStatus, parsed.data.listingStatus)) : eq(linerServicesTable.companyId, current.company.id);
  const [items, totals] = await Promise.all([db.select().from(linerServicesTable).where(where).limit(pageSize).offset(offset), db.select({ total: count() }).from(linerServicesTable).where(where)]);
  res.json(ListMyLinerServicesResponse.parse({ items, page, pageSize, total: totals[0]?.total ?? 0 }));
});
router.post("/liner/services", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] }); if (!current) return; const body = CreateMyLinerServiceBody.safeParse(req.body); if (!body.success) return error(res, 400, "Invalid liner service");
  const result = await db.transaction(async tx => { await lockDomain(tx); const member = await writeMember(tx, req.user!.id); if (!member || !hasCarrierActivity(member)) return null; const [row] = await tx.insert(linerServicesTable).values({ ...body.data, serviceName: body.data.serviceName.trim(), tradeLane: body.data.tradeLane.trim(), companyId: member.company.id }).returning(); return row; });
  if (!result) return error(res, 403, "Company membership is no longer authorized"); res.status(201).json(CreateMyLinerServiceResponse.parse(result));
});
router.get("/liner/services/:linerServiceId", async (req, res) => {
  const current = await requireMembership(req, res); if (!current) return; const params = GetMyLinerServiceParams.safeParse(req.params); if (!params.success) return error(res, 400, "Invalid service id");
  const [row] = await db.select().from(linerServicesTable).where(and(eq(linerServicesTable.id, params.data.linerServiceId), eq(linerServicesTable.companyId, current.company.id))); if (!row) return error(res, 404, "Liner service not found"); res.json(GetMyLinerServiceResponse.parse(row));
});
router.patch("/liner/services/:linerServiceId", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] }); if (!current) return; const params = UpdateMyLinerServiceParams.safeParse(req.params); const body = UpdateMyLinerServiceBody.safeParse(req.body); if (!params.success || !body.success || !Object.keys(body.data).length) return error(res, 400, "Invalid liner service");
  const result = await db.transaction(async tx => { await lockDomain(tx); const member = await writeMember(tx, req.user!.id); if (!member || !hasCarrierActivity(member)) return { kind: "forbidden" }; const [old] = await tx.select().from(linerServicesTable).where(and(eq(linerServicesTable.id, params.data.linerServiceId), eq(linerServicesTable.companyId, member.company.id))).for("update"); if (!old) return { kind: "missing" }; const next = body.data.listingStatus ?? old.listingStatus; if (!canTransition(old.listingStatus, next)) return { kind: "invalid" }; const [row] = await tx.update(linerServicesTable).set({ ...body.data, serviceName: body.data.serviceName?.trim(), tradeLane: body.data.tradeLane?.trim(), updatedAt: new Date() }).where(eq(linerServicesTable.id, old.id)).returning(); await recalculateLinerMatchesWithin(tx, { serviceIds: [old.id] }); return { kind: "ok", row }; });
  if (result.kind === "forbidden") return error(res, 403, "Company membership is no longer authorized"); if (result.kind === "missing") return error(res, 404, "Liner service not found"); if (result.kind === "invalid") return error(res, 409, "Listing status transition is not allowed"); res.json(UpdateMyLinerServiceResponse.parse(result.row));
});
router.post("/liner/services/:linerServiceId/withdraw", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] }); if (!current) return; const params = WithdrawMyLinerServiceParams.safeParse(req.params); if (!params.success) return error(res, 400, "Invalid service id");
  const result = await db.transaction(async tx => { await lockDomain(tx); const member = await writeMember(tx, req.user!.id); if (!member || !hasCarrierActivity(member)) return null; const [row] = await tx.update(linerServicesTable).set({ listingStatus: "WITHDRAWN", updatedAt: new Date() }).where(and(eq(linerServicesTable.id, params.data.linerServiceId), eq(linerServicesTable.companyId, member.company.id), eq(linerServicesTable.listingStatus, "ACTIVE"))).returning(); if (!row) return undefined; await tx.update(linerSailingsTable).set({ listingStatus: "WITHDRAWN", updatedAt: new Date() }).where(eq(linerSailingsTable.serviceId, row.id)); await recalculateLinerMatchesWithin(tx, { serviceIds: [row.id] }); return row; });
  if (result === null) return error(res, 403, "Company membership is no longer authorized"); if (!result) return error(res, 404, "Active liner service not found"); res.json(WithdrawMyLinerServiceResponse.parse(result));
});

router.get("/liner/services/:linerServiceId/sailings", async (req, res) => {
  const current = await requireMembership(req, res); if (!current) return; const params = ListMyLinerSailingsParams.safeParse(req.params); if (!params.success) return error(res, 400, "Invalid service id");
  const [service] = await db.select({ id: linerServicesTable.id }).from(linerServicesTable).where(and(eq(linerServicesTable.id, params.data.linerServiceId), eq(linerServicesTable.companyId, current.company.id))); if (!service) return error(res, 404, "Liner service not found");
  const items = await db.select().from(linerSailingsTable).where(eq(linerSailingsTable.serviceId, service.id));
  res.json(ListMyLinerSailingsResponse.parse({ items: await Promise.all(items.map((sailing) => sailingResponse(db, sailing))), page: 1, pageSize: items.length, total: items.length }));
});
router.post("/liner/services/:linerServiceId/sailings", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] }); if (!current) return; if (!current.company.activities.includes("CARRIER")) return error(res, 403, "Carrier activity is required"); const params = CreateMyLinerSailingParams.safeParse(req.params); const body = CreateMyLinerSailingBody.safeParse(req.body);
  if (!params.success || !body.success || body.data.cargoCutoffAt >= body.data.departureAt || !rotationValid(body.data.portRotation, body.data.departureAt)) return error(res, 400, "Invalid sailing, cutoff, or ordered rotation");
  const result = await db.transaction(async tx => {
    await lockDomain(tx); const member = await writeMember(tx, req.user!.id); if (!member || !hasCarrierActivity(member)) return { kind: "forbidden" };
    const [service] = await tx.select().from(linerServicesTable).where(and(eq(linerServicesTable.id, params.data.linerServiceId), eq(linerServicesTable.companyId, member.company.id))).for("update"); if (!service) return { kind: "missing" };
    const [vessel] = await tx.select().from(linerVesselsTable).where(and(eq(linerVesselsTable.id, body.data.linerVesselId), eq(linerVesselsTable.companyId, member.company.id), eq(linerVesselsTable.active, true))).for("update"); if (!vessel) return { kind: "vessel" };
    if (!await assertLocations(tx, body.data.portRotation.map((call) => call.locationId))) return { kind: "location" };
    const { portRotation, commercialCapacity, ...base } = body.data;
    const [sailing] = await tx.insert(linerSailingsTable).values({ ...base, serviceId: service.id }).returning();
    await tx.insert(linerPortRotationsTable).values(portRotation.map(call => ({ sailingId: sailing.id, ...call })));
    await tx.insert(linerSailingCapacitiesTable).values({ sailingId: sailing.id, ...commercialCapacity });
    if (sailing.listingStatus === "ACTIVE") await recalculateLinerMatchesWithin(tx, { sailingIds: [sailing.id] });
    return { kind: "ok", sailing };
  });
  if (result.kind === "forbidden") return error(res, 403, "Company membership is no longer authorized"); if (result.kind === "missing") return error(res, 404, "Liner service not found"); if (result.kind === "vessel") return error(res, 400, "Sailing requires an owned active actual liner vessel"); if (result.kind === "location") return error(res, 400, "Rotation contains an unknown or inactive location");
  res.status(201).json(CreateMyLinerSailingResponse.parse(await sailingResponse(db, result.sailing!)));
});
router.get("/liner/sailings/:linerSailingId", async (req, res) => {
  const current = await requireMembership(req, res); if (!current) return; const params = GetMyLinerSailingParams.safeParse(req.params); if (!params.success) return error(res, 400, "Invalid sailing id");
  const [row] = await db.select({ sailing: linerSailingsTable }).from(linerSailingsTable).innerJoin(linerServicesTable, eq(linerServicesTable.id, linerSailingsTable.serviceId)).where(and(eq(linerSailingsTable.id, params.data.linerSailingId), eq(linerServicesTable.companyId, current.company.id)));
  if (!row) return error(res, 404, "Liner sailing not found"); res.json(GetMyLinerSailingResponse.parse(await sailingResponse(db, row.sailing)));
});
router.patch("/liner/sailings/:linerSailingId", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] }); if (!current) return; const params = UpdateMyLinerSailingParams.safeParse(req.params); const body = UpdateMyLinerSailingBody.safeParse(req.body); if (!params.success || !body.success || !Object.keys(body.data).length) return error(res, 400, "Invalid sailing data");
  const result = await db.transaction(async tx => {
    await lockDomain(tx); const member = await writeMember(tx, req.user!.id); if (!member || !hasCarrierActivity(member)) return { kind: "forbidden" };
    const [row] = await tx.select({ sailing: linerSailingsTable, service: linerServicesTable }).from(linerSailingsTable).innerJoin(linerServicesTable, eq(linerServicesTable.id, linerSailingsTable.serviceId)).where(and(eq(linerSailingsTable.id, params.data.linerSailingId), eq(linerServicesTable.companyId, member.company.id))).for("update"); if (!row) return { kind: "missing" };
    const departureAt = body.data.departureAt ?? row.sailing.departureAt; const cargoCutoffAt = body.data.cargoCutoffAt ?? row.sailing.cargoCutoffAt; const nextStatus = body.data.listingStatus ?? row.sailing.listingStatus;
    const effectiveRotation = body.data.portRotation ?? await tx.select().from(linerPortRotationsTable).where(eq(linerPortRotationsTable.sailingId, row.sailing.id)).orderBy(linerPortRotationsTable.sequence);
    if (cargoCutoffAt >= departureAt || !canTransition(row.sailing.listingStatus, nextStatus) || !rotationValid(effectiveRotation, departureAt)) return { kind: "invalid" };
    if (body.data.linerVesselId) { const [vessel] = await tx.select({ id: linerVesselsTable.id }).from(linerVesselsTable).where(and(eq(linerVesselsTable.id, body.data.linerVesselId), eq(linerVesselsTable.companyId, member.company.id), eq(linerVesselsTable.active, true))).for("update"); if (!vessel) return { kind: "vessel" }; }
    if (body.data.portRotation && !await assertLocations(tx, body.data.portRotation.map(call => call.locationId))) return { kind: "location" };
    const { portRotation, commercialCapacity, ...base } = body.data;
    const [sailing] = await tx.update(linerSailingsTable).set({ ...base, updatedAt: new Date() }).where(eq(linerSailingsTable.id, row.sailing.id)).returning();
    if (portRotation) { await tx.delete(linerPortRotationsTable).where(eq(linerPortRotationsTable.sailingId, sailing.id)); await tx.insert(linerPortRotationsTable).values(portRotation.map(call => ({ sailingId: sailing.id, ...call }))); }
    if (commercialCapacity) await tx.update(linerSailingCapacitiesTable).set({ ...commercialCapacity, updatedAt: new Date() }).where(eq(linerSailingCapacitiesTable.sailingId, sailing.id));
    await recalculateLinerMatchesWithin(tx, { sailingIds: [sailing.id] }); return { kind: "ok", sailing };
  });
  if (result.kind === "forbidden") return error(res, 403, "Company membership is no longer authorized"); if (result.kind === "missing") return error(res, 404, "Liner sailing not found"); if (result.kind === "invalid") return error(res, 400, "Invalid sailing, cutoff, rotation, or state transition"); if (result.kind === "vessel") return error(res, 400, "Sailing requires an owned active actual liner vessel"); if (result.kind === "location") return error(res, 400, "Rotation contains an unknown or inactive location");
  res.json(UpdateMyLinerSailingResponse.parse(await sailingResponse(db, result.sailing!)));
});
router.post("/liner/sailings/:linerSailingId/withdraw", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] }); if (!current) return; const params = WithdrawMyLinerSailingParams.safeParse(req.params); if (!params.success) return error(res, 400, "Invalid sailing id");
  const result = await db.transaction(async tx => { await lockDomain(tx); const member = await writeMember(tx, req.user!.id); if (!member || !hasCarrierActivity(member)) return null; const [row] = await tx.update(linerSailingsTable).set({ listingStatus: "WITHDRAWN", updatedAt: new Date() }).where(and(eq(linerSailingsTable.id, params.data.linerSailingId), eq(linerSailingsTable.listingStatus, "ACTIVE"), inArray(linerSailingsTable.serviceId, tx.select({ id: linerServicesTable.id }).from(linerServicesTable).where(eq(linerServicesTable.companyId, member.company.id))))).returning(); if (!row) return undefined; await recalculateLinerMatchesWithin(tx, { sailingIds: [row.id] }); return row; });
  if (result === null) return error(res, 403, "Company membership is no longer authorized"); if (!result) return error(res, 404, "Active liner sailing not found"); res.json(WithdrawMyLinerSailingResponse.parse(await sailingResponse(db, result)));
});

router.get("/liner/cargo", async (req, res) => {
  const current = await requireMembership(req, res); if (!current) return; const parsed = ListMyLinerCargoQueryParams.safeParse(req.query); if (!parsed.success) return error(res, 400, "Invalid liner cargo filters");
  const { page, pageSize, offset } = pageParams(parsed.data.page, parsed.data.pageSize); const where = parsed.data.listingStatus ? and(eq(linerCargoTable.companyId, current.company.id), eq(linerCargoTable.listingStatus, parsed.data.listingStatus)) : eq(linerCargoTable.companyId, current.company.id);
  const [items, totals] = await Promise.all([db.select().from(linerCargoTable).where(where).limit(pageSize).offset(offset), db.select({ total: count() }).from(linerCargoTable).where(where)]);
  res.json(ListMyLinerCargoResponse.parse({ items, page, pageSize, total: totals[0]?.total ?? 0 }));
});
router.post("/liner/cargo", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] }); if (!current) return; const body = CreateMyLinerCargoBody.safeParse(req.body);
  if (!body.success || body.data.originLocationId === body.data.destinationLocationId || !validCargoTotals(body.data)) return error(res, 400, "Invalid breakbulk cargo");
  const result = await db.transaction(async tx => { await lockDomain(tx); const member = await writeMember(tx, req.user!.id); if (!member || !hasCargoActivity(member)) return { kind: "forbidden" }; if (!await assertLocations(tx, [body.data.originLocationId, body.data.destinationLocationId])) return { kind: "location" }; const [row] = await tx.insert(linerCargoTable).values({ ...body.data, cargoName: body.data.cargoName.trim(), companyId: member.company.id }).returning(); if (row.listingStatus === "ACTIVE") await recalculateLinerMatchesWithin(tx, { cargoIds: [row.id] }); return { kind: "ok", row }; });
  if (result.kind === "forbidden") return error(res, 403, "Company membership is no longer authorized"); if (result.kind === "location") return error(res, 400, "Unknown or inactive origin/destination location"); res.status(201).json(CreateMyLinerCargoResponse.parse(result.row));
});
router.get("/liner/cargo/:linerCargoId", async (req, res) => {
  const current = await requireMembership(req, res); if (!current) return; const params = GetMyLinerCargoParams.safeParse(req.params); if (!params.success) return error(res, 400, "Invalid liner cargo id");
  const [row] = await db.select().from(linerCargoTable).where(and(eq(linerCargoTable.id, params.data.linerCargoId), eq(linerCargoTable.companyId, current.company.id))); if (!row) return error(res, 404, "Liner cargo not found"); res.json(GetMyLinerCargoResponse.parse(row));
});
router.patch("/liner/cargo/:linerCargoId", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] }); if (!current) return; const params = UpdateMyLinerCargoParams.safeParse(req.params); const body = UpdateMyLinerCargoBody.safeParse(req.body); if (!params.success || !body.success || !Object.keys(body.data).length) return error(res, 400, "Invalid liner cargo");
  const result = await db.transaction(async tx => {
    await lockDomain(tx); const member = await writeMember(tx, req.user!.id); if (!member) return { kind: "forbidden" };
    const [old] = await tx.select().from(linerCargoTable).where(and(eq(linerCargoTable.id, params.data.linerCargoId), eq(linerCargoTable.companyId, member.company.id))).for("update"); if (!old) return { kind: "missing" }; if (!hasCargoActivity(member)) return { kind: "forbidden" };
    const nextStatus = body.data.listingStatus ?? old.listingStatus; const origin = body.data.originLocationId ?? old.originLocationId; const destination = body.data.destinationLocationId ?? old.destinationLocationId;
    const totalWeightTonnes = body.data.totalWeightTonnes ?? old.totalWeightTonnes; const pieceWeightTonnes = body.data.pieceWeightTonnes ?? old.pieceWeightTonnes; const pieceCount = body.data.pieceCount ?? old.pieceCount;
    if (!canTransition(old.listingStatus, nextStatus) || origin === destination || !validCargoTotals({ totalWeightTonnes, pieceWeightTonnes, pieceCount })) return { kind: "invalid" };
    if ((body.data.originLocationId || body.data.destinationLocationId) && !await assertLocations(tx, [origin, destination])) return { kind: "location" };
    const [row] = await tx.update(linerCargoTable).set({ ...body.data, cargoName: body.data.cargoName?.trim(), updatedAt: new Date() }).where(eq(linerCargoTable.id, old.id)).returning(); await recalculateLinerMatchesWithin(tx, { cargoIds: [row.id] }); return { kind: "ok", row };
  });
  if (result.kind === "forbidden") return error(res, 403, "Company membership is no longer authorized"); if (result.kind === "missing") return error(res, 404, "Liner cargo not found"); if (result.kind === "invalid") return error(res, 400, "Invalid liner cargo or status transition"); if (result.kind === "location") return error(res, 400, "Unknown or inactive origin/destination location"); res.json(UpdateMyLinerCargoResponse.parse(result.row));
});
router.post("/liner/cargo/:linerCargoId/withdraw", async (req, res) => {
  const current = await requireMembership(req, res, { roles: ["OWNER", "ADMIN"] }); if (!current) return; const params = WithdrawMyLinerCargoParams.safeParse(req.params); if (!params.success) return error(res, 400, "Invalid liner cargo id");
  const result = await db.transaction(async tx => { await lockDomain(tx); const member = await writeMember(tx, req.user!.id); if (!member) return null; const [owned] = await tx.select({ id: linerCargoTable.id }).from(linerCargoTable).where(and(eq(linerCargoTable.id, params.data.linerCargoId), eq(linerCargoTable.companyId, member.company.id))).for("update"); if (!owned) return undefined; if (!hasCargoActivity(member)) return null; const [row] = await tx.update(linerCargoTable).set({ listingStatus: "WITHDRAWN", updatedAt: new Date() }).where(and(eq(linerCargoTable.id, owned.id), eq(linerCargoTable.listingStatus, "ACTIVE"))).returning(); if (row) await recalculateLinerMatchesWithin(tx, { cargoIds: [row.id] }); return row; });
  if (result === null) return error(res, 403, "Company membership is no longer authorized"); if (!result) return error(res, 404, "Active liner cargo not found"); res.json(WithdrawMyLinerCargoResponse.parse(result));
});

function linerWeightBand(value: number) { return value < 20 ? "< 20 t" : value < 100 ? "20–100 t" : "100+ t"; }
function linerDimensionBand(cargo: typeof linerCargoTable.$inferSelect) {
  const max = Math.max(cargo.pieceLengthMetres, cargo.pieceWidthMetres, cargo.pieceHeightMetres);
  return max < 5 ? "Under 5 m" : max < 15 ? "5–15 m" : "15 m+";
}
function linerTimeBand(value: Date) {
  const days = (value.getTime() - Date.now()) / 86_400_000;
  return days < 7 ? "Within 7 days" : days < 30 ? "Within 30 days" : "30+ days";
}
function anonymousLinerCargo(cargo: typeof linerCargoTable.$inferSelect, origin: typeof locationsTable.$inferSelect, destination: typeof locationsTable.$inferSelect) {
  return { id: cargo.id, listingType: "CARGO" as const, cargoType: cargo.cargoType, originRegion: origin.region, destinationRegion: destination.region, totalWeightBand: linerWeightBand(cargo.totalWeightTonnes), pieceDimensionBand: linerDimensionBand(cargo), liftingBand: cargo.requiredLiftingTonnes ? linerWeightBand(cargo.requiredLiftingTonnes) : "No special lift declared", stowage: cargo.requiredStowage, readyBand: linerTimeBand(cargo.readyAt) };
}
function anonymousLinerSailing(pair: Pick<Awaited<ReturnType<typeof listLinerPairs>>[number], "sailing" | "capacity">, regions: string[]) {
  return { id: pair.sailing.id, listingType: "SAILING" as const, tradeLaneBand: regions.join(" → "), departureBand: linerTimeBand(pair.sailing.departureAt), cutoffBand: linerTimeBand(pair.sailing.cargoCutoffAt), capacityBand: linerWeightBand(pair.capacity.availableCommercialTonnes), cargoTypes: pair.capacity.acceptedCargoTypes, stowage: pair.capacity.stowage };
}
async function linerBundle(matchId: string, companyId: string) {
  const [matches, pairs, interests] = await Promise.all([db.select().from(matchesTable).where(eq(matchesTable.id, matchId)), listLinerPairs(db), db.select().from(interestsTable).where(eq(interestsTable.matchId, matchId))]);
  const match = matches[0]; if (!match?.linerCargoId || !match.linerSailingId) return null;
  const pair = pairs.find(candidate => candidate.cargo.id === match.linerCargoId && candidate.sailing.id === match.linerSailingId);
  if (!pair || (pair.cargoCompany.id !== companyId && pair.serviceCompany.id !== companyId)) return null;
  return { match, pair, initiatedByCompanyId: interests.find(interest => interest.status === "PENDING")?.companyId ?? null };
}
async function linerMatchResponse(bundle: NonNullable<Awaited<ReturnType<typeof linerBundle>>>, companyId: string) {
  const { match, pair } = bundle; const ownsCargo = pair.cargoCompany.id === companyId; const ownsSailing = pair.serviceCompany.id === companyId; const connected = match.status === "CONNECTED";
  const score = match.evaluationInputs;
  const summary = { id: match.id, linerCargoId: pair.cargo.id, linerSailingId: pair.sailing.id, status: match.status, cargo: anonymousLinerCargo(pair.cargo, pair.origin, pair.destination), sailing: anonymousLinerSailing(pair, [pair.origin.region, pair.destination.region]), score: {
    totalScore: Math.round(match.totalScore), dimensionsFit: Number(score.dimensionsFit ?? 0), weightFit: Number(score.weightFit ?? 0), liftingFit: Number(score.liftingFit ?? 0), stowageFit: Number(score.stowageFit ?? 0), rotationFit: Number(score.rotationFit ?? 0), timingFit: Number(score.timingFit ?? 0), explanation: match.explanation, calculatedAt: match.calculatedAt,
  }, initiatedByMe: bundle.initiatedByCompanyId === companyId, canAccept: match.status === "INTEREST_SENT" && bundle.initiatedByCompanyId !== companyId, createdAt: match.createdAt, updatedAt: match.updatedAt };
  const safeCargo = (() => { const { notes: _notes, ...cargo } = pair.cargo; return cargo; })();
  const fullSailing = await sailingResponse(db, pair.sailing);
  const safeSailing = (() => { const { notes: _notes, ...sailing } = fullSailing; return sailing; })();
  const [vessel] = await db.select().from(linerVesselsTable).where(eq(linerVesselsTable.id, pair.sailing.linerVesselId));
  const safeService = (() => { const { notes: _notes, ...service } = pair.service; return service; })();
  return { ...summary, disclosureState: connected ? "CONNECTED" as const : ownsCargo || ownsSailing ? "OWNER" as const : "ANONYMOUS" as const, ownedCargo: ownsCargo ? pair.cargo : null, ownedSailing: ownsSailing ? fullSailing : null, ownedService: ownsSailing ? pair.service : null, ownedVessel: ownsSailing ? vessel ?? null : null, connectedCargo: connected && !ownsCargo ? safeCargo : null, connectedSailing: connected && !ownsSailing ? safeSailing : null, connectedService: connected && !ownsSailing ? safeService : null, connectedVessel: connected && !ownsSailing ? vessel ?? null : null, connectedCompanies: connected ? [{ id: pair.cargoCompany.id, name: pair.cargoCompany.name, country: pair.cargoCompany.country, activities: pair.cargoCompany.activities, primaryContactName: pair.cargoCompany.primaryContactName, email: pair.cargoCompany.email, phone: pair.cargoCompany.phone }, { id: pair.serviceCompany.id, name: pair.serviceCompany.name, country: pair.serviceCompany.country, activities: pair.serviceCompany.activities, primaryContactName: pair.serviceCompany.primaryContactName, email: pair.serviceCompany.email, phone: pair.serviceCompany.phone }] : [] };
}

router.get("/liner/marketplace", async (req, res) => {
  const current = await requireMembership(req, res); if (!current) return; const parsed = ListLinerMarketplaceQueryParams.safeParse(req.query); if (!parsed.success) return error(res, 400, "Invalid liner marketplace filters");
  const items: Array<ReturnType<typeof anonymousLinerCargo> | ReturnType<typeof anonymousLinerSailing>> = [];
  if (parsed.data.listingType !== "SAILING") {
    const origin = alias(locationsTable, "liner_marketplace_origin"); const destination = alias(locationsTable, "liner_marketplace_destination");
    const cargoRows = await db.select({ cargo: linerCargoTable, origin, destination })
      .from(linerCargoTable)
      .innerJoin(origin, eq(origin.id, linerCargoTable.originLocationId))
      .innerJoin(destination, eq(destination.id, linerCargoTable.destinationLocationId))
      .innerJoin(companiesTable, eq(companiesTable.id, linerCargoTable.companyId))
      .where(and(
        eq(linerCargoTable.listingStatus, "ACTIVE"), eq(linerCargoTable.visibility, "OPEN_NETWORK"),
        eq(companiesTable.status, "ACTIVE"), eq(origin.active, true), eq(destination.active, true),
        sql`${companiesTable.activities} && ARRAY['SHIPPER','CHARTERER']::text[]`,
      )).orderBy(linerCargoTable.id);
    for (const row of cargoRows) if (row.cargo.companyId !== current.company.id) items.push(anonymousLinerCargo(row.cargo, row.origin, row.destination));
  }
  if (parsed.data.listingType !== "CARGO") {
    const now = new Date();
    const sailingRows = await db.select({ sailing: linerSailingsTable, service: linerServicesTable, capacity: linerSailingCapacitiesTable })
      .from(linerSailingsTable)
      .innerJoin(linerServicesTable, eq(linerServicesTable.id, linerSailingsTable.serviceId))
      .innerJoin(companiesTable, eq(companiesTable.id, linerServicesTable.companyId))
      .innerJoin(linerVesselsTable, and(eq(linerVesselsTable.id, linerSailingsTable.linerVesselId), eq(linerVesselsTable.companyId, linerServicesTable.companyId)))
      .innerJoin(linerSailingCapacitiesTable, eq(linerSailingCapacitiesTable.sailingId, linerSailingsTable.id))
      .where(and(
        eq(linerSailingsTable.listingStatus, "ACTIVE"), eq(linerSailingsTable.visibility, "OPEN_NETWORK"),
        eq(linerServicesTable.listingStatus, "ACTIVE"), eq(linerServicesTable.visibility, "OPEN_NETWORK"),
        eq(linerVesselsTable.active, true), eq(companiesTable.status, "ACTIVE"),
        gt(linerSailingsTable.cargoCutoffAt, now), gt(linerSailingsTable.departureAt, now),
        sql`${companiesTable.activities} @> ARRAY['CARRIER']::text[]`,
      )).orderBy(linerSailingsTable.id);
    const calls = sailingRows.length ? await db.select({
      sailingId: linerPortRotationsTable.sailingId, region: locationsTable.region, active: locationsTable.active,
    }).from(linerPortRotationsTable).innerJoin(locationsTable, eq(locationsTable.id, linerPortRotationsTable.locationId))
      .where(inArray(linerPortRotationsTable.sailingId, sailingRows.map(row => row.sailing.id)))
      .orderBy(linerPortRotationsTable.sequence) : [];
    for (const row of sailingRows) {
      const rotation = calls.filter(call => call.sailingId === row.sailing.id);
      if (row.service.companyId !== current.company.id && rotation.length >= 2 && rotation.every(call => call.active)) {
        items.push(anonymousLinerSailing(row, [rotation[0]!.region, rotation[rotation.length - 1]!.region]));
      }
    }
  }
  const { page, pageSize, offset } = pageParams(parsed.data.page, parsed.data.pageSize); res.json(ListLinerMarketplaceResponse.parse({ items: items.slice(offset, offset + pageSize), page, pageSize, total: items.length }));
});
router.get("/liner/matches", async (req, res) => {
  const current = await requireMembership(req, res); if (!current) return; const parsed = ListMyLinerMatchesQueryParams.safeParse(req.query); if (!parsed.success) return error(res, 400, "Invalid liner match filters");
  const all = await db.select().from(matchesTable); const bundles = (await Promise.all(all.filter(match => match.linerCargoId && match.linerSailingId && (!parsed.data.status || match.status === parsed.data.status)).map(match => linerBundle(match.id, current.company.id)))).filter((bundle): bundle is NonNullable<typeof bundle> => !!bundle && (bundle.match.status === "CONNECTED" || (!bundle.match.isStale && evaluateLinerEligibility(bundle.pair).eligible)));
  const { page, pageSize, offset } = pageParams(parsed.data.page, parsed.data.pageSize); res.json(ListMyLinerMatchesResponse.parse({ items: await Promise.all(bundles.slice(offset, offset + pageSize).map(bundle => linerMatchResponse(bundle, current.company.id))), page, pageSize, total: bundles.length }));
});
router.get("/liner/matches/:matchId", async (req, res) => {
  const current = await requireMembership(req, res); if (!current) return; const params = GetMyLinerMatchParams.safeParse(req.params); if (!params.success) return error(res, 400, "Invalid match id"); const bundle = await linerBundle(params.data.matchId, current.company.id); if (!bundle || (bundle.match.status !== "CONNECTED" && (bundle.match.isStale || !evaluateLinerEligibility(bundle.pair).eligible))) return error(res, 404, "Liner match not found"); res.json(GetMyLinerMatchResponse.parse(await linerMatchResponse(bundle, current.company.id)));
});
router.post("/liner/matches/:matchId/actions", async (req, res) => {
  const current = await requireMembership(req, res); if (!current) return; const params = ActOnLinerMatchParams.safeParse(req.params); const body = ActOnLinerMatchBody.safeParse(req.body); if (!params.success || !body.success) return error(res, 400, "Invalid liner match action");
  const visible = await linerBundle(params.data.matchId, current.company.id);
  if (!visible) return error(res, 404, "Liner match not found");
  if (visible.match.status !== "CONNECTED" && (visible.match.isStale || !evaluateLinerEligibility(visible.pair).eligible)) return error(res, 409, "This liner match is stale or expired");
  try {
    await db.transaction(async tx => { await lockDomain(tx); const member = await getMembershipWithin(tx, req.user!.id, true); if (!member || !member.membership.active || member.company.status !== "ACTIVE" || member.company.id !== current.company.id) throw new Error("FORBIDDEN"); const [match] = await tx.select().from(matchesTable).where(eq(matchesTable.id, params.data.matchId)).for("update"); if (!match?.linerCargoId || !match.linerSailingId || match.isStale || match.status === "EXPIRED") throw new Error("STALE_MATCH"); const pair = (await listLinerPairs(tx)).find(candidate => candidate.cargo.id === match.linerCargoId && candidate.sailing.id === match.linerSailingId); if (!pair || !evaluateLinerEligibility(pair).eligible) throw new Error("STALE_MATCH"); await applyMatchConsent(tx, { match, actorCompanyId: member.company.id, action: body.data.action, participantCompanyIds: [pair.cargoCompany.id, pair.serviceCompany.id], notificationDomain: "liner" }); });
  } catch (cause) { const reason = cause instanceof Error ? cause.message : ""; return error(res, reason === "STALE_MATCH" ? 409 : reason === "FORBIDDEN" ? 403 : 422, reason === "STALE_MATCH" ? "This liner match is stale or expired" : reason === "FORBIDDEN" ? "Company membership is no longer authorized" : "Match action is not valid for the current state"); }
  const bundle = await linerBundle(params.data.matchId, current.company.id); if (!bundle) return error(res, 500, "Liner match state could not be loaded"); res.json(ActOnLinerMatchResponse.parse(await linerMatchResponse(bundle, current.company.id)));
});

export default router;