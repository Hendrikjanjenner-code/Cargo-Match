/**
 * Browser-safe matching primitives used by the CargoMatch demonstration.
 *
 * This intentionally mirrors the pure part of api-server/src/services/matching.ts.
 * It has no database or network dependency, so a demo evaluation cannot reach the
 * real marketplace. Keep the calculation version and weights in step with the
 * server implementation when the matching rules change.
 */

export const DEMO_CALCULATION_VERSION = "v1";

const EARTH_RADIUS_KM = 6_371;

export type MatchingLocation = {
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  active: boolean;
};

export type MatchingCargo = {
  id: string;
  companyId: string;
  companyStatus: string;
  cargoType: string;
  weightTonnes: number;
  loadingFrom: string;
  loadingUntil: string;
  requiredVesselType: string;
  listingStatus: string;
  visibility: string;
};

export type MatchingCapacity = {
  id: string;
  companyId: string;
  companyStatus: string;
  availableFrom: string;
  availableUntil: string;
  availableCapacityTonnes: number;
  cargoCompatibility: string[];
  preferredDirection: string;
  maximumPositioningDistanceKm: number;
  listingStatus: string;
  visibility: string;
};

export type MatchingVessel = {
  id: string;
  active: boolean;
  vesselType: string;
};

export type MatchingPair = {
  cargo: MatchingCargo;
  capacity: MatchingCapacity;
  vessel: MatchingVessel;
  loading: MatchingLocation;
  destination: MatchingLocation;
  capacityLocation: MatchingLocation;
};

export type DemoEligibilityResult =
  | { eligible: true; distanceKm: number }
  | { eligible: false; reason: string };

export type DemoScoreResult = {
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

function asDate(value: string) {
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) {
    throw new RangeError(`Invalid demo date: ${value}`);
  }
  return result;
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
  capacity: MatchingCapacity,
  cargo: MatchingCargo,
) {
  const cargoFrom = asDate(cargo.loadingFrom).getTime();
  const cargoUntil = asDate(cargo.loadingUntil).getTime();
  const capacityFrom = asDate(capacity.availableFrom).getTime();
  const capacityUntil = asDate(capacity.availableUntil).getTime();
  const startsEarly = capacityFrom <= cargoFrom;
  const endsLate = capacityUntil >= cargoUntil;
  if (!startsEarly || !endsLate) return 0;
  const startSlack = (cargoFrom - capacityFrom) / 3_600_000;
  const endSlack = (capacityUntil - cargoUntil) / 3_600_000;
  return Math.max(0, Math.min(100, 100 - Math.min(100, startSlack + endSlack)));
}

function directionScore(
  preferredDirection: string,
  destination: MatchingLocation,
) {
  const direction = preferredDirection.toLowerCase();
  const destinationText =
    `${destination.name} ${destination.region}`.toLowerCase();
  if (
    direction.includes("rhine") &&
    /duisburg|dusseldorf|düsseldorf|cologne|köln|germany|deutschland/.test(
      destinationText,
    )
  ) {
    return 100;
  }
  if (
    direction
      .split(/[,/ ]+/)
      .some((part) => part.length > 2 && destinationText.includes(part))
  ) {
    return 100;
  }
  if (direction.includes("germany") || direction.includes("rhine")) return 70;
  return 50;
}

function compatibilityScore(
  cargo: MatchingCargo,
  capacity: MatchingCapacity,
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

export function evaluateDemoEligibility(
  pair: MatchingPair,
  now: Date,
): DemoEligibilityResult {
  const { cargo, capacity, vessel, loading, destination, capacityLocation } =
    pair;
  if (
    cargo.companyStatus !== "ACTIVE" ||
    capacity.companyStatus !== "ACTIVE"
  ) {
    return { eligible: false, reason: "company_inactive" };
  }
  if (cargo.companyId === capacity.companyId) {
    return { eligible: false, reason: "same_company" };
  }
  if (
    !vessel.active ||
    !loading.active ||
    !destination.active ||
    !capacityLocation.active
  ) {
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
  if (
    asDate(cargo.loadingUntil) <= now ||
    asDate(capacity.availableUntil) <= now
  ) {
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
    asDate(capacity.availableFrom) > asDate(cargo.loadingFrom) ||
    asDate(capacity.availableUntil) < asDate(cargo.loadingUntil)
  ) {
    return { eligible: false, reason: "timing_incompatible" };
  }
  const distance = distanceKm(loading, capacityLocation);
  if (distance > capacity.maximumPositioningDistanceKm) {
    return { eligible: false, reason: "outside_positioning_distance" };
  }
  return { eligible: true, distanceKm: distance };
}

export function scoreDemoEligiblePair(
  pair: MatchingPair,
  distance: number,
): DemoScoreResult {
  const distanceScore = scoreDistance(
    distance,
    pair.capacity.maximumPositioningDistanceKm,
  );
  const timing = scoreTiming(pair.capacity, pair.cargo);
  const capacityScore = Math.min(
    100,
    (pair.capacity.availableCapacityTonnes / pair.cargo.weightTonnes) * 100,
  );
  const vesselType =
    pair.vessel.vesselType === pair.cargo.requiredVesselType ? 100 : 0;
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
      distance < 25
        ? "< 25 km"
        : distance < 50
          ? "25–50 km"
          : distance < 100
            ? "50–100 km"
            : "100+ km",
    timingBand:
      timing >= 90
        ? "Strong timing fit"
        : timing >= 60
          ? "Usable timing fit"
          : "Timing fit",
    capacityBand:
      pair.capacity.availableCapacityTonnes < pair.cargo.weightTonnes * 1.1
        ? "Capacity near requirement"
        : "Capacity above requirement",
    vesselTypeBand: vesselType === 100 ? "Type compatible" : "Type mismatch",
    directionBand:
      direction >= 90 ? "Direction aligned" : "Direction broadly aligned",
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