import { alias } from "drizzle-orm/pg-core";
import { and, eq, inArray, sql } from "drizzle-orm";

import {
  capacityOffersTable,
  cargoListingsTable,
  companyMembersTable,
  companiesTable,
  interestsTable,
  locationsTable,
  matchesTable,
  notificationsTable,
  vesselsTable,
  db,
} from "@workspace/db";

const CALCULATION_VERSION = "v1";
const EARTH_RADIUS_KM = 6_371;

export type PairInput = {
  cargo: typeof cargoListingsTable.$inferSelect;
  capacity: typeof capacityOffersTable.$inferSelect;
  vessel: typeof vesselsTable.$inferSelect;
  loading: typeof locationsTable.$inferSelect;
  destination: typeof locationsTable.$inferSelect;
  capacityLocation: typeof locationsTable.$inferSelect;
  cargoCompany: typeof companiesTable.$inferSelect;
  capacityCompany: typeof companiesTable.$inferSelect;
};

export type EligibilityResult =
  | { eligible: true; distanceKm: number }
  | { eligible: false; reason: string };

export type ScoreResult = {
  totalScore: number;
  distanceScore: number;
  timingScore: number;
  capacityScore: number;
  vesselTypeScore: number;
  directionScore: number;
  cargoCompatibilityScore: number;
  distanceKm: number;
  evaluationInputs: Record<string, string>;
  explanation: string;
};

function distanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const latitudeDelta = ((to.latitude - from.latitude) * Math.PI) / 180;
  const longitudeDelta = ((to.longitude - from.longitude) * Math.PI) / 180;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos((from.latitude * Math.PI) / 180) *
      Math.cos((to.latitude * Math.PI) / 180) *
      Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreDistance(value: number, maximum: number) {
  if (maximum <= 0) return 0;
  return Math.max(0, Math.min(100, 100 * (1 - value / maximum)));
}

function scoreTiming(
  capacity: typeof capacityOffersTable.$inferSelect,
  cargo: typeof cargoListingsTable.$inferSelect,
) {
  const startsEarly =
    capacity.availableFrom.getTime() <= cargo.loadingFrom.getTime();
  const endsLate =
    capacity.availableUntil.getTime() >= cargo.loadingUntil.getTime();
  if (!startsEarly || !endsLate) return 0;
  const startSlack =
    (cargo.loadingFrom.getTime() - capacity.availableFrom.getTime()) /
    3_600_000;
  const endSlack =
    (capacity.availableUntil.getTime() - cargo.loadingUntil.getTime()) /
    3_600_000;
  return Math.max(0, Math.min(100, 100 - Math.min(100, startSlack + endSlack)));
}

function directionScore(
  preferredDirection: string,
  destination: typeof locationsTable.$inferSelect,
) {
  const direction = preferredDirection.toLowerCase();
  const destinationText =
    `${destination.name} ${destination.region}`.toLowerCase();
  if (direction.includes("rhine") && /duisburg|dusseldorf|düsseldorf|cologne|köln|germany|deutschland/.test(destinationText)) {
    return 100;
  }
  if (direction.split(/[,/ ]+/).some((part) => part.length > 2 && destinationText.includes(part))) {
    return 100;
  }
  if (direction.includes("germany") || direction.includes("rhine")) return 70;
  return 50;
}

function compatibilityScore(
  cargo: typeof cargoListingsTable.$inferSelect,
  capacity: typeof capacityOffersTable.$inferSelect,
) {
  const cargoType = cargo.cargoType.toLowerCase();
  return capacity.cargoCompatibility.some(
    (value) =>
      cargoType.includes(value.toLowerCase()) ||
      value.toLowerCase().includes(cargoType) ||
      value.toLowerCase() === "all",
  )
    ? 100
    : 0;
}

export function evaluateEligibility(pair: PairInput, now = new Date()): EligibilityResult {
  const { cargo, capacity, vessel, loading, cargoCompany, capacityCompany } = pair;
  if (cargoCompany.status !== "ACTIVE" || capacityCompany.status !== "ACTIVE") {
    return { eligible: false, reason: "company_inactive" };
  }
  if (cargoCompany.id === capacityCompany.id) {
    return { eligible: false, reason: "same_company" };
  }
  if (!vessel.active || !loading.active || !pair.destination.active || !pair.capacityLocation.active) {
    return { eligible: false, reason: "catalogue_or_vessel_inactive" };
  }
  if (
    cargo.listingStatus !== "ACTIVE" ||
    cargo.visibility !== "OPEN_NETWORK" ||
    capacity.listingStatus !== "ACTIVE" ||
    capacity.visibility !== "OPEN_NETWORK"
  ) {
    return { eligible: false, reason: "not_discoverable" };
  }
  if (cargo.loadingUntil <= now || capacity.availableUntil <= now) {
    return { eligible: false, reason: "expired" };
  }
  if (capacity.availableCapacityTonnes < cargo.weightTonnes) {
    return { eligible: false, reason: "insufficient_capacity" };
  }
  if (vessel.vesselType !== cargo.requiredVesselType) {
    return { eligible: false, reason: "vessel_type_incompatible" };
  }
  if (compatibilityScore(cargo, capacity) === 0) {
    return { eligible: false, reason: "cargo_incompatible" };
  }
  if (
    capacity.availableFrom > cargo.loadingFrom ||
    capacity.availableUntil < cargo.loadingUntil
  ) {
    return { eligible: false, reason: "timing_incompatible" };
  }
  const distance = distanceKm(loading, pair.capacityLocation);
  if (distance > capacity.maximumPositioningDistanceKm) {
    return { eligible: false, reason: "outside_positioning_distance" };
  }
  return { eligible: true, distanceKm: distance };
}

export function scoreEligiblePair(
  pair: PairInput,
  distance: number,
): ScoreResult {
  const distanceScore = scoreDistance(
    distance,
    pair.capacity.maximumPositioningDistanceKm,
  );
  const timing = scoreTiming(pair.capacity, pair.cargo);
  const capacityScore = Math.min(
    100,
    (pair.capacity.availableCapacityTonnes / pair.cargo.weightTonnes) * 100,
  );
  const vesselType = pair.vessel.vesselType === pair.cargo.requiredVesselType ? 100 : 0;
  const direction = directionScore(
    pair.capacity.preferredDirection,
    pair.destination,
  );
  const compatibility = compatibilityScore(pair.cargo, pair.capacity);
  const total =
    distanceScore * 0.3 +
    timing * 0.25 +
    capacityScore * 0.2 +
    vesselType * 0.1 +
    direction * 0.1 +
    compatibility * 0.05;
  const evaluationInputs = {
    distanceBand:
      distance < 25 ? "< 25 km" : distance < 50 ? "25–50 km" : distance < 100 ? "50–100 km" : "100+ km",
    timingBand: timing >= 90 ? "Strong timing fit" : timing >= 60 ? "Usable timing fit" : "Timing fit",
    capacityBand:
      pair.capacity.availableCapacityTonnes < pair.cargo.weightTonnes * 1.1
        ? "Capacity near requirement"
        : "Capacity above requirement",
    vesselTypeBand: vesselType === 100 ? "Type compatible" : "Type mismatch",
    directionBand: direction >= 90 ? "Direction aligned" : "Direction broadly aligned",
    cargoCompatibilityBand:
      compatibility === 100 ? "Cargo compatible" : "Compatibility uncertain",
  };
  return {
    totalScore: total,
    distanceScore,
    timingScore: timing,
    capacityScore,
    vesselTypeScore: vesselType,
    directionScore: direction,
    cargoCompatibilityScore: compatibility,
    distanceKm: distance,
    evaluationInputs,
    explanation:
      "Potential fit based on approximate positioning, timing, capacity, vessel type, direction, and cargo compatibility. This is not a booking or suitability guarantee.",
  };
}

type QueryExecutor = any;

export async function lockDomain(executor: QueryExecutor) {
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('cargomatch-domain-v1'))`,
  );
}

export async function listPairRows(executor: QueryExecutor = db): Promise<PairInput[]> {
  const loadingLocation = alias(locationsTable, "loading_location");
  const destinationLocation = alias(
    locationsTable,
    "destination_location",
  );
  const capacityLocation = alias(locationsTable, "capacity_location");
  const cargoCompany = alias(companiesTable, "cargo_company");
  const capacityCompany = alias(companiesTable, "capacity_company");
  const rows = await executor
    .select({
      cargo: cargoListingsTable,
      capacity: capacityOffersTable,
      vessel: vesselsTable,
      loading: loadingLocation,
      destination: destinationLocation,
      capacityLocation,
      cargoCompany,
      capacityCompany,
    })
    .from(cargoListingsTable)
    .innerJoin(capacityOffersTable, sql`true`)
    .innerJoin(vesselsTable, eq(vesselsTable.id, capacityOffersTable.vesselId))
    .innerJoin(
      loadingLocation,
      eq(loadingLocation.id, cargoListingsTable.loadingLocationId),
    )
    .innerJoin(
      destinationLocation,
      eq(destinationLocation.id, cargoListingsTable.destinationLocationId),
    )
    .innerJoin(
      capacityLocation,
      eq(capacityLocation.id, capacityOffersTable.locationId),
    )
    .innerJoin(
      cargoCompany,
      eq(cargoCompany.id, cargoListingsTable.companyId),
    )
    .innerJoin(
      capacityCompany,
      eq(capacityCompany.id, capacityOffersTable.companyId),
    );
  return rows as unknown as PairInput[];
}

export type RecalculationOptions = {
  changedCargoIds?: string[];
  changedCapacityIds?: string[];
  changedVesselIds?: string[];
  invalidateAllPending?: boolean;
};

export async function recalculateMatchesWithin(
  executor: QueryExecutor,
  options: RecalculationOptions = {},
) {
  const rows = await listPairRows(executor);
  const existing =
    (await executor.select().from(matchesTable)) as (typeof matchesTable.$inferSelect)[];
  const changedCargoIds = new Set(options.changedCargoIds ?? []);
  const changedCapacityIds = new Set(options.changedCapacityIds ?? []);
  const changedVesselIds = new Set(options.changedVesselIds ?? []);

  const byPair = new Map(
    existing.map((match: typeof matchesTable.$inferSelect) => [
      `${match.cargoListingId}:${match.capacityOfferId}`,
      match,
    ]),
  );
  for (const pair of rows) {
    const eligibility = evaluateEligibility(pair);
    const prior = byPair.get(`${pair.cargo.id}:${pair.capacity.id}`);
    const affected =
      options.invalidateAllPending ||
      changedCargoIds.has(pair.cargo.id) ||
      changedCapacityIds.has(pair.capacity.id) ||
      changedVesselIds.has(pair.vessel.id);
    if (!eligibility.eligible) {
      if (prior && prior.status !== "CONNECTED") {
        await executor
          .delete(interestsTable)
          .where(eq(interestsTable.matchId, prior.id));
        await executor
          .update(matchesTable)
          .set({ isStale: true, status: "EXPIRED", updatedAt: new Date() })
          .where(eq(matchesTable.id, prior.id));
      }
      continue;
    }
    const score = scoreEligiblePair(pair, eligibility.distanceKm);
    const values = {
      cargoListingId: pair.cargo.id,
      capacityOfferId: pair.capacity.id,
      totalScore: score.totalScore,
      distanceScore: score.distanceScore,
      timingScore: score.timingScore,
      capacityScore: score.capacityScore,
      vesselTypeScore: score.vesselTypeScore,
      directionScore: score.directionScore,
      cargoCompatibilityScore: score.cargoCompatibilityScore,
      approximatePositioningDistanceKm: score.distanceKm,
      calculationVersion: CALCULATION_VERSION,
      calculatedAt: new Date(),
      evaluationInputs: score.evaluationInputs,
      explanation: score.explanation,
      isStale: false,
    };
    if (prior) {
      if (affected && prior.status !== "CONNECTED") {
        await executor
          .delete(interestsTable)
          .where(eq(interestsTable.matchId, prior.id));
      }
      await executor
        .update(matchesTable)
        .set({
          ...values,
          status:
            prior.status === "CONNECTED"
              ? "CONNECTED"
              : affected
                ? "NEW"
                : prior.status,
        })
        .where(eq(matchesTable.id, prior.id));
    } else {
      const [created] = await executor
        .insert(matchesTable)
        .values(values)
        .onConflictDoUpdate({
          target: [matchesTable.cargoListingId, matchesTable.capacityOfferId],
          set: values,
        })
        .returning({ id: matchesTable.id });
      const recipients = (await executor
        .select({ userId: companyMembersTable.userId })
        .from(companyMembersTable)
        .where(
          and(
            inArray(companyMembersTable.companyId, [
              pair.cargoCompany.id,
              pair.capacityCompany.id,
            ]),
            eq(companyMembersTable.active, true),
          ),
        )) as Array<{ userId: string }>;
      if (created && recipients.length) {
        await executor.insert(notificationsTable).values(
          recipients.map(({ userId }) => ({
            userId,
            type: "NEW_MATCH" as const,
            title: "New marketplace match",
            message: "A new privacy-safe marketplace match is available for review.",
            relatedMatchId: created.id,
          })),
        );
      }
    }
  }
}

export async function recalculateMatches(
  options: RecalculationOptions = {},
) {
  return db.transaction(async (tx) => {
    await lockDomain(tx);
    await recalculateMatchesWithin(tx, options);
  });
}

export async function expireListings(now = new Date()) {
  await db.transaction(async (tx) => {
    await lockDomain(tx);
    const cargo = await tx
      .update(cargoListingsTable)
      .set({ listingStatus: "EXPIRED", updatedAt: now })
      .where(
        and(
          eq(cargoListingsTable.listingStatus, "ACTIVE"),
          sql`${cargoListingsTable.loadingUntil} <= ${now}`,
        ),
      )
      .returning({ id: cargoListingsTable.id });
    const capacity = await tx
      .update(capacityOffersTable)
      .set({ listingStatus: "EXPIRED", updatedAt: now })
      .where(
        and(
          eq(capacityOffersTable.listingStatus, "ACTIVE"),
          sql`${capacityOffersTable.availableUntil} <= ${now}`,
        ),
      )
      .returning({ id: capacityOffersTable.id });
    if (cargo.length || capacity.length) {
      await recalculateMatchesWithin(tx, {
        changedCargoIds: cargo.map(({ id }) => id),
        changedCapacityIds: capacity.map(({ id }) => id),
      });
    }
  });
}