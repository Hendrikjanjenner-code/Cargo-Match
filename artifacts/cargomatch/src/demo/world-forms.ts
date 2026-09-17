import type {
  WorldDeepseaAvailability,
  WorldDeepseaCargoRequirement,
  WorldDeepseaVesselProfile,
  WorldLinerCargoRequirement,
  WorldLinerService,
  WorldMode,
  WorldRoadAssetProfile,
  WorldRoadAvailability,
  WorldRoadCargoRequirement,
} from "./world-types";

export interface CargoForm {
  mode: WorldMode;
  name: string;
  cargoType: string;
  weightTonnes: number | string;
  originId: string;
  destinationId: string;
  readyFrom: string;
  readyUntil: string;
  visibility?: "OPEN_NETWORK" | "PRIVATE";
  requiredVesselType?: string;
  deepseaRequirement?: WorldDeepseaCargoRequirement;
  linerRequirements?: WorldLinerCargoRequirement;
  roadRequirements?: WorldRoadCargoRequirement;
}

export interface AssetForm {
  mode: "INLAND" | "DEEPSEA" | "ROAD";
  name: string;
  type: string;
  capacityTonnes: number | string;
  equipment?: string | string[];
  assignedDriverId?: string;
  roadProfile?: WorldRoadAssetProfile;
  deepseaProfile?: WorldDeepseaVesselProfile;
}

export interface OfferForm {
  mode: "INLAND" | "DEEPSEA" | "ROAD";
  assetId: string;
  locationId: string;
  availableFrom: string;
  availableUntil: string;
  capacityTonnes: number | string;
  cargoTypes?: string | string[];
  direction?: string;
  visibility?: "OPEN_NETWORK" | "PRIVATE";
  maximumPositioningDistanceKm?: number | string;
  roadAvailability?: WorldRoadAvailability;
  deepseaAvailability?: WorldDeepseaAvailability;
}

export interface DepartureForm {
  serviceName: string;
  originId: string;
  destinationId: string;
  departureAt: string;
  cargoCutoffAt: string;
  capacityTonnes: number | string;
  visibility?: "OPEN_NETWORK" | "PRIVATE";
  linerService?: WorldLinerService;
}

const list = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value.map((item) => item.trim()).filter(Boolean) : (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);

const positive = (value: number | string, label: string) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${label} must be greater than zero`);
  return number;
};
const finite = (value: unknown, label: string, minimum = 0) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new RangeError(`${label} must be a finite number${minimum > 0 ? " greater than zero" : ""}`);
  }
  return value;
};
const validDate = (value: string, label: string) => {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw new RangeError(`${label} must be a valid date`);
  return parsed;
};
const optionalFinite = (value: number | null | undefined, label: string, minimum = 0) => {
  if (value != null) finite(value, label, minimum);
};

function validateRoadRequirements(value: WorldRoadCargoRequirement | undefined) {
  if (!value) return;
  optionalFinite(value.volumeCubicMetres, "Road cargo volume", Number.MIN_VALUE);
  optionalFinite(value.loadingMetres, "Road cargo loading metres", Number.MIN_VALUE);
  optionalFinite(value.palletPositions, "Road cargo pallet positions", Number.MIN_VALUE);
  if (!Array.isArray(value.requiredEquipment) || !Array.isArray(value.adrClasses ?? [])) throw new RangeError("Road equipment and ADR classes must be lists");
  if (value.temperatureMinCelsius != null && value.temperatureMaxCelsius != null && value.temperatureMinCelsius > value.temperatureMaxCelsius) throw new RangeError("Road cargo temperature range is invalid");
}

function validateRoadProfile(value: WorldRoadAssetProfile | undefined) {
  if (!value) return;
  finite(value.volumeCubicMetres, "Road asset volume", Number.MIN_VALUE);
  finite(value.loadingMetres, "Road asset loading metres", Number.MIN_VALUE);
  finite(value.palletPositions, "Road asset pallet positions", Number.MIN_VALUE);
  optionalFinite(value.payloadTonnes, "Road asset payload", Number.MIN_VALUE);
  if (value.temperatureMinCelsius != null && value.temperatureMaxCelsius != null && value.temperatureMinCelsius > value.temperatureMaxCelsius) throw new RangeError("Road asset temperature range is invalid");
}

function validateRoadAvailability(value: WorldRoadAvailability | undefined) {
  if (!value) return;
  const current = validDate(value.currentDeliveryExpectedAt, "Current delivery time");
  const available = validDate(value.expectedAvailabilityAt, "Expected availability time");
  if (current > available) throw new RangeError("Expected availability cannot precede current delivery");
  finite(value.availabilityUncertaintyMinutes, "Availability uncertainty");
  finite(value.availableVolumeCubicMetres, "Available road volume", Number.MIN_VALUE);
  finite(value.availableLoadingMetres, "Available road loading metres", Number.MIN_VALUE);
  finite(value.availablePalletPositions, "Available road pallet positions", Number.MIN_VALUE);
  if (value.temperatureMinCelsius != null && value.temperatureMaxCelsius != null && value.temperatureMinCelsius > value.temperatureMaxCelsius) throw new RangeError("Road availability temperature range is invalid");
}

function validateDeepsea(value: WorldDeepseaCargoRequirement | undefined, availability?: WorldDeepseaAvailability) {
  if (value) {
    const tolerance = value.quantityTolerancePercent ?? 0;
    if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance >= 100) throw new RangeError("Deepsea quantity tolerance must be from 0 up to 100");
    optionalFinite(value.minimumVesselDwtTonnes, "Minimum vessel DWT", Number.MIN_VALUE);
    optionalFinite(value.maximumVesselDwtTonnes, "Maximum vessel DWT", Number.MIN_VALUE);
    if (value.minimumVesselDwtTonnes != null && value.maximumVesselDwtTonnes != null && value.minimumVesselDwtTonnes > value.maximumVesselDwtTonnes) throw new RangeError("Deepsea DWT range is invalid");
  }
  if (availability) {
    for (const [label, number] of Object.entries({
      "Manual positioning days": availability.manualPositioningDays,
      "Departure uncertainty days": availability.departureUncertaintyDays,
      "Positioning buffer days": availability.positioningBufferDays,
    })) optionalFinite(number, label);
    if ([availability.manualPositioningDays, availability.departureUncertaintyDays, availability.positioningBufferDays].some((number) => number != null && number! > 365)) throw new RangeError("Deepsea manual estimates cannot exceed 365 days");
    optionalFinite(availability.approximateMaxDistanceKm, "Approximate positioning distance", Number.MIN_VALUE);
  }
}

function validateLiner(value: WorldLinerCargoRequirement | undefined, service?: WorldLinerService) {
  if (value) {
    validDate(value.readyAt, "Liner ready time");
    if (!Number.isInteger(value.pieceCount) || value.pieceCount < 1) throw new RangeError("Liner piece count must be a positive integer");
    for (const [label, number] of Object.entries({
      "Liner piece weight": value.pieceWeightTonnes, "Liner piece length": value.pieceLengthMetres,
      "Liner piece width": value.pieceWidthMetres, "Liner piece height": value.pieceHeightMetres,
    })) finite(number, label, Number.MIN_VALUE);
    optionalFinite(value.requiredLiftingTonnes, "Liner required lifting", Number.MIN_VALUE);
  }
  if (service) {
    for (const [label, number] of Object.entries({
      "Commercial tonnes": service.availableCommercialTonnes, "Maximum piece weight": service.maximumPieceWeightTonnes,
      "Maximum piece length": service.maximumPieceLengthMetres, "Maximum piece width": service.maximumPieceWidthMetres,
      "Maximum piece height": service.maximumPieceHeightMetres, "Lifting capacity": service.liftingCapacityTonnes,
    })) finite(number, label, Number.MIN_VALUE);
    if (!Array.isArray(service.portRotation) || !Array.isArray(service.acceptedCargoTypes)) throw new RangeError("Liner port rotation and cargo types are required");
    for (const call of service.portRotation) {
      if (!call.locationId || !Number.isInteger(call.sequence) || call.sequence < 1) throw new RangeError("Liner port calls need a location and positive sequence");
      validDate(call.estimatedDeparture, "Liner port departure");
    }
  }
}

export function cargoFormPayload(form: CargoForm) {
  if (!form.name.trim() || !form.originId || !form.destinationId) throw new RangeError("Cargo name and locations are required");
  const from = validDate(form.readyFrom, "Cargo start date");
  const until = validDate(form.readyUntil, "Cargo end date");
  if (until <= from) throw new RangeError("Cargo end date must be after its start date");
  validateRoadRequirements(form.roadRequirements);
  validateDeepsea(form.deepseaRequirement);
  validateLiner(form.linerRequirements);
  const cargoType = form.mode === "LINER" ? form.cargoType.trim().toUpperCase() : form.cargoType.trim().toLowerCase();
  if (!cargoType) throw new RangeError("Cargo type is required");
  return { ...form, name: form.name.trim(), cargoType, weightTonnes: positive(form.weightTonnes, "Cargo weight"), visibility: form.visibility ?? "OPEN_NETWORK" };
}

export function assetFormPayload(form: AssetForm) {
  if (!form.name.trim() || !form.type.trim()) throw new RangeError("Asset name and type are required");
  validateRoadProfile(form.roadProfile);
  if (form.deepseaProfile) {
    finite(form.deepseaProfile.dwtTonnes, "Deepsea vessel DWT", Number.MIN_VALUE);
    optionalFinite(form.deepseaProfile.summerDraftMetres, "Deepsea summer draft", Number.MIN_VALUE);
  }
  return { ...form, name: form.name.trim(), type: form.type.trim(), capacityTonnes: positive(form.capacityTonnes, "Asset capacity"), equipment: list(form.equipment) };
}

export function offerFormPayload(form: OfferForm) {
  if (!form.assetId || !form.locationId) throw new RangeError("Offer asset and location are required");
  const from = validDate(form.availableFrom, "Offer start date");
  const until = validDate(form.availableUntil, "Offer end date");
  if (until <= from) throw new RangeError("Offer end date must be after its start date");
  if (form.maximumPositioningDistanceKm != null) positive(form.maximumPositioningDistanceKm, "Maximum positioning distance");
  validateRoadAvailability(form.roadAvailability);
  validateDeepsea(undefined, form.deepseaAvailability);
  return { ...form, capacityTonnes: positive(form.capacityTonnes, "Offer capacity"), cargoTypes: list(form.cargoTypes), visibility: form.visibility ?? "OPEN_NETWORK", maximumPositioningDistanceKm: form.maximumPositioningDistanceKm == null ? undefined : positive(form.maximumPositioningDistanceKm, "Maximum positioning distance") };
}

export function departureFormPayload(form: DepartureForm) {
  if (!form.serviceName.trim() || !form.originId || !form.destinationId) throw new RangeError("Departure service and locations are required");
  const cutoff = validDate(form.cargoCutoffAt, "Departure cutoff");
  const departure = validDate(form.departureAt, "Departure time");
  if (cutoff >= departure) throw new RangeError("Departure cutoff must be before departure");
  validateLiner(undefined, form.linerService);
  return { ...form, serviceName: form.serviceName.trim(), capacityTonnes: positive(form.capacityTonnes, "Departure capacity"), visibility: form.visibility ?? "OPEN_NETWORK" };
}