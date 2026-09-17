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

function bandTonnes(value: number): string {
  if (value < 500) return "< 500 t";
  if (value < 1000) return "500–1,000 t";
  if (value < 1500) return "1,000–1,500 t";
  if (value < 2500) return "1,500–2,500 t";
  return "2,500+ t";
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
    tonnageBand: bandTonnes(cargo.weightTonnes),
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
  vessel: Vessel,
  location: Location,
  profile?: DeepseaProfile | null,
  extension?: DeepseaExtension | null,
) {
  const direction = capacity.preferredDirection.toLowerCase();
  return {
    id: capacity.id,
    transportMode: capacity.transportMode,
    listingType: "CAPACITY" as const,
    vesselType: vessel.vesselType,
    availabilityType: capacity.availabilityType,
    cargoCompatibilityBand: bandText(capacity.cargoCompatibility),
    directionBand: direction.includes("rhine")
      ? "Rhine corridor"
      : "Regional direction",
    availabilityRegion: location.region,
    tonnageBand: bandTonnes(capacity.availableCapacityTonnes),
    timeBand: bandTime(capacity.availableFrom, capacity.availableUntil),
    distanceBand: bandDistance(capacity.maximumPositioningDistanceKm),
    visibility: "OPEN_NETWORK" as const,
    listingStatus: "ACTIVE" as const,
    ...(capacity.transportMode === "DEEPSEA_BULK"
      ? {
          deepseaClassBand: profile?.vesselClass ?? "Class not disclosed",
          dwtBand: profile ? bandDwt(profile.dwtTonnes) : "DWT not disclosed",
          availabilityConfidence: capacity.availabilityConfidence,
          positioningConfidence: extension?.manualPositioningDays == null
            ? "PROVISIONAL"
            : "ESTIMATED",
          provisional: extension?.manualPositioningDays == null,
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

export function matchScore(match: Match) {
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
    },
    calculationVersion: match.calculationVersion,
    calculatedAt: match.calculatedAt,
    provisional: inputs.timingBand === "Provisional timing fit",
    explanation: match.explanation,
  };
}

export type MatchBundle = {
  match: Match;
  initiatedByCompanyId: string | null;
  cargo: Cargo;
  capacity: Capacity;
  vessel: Vessel;
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
          provisional:
            bundle.deepseaExtension?.manualPositioningDays == null,
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
    score: matchScore(bundle.match),
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