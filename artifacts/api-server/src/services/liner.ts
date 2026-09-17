import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  companiesTable, companyMembersTable,
  interestsTable,
  linerCargoTable,
  linerPortRotationsTable,
  linerSailingCapacitiesTable,
  linerSailingsTable,
  linerServicesTable,
  linerVesselsTable,
  locationsTable,
  matchesTable,
  notificationsTable,
} from "@workspace/db";

type Executor = any;

export type LinerPair = {
  cargo: typeof linerCargoTable.$inferSelect;
  sailing: typeof linerSailingsTable.$inferSelect;
  service: typeof linerServicesTable.$inferSelect;
  vessel: typeof linerVesselsTable.$inferSelect;
  capacity: typeof linerSailingCapacitiesTable.$inferSelect;
  cargoCompany: typeof companiesTable.$inferSelect;
  serviceCompany: typeof companiesTable.$inferSelect;
  origin: typeof locationsTable.$inferSelect;
  destination: typeof locationsTable.$inferSelect;
  rotation: Array<typeof linerPortRotationsTable.$inferSelect>;
};

export type LinerEligibility =
  | { eligible: true; originSequence: number; destinationSequence: number }
  | { eligible: false; reason: string };

export function linerStowageFits(required: "DECK" | "HOLD" | "EITHER", offered: "DECK" | "HOLD" | "EITHER") {
  return required === "EITHER" || offered === "EITHER" || required === offered;
}

export function evaluateLinerEligibility(pair: LinerPair, now = new Date()): LinerEligibility {
  const { cargo, sailing, service, vessel, capacity, cargoCompany, serviceCompany } = pair;
  if (cargoCompany.status !== "ACTIVE" || serviceCompany.status !== "ACTIVE") return { eligible: false, reason: "company_inactive" };
  if (!serviceCompany.activities.includes("CARRIER")) return { eligible: false, reason: "service_company_not_carrier" };
  if (!cargoCompany.activities.some((activity) => activity === "SHIPPER" || activity === "CHARTERER")) return { eligible: false, reason: "cargo_company_not_shipper_or_charterer" };
  if (cargoCompany.id === serviceCompany.id) return { eligible: false, reason: "same_company" };
  if (!pair.origin.active || !pair.destination.active || !vessel.active || vessel.companyId !== service.companyId) return { eligible: false, reason: "catalogue_or_actual_vessel_inactive" };
  if (cargo.listingStatus !== "ACTIVE" || sailing.listingStatus !== "ACTIVE" || service.listingStatus !== "ACTIVE" || cargo.visibility !== "OPEN_NETWORK" || sailing.visibility !== "OPEN_NETWORK" || service.visibility !== "OPEN_NETWORK") return { eligible: false, reason: "not_discoverable" };
  if (sailing.cargoCutoffAt <= now || sailing.departureAt <= now || cargo.readyAt > sailing.cargoCutoffAt || sailing.cargoCutoffAt >= sailing.departureAt) return { eligible: false, reason: "cutoff_or_readiness_incompatible" };
  const values = [
    cargo.totalWeightTonnes, cargo.pieceWeightTonnes, cargo.pieceLengthMetres, cargo.pieceWidthMetres, cargo.pieceHeightMetres,
    capacity.availableCommercialTonnes, capacity.maximumPieceWeightTonnes, capacity.maximumPieceLengthMetres, capacity.maximumPieceWidthMetres,
    capacity.maximumPieceHeightMetres, capacity.liftingCapacityTonnes,
  ];
  if (values.some((value) => !Number.isFinite(value) || value <= 0) ||
    !Number.isInteger(cargo.pieceCount) || cargo.pieceCount < 1 ||
    cargo.totalWeightTonnes < cargo.pieceWeightTonnes ||
    cargo.totalWeightTonnes > cargo.pieceCount * cargo.pieceWeightTonnes) return { eligible: false, reason: "invalid_commercial_dimensions_or_weight" };
  if (cargo.totalWeightTonnes > capacity.availableCommercialTonnes) return { eligible: false, reason: "insufficient_commercial_tonnage" };
  if (cargo.pieceWeightTonnes > capacity.maximumPieceWeightTonnes || cargo.pieceLengthMetres > capacity.maximumPieceLengthMetres || cargo.pieceWidthMetres > capacity.maximumPieceWidthMetres || cargo.pieceHeightMetres > capacity.maximumPieceHeightMetres) return { eligible: false, reason: "piece_dimensions_or_weight_incompatible" };
  if (cargo.requiredLiftingTonnes != null && cargo.requiredLiftingTonnes > capacity.liftingCapacityTonnes) return { eligible: false, reason: "lifting_incompatible" };
  if (!linerStowageFits(cargo.requiredStowage, capacity.stowage)) return { eligible: false, reason: "stowage_incompatible" };
  if (!capacity.acceptedCargoTypes.includes(cargo.cargoType)) return { eligible: false, reason: "cargo_type_incompatible" };
  const origin = pair.rotation.find((call) => call.locationId === cargo.originLocationId && cargo.readyAt <= call.estimatedDeparture);
  const destination = origin && pair.rotation.find((call) => call.locationId === cargo.destinationLocationId && call.sequence > origin.sequence);
  if (!origin || !destination) return { eligible: false, reason: "rotation_does_not_serve_ready_origin_before_destination" };
  return { eligible: true, originSequence: origin.sequence, destinationSequence: destination.sequence };
}

export async function listLinerPairs(executor: Executor): Promise<LinerPair[]> {
  const cargoCompany = alias(companiesTable, "liner_cargo_company");
  const serviceCompany = alias(companiesTable, "liner_service_company");
  const origin = alias(locationsTable, "liner_origin");
  const destination = alias(locationsTable, "liner_destination");
  const rows = await executor.select({
    cargo: linerCargoTable, sailing: linerSailingsTable, service: linerServicesTable, vessel: linerVesselsTable, capacity: linerSailingCapacitiesTable,
    cargoCompany, serviceCompany, origin, destination,
  }).from(linerCargoTable)
    .innerJoin(linerSailingsTable, sql`true`)
    .innerJoin(linerServicesTable, eq(linerServicesTable.id, linerSailingsTable.serviceId))
    .innerJoin(linerVesselsTable, eq(linerVesselsTable.id, linerSailingsTable.linerVesselId))
    .innerJoin(linerSailingCapacitiesTable, eq(linerSailingCapacitiesTable.sailingId, linerSailingsTable.id))
    .innerJoin(cargoCompany, eq(cargoCompany.id, linerCargoTable.companyId))
    .innerJoin(serviceCompany, eq(serviceCompany.id, linerServicesTable.companyId))
    .innerJoin(origin, eq(origin.id, linerCargoTable.originLocationId))
    .innerJoin(destination, eq(destination.id, linerCargoTable.destinationLocationId));
  const sailingIds = [...new Set(rows.map((row: any) => row.sailing.id))] as string[];
  const rotations = sailingIds.length ? await executor.select().from(linerPortRotationsTable).where(inArray(linerPortRotationsTable.sailingId, sailingIds)) : [];
  const bySailing = new Map<string, Array<typeof linerPortRotationsTable.$inferSelect>>();
  for (const call of rotations) bySailing.set(call.sailingId, [...(bySailing.get(call.sailingId) ?? []), call]);
  return rows.map((row: any) => ({ ...row, rotation: (bySailing.get(row.sailing.id) ?? []).sort((a, b) => a.sequence - b.sequence) }));
}

export async function recalculateLinerMatchesWithin(executor: Executor, changed: { cargoIds?: string[]; sailingIds?: string[]; serviceIds?: string[] } = {}) {
  const pairs = await listLinerPairs(executor);
  const existing = await executor.select().from(matchesTable).where(isNotNull(matchesTable.linerCargoId)) as Array<typeof matchesTable.$inferSelect>;
  const byPair = new Map<string, typeof matchesTable.$inferSelect>(existing.map((match) => [`${match.linerCargoId}:${match.linerSailingId}`, match]));
  const changedCargo = new Set(changed.cargoIds ?? []);
  const changedSailing = new Set(changed.sailingIds ?? []);
  const changedService = new Set(changed.serviceIds ?? []);
  for (const pair of pairs) {
    const key = `${pair.cargo.id}:${pair.sailing.id}`;
    const prior = byPair.get(key);
    const eligibility = evaluateLinerEligibility(pair);
    const affected = changedCargo.has(pair.cargo.id) || changedSailing.has(pair.sailing.id) || changedService.has(pair.service.id);
    if (!eligibility.eligible) {
      if (prior && prior.status !== "CONNECTED") {
        await executor.delete(interestsTable).where(eq(interestsTable.matchId, prior.id));
        await executor.update(matchesTable).set({ status: "EXPIRED", isStale: true, updatedAt: new Date() }).where(eq(matchesTable.id, prior.id));
      }
      continue;
    }
    const dims = Math.min(100, (capacityDimensionHeadroom(pair) * 100));
    const weight = Math.min(100, (pair.capacity.availableCommercialTonnes / pair.cargo.totalWeightTonnes) * 100);
    const lifting = pair.cargo.requiredLiftingTonnes == null ? 100 : Math.min(100, (pair.capacity.liftingCapacityTonnes / pair.cargo.requiredLiftingTonnes) * 100);
    const stowage = 100;
    const rotation = 100;
    const timing = 100;
    const total = dims * .25 + weight * .2 + lifting * .15 + stowage * .1 + rotation * .2 + timing * .1;
    const values = {
      linerCargoId: pair.cargo.id, linerSailingId: pair.sailing.id, totalScore: total, distanceScore: rotation, timingScore: timing, capacityScore: weight,
      vesselTypeScore: dims, directionScore: lifting, cargoCompatibilityScore: stowage, approximatePositioningDistanceKm: 0, calculationVersion: "liner-v1",
      calculatedAt: new Date(), evaluationInputs: { dimensionsFit: `${Math.round(dims)}`, weightFit: `${Math.round(weight)}`, liftingFit: `${Math.round(lifting)}`, stowageFit: "100", rotationFit: "100", timingFit: "100" },
      explanation: "Potential conventional liner fit based on published commercial capacity, piece limits, lifting, stowage, ordered port rotation, readiness, and cutoff. This is not a booking.", isStale: false,
    };
    if (prior) {
      if (affected && prior.status !== "CONNECTED") await executor.delete(interestsTable).where(eq(interestsTable.matchId, prior.id));
      await executor.update(matchesTable).set({ ...values, status: prior.status === "CONNECTED" ? "CONNECTED" : affected ? "NEW" : prior.status }).where(eq(matchesTable.id, prior.id));
    } else {
      const [created] = await executor.insert(matchesTable).values(values).returning();
      const recipients = await executor.select({ userId: companyMembersTable.userId }).from(companyMembersTable).where(and(
        inArray(companyMembersTable.companyId, [pair.cargoCompany.id, pair.serviceCompany.id]),
        eq(companyMembersTable.active, true),
      ));
      if (created && recipients.length) {
        await executor.insert(notificationsTable).values(recipients.map(({ userId }: { userId: string }) => ({
          userId, type: "NEW_MATCH" as const, title: "New liner match",
          message: "A new privacy-safe liner match is available for review.", relatedMatchId: created.id, relatedMatchDomain: "LINER",
        })));
      }
    }
  }
}

function capacityDimensionHeadroom(pair: LinerPair) {
  return Math.min(
    pair.capacity.maximumPieceWeightTonnes / pair.cargo.pieceWeightTonnes,
    pair.capacity.maximumPieceLengthMetres / pair.cargo.pieceLengthMetres,
    pair.capacity.maximumPieceWidthMetres / pair.cargo.pieceWidthMetres,
    pair.capacity.maximumPieceHeightMetres / pair.cargo.pieceHeightMetres,
  );
}