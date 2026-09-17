import type {
  capacityOffersTable,
  cargoListingsTable,
  companiesTable,
  locationsTable,
  matchesTable,
  deepseaCapacityExtensionsTable,
  deepseaCargoRequirementsTable,
  deepseaVesselProfilesTable,
  vesselsTable,
  roadAssetsTable,
} from "@workspace/db";

type Cargo = typeof cargoListingsTable.$inferSelect;
type Capacity = typeof capacityOffersTable.$inferSelect;
type Company = typeof companiesTable.$inferSelect;
type Location = typeof locationsTable.$inferSelect;
type Vessel = typeof vesselsTable.$inferSelect;
type Match = typeof matchesTable.$inferSelect;
type DeepseaProfile = typeof deepseaVesselProfilesTable.$inferSelect;
type DeepseaRequirement = typeof deepseaCargoRequirementsTable.$inferSelect;
type DeepseaExtension = typeof deepseaCapacityExtensionsTable.$inferSelect;
type RoadRequirement = {
  volumeCubicMetres: number | null;
  loadingMetres: number | null;
  palletPositions: number | null;
  requiredTrailerType: string | null;
  requiredEquipment: string[];
  temperatureMinCelsius: number | null;
  temperatureMaxCelsius: number | null;
  adrClasses: string[];
};
type RoadExtension = {
  availableVolumeCubicMetres: number;
  availableLoadingMetres: number;
  availablePalletPositions: number;
  equipment: string[];
  temperatureMinCelsius: number | null;
  temperatureMaxCelsius: number | null;
  adrClasses: string[];
  availabilityUncertaintyMinutes: number;
};

function bandTonnes(value: number): string {
  if (value < 500) return "< 500 t";
  if (value < 1000) return "500–1,000 t";
  if (value < 1500) return "1,000–1,500 t";
  if (value < 2500) return "1,500–2,500 t";
  return "2,500+ t";
}

function roadTonnageBand(value: number): string {
  if (value < 5) return "< 5 t";
  if (value < 15) return "5–15 t";
  if (value < 25) return "15–25 t";
  return "25+ t";
}

function bandDwt(value: number): string {
  if (value < 10_000) return "< 10k DWT";
  if (value < 35_000) return "10–35k DWT";
  if (value < 65_000) return "35–65k DWT";
  if (value < 85_000) return "65–85k DWT";
  return "85k+ DWT";
}

function bandDistance(value: number): string {
  if (value < 25) return "< 25 km";
  if (value < 50) return "25–50 km";
  if (value < 100) return "50–100 km";
  if (value < 200) return "100–200 km";
  return "200+ km";
}

function bandTime(from: Date, until: Date): string {
  const hours = (until.getTime() - from.getTime()) / 3_600_000;
  if (hours <= 6) return "Short window";
  if (hours <= 24) return "Within 24 hours";
  if (hours <= 72) return "Within 3 days";
  return "More than 3 days";
}

function bandText(values: string[]): string {
  const normalized = values.map((value) => value.trim().toLowerCase());
  if (normalized.some((value) => value.includes("dry") || value.includes("grain"))) {
    return "Dry bulk compatible";
  }
  if (normalized.some((value) => value.includes("liquid") || value.includes("tanker"))) {
    return "Liquid bulk compatible";
  }
  return "General cargo compatible";
}

function cargoTypeBand(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes("grain") || normalized.includes("dry")) return "Dry bulk";
  if (normalized.includes("liquid") || normalized.includes("oil")) return "Liquid bulk";
  if (normalized.includes("container")) return "Containerized cargo";
  return "General cargo";
}

function roadDateBand(value: Date): string {
  const month = value.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const period = value.getUTCDate() <= 10 ? "early" : value.getUTCDate() <= 20 ? "mid" : "late";
  return `${period} ${month} ${value.getUTCFullYear()}`;
}

function roadTimeWindowBand(from: Date, until: Date): string {
  const hour = from.getUTCHours();
  const dayPart = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  return `${dayPart} · ${bandTime(from, until)}`;
}

function roadRequirementEquipmentBand(values: string[]): string {
  if (!values.length) return "Standard equipment";
  const normalized = values.join(" ").toLowerCase();
  if (/refrigerat|reefer|cool|freez/.test(normalized)) return "Temperature equipment";
  if (/lift|ramp|loading/.test(normalized)) return "Loading assistance";
  return "Special equipment";
}

function roadTemperatureBand(min: number | null, max: number | null): string {
  if (min == null && max == null) return "Ambient";
  if (max != null && max <= -10) return "Frozen";
  if (min != null && min >= 0 && max != null && max <= 10) return "Chilled";
  return "Temperature-controlled";
}

function roadAdrBand(classes: string[]): string {
  return classes.length ? "ADR-regulated cargo" : "No ADR indicated";
}

function roadDimensionBand(
  volume: number | null,
  loadingMetres: number | null,
  pallets: number | null,
): string {
  const volumeBand = volume == null ? "volume not specified" : volume < 20 ? "< 20 m³" : volume < 50 ? "20–50 m³" : "50+ m³";
  const loadingBand = loadingMetres == null ? "loading space not specified" : loadingMetres < 5 ? "< 5 lm" : loadingMetres < 10 ? "5–10 lm" : "10+ lm";
  const palletBand = pallets == null ? "pallet footprint not specified" : pallets < 10 ? "< 10 pallets" : pallets < 25 ? "10–25 pallets" : "25+ pallets";
  return `${volumeBand}; ${loadingBand}; ${palletBand}`;
}

/**
 * A road match projection is deliberately built from the joined cargo,
 * capacity, location, and road-extension rows. It contains useful planning
 * bands without relaying names, notes, identifiers, coordinates, or exact
 * commercial quantities.
 */
export function roadOpportunityProjection(input: {
  cargo: Cargo;
  capacity: Capacity;
  loading: Location;
  destination: Location;
  capacityLocation: Location;
  roadRequirement?: RoadRequirement | null;
  roadExtension?: RoadExtension | null;
  roadAsset?: typeof roadAssetsTable.$inferSelect | null;
}) {
  const requirement = input.roadRequirement;
  const extension = input.roadExtension;
  return {
    cargoTypeBand: cargoTypeBand(input.cargo.cargoType),
    originRegion: input.loading.region,
    destinationRegion: input.destination.region,
    loadingDateBand: roadDateBand(input.cargo.loadingFrom),
    loadingTimeWindowBand: roadTimeWindowBand(input.cargo.loadingFrom, input.cargo.loadingUntil),
    weightBand: roadTonnageBand(input.cargo.weightTonnes),
    equipmentBand: roadRequirementEquipmentBand(requirement?.requiredEquipment ?? []),
    temperatureBand: roadTemperatureBand(
      requirement?.temperatureMinCelsius ?? null,
      requirement?.temperatureMaxCelsius ?? null,
    ),
    adrBand: roadAdrBand(requirement?.adrClasses ?? []),
    dimensionalRequirementsBand: roadDimensionBand(
      requirement?.volumeCubicMetres ?? null,
      requirement?.loadingMetres ?? null,
      requirement?.palletPositions ?? null,
    ),
    freeAreaBand: input.capacityLocation.region,
    freeTimeBand: `${roadDateBand(input.capacity.availableFrom)} · ${roadTimeWindowBand(input.capacity.availableFrom, input.capacity.availableUntil)}${extension?.availabilityUncertaintyMinutes ? " · Estimated availability" : ""}`,
    freeCapacityBand: roadTonnageBand(input.capacity.availableCapacityTonnes),
    capacityEquipmentBand: roadRequirementEquipmentBand([...(input.roadAsset?.equipment ?? []), ...(extension?.equipment ?? [])]),
    capacityTemperatureBand: roadTemperatureBand(
      extension?.temperatureMinCelsius ?? input.roadAsset?.temperatureMinCelsius ?? null,
      extension?.temperatureMaxCelsius ?? input.roadAsset?.temperatureMaxCelsius ?? null,
    ),
    capacityAdrBand: roadAdrBand(extension?.adrClasses.length ? extension.adrClasses : input.roadAsset?.adrClasses ?? []),
  };
}

export function companyResponse(company: Company) {
  return {
    id: company.id,
    name: company.name,
    country: company.country,
    activities: company.activities,
    primaryContactName: company.primaryContactName,
    email: company.email,
    phone: company.phone,
    vatRegistrationNumber: company.vatRegistrationNumber,
    verified: company.verified,
    status: company.status,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  };
}

export function vesselResponse(
  vessel: Vessel,
  profile?:
    | DeepseaProfile
    | {
        vesselClass: DeepseaProfile["vesselClass"];
        dwtTonnes: number;
        summerDraftMetres?: number | null;
        gearConfiguration?: string | null;
      }
    | null,
) {
  return {
    ...vessel,
    deepseaProfile: profile
      ? {
          vesselClass: profile.vesselClass,
          dwtTonnes: profile.dwtTonnes,
          summerDraftMetres: profile.summerDraftMetres ?? null,
          gearConfiguration: profile.gearConfiguration ?? null,
        }
      : null,
  };
}

export function locationResponse(location: Location) {
  return {
    id: location.id,
    name: location.name,
    country: location.country,
    region: location.region,
    locationType: location.locationType,
    active: location.active,
  };
}

export function cargoResponse(
  cargo: Cargo,
  requirement?: DeepseaRequirement | null,
) {
  return {
    ...cargo,
    deepseaRequirement: requirement
      ? {
          quantityTolerancePercent: requirement.quantityTolerancePercent,
          minimumVesselDwtTonnes: requirement.minimumVesselDwtTonnes,
          maximumVesselDwtTonnes: requirement.maximumVesselDwtTonnes,
          maximumDraftMetres: requirement.maximumDraftMetres,
          requiredGear: requirement.requiredGear,
          preferredVesselClass: requirement.preferredVesselClass,
        }
      : null,
  };
}

export function capacityResponse(
  capacity: Capacity,
  extension?: DeepseaExtension | null,
) {
  return {
    ...capacity,
    deepseaExtension: extension
      ? {
          manualPositioningDays: extension.manualPositioningDays,
          routeChoice: extension.routeChoice,
          routeNotes: extension.routeNotes,
          departureUncertaintyDays: extension.departureUncertaintyDays,
          positioningBufferDays: extension.positioningBufferDays,
          approximateMaxDistanceKm: extension.approximateMaxDistanceKm,
          previousVoyageContext: extension.previousVoyageContext,
        }
      : null,
  };
}

export function anonymousCargo(cargo: Cargo, loading: Location, destination: Location) {
  return {
    id: cargo.id,
    transportMode: cargo.transportMode,
    listingType: "CARGO" as const,
    cargoTypeBand: cargoTypeBand(cargo.cargoType),
    loadingRegion: loading.region,
    destinationRegion: destination.region,
    requiredVesselType: cargo.requiredVesselType,
    tonnageBand: cargo.transportMode === "ROAD" ? roadTonnageBand(cargo.weightTonnes) : bandTonnes(cargo.weightTonnes),
    timeBand: bandTime(cargo.loadingFrom, cargo.loadingUntil),
    distanceBand: "Regional positioning only",
    visibility: "OPEN_NETWORK" as const,
    listingStatus: "ACTIVE" as const,
    ...(cargo.transportMode === "DEEPSEA_BULK"
      ? { deepseaRequirementsBand: "Dry-bulk requirements on file" }
      : {}),
  };
}

export function anonymousCapacity(
  capacity: Capacity,
  vessel: Vessel | null,
  location: Location,
  profile?: DeepseaProfile | null,
  extension?: DeepseaExtension | null,
) {
  const direction = capacity.preferredDirection.toLowerCase();
  return {
    id: capacity.id,
    transportMode: capacity.transportMode,
    listingType: "CAPACITY" as const,
    vesselType: vessel?.vesselType ?? null,
    availabilityType: capacity.availabilityType,
    cargoCompatibilityBand: capacity.transportMode === "ROAD" ? "Road cargo requirements checked" : bandText(capacity.cargoCompatibility),
    directionBand: direction.includes("rhine")
      ? "Rhine corridor"
      : "Regional direction",
    availabilityRegion: location.region,
    tonnageBand: capacity.transportMode === "ROAD" ? roadTonnageBand(capacity.availableCapacityTonnes) : bandTonnes(capacity.availableCapacityTonnes),
    timeBand: bandTime(capacity.availableFrom, capacity.availableUntil),
    distanceBand: bandDistance(capacity.maximumPositioningDistanceKm),
    visibility: "OPEN_NETWORK" as const,
    listingStatus: "ACTIVE" as const,
    ...(capacity.transportMode === "DEEPSEA_BULK"
      ? {
          deepseaClassBand: profile?.vesselClass ?? "Class not disclosed",
          dwtBand: profile ? bandDwt(profile.dwtTonnes) : "DWT not disclosed",
          availabilityConfidence: capacity.availabilityConfidence,
           // Complete manual inputs remain user-estimated and unverified.
           positioningConfidence: "PROVISIONAL",
           provisional: true,
        }
      : {}),
  };
}

export function connectedCargo(
  cargo: Cargo,
  requirement?: DeepseaRequirement | null,
) {
  const { notes: _notes, ...safe } = cargo;
  return {
    ...safe,
    deepseaRequirement: requirement
      ? {
          quantityTolerancePercent: requirement.quantityTolerancePercent,
          minimumVesselDwtTonnes: requirement.minimumVesselDwtTonnes,
          maximumVesselDwtTonnes: requirement.maximumVesselDwtTonnes,
          maximumDraftMetres: requirement.maximumDraftMetres,
          requiredGear: requirement.requiredGear,
          preferredVesselClass: requirement.preferredVesselClass,
        }
      : null,
  };
}

export function connectedCapacity(
  capacity: Capacity,
  extension?: DeepseaExtension | null,
) {
  const { notes: _notes, ...safe } = capacity;
  return {
    ...safe,
    deepseaExtension: extension
      ? {
          manualPositioningDays: extension.manualPositioningDays,
          routeChoice: extension.routeChoice,
          routeNotes: extension.routeNotes,
          departureUncertaintyDays: extension.departureUncertaintyDays,
          positioningBufferDays: extension.positioningBufferDays,
          approximateMaxDistanceKm: extension.approximateMaxDistanceKm,
          previousVoyageContext: extension.previousVoyageContext,
        }
      : null,
  };
}

export function connectedCompany(company: Company) {
  return {
    id: company.id,
    name: company.name,
    country: company.country,
    activities: company.activities,
    primaryContactName: company.primaryContactName,
    email: company.email,
    phone: company.phone,
  };
}

export function matchScore(match: Match, deepsea = false) {
  const standardizeScore = (value: number) => Math.round(value);
  const inputs = match.evaluationInputs ?? {};
  const safeBand = (
    key: string,
    allowed: string[],
    fallback: string,
  ): string => {
    const value = inputs[key];
    return typeof value === "string" && allowed.includes(value) ? value : fallback;
  };
  return {
    totalScore: standardizeScore(match.totalScore),
    components: {
      distanceScore: standardizeScore(match.distanceScore),
      timingScore: standardizeScore(match.timingScore),
      capacityScore: standardizeScore(match.capacityScore),
      vesselTypeScore: standardizeScore(match.vesselTypeScore),
      directionScore: standardizeScore(match.directionScore),
      cargoCompatibilityScore: standardizeScore(match.cargoCompatibilityScore),
    },
    evaluationInputs: {
      distanceBand: safeBand(
        "distanceBand",
        ["< 25 km", "25–50 km", "50–100 km", "100+ km"],
        "Broad distance band",
      ),
      timingBand: safeBand(
        "timingBand",
        [
          "Strong timing fit",
          "Usable timing fit",
          "Timing fit",
          "Timing not feasible",
          "Provisional timing fit",
          "Laycan and buffer fit",
        ],
        "Timing fit",
      ),
      capacityBand: safeBand(
        "capacityBand",
        ["Capacity near requirement", "Capacity above requirement"],
        "Capacity band",
      ),
      vesselTypeBand: safeBand(
        "vesselTypeBand",
        ["Type compatible", "Type mismatch"],
        "Vessel type band",
      ),
      directionBand: safeBand(
        "directionBand",
        ["Direction aligned", "Direction broadly aligned"],
        "Direction band",
      ),
      cargoCompatibilityBand: safeBand(
        "cargoCompatibilityBand",
        ["Cargo compatible", "Compatibility uncertain"],
        "Cargo compatibility band",
      ),
      reachabilityStatus: safeBand(
        "reachabilityStatus",
        ["UNKNOWN", "USER_ESTIMATED"],
        "UNKNOWN",
      ),
      laycanAssessment: safeBand(
        "laycanAssessment",
        ["UNKNOWN", "WITHIN_WINDOW", "UNCERTAIN", "TOO_LATE"],
        "UNKNOWN",
      ),
      // This is deliberately a generic status; actual route choices and
      // private notes are returned only in owner/connected capacity views.
      routeChoice: safeBand(
        "routeChoice",
        ["NOT_CONFIGURED", "USER_SELECTED"],
        "NOT_CONFIGURED",
      ),
      departureUncertainty: safeBand(
        "departureUncertainty",
        ["UNKNOWN", "USER_ESTIMATED"],
        "UNKNOWN",
      ),
      positioningBuffer: safeBand(
        "positioningBuffer",
        ["UNKNOWN", "USER_ESTIMATED"],
        "UNKNOWN",
      ),
      routeDataAccess: safeBand(
        "routeDataAccess",
        ["NOT_CONFIGURED"],
        "NOT_CONFIGURED",
      ),
      verification: safeBand(
        "verification",
        ["NOT_VERIFIED"],
        "NOT_VERIFIED",
      ),
    },
    calculationVersion: match.calculationVersion,
    calculatedAt: match.calculatedAt,
    provisional:
      deepsea ||
      match.calculationVersion?.startsWith("road-") === true ||
      inputs.verification === "NOT_VERIFIED" ||
      inputs.timingBand === "Provisional timing fit",
    explanation: match.explanation,
  };
}

export type MatchBundle = {
  match: Match;
  initiatedByCompanyId: string | null;
  cargo: Cargo;
  capacity: Capacity;
  vessel: Vessel | null;
  deepseaProfile?: DeepseaProfile | null;
  deepseaRequirement?: DeepseaRequirement | null;
  deepseaExtension?: DeepseaExtension | null;
  loading: Location;
  destination: Location;
  capacityLocation: Location;
  cargoCompany: Company;
  capacityCompany: Company;
};

export function matchSummary(bundle: MatchBundle, companyId: string) {
  const initiatedByMe = bundle.initiatedByCompanyId === companyId;
  const deepseaMatch =
    bundle.capacity.transportMode === "DEEPSEA_BULK" && bundle.deepseaProfile
      ? {
          vesselClass: bundle.deepseaProfile.vesselClass,
          dwtBand: bandDwt(bundle.deepseaProfile.dwtTonnes),
          availabilityConfidence: bundle.capacity.availabilityConfidence,
           provisional: true,
          positioningBand: bandDistance(
            bundle.match.approximatePositioningDistanceKm,
          ),
        }
      : null;
  return {
    id: bundle.match.id,
    cargoListingId: bundle.match.cargoListingId,
    capacityOfferId: bundle.match.capacityOfferId,
    status: bundle.match.status,
    networkCategory: "OPEN_NETWORK" as const,
    cargo: anonymousCargo(bundle.cargo, bundle.loading, bundle.destination),
    capacity: anonymousCapacity(
      bundle.capacity,
      bundle.vessel,
      bundle.capacityLocation,
      bundle.deepseaProfile,
      bundle.deepseaExtension,
    ),
    score: matchScore(
      bundle.match,
      bundle.capacity.transportMode === "DEEPSEA_BULK",
    ),
    deepseaMatch,
    initiatedByMe,
    canAccept:
      bundle.match.status === "INTEREST_SENT" &&
      bundle.initiatedByCompanyId !== null &&
      !initiatedByMe,
    createdAt: bundle.match.createdAt,
    updatedAt: bundle.match.updatedAt,
  };
}

export function matchDetail(bundle: MatchBundle, companyId: string) {
  const summary = matchSummary(bundle, companyId);
  const ownsCargo = bundle.cargoCompany.id === companyId;
  const ownsCapacity = bundle.capacityCompany.id === companyId;
  const connected = bundle.match.status === "CONNECTED";
  return {
    ...summary,
    disclosureState: connected
      ? ("CONNECTED" as const)
      : ownsCargo || ownsCapacity
        ? ("OWNER" as const)
        : ("ANONYMOUS" as const),
    ownedCargo: ownsCargo
      ? cargoResponse(bundle.cargo, bundle.deepseaRequirement)
      : null,
    ownedCapacity: ownsCapacity
      ? capacityResponse(bundle.capacity, bundle.deepseaExtension)
      : null,
    connectedCargo:
      connected && !ownsCargo
        ? connectedCargo(bundle.cargo, bundle.deepseaRequirement)
        : null,
    connectedCapacity:
      connected && !ownsCapacity
        ? connectedCapacity(bundle.capacity, bundle.deepseaExtension)
        : null,
    connectedCompanies: connected
      ? [
          connectedCompany(bundle.cargoCompany),
          connectedCompany(bundle.capacityCompany),
        ]
      : [],
  };
}