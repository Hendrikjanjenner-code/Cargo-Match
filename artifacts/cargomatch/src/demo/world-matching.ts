import {
  evaluateDemoEligibility,
  scoreDemoEligiblePair,
} from "./matching";
import type {
  WorldAsset,
  WorldCargo,
  WorldDeparture,
  WorldLinerCargoType,
  WorldMatchEvaluation,
  WorldOffer,
  WorldState,
} from "./world-types";

/**
 * Browser-safe adapter for the pure matching rules.  It intentionally has no
 * API, database, session, or route imports.  The demo uses a compact contract,
 * but does not turn missing mode-specific commercial data into a match.
 */
export const WORLD_CALCULATION_VERSION = "world-v3";
const EARTH_RADIUS_KM = 6_371;
const LINER_CARGO_TYPES: readonly WorldLinerCargoType[] = [
  "BREAKBULK", "PROJECT_CARGO", "HEAVY_LIFT", "STEEL", "MACHINERY", "RORO",
];

const fail = (reason: string, distanceKm?: number): WorldMatchEvaluation =>
  ({ eligible: false, score: 0, reason, calculationVersion: WORLD_CALCULATION_VERSION, ...(distanceKm == null ? {} : { distanceKm }) });
const pass = (score: number, extra: Omit<WorldMatchEvaluation, "eligible" | "score" | "calculationVersion"> = {}): WorldMatchEvaluation =>
  ({ eligible: true, score, calculationVersion: WORLD_CALCULATION_VERSION, ...extra });
const validDate = (value: string) => {
  const result = new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
};
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const finiteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const sameText = (left: string | null | undefined, right: string | null | undefined) =>
  left?.trim().toLowerCase() === right?.trim().toLowerCase();
const includesAll = (values: string[], required: string[]) => {
  const available = new Set(values.map((value) => value.trim().toLowerCase()));
  return required.every((value) => available.has(value.trim().toLowerCase()));
};
const cargoCompatible = (cargo: WorldCargo, offer: WorldOffer) => {
  const cargoType = cargo.cargoType.toLowerCase();
  return offer.cargoTypes.some((value) => {
    const candidate = value.toLowerCase();
    return candidate === "all" || cargoType.includes(candidate) || candidate.includes(cargoType);
  });
};
const distance = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
  const lat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const lon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const value = Math.sin(lat / 2) ** 2
    + Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(lon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};
const scoreDistance = (value: number, maximum: number) => Math.max(0, Math.min(100, 100 * (1 - value / maximum)));
const modeOf = (cargo: WorldCargo, offer: WorldOffer) =>
  cargo.mode === offer.mode ? undefined : "mode_incompatible";

function offerBase(cargo: WorldCargo, offer: WorldOffer, state: WorldState, now: Date) {
  const asset = state.assets.find((item) => item.id === offer.assetId);
  const cargoCompany = state.companies.find((item) => item.id === cargo.companyId);
  const offerCompany = state.companies.find((item) => item.id === offer.companyId);
  const cargoFrom = validDate(cargo.readyFrom);
  const cargoUntil = validDate(cargo.readyUntil);
  const offerFrom = validDate(offer.availableFrom);
  const offerUntil = validDate(offer.availableUntil);
  const mode = modeOf(cargo, offer);
  if (mode) return { result: fail(mode) };
  if (!cargoCompany || cargoCompany.status !== "ACTIVE" || !offerCompany || offerCompany.status !== "ACTIVE") return { result: fail("company_inactive") };
  if (cargo.companyId === offer.companyId) return { result: fail("same_company") };
  if (!asset || !asset.active || asset.companyId !== offer.companyId || asset.mode !== offer.mode) return { result: fail("asset_inactive_or_unowned") };
  if (!cargo.origin.active || !cargo.destination.active || !offer.location.active) return { result: fail("catalogue_inactive") };
  if (cargo.listingStatus !== "ACTIVE" || cargo.visibility !== "OPEN_NETWORK" || offer.listingStatus !== "ACTIVE" || offer.visibility !== "OPEN_NETWORK") return { result: fail("not_discoverable") };
  if (!cargoFrom || !cargoUntil || !offerFrom || !offerUntil || cargoFrom >= cargoUntil || offerFrom >= offerUntil) return { result: fail("invalid_time_window") };
  if (cargoUntil <= now || offerUntil <= now) return { result: fail("expired") };
  if (!positive(cargo.weightTonnes) || !positive(offer.capacityTonnes)) return { result: fail("invalid_tonnage") };
  return { asset, cargoFrom, cargoUntil, offerFrom, offerUntil };
}

function inland(cargo: WorldCargo, offer: WorldOffer, state: WorldState, now: Date, asset: WorldAsset) {
  const maximum = offer.maximumPositioningDistanceKm ??
    Number(offer.projection?.maximumPositioningDistanceKm);
  if (!positive(maximum)) return fail("invalid_positioning_distance");
  if (offer.capacityTonnes > asset.capacityTonnes) return fail("invalid_physical_capacity");
  if (!cargo.requiredVesselType) return fail("required_inland_fields_missing");
  const cargoCompany = state.companies.find((item) => item.id === cargo.companyId)!;
  const offerCompany = state.companies.find((item) => item.id === offer.companyId)!;
  const result = evaluateDemoEligibility({
    cargo: {
      id: cargo.id, companyId: cargo.companyId, companyStatus: cargoCompany.status, cargoType: cargo.cargoType,
      weightTonnes: cargo.weightTonnes, loadingFrom: cargo.readyFrom, loadingUntil: cargo.readyUntil,
      requiredVesselType: cargo.requiredVesselType, listingStatus: cargo.listingStatus, visibility: cargo.visibility,
    },
    capacity: {
      id: offer.id, companyId: offer.companyId, companyStatus: offerCompany.status, availableFrom: offer.availableFrom,
      availableUntil: offer.availableUntil, availableCapacityTonnes: offer.capacityTonnes,
      cargoCompatibility: offer.cargoTypes, preferredDirection: offer.direction ?? "", maximumPositioningDistanceKm: maximum,
      listingStatus: offer.listingStatus, visibility: offer.visibility,
    },
    vessel: { id: asset.id, active: asset.active, vesselType: asset.type },
    loading: cargo.origin, destination: cargo.destination, capacityLocation: offer.location,
  }, now);
  if (!result.eligible) return fail(result.reason);
  const score = scoreDemoEligiblePair({
    cargo: { id: cargo.id, companyId: cargo.companyId, companyStatus: cargoCompany.status, cargoType: cargo.cargoType, weightTonnes: cargo.weightTonnes, loadingFrom: cargo.readyFrom, loadingUntil: cargo.readyUntil, requiredVesselType: cargo.requiredVesselType, listingStatus: cargo.listingStatus, visibility: cargo.visibility },
    capacity: { id: offer.id, companyId: offer.companyId, companyStatus: offerCompany.status, availableFrom: offer.availableFrom, availableUntil: offer.availableUntil, availableCapacityTonnes: offer.capacityTonnes, cargoCompatibility: offer.cargoTypes, preferredDirection: offer.direction ?? "", maximumPositioningDistanceKm: maximum, listingStatus: offer.listingStatus, visibility: offer.visibility },
    vessel: { id: asset.id, active: asset.active, vesselType: asset.type }, loading: cargo.origin, destination: cargo.destination, capacityLocation: offer.location,
  }, result.distanceKm);
  return pass(score.totalScore, { distanceKm: result.distanceKm, evaluationInputs: score.evaluationInputs, explanation: score.explanation });
}

function reachability(offerFrom: Date, offerUntil: Date, cargoFrom: Date, cargoUntil: Date, now: Date, extension: WorldOffer["deepseaAvailability"]) {
  const earliestDeparture = new Date(Math.max(offerFrom.getTime(), now.getTime()));
  const days = extension?.manualPositioningDays;
  const buffer = extension?.positioningBufferDays ?? 0;
  const lowerBound = new Date(Math.max(earliestDeparture.getTime() + ((days ?? 0) + buffer) * 86_400_000, cargoFrom.getTime()));
  const latestDeparture = extension?.departureUncertaintyDays == null ? null : new Date(earliestDeparture.getTime() + extension.departureUncertaintyDays * 86_400_000);
  const latestReady = days == null || extension?.positioningBufferDays == null || latestDeparture == null
    ? null : new Date(Math.max(latestDeparture.getTime() + (days + buffer) * 86_400_000, cargoFrom.getTime()));
  const horizonLate = offerUntil < cargoFrom || lowerBound > offerUntil;
  const late = horizonLate || lowerBound > cargoUntil;
  const assessment = late ? "TOO_LATE" : latestReady == null ? "UNKNOWN" : latestReady <= cargoUntil && latestReady <= offerUntil ? "WITHIN_WINDOW" : "UNCERTAIN";
  return { late, assessment, estimated: days != null || extension?.departureUncertaintyDays != null || extension?.positioningBufferDays != null };
}

function deepsea(cargo: WorldCargo, offer: WorldOffer, now: Date, asset: WorldAsset, cargoFrom: Date, cargoUntil: Date, offerFrom: Date, offerUntil: Date) {
  const profile = asset.deepseaProfile;
  const requirement = cargo.deepseaRequirement;
  const extension = offer.deepseaAvailability;
  if (!profile || !requirement || !cargo.requiredVesselType) return fail("required_deepsea_profile_missing");
  if (!["UNSPECIFIED", "DIRECT", "SUEZ", "PANAMA", "CAPE_GOOD_HOPE", "OTHER"].includes(extension?.routeChoice ?? "UNSPECIFIED") ||
    [extension?.manualPositioningDays, extension?.departureUncertaintyDays, extension?.positioningBufferDays].some((value) => value != null && (!finiteNonNegative(value) || value > 365)) ||
    (extension?.approximateMaxDistanceKm != null && !positive(extension.approximateMaxDistanceKm))) return fail("invalid_deepsea_extension");
  if (asset.type !== cargo.requiredVesselType) return fail("vessel_type_incompatible");
  if (!positive(profile.dwtTonnes) || offer.capacityTonnes > profile.dwtTonnes) return fail("cargo_tonnage_exceeds_vessel_dwt");
  if (!cargoCompatible(cargo, offer)) return fail("cargo_incompatible");
  const tolerance = requirement.quantityTolerancePercent ?? 0;
  if (!finiteNonNegative(tolerance) || tolerance >= 100) return fail("invalid_quantity_tolerance");
  if (offer.capacityTonnes < cargo.weightTonnes * (1 - tolerance / 100)) return fail("insufficient_cargo_tonnage");
  if ((requirement.minimumVesselDwtTonnes != null && profile.dwtTonnes < requirement.minimumVesselDwtTonnes) ||
    (requirement.maximumVesselDwtTonnes != null && profile.dwtTonnes > requirement.maximumVesselDwtTonnes)) return fail("dwt_incompatible");
  if (requirement.maximumDraftMetres != null && (!positive(profile.summerDraftMetres) || profile.summerDraftMetres > requirement.maximumDraftMetres)) return fail("draft_incompatible");
  if (requirement.requiredGear?.trim()) {
    if (!profile.gearConfiguration) return fail("required_gear_unknown");
    if (!sameText(requirement.requiredGear, profile.gearConfiguration)) return fail("gear_incompatible");
  }
  const maximum = extension?.approximateMaxDistanceKm ?? offer.maximumPositioningDistanceKm;
  if (!positive(maximum)) return fail("invalid_positioning_distance");
  const distanceKm = distance(cargo.origin, offer.location);
  if (distanceKm > maximum) return fail("outside_approximate_positioning_distance", distanceKm);
  if (offerUntil < cargoFrom) return fail("laycan_incompatible", distanceKm);
  const timing = reachability(offerFrom, offerUntil, cargoFrom, cargoUntil, now, extension);
  if (timing.late) return fail("laycan_incompatible_with_positioning", distanceKm);
  const timingScore = ({ WITHIN_WINDOW: 100, UNCERTAIN: 50, UNKNOWN: 25 } as const)[timing.assessment];
  const capacityScore = Math.min(100, offer.capacityTonnes / (cargo.weightTonnes * (1 - tolerance / 100)) * 100);
  const classScore = !requirement.preferredVesselClass || requirement.preferredVesselClass === profile.vesselClass ? 100 : 0;
  return pass(scoreDistance(distanceKm, maximum) * .35 + (timingScore || 0) * .25 + capacityScore * .2 + classScore * .1 + 10, {
    distanceKm, provisional: true,
    evaluationInputs: { reachabilityStatus: timing.estimated ? "USER_ESTIMATED" : "UNKNOWN", laycanAssessment: timing.assessment, routeDataAccess: "NOT_CONFIGURED", verification: "NOT_VERIFIED" },
    explanation: "Potential deepsea fit uses manual positioning estimates only; no route or arrival is independently verified.",
  });
}

function directionCompatible(direction: string | null | undefined, cargo: WorldCargo) {
  if (!direction?.trim() || /^(all|any)$/i.test(direction.trim())) return true;
  const destination = `${cargo.destination.name} ${cargo.destination.region} ${cargo.destination.country}`.toLowerCase();
  const value = direction.trim().toLowerCase();
  if (value.includes("rhine") && /duisburg|dusseldorf|düsseldorf|cologne|köln|germany|deutschland|nl|netherlands/.test(destination)) return true;
  return value.split(/[,/ ]+/).some((part) => part.length > 2 && destination.includes(part));
}
function roadDirectionScore(direction: string | null | undefined, cargo: WorldCargo) {
  const value = direction?.toLowerCase() ?? "";
  const destination = `${cargo.destination.name} ${cargo.destination.region}`.toLowerCase();
  if (value.includes("rhine") && /duisburg|dusseldorf|düsseldorf|cologne|köln|germany|deutschland/.test(destination)) return 100;
  if (value.split(/[,/ ]+/).some((part) => part.length > 2 && destination.includes(part))) return 100;
  if (value.includes("germany") || value.includes("rhine")) return 70;
  return 50;
}
function windowTimingScore(offerFrom: Date, offerUntil: Date, cargoFrom: Date, cargoUntil: Date) {
  if (offerFrom > cargoFrom || offerUntil < cargoUntil) return 0;
  const slackHours = (cargoFrom.getTime() - offerFrom.getTime() + offerUntil.getTime() - cargoUntil.getTime()) / 3_600_000;
  return Math.max(0, Math.min(100, 100 - Math.min(100, slackHours)));
}

function road(cargo: WorldCargo, offer: WorldOffer, asset: WorldAsset, cargoFrom: Date, cargoUntil: Date, offerFrom: Date, offerUntil: Date, now: Date) {
  const requirement = cargo.roadRequirements;
  const profile = asset.roadProfile;
  const availability = offer.roadAvailability;
  if (!requirement || !profile || !availability) return fail("road_profile_missing");
  if (!positive(profile.payloadTonnes ?? asset.capacityTonnes) || !positive(profile.volumeCubicMetres) || !positive(profile.loadingMetres) || !positive(profile.palletPositions) ||
    !positive(availability.availableVolumeCubicMetres) || !positive(availability.availableLoadingMetres) || !positive(availability.availablePalletPositions)) return fail("invalid_road_dimensions");
  if (!positive(offer.capacityTonnes) || offer.capacityTonnes > (profile.payloadTonnes ?? asset.capacityTonnes) || offer.capacityTonnes < cargo.weightTonnes) return fail("insufficient_tonnage");
  if ([requirement.volumeCubicMetres, requirement.loadingMetres, requirement.palletPositions].some((value) => value != null && !positive(value))) return fail("invalid_road_requirements");
  if (availability.availableVolumeCubicMetres > profile.volumeCubicMetres || availability.availableLoadingMetres > profile.loadingMetres || availability.availablePalletPositions > profile.palletPositions) return fail("road_capacity_exceeds_asset");
  if ((requirement.volumeCubicMetres != null && availability.availableVolumeCubicMetres < requirement.volumeCubicMetres) ||
    (requirement.loadingMetres != null && availability.availableLoadingMetres < requirement.loadingMetres) ||
    (requirement.palletPositions != null && availability.availablePalletPositions < requirement.palletPositions)) return fail("insufficient_road_dimensions");
  if (!includesAll([...asset.equipment, ...(availability.equipment ?? [])], requirement.requiredEquipment)) return fail("equipment_incompatible");
  if (requirement.requiredTrailerType && !sameText(requirement.requiredTrailerType, availability.trailerType ?? profile.trailerType)) return fail("trailer_type_incompatible");
  if (
    (availability.temperatureMinCelsius != null && (profile.temperatureMinCelsius == null || availability.temperatureMinCelsius < profile.temperatureMinCelsius)) ||
    (availability.temperatureMaxCelsius != null && (profile.temperatureMaxCelsius == null || availability.temperatureMaxCelsius > profile.temperatureMaxCelsius))
  ) return fail("temperature_capability_overclaimed");
  const low = availability.temperatureMinCelsius ?? profile.temperatureMinCelsius;
  const high = availability.temperatureMaxCelsius ?? profile.temperatureMaxCelsius;
  if (requirement.temperatureMinCelsius != null || requirement.temperatureMaxCelsius != null) {
    const requiredLow = requirement.temperatureMinCelsius ?? requirement.temperatureMaxCelsius!;
    const requiredHigh = requirement.temperatureMaxCelsius ?? requirement.temperatureMinCelsius!;
    if (!Number.isFinite(low) || !Number.isFinite(high) || low! > requiredLow || high! < requiredHigh) return fail("temperature_incompatible");
  }
  if (!includesAll(availability.adrClasses?.length ? availability.adrClasses : profile.adrClasses ?? [], requirement.adrClasses ?? [])) return fail("adr_incompatible");
  if (!cargoCompatible(cargo, offer)) return fail("cargo_incompatible");
  const current = validDate(availability.currentDeliveryExpectedAt);
  const expected = validDate(availability.expectedAvailabilityAt);
  if (!current || !expected || current > expected || !finiteNonNegative(availability.availabilityUncertaintyMinutes)) return fail("invalid_delivery_sequence");
  const conservative = new Date(expected.getTime() + availability.availabilityUncertaintyMinutes * 60_000);
  const effectiveFrom = new Date(Math.max(offerFrom.getTime(), conservative.getTime()));
  if (Math.max(effectiveFrom.getTime(), cargoFrom.getTime()) >= Math.min(offerUntil.getTime(), cargoUntil.getTime())) return fail("future_availability_outside_window");
  if (!directionCompatible(availability.preferredDirection ?? requirement.direction, cargo)) return fail("direction_incompatible");
  // The road API validates this on write. Keep legacy persisted zero-distance
  // limits parity-safe: as on the core matcher, it only excludes nonzero
  // deadhead rather than fabricating a validation rejection during matching.
  if (typeof offer.maximumPositioningDistanceKm !== "number" || !Number.isFinite(offer.maximumPositioningDistanceKm)) return fail("invalid_positioning_distance");
  const distanceKm = distance(cargo.origin, offer.location);
  if (distanceKm > offer.maximumPositioningDistanceKm) return fail("outside_positioning_distance", distanceKm);
  const capacityScore = Math.min(100, offer.capacityTonnes / cargo.weightTonnes * 100);
  const dimensions = [requirement.volumeCubicMetres == null ? 100 : Math.min(100, availability.availableVolumeCubicMetres / requirement.volumeCubicMetres * 100), requirement.loadingMetres == null ? 100 : Math.min(100, availability.availableLoadingMetres / requirement.loadingMetres * 100), requirement.palletPositions == null ? 100 : Math.min(100, availability.availablePalletPositions / requirement.palletPositions * 100)];
  const timingScore = windowTimingScore(offerFrom, offerUntil, cargoFrom, cargoUntil);
  const directionScore = roadDirectionScore(availability.preferredDirection ?? requirement.direction, cargo);
  return pass(scoreDistance(distanceKm, offer.maximumPositioningDistanceKm) * .25 + timingScore * .25 + capacityScore * .25 + Math.min(...dimensions) * .15 + directionScore * .1, {
    distanceKm, provisional: true, evaluationInputs: { mode: "ROAD", timing: availability.availabilityUncertaintyMinutes > 0 ? "USER_ESTIMATED_INTERVAL" : "USER_ESTIMATED", location: "CATALOGUE_REGION_ONLY", verification: "NOT_VERIFIED" },
    explanation: "Potential road fit uses manually declared future availability, not a verified vehicle position or booking.",
  });
}

export function evaluateWorldOffer(cargo: WorldCargo, offer: WorldOffer, state: WorldState, now: Date): WorldMatchEvaluation {
  const base = offerBase(cargo, offer, state, now);
  if (base.result) return base.result as WorldMatchEvaluation;
  if (cargo.mode === "INLAND") return inland(cargo, offer, state, now, base.asset);
  if (cargo.mode === "DEEPSEA") return deepsea(cargo, offer, now, base.asset, base.cargoFrom, base.cargoUntil, base.offerFrom, base.offerUntil);
  if (cargo.mode === "ROAD") return road(cargo, offer, base.asset, base.cargoFrom, base.cargoUntil, base.offerFrom, base.offerUntil, now);
  return fail("mode_incompatible");
}

export function evaluateWorldDeparture(cargo: WorldCargo, departure: WorldDeparture, state: WorldState, now: Date): WorldMatchEvaluation {
  if (cargo.mode !== "LINER") return fail("mode_incompatible");
  const cargoCompany = state.companies.find((item) => item.id === cargo.companyId);
  const company = state.companies.find((item) => item.id === departure.companyId);
  const requirement = cargo.linerRequirements;
  const service = departure.linerService;
  const readyAt = requirement && validDate(requirement.readyAt);
  const cutoff = validDate(departure.cargoCutoffAt);
  const departureAt = validDate(departure.departureAt);
  if (!cargoCompany || !company || cargoCompany.status !== "ACTIVE" || company.status !== "ACTIVE") return fail("company_inactive");
  if (!company.activities.includes("CARRIER")) return fail("service_company_not_carrier");
  if (!cargoCompany.activities.some((activity) => activity === "SHIPPER" || activity === "CHARTERER")) return fail("cargo_company_not_shipper_or_charterer");
  if (company.id === cargo.companyId) return fail("same_company");
  if (!requirement || !service || !readyAt) return fail("required_liner_fields_missing");
  if (!cargo.origin.active || !cargo.destination.active || !service.vesselActive || (service.vesselCompanyId != null && service.vesselCompanyId !== departure.companyId)) return fail("catalogue_or_actual_vessel_inactive");
  if (cargo.listingStatus !== "ACTIVE" || cargo.visibility !== "OPEN_NETWORK" || departure.listingStatus !== "ACTIVE" || departure.visibility !== "OPEN_NETWORK" || (service.serviceListingStatus && service.serviceListingStatus !== "ACTIVE") || (service.serviceVisibility && service.serviceVisibility !== "OPEN_NETWORK")) return fail("not_discoverable");
  if (!cutoff || !departureAt || cutoff <= now || departureAt <= now || readyAt > cutoff || cutoff >= departureAt) return fail("cutoff_or_readiness_incompatible");
  if (!LINER_CARGO_TYPES.includes(requirement.cargoType) || cargo.cargoType.toUpperCase() !== requirement.cargoType) return fail("cargo_type_incompatible");
  const values = [cargo.weightTonnes, requirement.pieceWeightTonnes, requirement.pieceLengthMetres, requirement.pieceWidthMetres, requirement.pieceHeightMetres, service.availableCommercialTonnes, service.maximumPieceWeightTonnes, service.maximumPieceLengthMetres, service.maximumPieceWidthMetres, service.maximumPieceHeightMetres, service.liftingCapacityTonnes];
  if (values.some((value) => !positive(value)) || !Number.isInteger(requirement.pieceCount) || requirement.pieceCount < 1 || cargo.weightTonnes < requirement.pieceWeightTonnes || cargo.weightTonnes > requirement.pieceCount * requirement.pieceWeightTonnes) return fail("invalid_commercial_dimensions_or_weight");
  if (cargo.weightTonnes > service.availableCommercialTonnes) return fail("insufficient_commercial_tonnage");
  if (requirement.pieceWeightTonnes > service.maximumPieceWeightTonnes || requirement.pieceLengthMetres > service.maximumPieceLengthMetres || requirement.pieceWidthMetres > service.maximumPieceWidthMetres || requirement.pieceHeightMetres > service.maximumPieceHeightMetres) return fail("piece_dimensions_or_weight_incompatible");
  if (requirement.requiredLiftingTonnes != null && requirement.requiredLiftingTonnes > service.liftingCapacityTonnes) return fail("lifting_incompatible");
  if (!(requirement.requiredStowage === "EITHER" || service.stowage === "EITHER" || requirement.requiredStowage === service.stowage)) return fail("stowage_incompatible");
  if (!service.acceptedCargoTypes.includes(requirement.cargoType)) return fail("cargo_type_incompatible");
  const origin = service.portRotation.find((call) => call.locationId === cargo.origin.id && validDate(call.estimatedDeparture) && readyAt <= validDate(call.estimatedDeparture)!);
  const destination = origin && service.portRotation.find((call) => call.locationId === cargo.destination.id && call.sequence > origin.sequence);
  if (!origin || !destination) return fail("rotation_does_not_serve_ready_origin_before_destination");
  const dimensions = Math.min(service.maximumPieceWeightTonnes / requirement.pieceWeightTonnes, service.maximumPieceLengthMetres / requirement.pieceLengthMetres, service.maximumPieceWidthMetres / requirement.pieceWidthMetres, service.maximumPieceHeightMetres / requirement.pieceHeightMetres) * 100;
  const weight = Math.min(100, service.availableCommercialTonnes / cargo.weightTonnes * 100);
  const lifting = requirement.requiredLiftingTonnes == null ? 100 : Math.min(100, service.liftingCapacityTonnes / requirement.requiredLiftingTonnes * 100);
  return pass(Math.min(100, dimensions) * .25 + weight * .2 + lifting * .15 + 40, { evaluationInputs: { dimensionsFit: `${Math.round(Math.min(100, dimensions))}`, weightFit: `${Math.round(weight)}`, liftingFit: `${Math.round(lifting)}`, stowageFit: "100", rotationFit: "100", timingFit: "100" }, explanation: "Potential conventional liner fit based on published breakbulk commercial limits, cutoff, readiness, and ordered port rotation. This is not a booking." });
}

export function findWorldMatches(state: WorldState, cargo: WorldCargo, now: Date = new Date()) {
  const found: Array<{ kind: "OFFER" | "DEPARTURE"; id: string; evaluation: WorldMatchEvaluation; companyId: string }> = [];
  if (cargo.mode === "LINER") for (const departure of state.departures) {
    const evaluation = evaluateWorldDeparture(cargo, departure, state, now);
    if (evaluation.eligible) found.push({ kind: "DEPARTURE", id: departure.id, evaluation, companyId: departure.companyId });
  } else for (const offer of state.offers) {
    const evaluation = evaluateWorldOffer(cargo, offer, state, now);
    if (evaluation.eligible) found.push({ kind: "OFFER", id: offer.id, evaluation, companyId: offer.companyId });
  }
  return found;
}

export function isWorldListingActive(value: { listingStatus: string; visibility: string }, now: Date, until: string) {
  const end = validDate(until);
  return value.listingStatus === "ACTIVE" && value.visibility === "OPEN_NETWORK" && !!end && end > now;
}