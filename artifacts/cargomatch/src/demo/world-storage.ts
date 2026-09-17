import {
  WORLD_STATE_VERSION,
  WORLD_STORAGE_KEY,
  type WorldState,
  type WorldStorageLoad,
  type WorldStorageResetChoice,
} from "./world-types";

export const LEGACY_WORLD_STORAGE_KEYS = ["cargomatch.demo.v1", "cargomatch.demo"] as const;

export interface WorldStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): WorldStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const dateString = (value: unknown) => string(value) && !Number.isNaN(new Date(value).getTime());
const oneOf = (value: unknown, values: readonly string[]) => typeof value === "string" && values.includes(value);
const location = (value: unknown): value is Record<string, unknown> => record(value)
  && string(value.id) && string(value.name) && string(value.region) && string(value.country)
  && typeof value.latitude === "number" && Number.isFinite(value.latitude)
  && typeof value.longitude === "number" && Number.isFinite(value.longitude)
  && typeof value.active === "boolean";
const positiveNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
const nonNegativeNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const modeCargoFields = (item: Record<string, unknown>) => {
  if (item.mode === "INLAND") return string(item.requiredVesselType);
  if (item.mode === "DEEPSEA") return string(item.requiredVesselType) && record(item.deepseaRequirement);
  if (item.mode === "ROAD") return record(item.roadRequirements) && Array.isArray(item.roadRequirements.requiredEquipment);
  if (item.mode === "LINER") return record(item.linerRequirements) && string(item.linerRequirements.cargoType) && dateString(item.linerRequirements.readyAt);
  return false;
};
const modeAssetFields = (item: Record<string, unknown>) => {
  if (item.mode === "DEEPSEA") return record(item.deepseaProfile) && positiveNumber(item.deepseaProfile.dwtTonnes);
  if (item.mode === "ROAD") return record(item.roadProfile) && positiveNumber(item.roadProfile.volumeCubicMetres) && positiveNumber(item.roadProfile.loadingMetres) && positiveNumber(item.roadProfile.palletPositions);
  return true;
};
const modeOfferFields = (item: Record<string, unknown>) => {
  if (!positiveNumber(item.maximumPositioningDistanceKm)) return false;
  if (item.mode === "DEEPSEA") return record(item.deepseaAvailability);
  if (item.mode === "ROAD") return record(item.roadAvailability) && dateString(item.roadAvailability.currentDeliveryExpectedAt) && dateString(item.roadAvailability.expectedAvailabilityAt) && nonNegativeNumber(item.roadAvailability.availabilityUncertaintyMinutes);
  return true;
};
const linerServiceFields = (item: Record<string, unknown>) => {
  const service = item.linerService;
  return record(service) && typeof service.vesselActive === "boolean" && Array.isArray(service.portRotation) && service.portRotation.length >= 2 && service.portRotation.every((call) => record(call) && string(call.locationId) && typeof call.sequence === "number" && dateString(call.estimatedDeparture)) && Array.isArray(service.acceptedCargoTypes) && positiveNumber(service.availableCommercialTonnes) && positiveNumber(service.maximumPieceWeightTonnes) && positiveNumber(service.maximumPieceLengthMetres) && positiveNumber(service.maximumPieceWidthMetres) && positiveNumber(service.maximumPieceHeightMetres) && positiveNumber(service.liftingCapacityTonnes);
};

function validState(value: unknown): value is WorldState {
  if (!record(value) || value.version !== WORLD_STATE_VERSION || !dateString(value.createdAt) || !dateString(value.updatedAt)) return false;
  const state = value;
  if (state.activePersonaId !== undefined && !string(state.activePersonaId)) return false;
  const arrays = ["companies", "users", "locations", "cargos", "assets", "offers", "departures", "matches", "messages", "operationalEvidence"];
  if (!arrays.every((key) => Array.isArray(state[key]))) return false;
  const companies = state.companies as unknown[];
  const companyIds = new Set<string>();
  for (const raw of companies) {
    if (!record(raw) || !string(raw.id) || companyIds.has(raw.id) || !string(raw.name) || !oneOf(raw.mode, ["INLAND", "DEEPSEA", "LINER", "ROAD"]) || !Array.isArray(raw.activities) || !raw.activities.every(string) || !oneOf(raw.status, ["ACTIVE", "INACTIVE"]) || raw.fictional !== true) return false;
    companyIds.add(raw.id);
  }
  const users = state.users as unknown[];
  const userIds = new Set<string>();
  for (const raw of users) {
    if (!record(raw) || !string(raw.id) || userIds.has(raw.id) || !string(raw.companyId) || !companyIds.has(raw.companyId) || !string(raw.name) || !oneOf(raw.role, ["OWNER", "PLANNER", "DRIVER", "MEMBER"])) return false;
    userIds.add(raw.id);
  }
  if (state.activePersonaId !== undefined && !userIds.has(state.activePersonaId)) return false;
  const locations = state.locations as unknown[];
  const locationIds = new Set<string>();
  for (const raw of locations) {
    if (!location(raw) || !string(raw.id) || locationIds.has(raw.id)) return false;
    locationIds.add(raw.id);
  }
  const listing = (raw: Record<string, unknown>) => string(raw.id) && string(raw.companyId) && companyIds.has(raw.companyId) && oneOf(raw.listingStatus, ["DRAFT", "ACTIVE", "WITHDRAWN", "EXPIRED", "CLOSED"]) && oneOf(raw.visibility, ["OPEN_NETWORK", "PRIVATE"]);
  for (const raw of state.cargos as unknown[]) {
    if (!record(raw) || !listing(raw) || !oneOf(raw.mode, ["INLAND", "DEEPSEA", "LINER", "ROAD"]) || !string(raw.name) || !string(raw.cargoType) || typeof raw.weightTonnes !== "number" || !Number.isFinite(raw.weightTonnes) || raw.weightTonnes <= 0 || !location(raw.origin) || !location(raw.destination) || !dateString(raw.readyFrom) || !dateString(raw.readyUntil) || !dateString(raw.createdAt) || !dateString(raw.updatedAt) || !modeCargoFields(raw)) return false;
  }
  const assets = state.assets as unknown[];
  const assetIds = new Set<string>();
  for (const raw of assets) {
    if (!record(raw) || !string(raw.id) || assetIds.has(raw.id) || !oneOf(raw.mode, ["INLAND", "DEEPSEA", "ROAD"]) || !string(raw.companyId) || !companyIds.has(raw.companyId) || !string(raw.name) || !string(raw.type) || typeof raw.active !== "boolean" || typeof raw.capacityTonnes !== "number" || !Number.isFinite(raw.capacityTonnes) || raw.capacityTonnes <= 0 || !Array.isArray(raw.equipment) || !raw.equipment.every(string) || !modeAssetFields(raw)) return false;
    assetIds.add(raw.id);
  }
  for (const raw of state.offers as unknown[]) {
    if (!record(raw) || !listing(raw) || !oneOf(raw.mode, ["INLAND", "DEEPSEA", "ROAD"]) || !string(raw.assetId) || !assetIds.has(raw.assetId) || !location(raw.location) || !dateString(raw.availableFrom) || !dateString(raw.availableUntil) || typeof raw.capacityTonnes !== "number" || !Number.isFinite(raw.capacityTonnes) || raw.capacityTonnes <= 0 || !Array.isArray(raw.cargoTypes) || !raw.cargoTypes.every(string) || !dateString(raw.createdAt) || !dateString(raw.updatedAt) || !modeOfferFields(raw)) return false;
    const asset = assets.find((candidate) => record(candidate) && candidate.id === raw.assetId);
    if (!record(asset) || asset.companyId !== raw.companyId || asset.mode !== raw.mode || typeof asset.capacityTonnes !== "number" || raw.capacityTonnes > asset.capacityTonnes) return false;
  }
  for (const raw of state.departures as unknown[]) {
    if (!record(raw) || !string(raw.id) || !string(raw.companyId) || !companyIds.has(raw.companyId) || !string(raw.serviceName) || !location(raw.origin) || !location(raw.destination) || !dateString(raw.departureAt) || !dateString(raw.cargoCutoffAt) || typeof raw.capacityTonnes !== "number" || !Number.isFinite(raw.capacityTonnes) || raw.capacityTonnes <= 0 || !oneOf(raw.listingStatus, ["DRAFT", "ACTIVE", "WITHDRAWN", "EXPIRED", "CLOSED"]) || !oneOf(raw.visibility, ["OPEN_NETWORK", "PRIVATE"]) || !dateString(raw.createdAt) || !dateString(raw.updatedAt) || !linerServiceFields(raw)) return false;
  }
  const matchIds = new Set<string>();
  for (const raw of state.matches as unknown[]) {
    if (!record(raw) || !string(raw.id) || matchIds.has(raw.id) || !oneOf(raw.mode, ["INLAND", "DEEPSEA", "LINER", "ROAD"]) || !string(raw.cargoId) || !string(raw.leftCompanyId) || !companyIds.has(raw.leftCompanyId) || !string(raw.rightCompanyId) || !companyIds.has(raw.rightCompanyId) || !oneOf(raw.status, ["NEW", "INTEREST_SENT", "CONNECTED", "REJECTED", "WITHDRAWN", "STALE"]) || (raw.leftConsent !== null && !oneOf(raw.leftConsent, ["PENDING", "ACCEPTED", "REJECTED", "WITHDRAWN"])) || (raw.rightConsent !== null && !oneOf(raw.rightConsent, ["PENDING", "ACCEPTED", "REJECTED", "WITHDRAWN"])) || typeof raw.score !== "number" || !Number.isFinite(raw.score) || !dateString(raw.createdAt) || !dateString(raw.updatedAt) || !string(raw.calculationVersion)) return false;
    matchIds.add(raw.id);
  }
  for (const raw of state.messages as unknown[]) {
    if (!record(raw) || !string(raw.id) || !string(raw.matchId) || !matchIds.has(raw.matchId) || !string(raw.senderCompanyId) || !companyIds.has(raw.senderCompanyId) || !string(raw.senderUserId) || !userIds.has(raw.senderUserId) || !string(raw.body) || !dateString(raw.createdAt)) return false;
  }
  for (const raw of state.operationalEvidence as unknown[]) {
    if (!record(raw) || !string(raw.id) || !string(raw.offerId) || !string(raw.driverUserId) || !userIds.has(raw.driverUserId) || !oneOf(raw.status, ["CONFIRMED", "FLAGGED"]) || !dateString(raw.createdAt)) return false;
  }
  return true;
}
export const isWorldState = validState;

export function loadWorldState(storage: WorldStorage | null = browserStorage()): WorldStorageLoad {
  if (!storage) return { status: "UNAVAILABLE", state: null, error: "Browser storage is unavailable." };
  let raw: string | null;
  try {
    raw = storage.getItem(WORLD_STORAGE_KEY);
  } catch {
    return { status: "UNAVAILABLE", state: null, error: "Browser storage cannot be read." };
  }
  if (!raw) {
    for (const key of LEGACY_WORLD_STORAGE_KEYS) {
      try {
        if (storage.getItem(key) != null) return { status: "LEGACY", state: null, version: 1 };
      } catch {
        return { status: "UNAVAILABLE", state: null, error: "Browser storage cannot be read." };
      }
    }
    return { status: "EMPTY", state: null };
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (validState(value)) return { status: "LOADED", state: value };
    if (value && typeof value === "object" && "version" in value && (value as { version?: unknown }).version !== WORLD_STATE_VERSION) {
      return { status: "LEGACY", state: null, version: (value as { version?: unknown }).version };
    }
    return { status: "CORRUPT", state: null, error: "Stored demo data has an invalid shape." };
  } catch {
    return { status: "CORRUPT", state: null, error: "Stored demo data is not valid JSON." };
  }
}

/**
 * Reset is explicit: callers must choose whether to remove a legacy/corrupt
 * value. A malformed value is never silently replaced during load.
 */
export function resetWorldStorage(
  choice: WorldStorageResetChoice,
  storage: WorldStorage | null = browserStorage(),
) {
  if (choice === "KEEP") return { ok: true as const, changed: false, status: "KEPT" as const };
  if (!storage) return { ok: false as const, changed: false, status: "UNAVAILABLE" as const, error: "Browser storage is unavailable." };
  try {
    storage.removeItem(WORLD_STORAGE_KEY);
    if (choice === "RESET_LEGACY") for (const key of LEGACY_WORLD_STORAGE_KEYS) storage.removeItem(key);
    return { ok: true as const, changed: true, status: "RESET" as const };
  } catch {
    return { ok: false as const, changed: false, status: "UNAVAILABLE" as const, error: "Browser storage cannot be changed." };
  }
}

export function saveWorldState(state: WorldState, storage: WorldStorage | null = browserStorage()) {
  if (!validState(state)) return { ok: false as const, changed: false, error: "Invalid world state." };
  if (!storage) return { ok: false as const, changed: false, error: "Browser storage is unavailable." };
  try {
    storage.setItem(WORLD_STORAGE_KEY, JSON.stringify(state));
    return { ok: true as const, changed: true };
  } catch {
    return { ok: false as const, changed: false, error: "Browser storage cannot be written." };
  }
}

export function clearWorldState(storage: WorldStorage | null = browserStorage()) {
  return resetWorldStorage("RESET_CORRUPT", storage);
}

export { WORLD_STORAGE_KEY, WORLD_STATE_VERSION };