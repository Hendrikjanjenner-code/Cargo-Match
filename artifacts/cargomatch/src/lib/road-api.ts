/**
 * Road pilot API boundary.
 *
 * Road deliberately does not use the vessel/capacity UI contracts: a road
 * availability claim is a forward-looking, manually confirmed claim tied to
 * an asset and its current delivery.  Keeping the boundary here lets the
 * pilot consume the provider-independent road contract without inventing
 * demo records when the API has no data.
 */

export type RoadAssetType =
  | "TRUCK"
  | "TRACTOR"
  | "TRAILER"
  | "TRUCK_TRAILER_COMBINATION";
export const roadAssetTypes: RoadAssetType[] = ["TRUCK", "TRACTOR", "TRAILER", "TRUCK_TRAILER_COMBINATION"];
export type RoadAvailabilitySource = "MANUAL" | "DRIVER_INPUT" | "TMS" | "TELEMATICS";
export type ListingStatus = "DRAFT" | "ACTIVE" | "WITHDRAWN" | "EXPIRED" | "CLOSED";
export type MatchStatus = "NEW" | "INTEREST_SENT" | "CONNECTED" | "DECLINED" | "EXPIRED";

export interface RoadAsset {
  id: string;
  assetType: RoadAssetType;
  assetName: string;
  registrationReference?: string | null;
  payloadTonnes: number;
  volumeCubicMetres: number;
  loadingMetres: number;
  palletPositions: number;
  trailerType?: string | null;
  equipment: string[];
  temperatureMinCelsius?: number | null;
  temperatureMaxCelsius?: number | null;
  adrClasses: string[];
  notes?: string | null;
  active: boolean;
  assignedDriverId?: string | null;
  assignedDriverName?: string | null;
}

export interface RoadCapacity {
  id: string;
  roadAssetId: string;
  roadAsset?: RoadAsset;
  currentDeliveryLocationId: string;
  currentDeliveryLocationName?: string;
  currentDeliveryExpectedAt: string;
  expectedAvailabilityLocationId: string;
  expectedAvailabilityLocationName?: string;
  expectedAvailabilityAt: string;
  availableFrom?: string;
  availableUntil?: string;
  availabilityUncertaintyMinutes: number;
  availabilitySource: RoadAvailabilitySource;
  availableCapacityTonnes: number;
  availableVolumeCubicMetres: number;
  availableLoadingMetres: number;
  availablePalletPositions: number;
  trailerType?: string | null;
  equipment: string[];
  temperatureMinCelsius?: number | null;
  temperatureMaxCelsius?: number | null;
  adrClasses: string[];
  preferredDirection?: string | null;
  listingStatus: ListingStatus;
  notes?: string | null;
  visibility?: string;
  availabilityType?: string;
  maximumPositioningDistanceKm?: number;
  cargoCompatibility?: string[];
  assignmentId?: string | null;
  assignmentStatus?: "ASSIGNED" | "CONFIRMED" | "FLAGGED" | null;
  assignedDriverId?: string | null;
  assignments?: RoadAssignment[];
}
export interface RoadAssignment {
  id: string;
  capacityOfferId: string;
  driverUserId: string;
  status: "ASSIGNED" | "CONFIRMED" | "FLAGGED" | string;
  operationalNote?: string | null;
  flaggedReason?: string | null;
  flaggedMatchId?: string | null;
  confirmedAt?: string | null;
}

export interface RoadCargo {
  id: string;
  cargoName: string;
  cargoType: string;
  weightTonnes: number;
  loadingLocationId: string;
  loadingLocationName?: string;
  destinationLocationId: string;
  destinationLocationName?: string;
  loadingFrom: string;
  loadingUntil: string;
  listingStatus: ListingStatus;
  volumeCubicMetres?: number | null;
  loadingMetres?: number | null;
  palletPositions?: number | null;
  requiredTrailerType?: string | null;
  requiredEquipment: string[];
  temperatureMinCelsius?: number | null;
  temperatureMaxCelsius?: number | null;
  adrClasses: string[];
  direction?: string | null;
  notes?: string | null;
}

export interface RoadOpportunityProjection {
  cargoTypeBand: string;
  originRegion: string;
  destinationRegion: string;
  loadingDateBand: string;
  loadingTimeWindowBand: string;
  weightBand: string;
  equipmentBand: string;
  temperatureBand: string;
  adrBand: string;
  dimensionalRequirementsBand: string;
  freeAreaBand: string;
  freeTimeBand: string;
  freeCapacityBand: string;
  capacityEquipmentBand: string;
  capacityTemperatureBand: string;
  capacityAdrBand: string;
}

export interface RoadOpportunity extends RoadOpportunityProjection {
  id: string;
  status?: string;
  flagStatus?: string | null;
}

export interface RoadMember {
  userId: string;
  name?: string | null;
  email?: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER" | string;
  active: boolean;
}
export interface RoadDriver {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

export interface RoadMatch {
  id: string;
  status: MatchStatus;
  createdAt: string;
  totalScore?: number;
  explanation?: string;
  cargoListingId: string;
  capacityOfferId: string;
  evaluationInputs?: Record<string, string>;
  projection?: RoadOpportunityProjection;
  initiatedByMe?: boolean;
  canAccept?: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.message || body?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

async function allPages<T>(path: string, signal?: AbortSignal): Promise<Page<T>> {
  const items: T[] = [];
  let pageNumber = 1;
  let total = 0;
  do {
    const separator = path.includes("?") ? "&" : "?";
    const response = page(await request<Page<T>>(`${path}${separator}page=${pageNumber}&pageSize=100`, { signal }));
    items.push(...response.items);
    total = response.total;
    if (!response.items.length) break;
    pageNumber += 1;
  } while (items.length < total);
  return { items, total, page: 1, pageSize: 100 };
}

function page<T>(value: Page<T> | T[]): Page<T> {
  if (Array.isArray(value)) return { items: value, total: value.length };
  return value;
}

export const roadApi = {
  listAssets: (signal?: AbortSignal) => allPages<RoadAsset>("/api/road/assets", signal),
  createAsset: (data: unknown) => request<RoadAsset>("/api/road/assets", { method: "POST", body: JSON.stringify(data) }),
  updateAsset: (id: string, data: unknown) => request<RoadAsset>(`/api/road/assets/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteAsset: (id: string) => request<RoadAsset>(`/api/road/assets/${id}/deactivate`, { method: "POST" }),
  listDrivers: (signal?: AbortSignal) => request<{ items: RoadDriver[] }>("/api/road/drivers", { signal }),
  listLocations: (signal?: AbortSignal) => allPages<{ id: string; name: string; country?: string }>("/api/locations", signal),
  listCapacity: async (signal?: AbortSignal) => {
    const response = await allPages<any>("/api/road/capacity", signal);
    return { ...response, items: response.items.map(normalizeCapacity) };
  },
  createCapacity: (data: unknown) => request<any>("/api/road/capacity", { method: "POST", body: JSON.stringify(data) }).then(normalizeCapacity),
  updateCapacity: (id: string, data: unknown) => request<any>(`/api/road/capacity/${id}`, { method: "PATCH", body: JSON.stringify(data) }).then(normalizeCapacity),
  assignDriver: (capacityId: string, driverUserId: string, operationalNote?: string) =>
    request<{ id: string }>(`/api/road/capacity/${capacityId}/assignments`, { method: "POST", body: JSON.stringify({ driverUserId, operationalNote }) }),
  changeCapacityStatus: (id: string, action: "publish" | "withdraw" | "close") =>
    action === "publish"
      ? request<any>(`/api/road/capacity/${id}`, { method: "PATCH", body: JSON.stringify({ listingStatus: "ACTIVE" }) }).then(normalizeCapacity)
      : request<any>(`/api/road/capacity/${id}/${action}`, { method: "POST" }).then(normalizeCapacity),
  listCargo: async (signal?: AbortSignal) => {
    const response = await allPages<any>("/api/road/cargo", signal);
    return { ...response, items: response.items.map(normalizeCargo) };
  },
  createCargo: (data: unknown) => request<any>("/api/road/cargo", { method: "POST", body: JSON.stringify(data) }).then(normalizeCargo),
  updateCargo: (id: string, data: unknown) => request<any>(`/api/road/cargo/${id}`, { method: "PATCH", body: JSON.stringify(data) }).then(normalizeCargo),
  changeCargoStatus: (id: string, action: "publish" | "withdraw" | "close") =>
    action === "publish"
      ? request<RoadCargo>(`/api/road/cargo/${id}`, { method: "PATCH", body: JSON.stringify({ listingStatus: "ACTIVE" }) })
      : request<RoadCargo>(`/api/road/cargo/${id}/${action}`, { method: "POST" }),
  listOpportunities: async (signal?: AbortSignal) => {
    const response = await allPages<any>("/api/road/matches", signal);
    return { ...response, items: response.items.map(normalizeMatch) };
  },
  listMatches: async (signal?: AbortSignal, planner = true) => {
    const roadResponse = await allPages<any>("/api/road/matches", signal);
    if (!planner) return { ...roadResponse, items: roadResponse.items.map(normalizeMatch) };
    const sharedResponse = await allPages<any>("/api/matches?transportMode=ROAD", signal);
    const roadById = new Map(roadResponse.items.map((item) => [item.id, item]));
    return {
      ...sharedResponse,
      items: sharedResponse.items.map((item) => normalizeMatch({
        ...item,
        projection: roadById.get(item.id)?.projection,
      })),
    };
  },
  getMatch: async (id: string, planner = true) => {
    const road = await request<any>(`/api/road/matches/${id}`);
    if (!planner) return normalizeMatch(road);
    const shared = await request<any>(`/api/matches/${id}`);
    return normalizeMatch({ ...shared, projection: road.projection });
  },
  actOnMatch: (id: string, action: "INTEREST" | "ACCEPT" | "DECLINE") =>
    request<RoadMatch>(`/api/matches/${id}/actions`, { method: "POST", body: JSON.stringify({ action }) }),
  confirmAssignment: (id: string, note?: string) =>
    request<void>(`/api/road/assignments/${id}/confirm`, { method: "POST", body: JSON.stringify({ note }) }),
  flagAssignment: (id: string, matchId: string, reason?: string) =>
    request<void>(`/api/road/assignments/${id}/flag`, { method: "POST", body: JSON.stringify({ matchId, reason }) }),
};

function normalizeCapacity(value: any): RoadCapacity {
  const extension = value.roadExtension || {};
  return {
    ...value,
    roadAssetId: extension.roadAssetId,
    currentDeliveryLocationId: extension.currentDeliveryLocationId,
    currentDeliveryExpectedAt: extension.currentDeliveryExpectedAt,
    expectedAvailabilityLocationId: extension.expectedAvailabilityLocationId,
    expectedAvailabilityAt: extension.expectedAvailabilityAt,
    availableFrom: value.availableFrom,
    availableUntil: value.availableUntil,
    availabilityUncertaintyMinutes: extension.availabilityUncertaintyMinutes ?? 0,
    availabilitySource: extension.availabilitySource || "MANUAL",
    availableVolumeCubicMetres: extension.availableVolumeCubicMetres,
    availableLoadingMetres: extension.availableLoadingMetres,
    availablePalletPositions: extension.availablePalletPositions,
    trailerType: extension.trailerType,
    equipment: extension.equipment || [],
    temperatureMinCelsius: extension.temperatureMinCelsius,
    temperatureMaxCelsius: extension.temperatureMaxCelsius,
    adrClasses: extension.adrClasses || [],
    preferredDirection: extension.preferredDirection ?? value.preferredDirection,
    notes: extension.notes ?? value.notes,
    assignments: value.assignments || extension.assignments || [],
  };
}

export function roadProjectionViewModel(value: any): RoadOpportunityProjection | undefined {
  if (value.projection) return value.projection;
  if (!value.cargo || !value.capacity) return undefined;
  return {
    cargoTypeBand: value.cargo.cargoTypeBand,
    originRegion: value.cargo.loadingRegion,
    destinationRegion: value.cargo.destinationRegion,
    loadingDateBand: value.cargo.timeBand,
    loadingTimeWindowBand: value.cargo.timeBand,
    weightBand: value.cargo.tonnageBand,
    equipmentBand: value.capacity.cargoCompatibilityBand,
    temperatureBand: "Temperature requirements confirmed",
    adrBand: "ADR requirements confirmed",
    dimensionalRequirementsBand: "Dimensional requirements confirmed",
    freeAreaBand: value.capacity.availabilityRegion,
    freeTimeBand: value.capacity.timeBand,
    freeCapacityBand: value.capacity.tonnageBand,
    capacityEquipmentBand: value.capacity.cargoCompatibilityBand,
    capacityTemperatureBand: "Temperature capability confirmed",
    capacityAdrBand: "ADR capability confirmed",
  };
}

function normalizeMatch(value: any): RoadMatch {
  const score = value.score || {};
  const source = score.evaluationInputs || value.evaluationInputs || {};
  const projection = roadProjectionViewModel(value);
  return {
    ...value,
    totalScore: score.totalScore ?? value.totalScore,
    explanation: score.explanation ?? value.explanation,
    calculationVersion: score.calculationVersion ?? value.calculationVersion,
    evaluationInputs: {
      ...source,
      cargoTypeBand: source.cargoTypeBand ?? source.cargoCompatibilityBand,
      weightBand: source.weightBand ?? source.capacityBand,
      requirementsBand: source.requirementsBand ?? source.cargoCompatibilityBand,
      availabilityRegion: source.availabilityRegion ?? source.distanceBand,
      availabilityTimeBand: source.availabilityTimeBand ?? source.timingBand,
    },
    projection,
    initiatedByMe: value.initiatedByMe,
    canAccept: value.canAccept,
  };
}

function normalizeCargo(value: any): RoadCargo {
  const requirements = value.roadRequirements || {};
  return {
    ...value,
    volumeCubicMetres: requirements.volumeCubicMetres,
    loadingMetres: requirements.loadingMetres,
    palletPositions: requirements.palletPositions,
    requiredTrailerType: requirements.requiredTrailerType,
    requiredEquipment: requirements.requiredEquipment || [],
    temperatureMinCelsius: requirements.temperatureMinCelsius,
    temperatureMaxCelsius: requirements.temperatureMaxCelsius,
    adrClasses: requirements.adrClasses || [],
    direction: requirements.direction,
    notes: requirements.notes ?? value.notes,
  };
}

export function toIso(value: string): string {
  return new Date(value).toISOString();
}

export function roadAssetFormPayload(data: Record<string, any>, editing: boolean) {
  const optionalNumber = (value: unknown) =>
    value === "" || value == null ? (editing ? null : undefined) : Number(value);
  const labels = (value: string) => value.split(",").map((part) => part.trim()).filter(Boolean);
  return {
    ...data,
    payloadTonnes: Number(data.payloadTonnes),
    volumeCubicMetres: Number(data.volumeCubicMetres),
    loadingMetres: Number(data.loadingMetres),
    palletPositions: Number(data.palletPositions),
    temperatureMinCelsius: optionalNumber(data.temperatureMinCelsius),
    temperatureMaxCelsius: optionalNumber(data.temperatureMaxCelsius),
    equipment: labels(data.equipment),
    adrClasses: labels(data.adrClasses),
  };
}

export function roadDriverActions(assignment: RoadAssignment | undefined, matchStatus: MatchStatus) {
  return {
    canConfirm: Boolean(assignment && !assignment.confirmedAt),
    canFlag: Boolean(assignment && (matchStatus === "NEW" || matchStatus === "INTEREST_SENT")),
  };
}