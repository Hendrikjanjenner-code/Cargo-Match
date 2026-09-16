import {
  DEMO_CALCULATION_VERSION,
  evaluateDemoEligibility,
  scoreDemoEligiblePair,
  type DemoEligibilityResult,
  type DemoScoreResult,
  type MatchingPair,
} from "./matching";

export { DEMO_CALCULATION_VERSION };
export type { DemoEligibilityResult, DemoScoreResult };

export const DEMO_STATE_VERSION = 1 as const;
export const DEMO_STORAGE_KEY = "cargomatch.demo.v1";
const DAY = 86_400_000;

export type DemoDateInput = Date | string | number;

export type DemoLocation = {
  id: string;
  name: string;
  country: string;
  region: string;
  latitude: number;
  longitude: number;
  active: boolean;
};

/**
 * The display-oriented aliases (origin/destination/weight/startDate/endDate)
 * are retained so the demo UI can use a compact form. The normalized fields
 * are what the pure matcher consumes.
 */
export type DemoCargo = {
  id: string;
  origin: string;
  destination: string;
  weight: number;
  startDate: string;
  endDate: string;
  companyId?: string;
  companyStatus?: "ACTIVE" | "INACTIVE";
  cargoName?: string;
  cargoType?: string;
  loadingLocation?: DemoLocation;
  destinationLocation?: DemoLocation;
  weightTonnes?: number;
  loadingFrom?: string;
  loadingUntil?: string;
  expectedUnloadingDate?: string | null;
  requiredVesselType?: string;
  specialRequirements?: string | null;
  visibility?: "OPEN_NETWORK" | "PRIVATE";
  listingStatus?: "ACTIVE" | "EXPIRED" | "CANCELLED";
  createdAt?: string;
  updatedAt?: string;
};

export type DemoCapacityOffer = {
  id: string;
  companyId: string;
  companyStatus: "ACTIVE" | "INACTIVE";
  vesselId: string;
  location: DemoLocation;
  availableFrom: string;
  availableUntil: string;
  availabilityType: "FULLY_EMPTY" | "PARTIALLY_LOADED";
  availableCapacityTonnes: number;
  cargoCompatibility: string[];
  preferredDirection: string;
  maximumPositioningDistanceKm: number;
  visibility: "OPEN_NETWORK" | "PRIVATE";
  listingStatus: "ACTIVE" | "EXPIRED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
};

export type DemoShip = {
  id: string;
  companyId: string;
  // Legacy/display aliases are deliberately fictitious and contain no contact data.
  name: string;
  realName: string;
  shipType: string;
  location: string;
  totalCapacity: number;
  availableCapacity: number;
  status: "LEEG" | "HALFBELADEN";
  distanceBand: string;
  maxPositioningDistance: number;
  vesselName: string;
  vesselType: "DRY_CARGO" | "TANKER" | string;
  loadStage: "EMPTY" | "HALF_LOADED";
  totalCapacityTonnes: number;
  homeRegion: string;
  active: boolean;
  capacityOfferId: string;
  createdAt: string;
  updatedAt: string;
};

export type DemoProfile = {
  id: string;
  name: "Andy Kers" | string;
  role: "Transportorganisator / charteraar" | string;
  companyId: string;
};

export type DemoCompany = {
  id: string;
  name: "Demo Transportplanning" | string;
  activities: ["CHARTERER"] | string[];
  status: "ACTIVE" | "INACTIVE";
};

export type DemoInterest = {
  id: string;
  cargoId: string;
  capacityOfferId: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "WITHDRAWN";
  createdAt: string;
};

export type DemoConnection = {
  id: string;
  cargoId: string;
  capacityOfferId: string;
  status: "CONNECTED";
  createdAt: string;
  connectedAt: string;
};

export type DemoMessage = {
  id: string;
  connectionId: string | null;
  cargoId: string;
  capacityOfferId: string;
  sender: "andy" | "carrier";
  body: string;
  createdAt: string;
};

export type DemoMatch = {
  id: string;
  cargoId: string;
  capacityOfferId: string;
  offerId: string;
  shipId: string;
  eligible: true;
  score: DemoScoreResult;
  totalScore: number;
};

export type DemoExclusion = {
  id: string;
  cargoId: string;
  capacityOfferId: string;
  offerId: string;
  shipId: string;
  eligible: false;
  reason: string;
  distanceKm?: number;
};

export type DemoEvaluation = {
  cargoId: string;
  evaluatedAt: string;
  calculationVersion: typeof DEMO_CALCULATION_VERSION;
  status: "ACTIVE" | "EXPIRED";
  expired: boolean;
  matches: DemoMatch[];
  eligible: DemoMatch[];
  exclusions: DemoExclusion[];
  results: Array<DemoMatch | DemoExclusion>;
};

/**
 * Compatibility result for the first demo screen. New screens should use
 * DemoEvaluation, but keeping this small shape makes the model safe to adopt
 * incrementally without creating a second matching implementation.
 */
export type DemoMatchResult = {
  ship: DemoShip;
  isSuitable: boolean;
  reason?: string;
  consentGranted: boolean;
  score?: DemoScoreResult;
  capacityOfferId?: string;
};

export type DemoState = {
  version: typeof DEMO_STATE_VERSION;
  createdAt: string;
  updatedAt: string;
  profile: DemoProfile;
  company: DemoCompany;
  cargos: DemoCargo[];
  ships: DemoShip[];
  offers: DemoCapacityOffer[];
  capacityOffers: DemoCapacityOffer[];
  // The active UI can cache display results here; it is never used as matcher input.
  matches: Record<string, DemoMatchResult[]>;
  connections: DemoConnection[];
  interests: DemoInterest[];
  messages: DemoMessage[];
};

function asDate(input: DemoDateInput, label = "date"): Date {
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid demo ${label}`);
  return date;
}

function iso(input: DemoDateInput, label = "date") {
  return asDate(input, label).toISOString();
}

function dateAt(base: Date, offsetDays: number) {
  return new Date(base.getTime() + offsetDays * DAY).toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeLocation(
  id: string,
  name: string,
  country: string,
  region: string,
  latitude: number,
  longitude: number,
): DemoLocation {
  return { id, name, country, region, latitude, longitude, active: true };
}

function makeCargo(
  base: Date,
  input: {
    id: string;
    cargoName: string;
    cargoType: string;
    weightTonnes: number;
    loading: DemoLocation;
    destination: DemoLocation;
    loadingFromDay: number;
    loadingUntilDay: number;
  },
): DemoCargo {
  const createdAt = base.toISOString();
  const loadingFrom = dateAt(base, input.loadingFromDay);
  const loadingUntil = dateAt(base, input.loadingUntilDay);
  return {
    id: input.id,
    companyId: "demo-company",
    companyStatus: "ACTIVE",
    cargoName: input.cargoName,
    cargoType: input.cargoType,
    origin: input.loading.name,
    destination: input.destination.name,
    weight: input.weightTonnes,
    startDate: loadingFrom.slice(0, 10),
    endDate: loadingUntil.slice(0, 10),
    loadingLocation: clone(input.loading),
    destinationLocation: clone(input.destination),
    weightTonnes: input.weightTonnes,
    loadingFrom,
    loadingUntil,
    expectedUnloadingDate: null,
    requiredVesselType: "DRY_CARGO",
    specialRequirements: null,
    visibility: "OPEN_NETWORK",
    listingStatus: "ACTIVE",
    createdAt,
    updatedAt: createdAt,
  };
}

function makeShip(
  base: Date,
  input: {
    id: string;
    name: string;
    vesselType: DemoShip["vesselType"];
    loadStage: DemoShip["loadStage"];
    totalCapacityTonnes: number;
    homeRegion: string;
    capacityOfferId: string;
  },
): DemoShip {
  const createdAt = base.toISOString();
  const status = input.loadStage === "EMPTY" ? "LEEG" : "HALFBELADEN";
  const shipType = input.vesselType === "TANKER" ? "Tanker" : "Drogeladingschip";
  return {
    id: input.id,
    companyId: "demo-carrier-company",
    name: input.name,
    // Deliberately generic: it is not an actual counterparty identity.
    realName: input.name,
    shipType,
    location: input.homeRegion,
    totalCapacity: input.totalCapacityTonnes,
    availableCapacity: input.totalCapacityTonnes,
    status,
    distanceBand: "Indicatieve afstand",
    maxPositioningDistance: 0,
    vesselName: input.name,
    vesselType: input.vesselType,
    loadStage: input.loadStage,
    totalCapacityTonnes: input.totalCapacityTonnes,
    homeRegion: input.homeRegion,
    active: true,
    capacityOfferId: input.capacityOfferId,
    createdAt,
    updatedAt: createdAt,
  };
}

function makeOffer(
  base: Date,
  input: {
    id: string;
    shipId: string;
    location: DemoLocation;
    availabilityType: DemoCapacityOffer["availabilityType"];
    availableCapacityTonnes: number;
    cargoCompatibility: string[];
    preferredDirection: string;
    maximumPositioningDistanceKm: number;
  },
): DemoCapacityOffer {
  const createdAt = base.toISOString();
  return {
    id: input.id,
    companyId: "demo-carrier-company",
    companyStatus: "ACTIVE",
    vesselId: input.shipId,
    location: clone(input.location),
    availableFrom: dateAt(base, 1),
    availableUntil: dateAt(base, 6),
    availabilityType: input.availabilityType,
    availableCapacityTonnes: input.availableCapacityTonnes,
    cargoCompatibility: [...input.cargoCompatibility],
    preferredDirection: input.preferredDirection,
    maximumPositioningDistanceKm: input.maximumPositioningDistanceKm,
    visibility: "OPEN_NETWORK",
    listingStatus: "ACTIVE",
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * Creates all relative windows once. A later load/refresh never shifts the
 * dates, which makes an expired demo visible instead of silently renewing it.
 */
export function createDemoState(now: DemoDateInput = new Date()): DemoState {
  const base = asDate(now, "creation time");
  const createdAt = base.toISOString();
  const dordrecht = makeLocation(
    "location-dordrecht",
    "Dordrecht",
    "NL",
    "South Holland",
    51.8133,
    4.6901,
  );
  const duisburg = makeLocation(
    "location-duisburg",
    "Duisburg",
    "DE",
    "North Rhine-Westphalia",
    51.4344,
    6.7623,
  );
  const rotterdam = makeLocation(
    "location-rotterdam",
    "Rotterdam",
    "NL",
    "South Holland",
    51.9244,
    4.4777,
  );
  const nijmegen = makeLocation(
    "location-nijmegen",
    "Nijmegen",
    "NL",
    "Gelderland",
    51.8426,
    5.852,
  );
  const moerdijk = makeLocation(
    "location-moerdijk",
    "Moerdijk",
    "NL",
    "North Brabant",
    51.7017,
    4.6251,
  );
  const antwerpen = makeLocation(
    "location-antwerpen",
    "Antwerpen",
    "BE",
    "Antwerp",
    51.2194,
    4.4025,
  );

  const cargos = [
    makeCargo(base, {
      id: "cargo-dordrecht-duisburg",
      cargoName: "Droge bulk Dordrecht → Duisburg",
      cargoType: "dry bulk",
      weightTonnes: 1_200,
      loading: dordrecht,
      destination: duisburg,
      loadingFromDay: 2,
      loadingUntilDay: 5,
    }),
    makeCargo(base, {
      id: "cargo-rotterdam-nijmegen",
      cargoName: "Voorbeeldlading Rotterdam → Nijmegen",
      cargoType: "dry bulk",
      weightTonnes: 800,
      loading: rotterdam,
      destination: nijmegen,
      loadingFromDay: 3,
      loadingUntilDay: 5,
    }),
    makeCargo(base, {
      id: "cargo-moerdijk-antwerpen",
      cargoName: "Voorbeeldlading Moerdijk → Antwerpen",
      cargoType: "dry bulk",
      weightTonnes: 600,
      loading: moerdijk,
      destination: antwerpen,
      loadingFromDay: 4,
      loadingUntilDay: 6,
    }),
  ];

  const ships = [
    makeShip(base, {
      id: "ship-moerdijk-dry-empty",
      name: "Fictief drogeladingschip — Moerdijk",
      vesselType: "DRY_CARGO",
      loadStage: "EMPTY",
      totalCapacityTonnes: 1_800,
      homeRegion: "Moerdijk",
      capacityOfferId: "offer-moerdijk-dry-empty",
    }),
    makeShip(base, {
      id: "ship-rotterdam-dry-half",
      name: "Fictief drogeladingschip — Rotterdam",
      vesselType: "DRY_CARGO",
      loadStage: "HALF_LOADED",
      totalCapacityTonnes: 2_600,
      homeRegion: "Rotterdam",
      capacityOfferId: "offer-rotterdam-dry-half",
    }),
    makeShip(base, {
      id: "ship-dordrecht-dry-half",
      name: "Fictief drogeladingschip — Dordrecht",
      vesselType: "DRY_CARGO",
      loadStage: "HALF_LOADED",
      totalCapacityTonnes: 1_800,
      homeRegion: "Dordrecht",
      capacityOfferId: "offer-dordrecht-dry-half",
    }),
    makeShip(base, {
      id: "ship-antwerpen-dry-empty",
      name: "Fictief drogeladingschip — Antwerpen",
      vesselType: "DRY_CARGO",
      loadStage: "EMPTY",
      totalCapacityTonnes: 1_600,
      homeRegion: "Antwerpen",
      capacityOfferId: "offer-antwerpen-dry-empty",
    }),
    makeShip(base, {
      id: "ship-moerdijk-tanker-empty",
      name: "Fictieve tanker — Moerdijk",
      vesselType: "TANKER",
      loadStage: "EMPTY",
      totalCapacityTonnes: 2_000,
      homeRegion: "Moerdijk",
      capacityOfferId: "offer-moerdijk-tanker-empty",
    }),
    makeShip(base, {
      id: "ship-nijmegen-dry-empty",
      name: "Fictief drogeladingschip — Nijmegen",
      vesselType: "DRY_CARGO",
      loadStage: "EMPTY",
      totalCapacityTonnes: 1_800,
      homeRegion: "Nijmegen",
      capacityOfferId: "offer-nijmegen-dry-empty",
    }),
  ];

  const offers = [
    makeOffer(base, {
      id: "offer-moerdijk-dry-empty",
      shipId: "ship-moerdijk-dry-empty",
      location: moerdijk,
      availabilityType: "FULLY_EMPTY",
      availableCapacityTonnes: 1_800,
      cargoCompatibility: ["dry bulk"],
      preferredDirection: "Rhine corridor",
      maximumPositioningDistanceKm: 75,
    }),
    makeOffer(base, {
      id: "offer-rotterdam-dry-half",
      shipId: "ship-rotterdam-dry-half",
      location: rotterdam,
      availabilityType: "PARTIALLY_LOADED",
      availableCapacityTonnes: 1_300,
      cargoCompatibility: ["dry bulk"],
      preferredDirection: "Rhine corridor",
      maximumPositioningDistanceKm: 75,
    }),
    makeOffer(base, {
      id: "offer-dordrecht-dry-half",
      shipId: "ship-dordrecht-dry-half",
      location: dordrecht,
      availabilityType: "PARTIALLY_LOADED",
      availableCapacityTonnes: 900,
      cargoCompatibility: ["dry bulk"],
      preferredDirection: "Rhine corridor",
      maximumPositioningDistanceKm: 50,
    }),
    makeOffer(base, {
      id: "offer-antwerpen-dry-empty",
      shipId: "ship-antwerpen-dry-empty",
      location: antwerpen,
      availabilityType: "FULLY_EMPTY",
      availableCapacityTonnes: 1_600,
      cargoCompatibility: ["dry bulk"],
      preferredDirection: "Rhine corridor",
      maximumPositioningDistanceKm: 200,
    }),
    makeOffer(base, {
      id: "offer-moerdijk-tanker-empty",
      shipId: "ship-moerdijk-tanker-empty",
      location: moerdijk,
      availabilityType: "FULLY_EMPTY",
      availableCapacityTonnes: 2_000,
      cargoCompatibility: ["liquid bulk"],
      preferredDirection: "Rhine corridor",
      maximumPositioningDistanceKm: 75,
    }),
    makeOffer(base, {
      id: "offer-nijmegen-dry-empty",
      shipId: "ship-nijmegen-dry-empty",
      location: nijmegen,
      availabilityType: "FULLY_EMPTY",
      availableCapacityTonnes: 1_800,
      cargoCompatibility: ["dry bulk"],
      preferredDirection: "Rhine corridor",
      maximumPositioningDistanceKm: 30,
    }),
  ];

  // Add offer-derived display values after both collections exist.
  for (const ship of ships) {
    const offer = offers.find((item) => item.id === ship.capacityOfferId);
    if (!offer) continue;
    ship.availableCapacity = offer.availableCapacityTonnes;
    ship.maxPositioningDistance = offer.maximumPositioningDistanceKm;
    ship.distanceBand =
      offer.location.id === dordrecht.id
        ? "< 25 km"
        : offer.location.id === antwerpen.id ||
            offer.location.id === nijmegen.id
          ? "50–100 km"
          : "< 25 km";
  }

  return {
    version: DEMO_STATE_VERSION,
    createdAt,
    updatedAt: createdAt,
    profile: {
      id: "andy-kers-demo",
      name: "Andy Kers",
      role: "Transportorganisator / charteraar",
      companyId: "demo-company",
    },
    company: {
      id: "demo-company",
      name: "Demo Transportplanning",
      activities: ["CHARTERER"],
      status: "ACTIVE",
    },
    cargos,
    ships,
    offers,
    capacityOffers: offers,
    matches: {},
    connections: [],
    interests: [],
    messages: [],
  };
}

/** Backwards-compatible name for the initial demo screen. */
export const getInitialDemoState = createDemoState;

export type DemoCargoNormalizeSource =
  | DemoState
  | {
      locations?: DemoLocation[];
      loadingLocation?: DemoLocation;
      destinationLocation?: DemoLocation;
    };

function sourceLocations(source?: DemoCargoNormalizeSource): DemoLocation[] {
  if (!source) return [];
  if ("cargos" in source) {
    return [
      ...source.cargos.flatMap((cargo) => [
        ...(cargo.loadingLocation ? [cargo.loadingLocation] : []),
        ...(cargo.destinationLocation ? [cargo.destinationLocation] : []),
      ]),
      ...source.offers.map((offer) => offer.location),
      ...source.capacityOffers.map((offer) => offer.location),
    ];
  }
  return [
    ...(source.locations ?? []),
    ...(source.loadingLocation ? [source.loadingLocation] : []),
    ...(source.destinationLocation ? [source.destinationLocation] : []),
  ];
}

function resolveDemoLocation(
  name: string,
  explicit: DemoLocation | undefined,
  candidates: DemoLocation[],
): DemoLocation {
  if (explicit && explicit.name.toLowerCase() === name.toLowerCase()) {
    return explicit;
  }
  const found = candidates.find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  );
  if (found) return found;
  throw new RangeError(`Unknown demo location: ${name}`);
}

function normalizedDate(value: string, label: string): {
  iso: string;
  dateOnly: string;
} {
  const trimmed = value.trim();
  const dateOnlyMatch = /^(\d{4}-\d{2}-\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    return {
      iso: `${dateOnlyMatch[1]}T00:00:00.000Z`,
      dateOnly: dateOnlyMatch[1],
    };
  }
  const parsed = asDate(trimmed, label);
  return { iso: parsed.toISOString(), dateOnly: parsed.toISOString().slice(0, 10) };
}

/**
 * Makes the two public cargo representations agree before a cargo is stored.
 * Forms may edit the compact aliases or normalized fields; this function is
 * the single canonical boundary that synchronizes both representations.
 */
export function normalizeDemoCargo(
  cargo: DemoCargo,
  source?: DemoCargoNormalizeSource,
): DemoCargo {
  const candidates = sourceLocations(source);
  const originName = cargo.origin?.trim() || cargo.loadingLocation?.name;
  const destinationName =
    cargo.destination?.trim() || cargo.destinationLocation?.name;
  if (!originName) throw new RangeError("Demo cargo needs a loading location");
  if (!destinationName) throw new RangeError("Demo cargo needs a destination");
  const loadingLocation = resolveDemoLocation(
    originName,
    cargo.loadingLocation,
    candidates,
  );
  const destinationLocation = resolveDemoLocation(
    destinationName,
    cargo.destinationLocation,
    candidates,
  );
  const fromValue = cargo.loadingFrom || cargo.startDate;
  const untilValue = cargo.loadingUntil || cargo.endDate;
  if (!fromValue || !untilValue) {
    throw new RangeError("Demo cargo needs a start and end date");
  }
  const from = normalizedDate(fromValue, "start date");
  const until = normalizedDate(untilValue, "end date");
  if (new Date(until.iso) < new Date(from.iso)) {
    throw new RangeError("End date may not be before start date");
  }
  const weight = Math.max(
    Number(cargo.weight ?? 0),
    Number(cargo.weightTonnes ?? 0),
  );
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new RangeError("Demo cargo weight must be greater than zero");
  }
  const cargoType = (cargo.cargoType || "dry bulk").trim().toLowerCase();
  if (cargoType !== "dry bulk") {
    throw new RangeError("Demo supports dry bulk cargo only");
  }
  const createdAt = cargo.createdAt ?? new Date().toISOString();
  const updatedAt = cargo.updatedAt ?? createdAt;
  return {
    ...cargo,
    companyId: cargo.companyId ?? "demo-company",
    companyStatus: cargo.companyStatus ?? "ACTIVE",
    cargoName:
      cargo.cargoName ??
      `${loadingLocation.name} → ${destinationLocation.name} dry bulk`,
    cargoType,
    origin: loadingLocation.name,
    destination: destinationLocation.name,
    weight,
    weightTonnes: weight,
    loadingLocation: clone(loadingLocation),
    destinationLocation: clone(destinationLocation),
    loadingFrom: from.iso,
    loadingUntil: until.iso,
    startDate: from.dateOnly,
    endDate: until.dateOnly,
    expectedUnloadingDate: cargo.expectedUnloadingDate ?? null,
    requiredVesselType: cargo.requiredVesselType ?? "DRY_CARGO",
    specialRequirements: cargo.specialRequirements ?? null,
    visibility: cargo.visibility ?? "OPEN_NETWORK",
    listingStatus: cargo.listingStatus ?? "ACTIVE",
    createdAt,
    updatedAt,
  };
}

function toMatchingPair(
  cargo: DemoCargo,
  offer: DemoCapacityOffer,
  ship: DemoShip,
): MatchingPair {
  const window = cargoWindow(cargo);
  return {
    cargo: {
      id: cargo.id,
      companyId: cargo.companyId ?? "demo-company",
      companyStatus: cargo.companyStatus ?? "ACTIVE",
      cargoType: cargo.cargoType ?? "dry bulk",
      weightTonnes: Math.max(cargo.weight, cargo.weightTonnes ?? cargo.weight),
      loadingFrom: window.loadingFrom,
      loadingUntil: window.loadingUntil,
      requiredVesselType: cargo.requiredVesselType ?? "DRY_CARGO",
      listingStatus: cargo.listingStatus ?? "ACTIVE",
      visibility: cargo.visibility ?? "OPEN_NETWORK",
    },
    capacity: {
      id: offer.id,
      companyId: offer.companyId,
      companyStatus: offer.companyStatus,
      availableFrom: offer.availableFrom,
      availableUntil: offer.availableUntil,
      availableCapacityTonnes: offer.availableCapacityTonnes,
      cargoCompatibility: offer.cargoCompatibility,
      preferredDirection: offer.preferredDirection,
      maximumPositioningDistanceKm: offer.maximumPositioningDistanceKm,
      listingStatus: offer.listingStatus,
      visibility: offer.visibility,
    },
    vessel: {
      id: ship.id,
      active: ship.active,
      vesselType: ship.vesselType,
    },
    loading: legacyLocation(
      `loading-${cargo.id}`,
      cargo.origin,
      cargo.loadingLocation,
    ),
    destination: legacyLocation(
      `destination-${cargo.id}`,
      cargo.destination,
      cargo.destinationLocation,
    ),
    capacityLocation: offer.location,
  };
}

function stateOffers(state: DemoState) {
  return state.offers.length ? state.offers : state.capacityOffers;
}

function legacyLocation(
  id: string,
  name: string,
  reference: DemoLocation | undefined,
): DemoLocation {
  return (
    reference ?? {
      id,
      name,
      country: "NL",
      region: name,
      latitude: 0,
      longitude: 0,
      active: true,
    }
  );
}

function cargoWindow(cargo: DemoCargo) {
  const loadingFrom = cargo.loadingFrom || `${cargo.startDate}T00:00:00.000Z`;
  const loadingUntil =
    cargo.loadingUntil || `${cargo.endDate}T00:00:00.000Z`;
  return { loadingFrom, loadingUntil };
}

export function evaluateDemo(
  state: DemoState,
  cargoId: string,
  now?: DemoDateInput,
): DemoEvaluation;
export function evaluateDemo(
  cargo: DemoCargo,
  ships: DemoShip[],
): DemoMatchResult[];
export function evaluateDemo(
  stateOrCargo: DemoState | DemoCargo,
  cargoIdOrShips: string | DemoShip[],
  now: DemoDateInput = new Date(),
): DemoEvaluation | DemoMatchResult[] {
  // This adapter keeps the old display-only call usable while all state-based
  // calls below go through the shared pure eligibility/scoring implementation.
  if (Array.isArray(cargoIdOrShips)) {
    const cargo = stateOrCargo as DemoCargo;
    return cargoIdOrShips.map((ship) => {
      const window = cargoWindow(cargo);
      const offer: DemoCapacityOffer = {
        id: ship.capacityOfferId,
        companyId: ship.companyId,
        companyStatus: "ACTIVE",
        vesselId: ship.id,
        location: {
          id: `legacy-${ship.id}`,
          name: ship.location,
          country: "NL",
          region: ship.location,
          latitude: cargo.loadingLocation?.latitude ?? 0,
          longitude: cargo.loadingLocation?.longitude ?? 0,
          active: true,
        },
        availableFrom: window.loadingFrom,
        availableUntil: window.loadingUntil,
        availabilityType: ship.status === "LEEG" ? "FULLY_EMPTY" : "PARTIALLY_LOADED",
        availableCapacityTonnes: ship.availableCapacity,
        cargoCompatibility: ["dry bulk"],
        preferredDirection: "Rhine corridor",
        maximumPositioningDistanceKm: ship.maxPositioningDistance,
        visibility: "OPEN_NETWORK",
        listingStatus: "ACTIVE",
        createdAt: cargo.createdAt ?? new Date().toISOString(),
        updatedAt: cargo.updatedAt ?? new Date().toISOString(),
      };
      const result = evaluateDemo(
        {
          ...createDemoState(cargo.createdAt),
          cargos: [cargo],
          ships: [ship],
          offers: [offer],
          capacityOffers: [offer],
        },
        cargo.id,
        now,
      );
      const match = result.matches[0];
      const exclusion = result.exclusions[0];
      return {
        ship,
        isSuitable: Boolean(match),
        reason: exclusion?.reason,
        consentGranted: false,
        score: match?.score,
        capacityOfferId: offer.id,
      };
    });
  }

  const state = stateOrCargo as DemoState;
  const cargoId = cargoIdOrShips;
  const cargo = state.cargos.find((item) => item.id === cargoId);
  if (!cargo) throw new RangeError(`Unknown demo cargo: ${cargoId}`);
  const evaluatedAt = iso(now, "evaluation time");
  const evaluationDate = asDate(evaluatedAt);
  const matches: DemoMatch[] = [];
  const exclusions: DemoExclusion[] = [];

  for (const offer of stateOffers(state)) {
    const ship = state.ships.find((item) => item.id === offer.vesselId);
    if (!ship) {
      exclusions.push({
        id: `${cargo.id}:${offer.id}`,
        cargoId: cargo.id,
        capacityOfferId: offer.id,
        offerId: offer.id,
        shipId: offer.vesselId,
        eligible: false,
        reason: "missing_vessel",
      });
      continue;
    }
    const eligibility = evaluateDemoEligibility(
      toMatchingPair(cargo, offer, ship),
      evaluationDate,
    );
    if (!eligibility.eligible) {
      exclusions.push({
        id: `${cargo.id}:${offer.id}`,
        cargoId: cargo.id,
        capacityOfferId: offer.id,
        offerId: offer.id,
        shipId: ship.id,
        eligible: false,
        reason: eligibility.reason,
      });
      continue;
    }
    const score = scoreDemoEligiblePair(
      toMatchingPair(cargo, offer, ship),
      eligibility.distanceKm,
    );
    matches.push({
      id: `${cargo.id}:${offer.id}`,
      cargoId: cargo.id,
      capacityOfferId: offer.id,
      offerId: offer.id,
      shipId: ship.id,
      eligible: true,
      score,
      totalScore: score.totalScore,
    });
  }
  const expired =
    new Date(cargoWindow(cargo).loadingUntil) <= evaluationDate ||
    exclusions.some((item) => item.reason === "expired");
  return {
    cargoId,
    evaluatedAt,
    calculationVersion: DEMO_CALCULATION_VERSION,
    status: expired ? "EXPIRED" : "ACTIVE",
    expired,
    matches,
    eligible: matches,
    exclusions,
    results: [...matches, ...exclusions],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validDateString(value: unknown) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

export function isDemoState(value: unknown): value is DemoState {
  if (!isRecord(value) || value.version !== DEMO_STATE_VERSION) return false;
  if (!validDateString(value.createdAt) || !validDateString(value.updatedAt)) {
    return false;
  }
  if (
    !isRecord(value.profile) ||
    typeof value.profile.id !== "string" ||
    typeof value.profile.name !== "string" ||
    typeof value.profile.role !== "string" ||
    typeof value.profile.companyId !== "string"
  ) {
    return false;
  }
  if (
    !isRecord(value.company) ||
    typeof value.company.id !== "string" ||
    typeof value.company.name !== "string" ||
    !Array.isArray(value.company.activities)
  ) {
    return false;
  }
  if (
    !Array.isArray(value.cargos) ||
    !Array.isArray(value.ships) ||
    !Array.isArray(value.offers) ||
    !Array.isArray(value.capacityOffers) ||
    !isRecord(value.matches) ||
    !Array.isArray(value.connections) ||
    !Array.isArray(value.interests) ||
    !Array.isArray(value.messages)
  ) {
    return false;
  }
  if (value.ships.length !== 6 || value.offers.length !== 6) return false;
  if (value.capacityOffers.length !== 6) return false;
  const cargos = value.cargos as Array<Record<string, unknown>>;
  if (
    !cargos.every(
      (cargo) =>
        typeof cargo.id === "string" &&
        typeof cargo.companyId === "string" &&
        validDateString(cargo.loadingFrom) &&
        validDateString(cargo.loadingUntil) &&
        validDateString(cargo.createdAt) &&
        validDateString(cargo.updatedAt),
    )
  ) {
    return false;
  }
  const offers = value.offers as Array<Record<string, unknown>>;
  return offers.every(
    (offer) =>
      typeof offer.id === "string" &&
      typeof offer.vesselId === "string" &&
      validDateString(offer.availableFrom) &&
      validDateString(offer.availableUntil) &&
      validDateString(offer.createdAt) &&
      validDateString(offer.updatedAt),
  );
}

function storage(): Storage | null {
  if (typeof globalThis.localStorage === "undefined") return null;
  return globalThis.localStorage;
}

export function loadDemoState(): DemoState | null {
  const currentStorage = storage();
  if (!currentStorage) return null;
  let raw: string | null;
  try {
    raw = currentStorage.getItem(DEMO_STORAGE_KEY);
  } catch (error) {
    throw new Error("Lokale demogegevens kunnen niet worden gelezen.", { cause: error });
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isDemoState(parsed)) throw new Error("Ongeldige demogegevens.");
    return parsed;
  } catch (error) {
    throw new Error("De lokale demogegevens zijn beschadigd. Begin de demo opnieuw.", { cause: error });
  }
}

export function saveDemoState(state: DemoState): void {
  if (!isDemoState(state)) throw new TypeError("Invalid CargoMatch demo state");
  const currentStorage = storage();
  if (!currentStorage) return;
  try {
    currentStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    throw new Error("Unable to save CargoMatch demo state", { cause: error });
  }
}

export function clearDemoState(): void {
  const currentStorage = storage();
  if (!currentStorage) return;
  try {
    currentStorage.removeItem(DEMO_STORAGE_KEY);
  } catch (error) {
    throw new Error("Unable to clear CargoMatch demo state", { cause: error });
  }
}