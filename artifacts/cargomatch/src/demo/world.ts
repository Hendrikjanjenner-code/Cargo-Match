import { findWorldMatches, evaluateWorldDeparture, evaluateWorldOffer, WORLD_CALCULATION_VERSION } from "./world-matching";
import { cargoFormPayload, assetFormPayload, offerFormPayload, departureFormPayload, type CargoForm, type AssetForm, type OfferForm, type DepartureForm } from "./world-forms";
import type {
  WorldAsset, WorldCargo, WorldCompany, WorldDeparture, WorldLocation, WorldMatch, WorldMessage,
  WorldMode, WorldOffer, WorldOperationalEvidence, WorldProjection, WorldResult, WorldRole, WorldState, WorldUser,
} from "./world-types";
import { WORLD_STATE_VERSION } from "./world-types";

export * from "./world-types";
export * from "./world-forms";
export * from "./world-matching";
export * from "./world-storage";

const DAY = 86_400_000;
const date = (value: string | Date) => {
  const result = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(result.getTime())) throw new RangeError("Invalid world date");
  return result;
};
const at = (base: Date, days: number) => new Date(base.getTime() + days * DAY).toISOString();
const id = (kind: string, base: Date, n: number) => `world-${kind}-${base.getTime()}-${n}`;
const location = (id: string, name: string, region: string, country: string, latitude: number, longitude: number): WorldLocation =>
  ({ id, name, region, country, latitude, longitude, active: true });
const copy = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;

export const WORLD_PERSONAS = {
  andy: "andy",
  shipper: "shipper-planner",
  inland: "inland-planner",
  deepsea: "deepsea-planner",
  liner: "liner-planner",
  roadPlanner: "road-planner",
  roadDriver: "road-driver",
} as const;
export type WorldPersonaId = typeof WORLD_PERSONAS[keyof typeof WORLD_PERSONAS];
export type WorldDemoState = WorldState & { activePersonaId?: WorldPersonaId };
type RuntimeMatch = WorldMatch & { revision?: string };
export type WorldMessageWithUser = WorldMessage & { senderUserId: string };

const companies = (): WorldCompany[] => [
  { id: "company-andy", name: "Demo Transportplanning", mode: "INLAND", activities: ["CHARTERER"], status: "ACTIVE", fictional: true },
  { id: "company-shipper", name: "Northstar Materials", mode: "INLAND", activities: ["SHIPPER"], status: "ACTIVE", fictional: true },
  { id: "company-inland", name: "Delta Barge Logistics", mode: "INLAND", activities: ["INLAND_CARRIER"], status: "ACTIVE", fictional: true },
  { id: "company-deepsea", name: "BlueHarbor Bulk", mode: "DEEPSEA", activities: ["DEEPSEA_CARRIER"], status: "ACTIVE", fictional: true },
    { id: "company-liner", name: "Atlas Conventional Lines", mode: "LINER", activities: ["LINER", "CARRIER"], status: "ACTIVE", fictional: true },
  { id: "company-road", name: "Rijnland Road Freight", mode: "ROAD", activities: ["ROAD_CARRIER"], status: "ACTIVE", fictional: true },
];

const users = (): WorldUser[] => [
  { id: WORLD_PERSONAS.andy, companyId: "company-andy", name: "Andy Kers", role: "OWNER" },
  { id: WORLD_PERSONAS.shipper, companyId: "company-shipper", name: "Nora Northstar", role: "OWNER" },
  { id: WORLD_PERSONAS.inland, companyId: "company-inland", name: "Ivo Delta", role: "OWNER" },
  { id: WORLD_PERSONAS.deepsea, companyId: "company-deepsea", name: "Dani BlueHarbor", role: "OWNER" },
  { id: WORLD_PERSONAS.liner, companyId: "company-liner", name: "Lina Atlas", role: "OWNER" },
  { id: WORLD_PERSONAS.roadPlanner, companyId: "company-road", name: "Ruben Planner", role: "PLANNER" },
  { id: WORLD_PERSONAS.roadDriver, companyId: "company-road", name: "Rosa Driver", role: "DRIVER" },
];

export interface WorldSeed {
  state: WorldState;
  personas: WorldUser[];
}

function cargo(base: Date, input: Omit<WorldCargo, "createdAt" | "updatedAt">): WorldCargo {
  const now = base.toISOString();
  return { ...input, createdAt: now, updatedAt: now };
}
function offer(base: Date, input: Omit<WorldOffer, "createdAt" | "updatedAt">): WorldOffer {
  const now = base.toISOString();
  return { ...input, createdAt: now, updatedAt: now };
}
function departure(base: Date, input: Omit<WorldDeparture, "createdAt" | "updatedAt">): WorldDeparture {
  const now = base.toISOString();
  return { ...input, createdAt: now, updatedAt: now };
}

/**
 * Six fictional companies and one deliberately small positive/negative
 * fixture per transport mode. All dates are relative to the supplied base.
 */
export function createWorldState(now: string | Date = new Date()): WorldDemoState {
  const base = date(now);
  const locations = [
    location("loc-rotterdam", "Rotterdam", "South Holland", "NL", 51.9244, 4.4777),
    location("loc-duisburg", "Duisburg", "North Rhine-Westphalia", "DE", 51.4344, 6.7623),
    location("loc-antwerp", "Antwerp", "Flanders", "BE", 51.2194, 4.4025),
    location("loc-singapore", "Singapore", "Singapore", "SG", 1.3521, 103.8198),
    location("loc-shanghai", "Shanghai", "Shanghai", "CN", 31.2304, 121.4737),
    location("loc-hamburg", "Hamburg", "Hamburg", "DE", 53.5511, 9.9937),
    location("loc-utrecht", "Utrecht", "Utrecht", "NL", 52.0907, 5.1214),
    location("loc-eindhoven", "Eindhoven", "North Brabant", "NL", 51.4416, 5.4697),
  ];
  const [rotterdam, duisburg, antwerp, singapore, shanghai, hamburg, utrecht, eindhoven] = locations;
  const stamp = base.toISOString();
  const assets: WorldAsset[] = [
    { id: "asset-delta-barge", mode: "INLAND", companyId: "company-inland", name: "Delta Pioneer", type: "DRY_CARGO", active: true, capacityTonnes: 1800, equipment: ["dry bulk"] },
    { id: "asset-blueharbor-ship", mode: "DEEPSEA", companyId: "company-deepsea", name: "Blue Meridian", type: "DRY_CARGO", active: true, capacityTonnes: 40000, equipment: ["dry bulk"], deepseaProfile: { vesselClass: "HANDYSIZE", dwtTonnes: 40000, summerDraftMetres: 8, gearConfiguration: "shore crane" } },
    { id: "asset-rijnland-truck", mode: "ROAD", companyId: "company-road", name: "Rijnland 42", type: "TRUCK", active: true, capacityTonnes: 24, equipment: ["curtainsider"], assignedDriverId: WORLD_PERSONAS.roadDriver, roadProfile: { payloadTonnes: 24, volumeCubicMetres: 100, loadingMetres: 13, palletPositions: 33, trailerType: "curtainsider", adrClasses: [] } },
  ];
  const cargos: WorldCargo[] = [
    cargo(base, { id: "cargo-andy-inland", mode: "INLAND", companyId: "company-andy", name: "Andy dry bulk", cargoType: "dry bulk", weightTonnes: 1200, origin: copy(rotterdam), destination: copy(duisburg), readyFrom: at(base, 2), readyUntil: at(base, 5), listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", requiredVesselType: "DRY_CARGO" }),
    cargo(base, { id: "cargo-shipper-inland", mode: "INLAND", companyId: "company-shipper", name: "Northstar aggregates", cargoType: "dry bulk", weightTonnes: 900, origin: copy(rotterdam), destination: copy(duisburg), readyFrom: at(base, 3), readyUntil: at(base, 6), listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", requiredVesselType: "DRY_CARGO" }),
    cargo(base, { id: "cargo-deepsea", mode: "DEEPSEA", companyId: "company-shipper", name: "Northstar export bulk", cargoType: "dry bulk", weightTonnes: 20000, origin: copy(singapore), destination: copy(hamburg), readyFrom: at(base, 3), readyUntil: at(base, 8), listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", requiredVesselType: "DRY_CARGO", deepseaRequirement: { quantityTolerancePercent: 0, preferredVesselClass: "HANDYSIZE" } }),
    cargo(base, { id: "cargo-liner", mode: "LINER", companyId: "company-shipper", name: "Northstar breakbulk", cargoType: "BREAKBULK", weightTonnes: 800, origin: copy(shanghai), destination: copy(hamburg), readyFrom: at(base, 4), readyUntil: at(base, 7), listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", linerRequirements: { cargoType: "BREAKBULK", pieceCount: 1, pieceWeightTonnes: 800, pieceLengthMetres: 10, pieceWidthMetres: 2, pieceHeightMetres: 2, requiredStowage: "EITHER", readyAt: at(base, 4) } }),
    cargo(base, { id: "cargo-road", mode: "ROAD", companyId: "company-shipper", name: "Northstar pallets", cargoType: "general cargo", weightTonnes: 18, origin: copy(utrecht), destination: copy(eindhoven), readyFrom: at(base, 2), readyUntil: at(base, 3), listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", requiredEquipment: ["curtainsider"], roadRequirements: { volumeCubicMetres: 40, loadingMetres: 8, palletPositions: 20, requiredEquipment: ["curtainsider"] } }),
    cargo(base, { id: "cargo-private-negative", mode: "ROAD", companyId: "company-shipper", name: "Private test cargo", cargoType: "general cargo", weightTonnes: 10, origin: copy(utrecht), destination: copy(eindhoven), readyFrom: at(base, 2), readyUntil: at(base, 3), listingStatus: "ACTIVE", visibility: "PRIVATE", roadRequirements: { volumeCubicMetres: 20, loadingMetres: 4, palletPositions: 10, requiredEquipment: ["curtainsider"] } }),
  ];
  const offers: WorldOffer[] = [
    offer(base, { id: "offer-inland", mode: "INLAND", companyId: "company-inland", assetId: "asset-delta-barge", location: copy(rotterdam), availableFrom: at(base, 1), availableUntil: at(base, 7), capacityTonnes: 1800, cargoTypes: ["dry bulk"], listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", direction: "Rhine", maximumPositioningDistanceKm: 100, projection: { maximumPositioningDistanceKm: "100" } }),
    offer(base, { id: "offer-inland-negative", mode: "INLAND", companyId: "company-inland", assetId: "asset-delta-barge", location: copy(rotterdam), availableFrom: at(base, 1), availableUntil: at(base, 7), capacityTonnes: 400, cargoTypes: ["dry bulk"], listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", maximumPositioningDistanceKm: 100 }),
    offer(base, { id: "offer-deepsea", mode: "DEEPSEA", companyId: "company-deepsea", assetId: "asset-blueharbor-ship", location: copy(singapore), availableFrom: at(base, 1), availableUntil: at(base, 20), capacityTonnes: 40000, cargoTypes: ["dry bulk"], listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", maximumPositioningDistanceKm: 250, deepseaAvailability: { manualPositioningDays: 1, departureUncertaintyDays: 1, positioningBufferDays: 1, approximateMaxDistanceKm: 250, routeChoice: "SUEZ" } }),
    offer(base, { id: "offer-deepsea-negative", mode: "DEEPSEA", companyId: "company-deepsea", assetId: "asset-blueharbor-ship", location: copy(singapore), availableFrom: at(base, 1), availableUntil: at(base, 20), capacityTonnes: 40000, cargoTypes: ["liquid bulk"], listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", maximumPositioningDistanceKm: 250, deepseaAvailability: { manualPositioningDays: 1, departureUncertaintyDays: 1, positioningBufferDays: 1, approximateMaxDistanceKm: 250, routeChoice: "SUEZ" } }),
    offer(base, { id: "offer-road", mode: "ROAD", companyId: "company-road", assetId: "asset-rijnland-truck", location: copy(utrecht), availableFrom: at(base, 1), availableUntil: at(base, 4), capacityTonnes: 24, cargoTypes: ["general cargo"], listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", maximumPositioningDistanceKm: 100, projection: { equipment: "curtainsider" }, roadAvailability: { currentDeliveryExpectedAt: at(base, 0), expectedAvailabilityAt: at(base, 1), availabilityUncertaintyMinutes: 15, availableVolumeCubicMetres: 90, availableLoadingMetres: 12, availablePalletPositions: 30, equipment: ["curtainsider"], adrClasses: [], trailerType: "curtainsider", preferredDirection: "Eindhoven" } }),
    offer(base, { id: "offer-road-return", mode: "ROAD", companyId: "company-road", assetId: "asset-rijnland-truck", location: copy(eindhoven), availableFrom: at(base, 2), availableUntil: at(base, 5), capacityTonnes: 24, cargoTypes: ["general cargo"], listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", maximumPositioningDistanceKm: 100, projection: { equipment: "curtainsider" }, roadAvailability: { currentDeliveryExpectedAt: at(base, 1), expectedAvailabilityAt: at(base, 2), availabilityUncertaintyMinutes: 15, availableVolumeCubicMetres: 90, availableLoadingMetres: 12, availablePalletPositions: 30, equipment: ["curtainsider"], adrClasses: [], trailerType: "curtainsider", preferredDirection: "Utrecht" } }),
    offer(base, { id: "offer-road-negative", mode: "ROAD", companyId: "company-road", assetId: "asset-rijnland-truck", location: copy(utrecht), availableFrom: at(base, 1), availableUntil: at(base, 4), capacityTonnes: 8, cargoTypes: ["general cargo"], listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", maximumPositioningDistanceKm: 100, roadAvailability: { currentDeliveryExpectedAt: at(base, 0), expectedAvailabilityAt: at(base, 1), availabilityUncertaintyMinutes: 15, availableVolumeCubicMetres: 10, availableLoadingMetres: 2, availablePalletPositions: 3, equipment: ["curtainsider"], adrClasses: [], trailerType: "curtainsider", preferredDirection: "Eindhoven" } }),
    offer(base, { id: "offer-road-draft-negative", mode: "ROAD", companyId: "company-road", assetId: "asset-rijnland-truck", location: copy(utrecht), availableFrom: at(base, 1), availableUntil: at(base, 4), capacityTonnes: 24, cargoTypes: ["general cargo"], listingStatus: "DRAFT", visibility: "OPEN_NETWORK", maximumPositioningDistanceKm: 100, roadAvailability: { currentDeliveryExpectedAt: at(base, 0), expectedAvailabilityAt: at(base, 1), availabilityUncertaintyMinutes: 15, availableVolumeCubicMetres: 90, availableLoadingMetres: 12, availablePalletPositions: 30, equipment: ["curtainsider"], adrClasses: [], trailerType: "curtainsider", preferredDirection: "Eindhoven" } }),
  ];
  const departures: WorldDeparture[] = [
    departure(base, { id: "departure-atlas", companyId: "company-liner", serviceName: "Atlas East-West", origin: copy(shanghai), destination: copy(hamburg), departureAt: at(base, 10), cargoCutoffAt: at(base, 7), capacityTonnes: 4000, listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", linerService: { vesselActive: true, vesselCompanyId: "company-liner", portRotation: [{ locationId: shanghai.id, sequence: 1, estimatedDeparture: at(base, 10) }, { locationId: hamburg.id, sequence: 2, estimatedDeparture: at(base, 10) }], availableCommercialTonnes: 4000, maximumPieceWeightTonnes: 1000, maximumPieceLengthMetres: 20, maximumPieceWidthMetres: 4, maximumPieceHeightMetres: 4, liftingCapacityTonnes: 1000, stowage: "EITHER", acceptedCargoTypes: ["BREAKBULK"] } }),
    departure(base, { id: "departure-liner-negative", companyId: "company-liner", serviceName: "Atlas Northbound", origin: copy(shanghai), destination: copy(antwerp), departureAt: at(base, 10), cargoCutoffAt: at(base, 7), capacityTonnes: 4000, listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", linerService: { vesselActive: true, vesselCompanyId: "company-liner", portRotation: [{ locationId: shanghai.id, sequence: 1, estimatedDeparture: at(base, 10) }, { locationId: antwerp.id, sequence: 2, estimatedDeparture: at(base, 10) }], availableCommercialTonnes: 4000, maximumPieceWeightTonnes: 1000, maximumPieceLengthMetres: 20, maximumPieceWidthMetres: 4, maximumPieceHeightMetres: 4, liftingCapacityTonnes: 1000, stowage: "EITHER", acceptedCargoTypes: ["BREAKBULK"] } }),
    departure(base, { id: "departure-private-negative", companyId: "company-liner", serviceName: "Private sailing", origin: copy(shanghai), destination: copy(hamburg), departureAt: at(base, 10), cargoCutoffAt: at(base, 7), capacityTonnes: 4000, listingStatus: "ACTIVE", visibility: "PRIVATE", linerService: { vesselActive: true, vesselCompanyId: "company-liner", portRotation: [{ locationId: shanghai.id, sequence: 1, estimatedDeparture: at(base, 10) }, { locationId: hamburg.id, sequence: 2, estimatedDeparture: at(base, 10) }], availableCommercialTonnes: 4000, maximumPieceWeightTonnes: 1000, maximumPieceLengthMetres: 20, maximumPieceWidthMetres: 4, maximumPieceHeightMetres: 4, liftingCapacityTonnes: 1000, stowage: "EITHER", acceptedCargoTypes: ["BREAKBULK"] } }),
  ];
  cargos.push(cargo(base, { id: "cargo-road-return", mode: "ROAD", companyId: "company-shipper", name: "Northstar return pallets", cargoType: "general cargo", weightTonnes: 12, origin: copy(eindhoven), destination: copy(utrecht), readyFrom: at(base, 3), readyUntil: at(base, 4), listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", requiredEquipment: ["curtainsider"], roadRequirements: { volumeCubicMetres: 30, loadingMetres: 6, palletPositions: 12, requiredEquipment: ["curtainsider"] } }));
  // Liner fixtures intentionally use BREAKBULK, not a container product.
  const state: WorldDemoState = {
    version: WORLD_STATE_VERSION, createdAt: stamp, updatedAt: stamp, companies: companies(), users: users(), locations,
    cargos, assets, offers, departures, matches: [], messages: [], operationalEvidence: [],
  };
  state.activePersonaId = WORLD_PERSONAS.andy;
  return state;
}

export const getInitialWorldState = createWorldState;
export const startDemo = (personaId: WorldPersonaId = WORLD_PERSONAS.andy, now: string | Date = new Date()) => {
  const state = createWorldState(now);
  if (!state.users.some((user) => user.id === personaId)) throw new RangeError(`Unknown demo persona: ${personaId}`);
  state.activePersonaId = personaId;
  return state;
};

function user(state: WorldState, actorId: string) {
  return state.users.find((item) => item.id === actorId);
}
function companyOf(state: WorldState, actorId: string) {
  return user(state, actorId)?.companyId ?? (state.companies.some((item) => item.id === actorId) ? actorId : undefined);
}
function activeCompany(state: WorldState, companyId: string | undefined) {
  return Boolean(companyId && state.companies.some((company) => company.id === companyId && company.status === "ACTIVE"));
}
function hasActivity(state: WorldState, companyId: string, activity: string) {
  return state.companies.some((company) => company.id === companyId && company.status === "ACTIVE" && company.activities.includes(activity));
}
function carrierActivity(mode: WorldMode) {
  return mode === "INLAND" ? "INLAND_CARRIER" : mode === "DEEPSEA" ? "DEEPSEA_CARRIER" : mode === "ROAD" ? "ROAD_CARRIER" : "LINER";
}
function canCargo(state: WorldState, actorId: string) {
  const actor = user(state, actorId);
  const companyId = companyOf(state, actorId);
  return Boolean(actor && actor.role === "OWNER" && activeCompany(state, companyId) && (hasActivity(state, companyId!, "SHIPPER") || hasActivity(state, companyId!, "CHARTERER")));
}
function canCarrierManage(state: WorldState, actorId: string, mode: WorldMode) {
  const actor = user(state, actorId);
  const companyId = companyOf(state, actorId);
  if (!actor || !companyId || !activeCompany(state, companyId)) return false;
  if (mode === "ROAD") return actor.role === "PLANNER" && companyId === "company-road" && hasActivity(state, companyId, "ROAD_CARRIER");
  return actor.role === "OWNER" && hasActivity(state, companyId, carrierActivity(mode));
}
function canLinerManage(state: WorldState, actorId: string) {
  const actor = user(state, actorId);
  const companyId = companyOf(state, actorId);
  return Boolean(actor && actor.role === "OWNER" && companyId && hasActivity(state, companyId, "LINER"));
}
function cargoFieldsPresent(mode: WorldMode, value: CargoForm) {
  return mode === "INLAND" ? Boolean(value.requiredVesselType)
    : mode === "DEEPSEA" ? Boolean(value.requiredVesselType && value.deepseaRequirement)
      : mode === "ROAD" ? Boolean(value.roadRequirements)
        : Boolean(value.linerRequirements);
}
function assetFieldsPresent(mode: AssetForm["mode"], value: AssetForm) {
  return mode === "DEEPSEA" ? Boolean(value.deepseaProfile) : mode === "ROAD" ? Boolean(value.roadProfile) : true;
}
function offerFieldsPresent(mode: OfferForm["mode"], value: OfferForm) {
  return Boolean(value.maximumPositioningDistanceKm) && (mode === "DEEPSEA" ? Boolean(value.deepseaAvailability) : mode === "ROAD" ? Boolean(value.roadAvailability) : true);
}
function departureFieldsPresent(value: DepartureForm) {
  return Boolean(value.linerService);
}
export function worldPermissions(state: WorldState, actorId: string) {
  const actor = user(state, actorId);
  const roadPlanner = actor?.companyId === "company-road" && actor.role === "PLANNER";
  const roadDriver = actor?.companyId === "company-road" && actor.role === "DRIVER";
  const cargo = canCargo(state, actorId);
  const carrier = Boolean(actor && (canCarrierManage(state, actorId, "INLAND") || canCarrierManage(state, actorId, "DEEPSEA") || canCarrierManage(state, actorId, "ROAD")));
  const liner = canLinerManage(state, actorId);
  return {
    canCreateCargo: cargo,
    canCreateAsset: carrier,
    canCreateOffer: carrier,
    canCreateDeparture: liner,
    canManageDepartures: liner,
    canPublish: Boolean(cargo || carrier || liner),
    canConsent: Boolean(actor && activeCompany(state, actor.companyId) && (actor.role === "OWNER" || roadPlanner)),
    canViewCommercialRoad: Boolean(roadPlanner && activeCompany(state, actor?.companyId)),
    canConfirmRoadOperations: Boolean(roadDriver),
    canFlagRoadOperations: Boolean(roadDriver),
    canMessage: Boolean(actor && (actor.role === "OWNER" || roadPlanner)),
    isRoadDriver: Boolean(roadDriver),
  };
}

function result<T>(value: T, changed = true): WorldResult<T> { return { ok: true, value, changed }; }
function failure<T>(code: string, message: string): WorldResult<T> { return { ok: false, code, message }; }
function touch(state: WorldState, now: Date) { state.updatedAt = now.toISOString(); }
function nextId(kind: string, state: WorldState, base: Date) {
  return id(kind, base, state.cargos.length + state.assets.length + state.offers.length + state.departures.length + state.matches.length + state.messages.length + 1);
}

export function createCargo(state: WorldState, actorId: string, form: CargoForm, now: string | Date = new Date()): WorldResult<WorldCargo> {
  if (!canCargo(state, actorId)) return failure("FORBIDDEN", "Only an active shipper or charterer can create cargo.");
  if (!cargoFieldsPresent(form.mode, form)) return failure("INVALID_MODE_FIELDS", "Cargo is missing required mode-specific requirements.");
  const payload = cargoFormPayload(form);
  const base = date(now);
  const origin = state.locations.find((item) => item.id === payload.originId);
  const destination = state.locations.find((item) => item.id === payload.destinationId);
  if (!origin || !destination) return failure("INVALID_LOCATION", "Cargo locations are unknown.");
  const entry = cargo(base, { id: nextId("cargo", state, base), mode: payload.mode, companyId: companyOf(state, actorId)!, name: payload.name, cargoType: payload.cargoType, weightTonnes: payload.weightTonnes, origin: copy(origin), destination: copy(destination), readyFrom: new Date(payload.readyFrom).toISOString(), readyUntil: new Date(payload.readyUntil).toISOString(), listingStatus: "DRAFT", visibility: payload.visibility, requiredVesselType: payload.requiredVesselType, deepseaRequirement: copy(payload.deepseaRequirement), linerRequirements: copy(payload.linerRequirements), roadRequirements: copy(payload.roadRequirements) });
  state.cargos.push(entry); touch(state, base); return result(entry);
}

export function editCargo(state: WorldState, actorId: string, cargoId: string, form: CargoForm, now: string | Date = new Date()): WorldResult<WorldCargo> {
  const existing = state.cargos.find((item) => item.id === cargoId);
  if (!existing || existing.companyId !== companyOf(state, actorId) || !canCargo(state, actorId) || form.mode !== existing.mode) return failure("FORBIDDEN", "Cargo is not editable by this persona.");
  if (!cargoFieldsPresent(form.mode, form)) return failure("INVALID_MODE_FIELDS", "Cargo is missing required mode-specific requirements.");
  const created = createCargo({ ...state, cargos: [] }, actorId, form, now);
  if (!created.ok) return created;
  const replacement = { ...created.value, id: existing.id, listingStatus: existing.listingStatus, createdAt: existing.createdAt };
  state.cargos[state.cargos.indexOf(existing)] = replacement; touch(state, date(now)); return result(replacement);
}
export function publishCargo(state: WorldState, actorId: string, cargoId: string, now: string | Date = new Date()): WorldResult<WorldCargo> {
  const existing = state.cargos.find((item) => item.id === cargoId);
  if (!existing || existing.companyId !== companyOf(state, actorId) || !canCargo(state, actorId)) return failure("FORBIDDEN", "Cargo is not publishable by this persona.");
  existing.listingStatus = "ACTIVE"; existing.updatedAt = date(now).toISOString(); touch(state, date(now)); return result(existing);
}
export function withdrawCargo(state: WorldState, actorId: string, cargoId: string, now: string | Date = new Date()): WorldResult<WorldCargo> {
  const existing = state.cargos.find((item) => item.id === cargoId);
  if (!existing || existing.companyId !== companyOf(state, actorId) || !canCargo(state, actorId)) return failure("FORBIDDEN", "Cargo is not withdrawable by this persona.");
  if (existing.listingStatus === "WITHDRAWN") return result(existing, false);
  existing.listingStatus = "WITHDRAWN"; existing.updatedAt = date(now).toISOString(); touch(state, date(now)); return result(existing);
}

export function createAsset(state: WorldState, actorId: string, form: AssetForm, now: string | Date = new Date()): WorldResult<WorldAsset> {
  if (!canCarrierManage(state, actorId, form.mode)) return failure("FORBIDDEN", "This carrier cannot create assets for this mode.");
  const payload = assetFormPayload(form); const entry: WorldAsset = { id: nextId("asset", state, date(now)), mode: payload.mode, companyId: companyOf(state, actorId)!, name: payload.name, type: payload.type, active: true, capacityTonnes: payload.capacityTonnes, equipment: payload.equipment, assignedDriverId: payload.assignedDriverId, roadProfile: copy(payload.roadProfile), deepseaProfile: copy(payload.deepseaProfile) };
  if (!assetFieldsPresent(form.mode, form)) return failure("INVALID_MODE_FIELDS", "Asset is missing required mode-specific limits.");
  if (payload.assignedDriverId && payload.mode !== "ROAD") return failure("INVALID_ASSIGNMENT", "Only road assets may be assigned to a driver.");
  if (payload.assignedDriverId && !state.users.some((item) => item.id === payload.assignedDriverId && item.companyId === entry.companyId && item.role === "DRIVER")) return failure("INVALID_ASSIGNMENT", "The assigned driver is not a member of this road company.");
  state.assets.push(entry); touch(state, date(now)); return result(entry);
}
export function editAsset(state: WorldState, actorId: string, assetId: string, form: AssetForm, now: string | Date = new Date()): WorldResult<WorldAsset> {
  const old = state.assets.find((item) => item.id === assetId);
  if (!old || old.companyId !== companyOf(state, actorId) || !canCarrierManage(state, actorId, old.mode) || form.mode !== old.mode) return failure("FORBIDDEN", "Asset is not editable by this persona.");
  const payload = assetFormPayload(form);
  if (!assetFieldsPresent(form.mode, form)) return failure("INVALID_MODE_FIELDS", "Asset is missing required mode-specific limits.");
  if (state.offers.some((item) => item.assetId === old.id && item.capacityTonnes > payload.capacityTonnes)) return failure("CAPACITY_BELOW_OFFER", "Asset capacity cannot be below one of its published offers.");
  if (payload.assignedDriverId && (payload.mode !== "ROAD" || !state.users.some((item) => item.id === payload.assignedDriverId && item.companyId === old.companyId && item.role === "DRIVER"))) return failure("INVALID_ASSIGNMENT", "The assigned driver is not a member of this road company.");
  Object.assign(old, { ...payload, id: old.id, companyId: old.companyId, roadProfile: copy(payload.roadProfile), deepseaProfile: copy(payload.deepseaProfile) }); touch(state, date(now)); return result(old);
}
export function publishAsset(state: WorldState, actorId: string, assetId: string, now: string | Date = new Date()): WorldResult<WorldAsset> {
  const old = state.assets.find((item) => item.id === assetId);
  if (!old || old.companyId !== companyOf(state, actorId) || !canCarrierManage(state, actorId, old.mode)) return failure("FORBIDDEN", "Asset is not publishable by this persona.");
  old.active = true; touch(state, date(now)); return result(old);
}
export function withdrawAsset(state: WorldState, actorId: string, assetId: string, now: string | Date = new Date()): WorldResult<WorldAsset> {
  const old = state.assets.find((item) => item.id === assetId);
  if (!old || old.companyId !== companyOf(state, actorId) || !canCarrierManage(state, actorId, old.mode)) return failure("FORBIDDEN", "Asset is not withdrawable by this persona.");
  if (!old.active) return result(old, false);
  old.active = false; touch(state, date(now)); return result(old);
}
export function createOffer(state: WorldState, actorId: string, form: OfferForm, now: string | Date = new Date()): WorldResult<WorldOffer> {
  if (!canCarrierManage(state, actorId, form.mode)) return failure("FORBIDDEN", "This carrier cannot create offers for this mode.");
  if (!offerFieldsPresent(form.mode, form)) return failure("INVALID_MODE_FIELDS", "Offer is missing required mode-specific availability fields.");
  const payload = offerFormPayload(form); const asset = state.assets.find((item) => item.id === payload.assetId && item.companyId === companyOf(state, actorId));
  const place = state.locations.find((item) => item.id === payload.locationId);
  if (!asset || !place) return failure("INVALID_REFERENCE", "Offer asset or location is unknown.");
  if (asset.mode !== payload.mode) return failure("MODE_MISMATCH", "Offer mode must match its asset mode.");
  if (payload.capacityTonnes > asset.capacityTonnes) return failure("CAPACITY_EXCEEDS_ASSET", "Offer capacity cannot exceed asset capacity.");
  const base = date(now); const entry = offer(base, { id: nextId("offer", state, base), mode: payload.mode, companyId: asset.companyId, assetId: asset.id, location: copy(place), availableFrom: new Date(payload.availableFrom).toISOString(), availableUntil: new Date(payload.availableUntil).toISOString(), capacityTonnes: payload.capacityTonnes, cargoTypes: payload.cargoTypes, listingStatus: "DRAFT", visibility: payload.visibility, direction: payload.direction, maximumPositioningDistanceKm: payload.maximumPositioningDistanceKm, roadAvailability: copy(payload.roadAvailability), deepseaAvailability: copy(payload.deepseaAvailability) });
  state.offers.push(entry); touch(state, base); return result(entry);
}
export function editOffer(state: WorldState, actorId: string, offerId: string, form: OfferForm, now: string | Date = new Date()): WorldResult<WorldOffer> {
  const old = state.offers.find((item) => item.id === offerId);
  if (!old || old.companyId !== companyOf(state, actorId) || !canCarrierManage(state, actorId, old.mode) || form.mode !== old.mode) return failure("FORBIDDEN", "Offer is not editable by this persona.");
  if (!offerFieldsPresent(form.mode, form)) return failure("INVALID_MODE_FIELDS", "Offer is missing required mode-specific availability fields.");
  const payload = offerFormPayload(form); const asset = state.assets.find((item) => item.id === payload.assetId && item.companyId === old.companyId); const place = state.locations.find((item) => item.id === payload.locationId);
  if (!asset || !place) return failure("INVALID_REFERENCE", "Offer asset or location is unknown.");
  if (asset.mode !== payload.mode) return failure("MODE_MISMATCH", "Offer mode must match its asset mode.");
  if (payload.capacityTonnes > asset.capacityTonnes) return failure("CAPACITY_EXCEEDS_ASSET", "Offer capacity cannot exceed asset capacity.");
  Object.assign(old, { ...payload, assetId: asset.id, location: copy(place), availableFrom: new Date(payload.availableFrom).toISOString(), availableUntil: new Date(payload.availableUntil).toISOString(), maximumPositioningDistanceKm: payload.maximumPositioningDistanceKm, roadAvailability: copy(payload.roadAvailability), deepseaAvailability: copy(payload.deepseaAvailability), updatedAt: date(now).toISOString() }); touch(state, date(now)); return result(old);
}
export function publishOffer(state: WorldState, actorId: string, offerId: string, now: string | Date = new Date()): WorldResult<WorldOffer> {
  const old = state.offers.find((item) => item.id === offerId);
  if (!old || old.companyId !== companyOf(state, actorId) || !canCarrierManage(state, actorId, old.mode)) return failure("FORBIDDEN", "Offer is not publishable by this persona.");
  old.listingStatus = "ACTIVE"; old.updatedAt = date(now).toISOString(); touch(state, date(now)); return result(old);
}
export function withdrawOffer(state: WorldState, actorId: string, offerId: string, now: string | Date = new Date()): WorldResult<WorldOffer> {
  const old = state.offers.find((item) => item.id === offerId);
  if (!old || old.companyId !== companyOf(state, actorId) || !canCarrierManage(state, actorId, old.mode)) return failure("FORBIDDEN", "Offer is not withdrawable by this persona.");
  if (old.listingStatus === "WITHDRAWN") return result(old, false);
  old.listingStatus = "WITHDRAWN"; old.updatedAt = date(now).toISOString(); touch(state, date(now)); return result(old);
}
export function createDeparture(state: WorldState, actorId: string, form: DepartureForm, now: string | Date = new Date()): WorldResult<WorldDeparture> {
  if (!canLinerManage(state, actorId)) return failure("FORBIDDEN", "Only the active liner can create departures.");
  if (!departureFieldsPresent(form)) return failure("INVALID_MODE_FIELDS", "Departure is missing published liner service details.");
  const payload = departureFormPayload(form); const origin = state.locations.find((item) => item.id === payload.originId); const destination = state.locations.find((item) => item.id === payload.destinationId);
  if (!origin || !destination) return failure("INVALID_LOCATION", "Departure locations are unknown.");
  const base = date(now); const entry = departure(base, { id: nextId("departure", state, base), companyId: companyOf(state, actorId)!, serviceName: payload.serviceName, origin: copy(origin), destination: copy(destination), departureAt: new Date(payload.departureAt).toISOString(), cargoCutoffAt: new Date(payload.cargoCutoffAt).toISOString(), capacityTonnes: payload.capacityTonnes, listingStatus: "DRAFT", visibility: payload.visibility, linerService: copy(payload.linerService) });
  state.departures.push(entry); touch(state, base); return result(entry);
}
export function editDeparture(state: WorldState, actorId: string, departureId: string, form: DepartureForm, now: string | Date = new Date()): WorldResult<WorldDeparture> {
  const old = state.departures.find((item) => item.id === departureId);
  if (!old || old.companyId !== companyOf(state, actorId) || !canLinerManage(state, actorId)) return failure("FORBIDDEN", "Departure is not editable by this persona.");
  if (!departureFieldsPresent(form)) return failure("INVALID_MODE_FIELDS", "Departure is missing published liner service details.");
  const payload = departureFormPayload(form); const origin = state.locations.find((item) => item.id === payload.originId); const destination = state.locations.find((item) => item.id === payload.destinationId);
  if (!origin || !destination) return failure("INVALID_LOCATION", "Departure locations are unknown.");
  Object.assign(old, { ...payload, origin: copy(origin), destination: copy(destination), departureAt: new Date(payload.departureAt).toISOString(), cargoCutoffAt: new Date(payload.cargoCutoffAt).toISOString(), linerService: copy(payload.linerService), updatedAt: date(now).toISOString() }); touch(state, date(now)); return result(old);
}
export function publishDeparture(state: WorldState, actorId: string, departureId: string, now: string | Date = new Date()): WorldResult<WorldDeparture> {
  const old = state.departures.find((item) => item.id === departureId);
  if (!old || old.companyId !== companyOf(state, actorId) || !canLinerManage(state, actorId)) return failure("FORBIDDEN", "Departure is not publishable by this persona.");
  old.listingStatus = "ACTIVE"; old.updatedAt = date(now).toISOString(); touch(state, date(now)); return result(old);
}
export function withdrawDeparture(state: WorldState, actorId: string, departureId: string, now: string | Date = new Date()): WorldResult<WorldDeparture> {
  const old = state.departures.find((item) => item.id === departureId);
  if (!old || old.companyId !== companyOf(state, actorId) || !canLinerManage(state, actorId)) return failure("FORBIDDEN", "Departure is not withdrawable by this persona.");
  if (old.listingStatus === "WITHDRAWN") return result(old, false);
  old.listingStatus = "WITHDRAWN"; old.updatedAt = date(now).toISOString(); touch(state, date(now)); return result(old);
}
export const cancelCargo = withdrawCargo;
export const cancelAsset = withdrawAsset;
export const cancelOffer = withdrawOffer;
export const cancelDeparture = withdrawDeparture;
export const withdrawCapacityOffer = withdrawOffer;

function listingProjection(state: WorldState, kind: "CARGO" | "OFFER" | "DEPARTURE", value: WorldCargo | WorldOffer | WorldDeparture, anonymous: boolean): WorldProjection {
  if (kind === "CARGO") {
    const item = value as WorldCargo;
    return { id: item.id, mode: item.mode, kind, ownerCompanyId: anonymous ? undefined : item.companyId, companyName: anonymous ? undefined : state.companies.find((company) => company.id === item.companyId)?.name, origin: item.origin.region, destination: item.destination.region, timeBand: `${item.readyFrom.slice(0, 10)} → ${item.readyUntil.slice(0, 10)}`, capacityBand: anonymous ? `${Math.round(item.weightTonnes / 500) * 500}+ t` : `${item.weightTonnes} t`, cargoTypeBand: anonymous ? "catalogue cargo type band" : item.cargoType, detailsVisible: !anonymous, anonymous };
  }
  if (kind === "OFFER") {
    const item = value as WorldOffer;
    return { id: item.id, mode: item.mode, kind, ownerCompanyId: anonymous ? undefined : item.companyId, companyName: anonymous ? undefined : state.companies.find((company) => company.id === item.companyId)?.name, origin: item.location.region, destination: anonymous ? "catalogue direction band" : item.direction ?? "regional", timeBand: `${item.availableFrom.slice(0, 10)} → ${item.availableUntil.slice(0, 10)}`, capacityBand: anonymous ? "capacity band" : `${item.capacityTonnes} t`, cargoTypeBand: anonymous ? "cargo compatibility band" : item.cargoTypes.join(", "), detailsVisible: !anonymous, anonymous };
  }
  const item = value as WorldDeparture;
  return { id: item.id, mode: "LINER", kind, ownerCompanyId: anonymous ? undefined : item.companyId, companyName: anonymous ? undefined : state.companies.find((company) => company.id === item.companyId)?.name, origin: item.origin.region, destination: item.destination.region, timeBand: anonymous ? item.departureAt.slice(0, 10) : `${item.cargoCutoffAt.slice(0, 10)} cutoff · ${item.departureAt.slice(0, 10)} departure`, capacityBand: anonymous ? "capacity band" : `${item.capacityTonnes} t`, detailsVisible: !anonymous, anonymous };
}

function discoverable(state: WorldState, kind: "CARGO" | "OFFER" | "DEPARTURE", value: WorldCargo | WorldOffer | WorldDeparture, current: Date) {
  const companyId = "companyId" in value ? value.companyId : undefined;
  if (!activeCompany(state, companyId)) return false;
  if (kind === "CARGO") {
    const item = value as WorldCargo;
    return item.listingStatus === "ACTIVE" && item.visibility === "OPEN_NETWORK" && item.origin.active && item.destination.active && date(item.readyUntil) > current;
  }
  if (kind === "OFFER") {
    const item = value as WorldOffer;
    const asset = state.assets.find((candidate) => candidate.id === item.assetId);
    return item.listingStatus === "ACTIVE" && item.visibility === "OPEN_NETWORK" && item.location.active && date(item.availableUntil) > current && Boolean(asset?.active && asset.companyId === item.companyId && activeCompany(state, asset.companyId));
  }
  const item = value as WorldDeparture;
  return item.listingStatus === "ACTIVE" && item.visibility === "OPEN_NETWORK" && item.origin.active && item.destination.active && date(item.cargoCutoffAt) > current && date(item.departureAt) > current;
}

export function discoverWorld(state: WorldState, now: string | Date = new Date()): WorldProjection[] {
  const current = date(now); const output: WorldProjection[] = [];
  for (const item of state.cargos) if (discoverable(state, "CARGO", item, current)) output.push(listingProjection(state, "CARGO", item, true));
  for (const item of state.offers) if (discoverable(state, "OFFER", item, current)) output.push(listingProjection(state, "OFFER", item, true));
  for (const item of state.departures) if (discoverable(state, "DEPARTURE", item, current)) output.push(listingProjection(state, "DEPARTURE", item, true));
  return output;
}

export function projectWorldListing(
  state: WorldState,
  kind: "CARGO" | "OFFER" | "DEPARTURE",
  listingId: string,
  actorId?: string,
  now: string | Date = new Date(),
): WorldProjection | undefined {
  const actor = actorId ? user(state, actorId) : undefined;
  if (actor?.role === "DRIVER") return undefined;
  const value = kind === "CARGO" ? state.cargos.find((item) => item.id === listingId)
    : kind === "OFFER" ? state.offers.find((item) => item.id === listingId)
      : state.departures.find((item) => item.id === listingId);
  if (!value) return undefined;
  const current = date(now);
  const active = discoverable(state, kind, value, current);
  const ownerCompanyId = "companyId" in value ? value.companyId : undefined;
  const connected = actor && state.matches.some((match) => match.status === "CONNECTED" && (match.leftCompanyId === actor.companyId || match.rightCompanyId === actor.companyId) && [match.cargoId, match.offerId, match.departureId].includes(listingId));
  if (!actor) return active ? listingProjection(state, kind, value, true) : undefined;
  if (actor.companyId !== ownerCompanyId && !connected) return active ? listingProjection(state, kind, value, true) : undefined;
  return listingProjection(state, kind, value, false);
}

export function worldProjections(state: WorldState, actorId?: string, now: string | Date = new Date()): WorldProjection[] {
  const actor = actorId ? user(state, actorId) : undefined;
  if (!actor) return discoverWorld(state, now);
  if (actor.role === "DRIVER") return [];
  const companyId = actor.companyId; const connected = new Set(state.matches.filter((match) => match.status === "CONNECTED" && (match.leftCompanyId === companyId || match.rightCompanyId === companyId)).flatMap((match) => [match.cargoId, match.offerId, match.departureId].filter(Boolean) as string[]));
  const output: WorldProjection[] = [];
  for (const item of state.cargos) if (item.companyId === companyId || connected.has(item.id)) output.push(listingProjection(state, "CARGO", item, false));
  for (const item of state.offers) if (item.companyId === companyId || connected.has(item.id)) output.push(listingProjection(state, "OFFER", item, false));
  for (const item of state.departures) if (item.companyId === companyId || connected.has(item.id)) output.push(listingProjection(state, "DEPARTURE", item, false));
  return output;
}
export const discover = discoverWorld;
export const getWorldProjections = worldProjections;

function matchRevision(state: WorldState, match: WorldMatch) {
  const cargoItem = state.cargos.find((item) => item.id === match.cargoId);
  const counterpart = match.offerId
    ? state.offers.find((item) => item.id === match.offerId)
    : state.departures.find((item) => item.id === match.departureId);
  return JSON.stringify({ cargo: cargoItem, counterpart });
}

export function refreshWorldMatches(state: WorldState, now: string | Date = new Date()) {
  const current = date(now);
  for (const cargoItem of state.cargos) for (const found of findWorldMatches(state, cargoItem, current)) {
    const existing = state.matches.find((match) => match.cargoId === cargoItem.id && (match.offerId === (found.kind === "OFFER" ? found.id : undefined)) && (match.departureId === (found.kind === "DEPARTURE" ? found.id : undefined)));
    if (existing) {
      const runtime = existing as RuntimeMatch;
      const revision = matchRevision(state, existing);
      if (runtime.revision && runtime.revision !== revision && existing.status === "INTEREST_SENT") {
        existing.status = "STALE";
        existing.leftConsent = null;
        existing.rightConsent = null;
        existing.reason = "listing_changed";
      }
      if (existing.status === "NEW") {
        existing.score = found.evaluation.score;
        runtime.revision = revision;
        existing.updatedAt = current.toISOString();
      }
      continue;
    }
    const created: RuntimeMatch = { id: `${cargoItem.id}:${found.id}`, mode: cargoItem.mode, cargoId: cargoItem.id, offerId: found.kind === "OFFER" ? found.id : undefined, departureId: found.kind === "DEPARTURE" ? found.id : undefined, leftCompanyId: cargoItem.companyId, rightCompanyId: found.companyId, status: "NEW", leftConsent: null, rightConsent: null, score: found.evaluation.score, createdAt: current.toISOString(), updatedAt: current.toISOString(), calculationVersion: found.evaluation.calculationVersion, revision: "" };
    created.revision = matchRevision(state, created);
    state.matches.push(created);
  }
  // Do not leave an old eligible-looking card in the UI after an expiry,
  // withdrawal, or catalogue change. CONNECTED matches remain historical.
  for (const existing of state.matches) {
    if (existing.status !== "NEW" && existing.status !== "INTEREST_SENT") continue;
    if (!freshMatch(state, existing, current)) {
      existing.status = "STALE";
      existing.leftConsent = null;
      existing.rightConsent = null;
      existing.reason = "listing_changed";
      existing.updatedAt = current.toISOString();
    }
  }
  touch(state, current); return state.matches;
}
export const buildWorldMatches = refreshWorldMatches;

function freshMatch(state: WorldState, match: WorldMatch, now: Date) {
  const cargoItem = state.cargos.find((item) => item.id === match.cargoId);
  if (!cargoItem) return false;
  if (match.offerId) {
    const item = state.offers.find((offer) => offer.id === match.offerId);
    return Boolean(item && evaluateWorldOffer(cargoItem, item, state, now).eligible);
  }
  const item = state.departures.find((departure) => departure.id === match.departureId);
  return Boolean(item && evaluateWorldDeparture(cargoItem, item, state, now).eligible);
}

export type WorldConsentAction = "INTEREST" | "ACCEPT" | "REJECT" | "WITHDRAW";
export function applyWorldConsent(state: WorldState, actorId: string, matchId: string, action: WorldConsentAction, now: string | Date = new Date()): WorldResult<WorldMatch> {
  const actor = user(state, actorId); const match = state.matches.find((item) => item.id === matchId); const current = date(now);
  if (!actor || !match || !worldPermissions(state, actorId).canConsent) return failure("FORBIDDEN", "This persona cannot give commercial consent.");
  const companyId = actor.companyId;
  const side = match.leftCompanyId === companyId ? "left" : match.rightCompanyId === companyId ? "right" : null;
  if (!side) return failure("FORBIDDEN", "Only match parties can give consent.");
  if (action === "INTEREST" && match.status === "NEW" && !freshMatch(state, match, current)) {
    match.status = "STALE"; match.updatedAt = current.toISOString(); return failure("STALE_OFFER", "The offer is no longer eligible.");
  }
  const currentConsent = side === "left" ? match.leftConsent : match.rightConsent;
  if (action === "INTEREST") {
    if (currentConsent === "PENDING" || currentConsent === "ACCEPTED") return result(match, false);
    if (match.status === "STALE") {
      if (!freshMatch(state, match, current)) return failure("STALE_OFFER", "The offer is no longer eligible.");
      match.leftConsent = null;
      match.rightConsent = null;
    } else if (match.status !== "NEW") return failure("INVALID_CONSENT", "Interest can only start a new match.");
    if (side === "left") match.leftConsent = "PENDING"; else match.rightConsent = "PENDING";
    match.status = "INTEREST_SENT";
    (match as RuntimeMatch).revision = matchRevision(state, match);
  } else if (action === "ACCEPT") {
    if (match.status === "CONNECTED" || (currentConsent === "ACCEPTED" && match.leftConsent === "ACCEPTED" && match.rightConsent === "ACCEPTED")) return result(match, false);
    if (match.status !== "INTEREST_SENT" || currentConsent !== null) return failure("INVALID_ACCEPT", "The other party must send interest first.");
    if ((match as RuntimeMatch).revision !== matchRevision(state, match) || !freshMatch(state, match, current)) {
      match.status = "STALE";
      match.leftConsent = null;
      match.rightConsent = null;
      match.updatedAt = current.toISOString();
      return failure("STALE_OFFER", "The offer changed or is no longer eligible; renewed interest is required.");
    }
    if (side === "left") {
      match.leftConsent = "ACCEPTED";
      if (match.rightConsent === "PENDING") match.rightConsent = "ACCEPTED";
    } else {
      match.rightConsent = "ACCEPTED";
      if (match.leftConsent === "PENDING") match.leftConsent = "ACCEPTED";
    }
    if (match.leftConsent === "ACCEPTED" && match.rightConsent === "ACCEPTED") match.status = "CONNECTED";
  } else if (action === "REJECT") {
    if (match.status === "REJECTED") return result(match, false);
    if (match.status !== "INTEREST_SENT" || currentConsent !== null) return failure("INVALID_REJECT", "Only the party without pending interest can reject.");
    if (side === "left") match.leftConsent = "REJECTED"; else match.rightConsent = "REJECTED";
    match.status = "REJECTED";
  } else {
    if (match.status === "WITHDRAWN" || currentConsent === "WITHDRAWN") return result(match, false);
    if (currentConsent !== "PENDING") return failure("INVALID_WITHDRAW", "Only pending interest can be withdrawn.");
    if (side === "left") match.leftConsent = "WITHDRAWN"; else match.rightConsent = "WITHDRAWN";
    match.status = "WITHDRAWN";
  }
  match.updatedAt = current.toISOString(); touch(state, current); return result(match);
}
export const consent = applyWorldConsent;

export function sendWorldMessage(state: WorldState, actorId: string, matchId: string, body: string, now: string | Date = new Date()): WorldResult<WorldMessageWithUser> {
  const actor = user(state, actorId); const match = state.matches.find((item) => item.id === matchId);
  if (!actor || !match || match.status !== "CONNECTED" || (match.leftCompanyId !== actor.companyId && match.rightCompanyId !== actor.companyId) || !worldPermissions(state, actorId).canMessage) return failure("FORBIDDEN", "Only connected commercial parties can message.");
  if (!body.trim()) return failure("INVALID_MESSAGE", "Message body is required.");
  const message: WorldMessageWithUser = { id: nextId("message", state, date(now)), matchId, senderCompanyId: actor.companyId, senderUserId: actor.id, body: body.trim(), createdAt: date(now).toISOString() };
  state.messages.push(message); touch(state, date(now)); return result(message);
}
export function listWorldMessages(state: WorldState, actorId: string, matchId: string) {
  const actor = user(state, actorId); const match = state.matches.find((item) => item.id === matchId);
  if (!actor || !match || match.status !== "CONNECTED" || (match.leftCompanyId !== actor.companyId && match.rightCompanyId !== actor.companyId) || !worldPermissions(state, actorId).canMessage) return [];
  return state.messages.filter((message) => message.matchId === matchId) as WorldMessageWithUser[];
}

export function confirmRoadAvailability(state: WorldState, actorId: string, offerId: string, note = "", now: string | Date = new Date()): WorldResult<WorldOperationalEvidence> {
  const actor = user(state, actorId); const offerItem = state.offers.find((item) => item.id === offerId && item.mode === "ROAD"); const asset = offerItem && state.assets.find((item) => item.id === offerItem.assetId);
  if (!actor || actor.role !== "DRIVER" || actor.companyId !== "company-road" || !activeCompany(state, actor.companyId) || !offerItem || asset?.assignedDriverId !== actor.id) return failure("FORBIDDEN", "Only the assigned road driver can confirm operations.");
  const existing = state.operationalEvidence.find((item) => item.offerId === offerId && item.driverUserId === actor.id);
  if (existing) return result(existing, false);
  const evidence: WorldOperationalEvidence = { id: nextId("evidence", state, date(now)), offerId, driverUserId: actor.id, status: "CONFIRMED", note: note.trim() || undefined, createdAt: date(now).toISOString() };
  state.operationalEvidence.push(evidence); touch(state, date(now)); return result(evidence);
}
export function flagRoadAvailability(state: WorldState, actorId: string, offerId: string, note: string, now: string | Date = new Date()): WorldResult<WorldOperationalEvidence> {
  const confirmed = confirmRoadAvailability(state, actorId, offerId, note, now);
  if (!confirmed.ok) return confirmed;
  confirmed.value.status = "FLAGGED"; return confirmed;
}

/** Friendly alias used by the demo shell. */
export const createDemoWorld = createWorldState;