/**
 * Browser-only multi-company demo contract.  These types deliberately do not
 * reference an API client, a session, or a server model.
 */
export const WORLD_STATE_VERSION = 2 as const;
export const WORLD_STORAGE_KEY = "cargomatch.demo.world.v2";

export type WorldMode = "INLAND" | "DEEPSEA" | "LINER" | "ROAD";
export type WorldLinerCargoType =
  | "BREAKBULK"
  | "PROJECT_CARGO"
  | "HEAVY_LIFT"
  | "STEEL"
  | "MACHINERY"
  | "RORO";
export type WorldLinerStowage = "DECK" | "HOLD" | "EITHER";
export type WorldDeepseaVesselClass =
  | "HANDYSIZE" | "HANDYMAX" | "SUPRAMAX" | "ULTRAMAX" | "PANAMAX"
  | "KAMSARMAX" | "POST_PANAMAX" | "CAPESIZE" | "NEWCASTLEMAX" | "OTHER";
export type WorldRole = "OWNER" | "PLANNER" | "DRIVER" | "MEMBER";
export type ListingStatus = "DRAFT" | "ACTIVE" | "WITHDRAWN" | "EXPIRED" | "CLOSED";
export type Visibility = "OPEN_NETWORK" | "PRIVATE";
export type ConsentStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";
export type MatchStatus = "NEW" | "INTEREST_SENT" | "CONNECTED" | "REJECTED" | "WITHDRAWN" | "STALE";

export interface WorldCompany {
  id: string;
  name: string;
  mode: WorldMode;
  activities: string[];
  status: "ACTIVE" | "INACTIVE";
  fictional: true;
}

export interface WorldUser {
  id: string;
  companyId: string;
  name: string;
  role: WorldRole;
}

export interface WorldLocation {
  id: string;
  name: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
  active: boolean;
}

export interface WorldCargo {
  id: string;
  mode: WorldMode;
  companyId: string;
  name: string;
  cargoType: string;
  weightTonnes: number;
  origin: WorldLocation;
  destination: WorldLocation;
  readyFrom: string;
  readyUntil: string;
  listingStatus: ListingStatus;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
  requiredVesselType?: string;
  requiredEquipment?: string[];
  /** Required for a matching deepsea listing; manual estimates are never route verified. */
  deepseaRequirement?: WorldDeepseaCargoRequirement;
  /** Required for a conventional/breakbulk liner match; container cargo is not modelled here. */
  linerRequirements?: WorldLinerCargoRequirement;
  /** Required for a matching road listing. */
  roadRequirements?: WorldRoadCargoRequirement;
}

export interface WorldAsset {
  id: string;
  mode: "INLAND" | "DEEPSEA" | "ROAD";
  companyId: string;
  name: string;
  type: string;
  active: boolean;
  capacityTonnes: number;
  equipment: string[];
  assignedDriverId?: string;
  /** Registered physical limits for road matching. `capacityTonnes` remains the legacy payload field. */
  roadProfile?: WorldRoadAssetProfile;
  /** Required for a matching deepsea listing. */
  deepseaProfile?: WorldDeepseaVesselProfile;
}

export interface WorldOffer {
  id: string;
  mode: "INLAND" | "DEEPSEA" | "ROAD";
  companyId: string;
  assetId: string;
  location: WorldLocation;
  availableFrom: string;
  availableUntil: string;
  capacityTonnes: number;
  cargoTypes: string[];
  listingStatus: ListingStatus;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
  direction?: string;
  projection?: Record<string, string>;
  /** Explicit positioning limit. Legacy `projection.maximumPositioningDistanceKm` is read only for inland migration. */
  maximumPositioningDistanceKm?: number;
  /** Required for a matching road offer. */
  roadAvailability?: WorldRoadAvailability;
  /** Optional manual positioning estimate; it is labelled USER_ESTIMATED / NOT_VERIFIED. */
  deepseaAvailability?: WorldDeepseaAvailability;
}

export interface WorldDeparture {
  id: string;
  companyId: string;
  serviceName: string;
  origin: WorldLocation;
  destination: WorldLocation;
  departureAt: string;
  cargoCutoffAt: string;
  capacityTonnes: number;
  listingStatus: ListingStatus;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
  /** Published conventional/breakbulk sailing details and ordered port calls. */
  linerService?: WorldLinerService;
}

export interface WorldDeepseaVesselProfile {
  vesselClass: WorldDeepseaVesselClass;
  dwtTonnes: number;
  summerDraftMetres?: number | null;
  gearConfiguration?: string | null;
}

export interface WorldDeepseaCargoRequirement {
  quantityTolerancePercent?: number;
  minimumVesselDwtTonnes?: number | null;
  maximumVesselDwtTonnes?: number | null;
  maximumDraftMetres?: number | null;
  requiredGear?: string | null;
  preferredVesselClass?: WorldDeepseaVesselClass | null;
}

export interface WorldDeepseaAvailability {
  manualPositioningDays?: number | null;
  departureUncertaintyDays?: number | null;
  positioningBufferDays?: number | null;
  approximateMaxDistanceKm?: number | null;
  routeChoice?: "UNSPECIFIED" | "DIRECT" | "SUEZ" | "PANAMA" | "CAPE_GOOD_HOPE" | "OTHER";
}

export interface WorldRoadAssetProfile {
  payloadTonnes?: number;
  volumeCubicMetres: number;
  loadingMetres: number;
  palletPositions: number;
  trailerType?: string | null;
  adrClasses?: string[];
  temperatureMinCelsius?: number | null;
  temperatureMaxCelsius?: number | null;
}

export interface WorldRoadCargoRequirement {
  volumeCubicMetres?: number | null;
  loadingMetres?: number | null;
  palletPositions?: number | null;
  requiredEquipment: string[];
  requiredTrailerType?: string | null;
  temperatureMinCelsius?: number | null;
  temperatureMaxCelsius?: number | null;
  adrClasses?: string[];
  direction?: string | null;
}

export interface WorldRoadAvailability {
  currentDeliveryExpectedAt: string;
  expectedAvailabilityAt: string;
  availabilityUncertaintyMinutes: number;
  availableVolumeCubicMetres: number;
  availableLoadingMetres: number;
  availablePalletPositions: number;
  equipment?: string[];
  adrClasses?: string[];
  trailerType?: string | null;
  temperatureMinCelsius?: number | null;
  temperatureMaxCelsius?: number | null;
  preferredDirection?: string | null;
}

export interface WorldLinerCargoRequirement {
  cargoType: WorldLinerCargoType;
  pieceCount: number;
  pieceWeightTonnes: number;
  pieceLengthMetres: number;
  pieceWidthMetres: number;
  pieceHeightMetres: number;
  requiredLiftingTonnes?: number | null;
  requiredStowage: WorldLinerStowage;
  readyAt: string;
}

export interface WorldLinerPortCall {
  locationId: string;
  sequence: number;
  estimatedDeparture: string;
}

export interface WorldLinerService {
  vesselActive: boolean;
  vesselCompanyId?: string;
  serviceListingStatus?: ListingStatus;
  serviceVisibility?: Visibility;
  portRotation: WorldLinerPortCall[];
  availableCommercialTonnes: number;
  maximumPieceWeightTonnes: number;
  maximumPieceLengthMetres: number;
  maximumPieceWidthMetres: number;
  maximumPieceHeightMetres: number;
  liftingCapacityTonnes: number;
  stowage: WorldLinerStowage;
  acceptedCargoTypes: WorldLinerCargoType[];
}

export interface WorldMatch {
  id: string;
  mode: WorldMode;
  cargoId: string;
  offerId?: string;
  departureId?: string;
  leftCompanyId: string;
  rightCompanyId: string;
  status: MatchStatus;
  leftConsent: ConsentStatus | null;
  rightConsent: ConsentStatus | null;
  score: number;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  calculationVersion: string;
}

export interface WorldMessage {
  id: string;
  matchId: string;
  senderCompanyId: string;
  body: string;
  createdAt: string;
}

export interface WorldOperationalEvidence {
  id: string;
  offerId: string;
  driverUserId: string;
  status: "CONFIRMED" | "FLAGGED";
  note?: string;
  createdAt: string;
}

export interface WorldState {
  activePersonaId?: string;
  version: typeof WORLD_STATE_VERSION;
  createdAt: string;
  updatedAt: string;
  companies: WorldCompany[];
  users: WorldUser[];
  locations: WorldLocation[];
  cargos: WorldCargo[];
  assets: WorldAsset[];
  offers: WorldOffer[];
  departures: WorldDeparture[];
  matches: WorldMatch[];
  messages: WorldMessage[];
  operationalEvidence: WorldOperationalEvidence[];
}

export interface WorldProjection {
  id: string;
  mode: WorldMode;
  kind: "CARGO" | "OFFER" | "DEPARTURE";
  ownerCompanyId?: string;
  companyName?: string;
  origin: string;
  destination: string;
  timeBand: string;
  capacityBand?: string;
  cargoTypeBand?: string;
  detailsVisible: boolean;
  anonymous: boolean;
}

export interface WorldMatchEvaluation {
  eligible: boolean;
  score: number;
  reason?: string;
  calculationVersion: string;
  distanceKm?: number;
  provisional?: boolean;
  evaluationInputs?: Record<string, string>;
  explanation?: string;
}

export type WorldResult<T> =
  | { ok: true; value: T; changed: boolean }
  | { ok: false; code: string; message: string };

export type WorldStorageResetChoice = "RESET_LEGACY" | "RESET_CORRUPT" | "KEEP";
export type WorldStorageLoad =
  | { status: "EMPTY"; state: null }
  | { status: "LOADED"; state: WorldState }
  | { status: "LEGACY"; state: null; version?: unknown }
  | { status: "CORRUPT"; state: null; error: string }
  | { status: "UNAVAILABLE"; state: null; error: string };