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
  deepseaCapacityExtensionsTable,
  deepseaCargoRequirementsTable,
  deepseaVesselProfilesTable,
  db,
} from "@workspace/db";
import {
  evaluateDeepseaReachability,
  validateDeepseaCapacityExtension,
} from "./deepsea";
export { evaluateDeepseaReachability } from "./deepsea";

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
  deepseaProfile: typeof deepseaVesselProfilesTable.$inferSelect | null;
  deepseaRequirement: typeof deepseaCargoRequirementsTable.$inferSelect | null;
  deepseaExtension: typeof deepseaCapacityExtensionsTable.$inferSelect | null;
};

export type EligibilityResult =
  | { eligible: true; distanceKm: number; provisional?: boolean }
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

/**
 * Capacity is a physical claim about a specific vessel. Keep this check in
 * the matching layer as well as the write routes so legacy or manually
 * imported rows can never become eligible just because they bypassed the
 * API validation.
 */
export function isCapacityWithinVessel(
  availableCapacityTonnes: number,
  totalCapacityTonnes: number,
) {
  return (
    Number.isFinite(availableCapacityTonnes) &&
    availableCapacityTonnes > 0 &&
    Number.isFinite(totalCapacityTonnes) &&
    totalCapacityTonnes > 0 &&
    availableCapacityTonnes <= totalCapacityTonnes
  );
}

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
  const cargoMode = cargo.transportMode ?? "INLAND_WATERWAY";
  const capacityMode = capacity.transportMode ?? "INLAND_WATERWAY";
  const vesselMode = vessel.transportMode ?? "INLAND_WATERWAY";
  if (cargoMode !== capacityMode || capacityMode !== vesselMode) {
    return { eligible: false, reason: "transport_mode_mismatch" };
  }
  if (cargoMode === "DEEPSEA_BULK") {
    return evaluateDeepseaEligibility(pair, now);
  }
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
  if (
    !Number.isFinite(cargo.weightTonnes) ||
    cargo.weightTonnes <= 0
  ) {
    return { eligible: false, reason: "invalid_cargo_weight" };
  }
  if (
    !Number.isFinite(cargo.loadingFrom.getTime()) ||
    !Number.isFinite(cargo.loadingUntil.getTime()) ||
    cargo.loadingFrom >= cargo.loadingUntil ||
    !Number.isFinite(capacity.availableFrom.getTime()) ||
    !Number.isFinite(capacity.availableUntil.getTime()) ||
    capacity.availableFrom >= capacity.availableUntil
  ) {
    return { eligible: false, reason: "invalid_time_window" };
  }
  if (
    !isCapacityWithinVessel(
      capacity.availableCapacityTonnes,
      vessel.totalCapacityTonnes,
    )
  ) {
    return { eligible: false, reason: "invalid_physical_capacity" };
  }
  if (
    !Number.isFinite(capacity.maximumPositioningDistanceKm) ||
    capacity.maximumPositioningDistanceKm <= 0
  ) {
    return { eligible: false, reason: "invalid_positioning_distance" };
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

export function evaluateDeepseaEligibility(
  pair: PairInput,
  now = new Date(),
): EligibilityResult {
  const { cargo, capacity, vessel, loading, cargoCompany, capacityCompany } = pair;
  const profile = pair.deepseaProfile;
  const requirement = pair.deepseaRequirement;
  if (cargoCompany.status !== "ACTIVE" || capacityCompany.status !== "ACTIVE") {
    return { eligible: false, reason: "company_inactive" };
  }
  if (cargoCompany.id === capacityCompany.id) {
    return { eligible: false, reason: "same_company" };
  }
  if (
    !profile ||
    !requirement ||
    !vessel.active ||
    !loading.active ||
    !pair.destination.active ||
    !pair.capacityLocation.active
  ) {
    return { eligible: false, reason: "required_deepsea_profile_missing" };
  }
  if (!validateDeepseaCapacityExtension(pair.deepseaExtension)) {
    return { eligible: false, reason: "invalid_deepsea_extension" };
  }
  if (vessel.vesselType !== cargo.requiredVesselType) {
    return { eligible: false, reason: "vessel_type_incompatible" };
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
  if (
    !Number.isFinite(cargo.weightTonnes) ||
    cargo.weightTonnes <= 0 ||
    !Number.isFinite(capacity.availableCapacityTonnes) ||
    capacity.availableCapacityTonnes <= 0
  ) {
    return { eligible: false, reason: "invalid_tonnage" };
  }
  if (capacity.availableCapacityTonnes > profile.dwtTonnes) {
    return { eligible: false, reason: "cargo_tonnage_exceeds_vessel_dwt" };
  }
  if (compatibilityScore(cargo, capacity) === 0) {
    return { eligible: false, reason: "cargo_incompatible" };
  }
  if (
    !Number.isFinite(cargo.loadingFrom.getTime()) ||
    !Number.isFinite(cargo.loadingUntil.getTime()) ||
    cargo.loadingFrom >= cargo.loadingUntil ||
    !Number.isFinite(capacity.availableFrom.getTime()) ||
    !Number.isFinite(capacity.availableUntil.getTime()) ||
    capacity.availableFrom >= capacity.availableUntil
  ) {
    return { eligible: false, reason: "invalid_time_window" };
  }
  const tolerance = requirement.quantityTolerancePercent;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance >= 100) {
    return { eligible: false, reason: "invalid_quantity_tolerance" };
  }
  if (capacity.availableCapacityTonnes < cargo.weightTonnes * (1 - tolerance / 100)) {
    return { eligible: false, reason: "insufficient_cargo_tonnage" };
  }
  if (
    (requirement.minimumVesselDwtTonnes != null &&
      profile.dwtTonnes < requirement.minimumVesselDwtTonnes) ||
    (requirement.maximumVesselDwtTonnes != null &&
      profile.dwtTonnes > requirement.maximumVesselDwtTonnes)
  ) {
    return { eligible: false, reason: "dwt_incompatible" };
  }
  if (
    requirement.maximumDraftMetres != null &&
    (profile.summerDraftMetres == null ||
      profile.summerDraftMetres > requirement.maximumDraftMetres)
  ) {
    return { eligible: false, reason: "draft_incompatible" };
  }
  if (requirement.requiredGear) {
    const requiredGear = requirement.requiredGear.trim().toLowerCase();
    if (!profile.gearConfiguration) {
      return { eligible: false, reason: "required_gear_unknown" };
    }
    if (!requiredGear) {
      return { eligible: false, reason: "invalid_required_gear" };
    }
    if (profile.gearConfiguration.trim().toLowerCase() !== requiredGear) {
      return { eligible: false, reason: "gear_incompatible" };
    }
  }
  const distance = distanceKm(loading, pair.capacityLocation);
  const maximumDistance =
    pair.deepseaExtension?.approximateMaxDistanceKm ??
    capacity.maximumPositioningDistanceKm;
  if (!Number.isFinite(maximumDistance) || maximumDistance <= 0) {
    return { eligible: false, reason: "invalid_positioning_distance" };
  }
  if (distance > maximumDistance) {
    return { eligible: false, reason: "outside_approximate_positioning_distance" };
  }
  const repositioningDays = pair.deepseaExtension?.manualPositioningDays;
  if (capacity.availableUntil < cargo.loadingFrom) {
    return { eligible: false, reason: "laycan_incompatible" };
  }
  const reachability = evaluateDeepseaReachability({
    availableFrom: capacity.availableFrom,
    availableUntil: capacity.availableUntil,
    laycanFrom: cargo.loadingFrom,
    laycanUntil: cargo.loadingUntil,
    now,
    manualPositioningDays: repositioningDays,
    departureUncertaintyDays:
      pair.deepseaExtension?.departureUncertaintyDays,
    positioningBufferDays: pair.deepseaExtension?.positioningBufferDays,
  });
  if (reachability.definitelyLate) {
    return { eligible: false, reason: "laycan_incompatible_with_positioning" };
  }
  return {
    eligible: true,
    distanceKm: distance,
    // Manual inputs are useful estimates, but never independently verified.
    provisional: true,
  };
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

export function scoreDeepseaEligiblePair(
  pair: PairInput,
  distance: number,
  now = new Date(),
): ScoreResult {
  const maximumDistance =
    pair.deepseaExtension?.approximateMaxDistanceKm ??
    pair.capacity.maximumPositioningDistanceKm;
  const distanceScore = scoreDistance(distance, maximumDistance);
  const requirement = pair.deepseaRequirement!;
  const profile = pair.deepseaProfile!;
  const tolerance = requirement.quantityTolerancePercent;
  const capacityScore = Math.min(
    100,
    (pair.capacity.availableCapacityTonnes /
      (pair.cargo.weightTonnes * (1 - tolerance / 100))) *
      100,
  );
  const classScore =
    !requirement.preferredVesselClass ||
    requirement.preferredVesselClass === profile.vesselClass
      ? 100
      : 0;
  const compatibility = compatibilityScore(pair.cargo, pair.capacity);
  const reachability = evaluateDeepseaReachability({
    availableFrom: pair.capacity.availableFrom,
    availableUntil: pair.capacity.availableUntil,
    laycanFrom: pair.cargo.loadingFrom,
    laycanUntil: pair.cargo.loadingUntil,
    now,
    manualPositioningDays: pair.deepseaExtension?.manualPositioningDays,
    departureUncertaintyDays:
      pair.deepseaExtension?.departureUncertaintyDays,
    positioningBufferDays: pair.deepseaExtension?.positioningBufferDays,
  });
  // Ranking weights, not a probability or independent verification. Missing
  // assumptions must not rank as highly as an estimated interval within laycan.
  const timing = reachability.definitelyLate ? 0 : {
    WITHIN_WINDOW: 100,
    UNCERTAIN: 50,
    UNKNOWN: 25,
    TOO_LATE: 0,
  }[reachability.laycanAssessment];
  const total =
    distanceScore * 0.35 +
    timing * 0.25 +
    capacityScore * 0.2 +
    classScore * 0.1 +
    compatibility * 0.1;
  const extension = pair.deepseaExtension;
  const routeChoice =
    extension?.routeChoice && extension.routeChoice !== "UNSPECIFIED"
      ? "USER_SELECTED"
      : "NOT_CONFIGURED";
  return {
    totalScore: total,
    distanceScore,
    timingScore: timing,
    capacityScore,
    vesselTypeScore: classScore,
    directionScore: 50,
    cargoCompatibilityScore: compatibility,
    distanceKm: distance,
    evaluationInputs: {
      distanceBand: distance < 500 ? "< 500 km approx." : "500+ km approx.",
      timingBand:
        reachability.definitelyLate
          ? "Timing not feasible"
          : reachability.laycanAssessment === "WITHIN_WINDOW"
          ? "Laycan and buffer fit"
          : reachability.laycanAssessment === "TOO_LATE"
            ? "Timing not feasible"
            : "Provisional timing fit",
      capacityBand: "Deepsea cargo tonnage fit",
      vesselTypeBand: `${profile.vesselClass} / DWT fit`,
      directionBand: "Trade direction requires commercial confirmation",
      cargoCompatibilityBand:
        compatibility === 100 ? "Cargo compatible" : "Compatibility uncertain",
      reachabilityStatus: reachability.reachabilityStatus,
      laycanAssessment: reachability.laycanAssessment,
      routeChoice,
      departureUncertainty:
        extension?.departureUncertaintyDays == null
          ? "UNKNOWN"
          : "USER_ESTIMATED",
      positioningBuffer:
        extension?.positioningBufferDays == null
          ? "UNKNOWN"
          : "USER_ESTIMATED",
      routeDataAccess: "NOT_CONFIGURED",
      verification: "NOT_VERIFIED",
    },
    explanation:
      reachability.reachabilityStatus === "UNKNOWN" ||
      reachability.laycanAssessment === "UNKNOWN"
        ? "Potential deepsea dry-bulk fit using geodesic approximate positioning. Manual travel and route timing inputs are incomplete, so feasibility is provisional and not a verified route."
        : "Potential deepsea dry-bulk fit using user-estimated travel, departure, and positioning inputs. This is provisional and not a verified sailing route or booking.",
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
      deepseaProfile: deepseaVesselProfilesTable,
      deepseaRequirement: deepseaCargoRequirementsTable,
      deepseaExtension: deepseaCapacityExtensionsTable,
    })
    .from(cargoListingsTable)
    .innerJoin(capacityOffersTable, sql`true`)
    .innerJoin(vesselsTable, eq(vesselsTable.id, capacityOffersTable.vesselId))
    .leftJoin(
      deepseaVesselProfilesTable,
      eq(deepseaVesselProfilesTable.vesselId, vesselsTable.id),
    )
    .leftJoin(
      deepseaCargoRequirementsTable,
      eq(deepseaCargoRequirementsTable.cargoListingId, cargoListingsTable.id),
    )
    .leftJoin(
      deepseaCapacityExtensionsTable,
      eq(
        deepseaCapacityExtensionsTable.capacityOfferId,
        capacityOffersTable.id,
      ),
    )
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
  const now = new Date();
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
    const eligibility = evaluateEligibility(pair, now);
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
    const score =
      pair.cargo.transportMode === "DEEPSEA_BULK"
        ? scoreDeepseaEligiblePair(pair, eligibility.distanceKm, now)
        : scoreEligiblePair(pair, eligibility.distanceKm);
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
      calculationVersion:
        pair.cargo.transportMode === "DEEPSEA_BULK"
          ? "deepsea-v3"
          : CALCULATION_VERSION,
      calculatedAt: now,
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