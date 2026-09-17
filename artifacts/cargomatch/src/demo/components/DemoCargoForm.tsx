import React, { useState } from "react";
import { Button, Card, CardHeader, CardTitle, CardContent, Input, Label, Select } from "@/components/ui/primitives";
import {
  type AssetForm,
  type CargoForm,
  type DepartureForm,
  type OfferForm,
  type WorldAsset,
  type WorldCargo,
  type WorldDeparture,
  type WorldLinerCargoType,
  type WorldLinerStowage,
  type WorldMode,
  type WorldOffer,
  type WorldState,
  createAsset,
  createCargo,
  createDeparture,
  createOffer,
  editAsset,
  editCargo,
  editDeparture,
  editOffer,
  publishCargo,
  publishDeparture,
  publishOffer,
  publishAsset,
  withdrawAsset,
} from "../world";

interface Props {
  state: WorldState;
  actorId: string;
  entityId?: string;
  forceType?: "ASSET";
  updateState: (s: WorldState) => void;
  onCancel: () => void;
  now: Date;
}

type EditorType = "CARGO" | "OFFER" | "DEPARTURE" | "ASSET";
type ListingEditorStatus = "DRAFT" | "ACTIVE" | "WITHDRAWN";

interface EditorValues {
  mode: WorldMode;
  name: string;
  cargoType: string;
  weightTonnes: string;
  originId: string;
  destinationId: string;
  readyFrom: string;
  readyUntil: string;
  visibility: "OPEN_NETWORK" | "PRIVATE";
  listingStatus: ListingEditorStatus;
  requiredVesselType: string;
  deepseaTolerance: string;
  deepseaMinDwt: string;
  deepseaMaxDwt: string;
  deepseaMaxDraft: string;
  deepseaGear: string;
  deepseaClass: string;
  linerPieceCount: string;
  linerPieceWeight: string;
  linerPieceLength: string;
  linerPieceWidth: string;
  linerPieceHeight: string;
  linerLifting: string;
  linerStowage: WorldLinerStowage;
  linerReadyAt: string;
  roadVolume: string;
  roadLoading: string;
  roadPallets: string;
  roadEquipment: string;
  roadTrailer: string;
  roadAdr: string;
  roadTempMin: string;
  roadTempMax: string;
  roadDirection: string;
  assetMode: WorldAsset["mode"];
  assetName: string;
  assetType: string;
  assetCapacity: string;
  assetEquipment: string;
  assetActive: boolean;
  assignedDriverId: string;
  assetPayload: string;
  assetVolume: string;
  assetLoading: string;
  assetPallets: string;
  assetTrailer: string;
  assetAdr: string;
  assetTempMin: string;
  assetTempMax: string;
  vesselClass: string;
  vesselDwt: string;
  vesselDraft: string;
  vesselGear: string;
  assetId: string;
  locationId: string;
  offerCapacity: string;
  cargoTypes: string;
  availableFrom: string;
  availableUntil: string;
  direction: string;
  maximumPositioningDistanceKm: string;
  roadCurrentDelivery: string;
  roadExpectedAvailability: string;
  roadUncertainty: string;
  roadAvailableVolume: string;
  roadAvailableLoading: string;
  roadAvailablePallets: string;
  offerEquipment: string;
  offerAdr: string;
  offerTrailer: string;
  offerTempMin: string;
  offerTempMax: string;
  offerDirection: string;
  deepseaTravelDays: string;
  deepseaUncertaintyDays: string;
  deepseaBufferDays: string;
  deepseaDistance: string;
  deepseaRoute: string;
  serviceName: string;
  departureCapacity: string;
  cargoCutoffAt: string;
  departureAt: string;
  serviceVesselActive: boolean;
  serviceCommercialTonnes: string;
  serviceMaxPieceWeight: string;
  serviceMaxPieceLength: string;
  serviceMaxPieceWidth: string;
  serviceMaxPieceHeight: string;
  serviceLifting: string;
  serviceStowage: WorldLinerStowage;
  serviceCargoTypes: string;
}

const EMPTY: EditorValues = {
  mode: "INLAND", name: "", cargoType: "", weightTonnes: "", originId: "", destinationId: "", readyFrom: "", readyUntil: "", visibility: "OPEN_NETWORK", listingStatus: "DRAFT",
  requiredVesselType: "", deepseaTolerance: "", deepseaMinDwt: "", deepseaMaxDwt: "", deepseaMaxDraft: "", deepseaGear: "", deepseaClass: "",
  linerPieceCount: "", linerPieceWeight: "", linerPieceLength: "", linerPieceWidth: "", linerPieceHeight: "", linerLifting: "", linerStowage: "EITHER", linerReadyAt: "",
  roadVolume: "", roadLoading: "", roadPallets: "", roadEquipment: "", roadTrailer: "", roadAdr: "", roadTempMin: "", roadTempMax: "", roadDirection: "",
  assetMode: "INLAND", assetName: "", assetType: "", assetCapacity: "", assetEquipment: "", assetActive: true, assignedDriverId: "", assetPayload: "", assetVolume: "", assetLoading: "", assetPallets: "", assetTrailer: "", assetAdr: "", assetTempMin: "", assetTempMax: "", vesselClass: "HANDYSIZE", vesselDwt: "", vesselDraft: "", vesselGear: "",
  assetId: "", locationId: "", offerCapacity: "", cargoTypes: "", availableFrom: "", availableUntil: "", direction: "", maximumPositioningDistanceKm: "", roadCurrentDelivery: "", roadExpectedAvailability: "", roadUncertainty: "", roadAvailableVolume: "", roadAvailableLoading: "", roadAvailablePallets: "", offerEquipment: "", offerAdr: "", offerTrailer: "", offerTempMin: "", offerTempMax: "", offerDirection: "", deepseaTravelDays: "", deepseaUncertaintyDays: "", deepseaBufferDays: "", deepseaDistance: "", deepseaRoute: "UNSPECIFIED",
  serviceName: "", departureCapacity: "", cargoCutoffAt: "", departureAt: "", serviceVesselActive: true, serviceCommercialTonnes: "", serviceMaxPieceWeight: "", serviceMaxPieceLength: "", serviceMaxPieceWidth: "", serviceMaxPieceHeight: "", serviceLifting: "", serviceStowage: "EITHER", serviceCargoTypes: "BREAKBULK",
};

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
const inputDate = (value: string | Date) => {
  const date = new Date(value);
  const pad = (number: number) => `${number}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const nullableNumber = (value: string): number | undefined => value.trim() === "" ? undefined : Number(value);
const textList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const optionalText = (value: string): string | undefined => value.trim() || undefined;
const same = (left: string | undefined | null, right: string | undefined | null) => (left ?? "") === (right ?? "");
const exactDate = (value: string, originalDisplay: string, originalIso: string | undefined) => originalIso && value === originalDisplay ? originalIso : value;

function locationsFor(mode: WorldMode) {
  if (mode === "DEEPSEA") return ["loc-singapore", "loc-hamburg"];
  if (mode === "LINER") return ["loc-shanghai", "loc-hamburg"];
  if (mode === "ROAD") return ["loc-utrecht", "loc-eindhoven"];
  return ["loc-rotterdam", "loc-duisburg"];
}

function cargoDefaults(mode: WorldMode, now: Date): Partial<EditorValues> {
  const [originId, destinationId] = locationsFor(mode);
  const from = inputDate(addDays(now, mode === "LINER" ? 3 : 2));
  const until = inputDate(addDays(now, mode === "LINER" ? 6 : 5));
  if (mode === "DEEPSEA") return { mode, cargoType: "dry bulk", weightTonnes: "20000", originId, destinationId, readyFrom: from, readyUntil: until, requiredVesselType: "DRY_CARGO", deepseaTolerance: "0", deepseaClass: "HANDYSIZE" };
  if (mode === "LINER") return { mode, cargoType: "BREAKBULK", weightTonnes: "800", originId, destinationId, readyFrom: from, readyUntil: until, linerPieceCount: "1", linerPieceWeight: "800", linerPieceLength: "10", linerPieceWidth: "2", linerPieceHeight: "2", linerStowage: "EITHER", linerReadyAt: from };
  if (mode === "ROAD") return { mode, cargoType: "general cargo", weightTonnes: "18", originId, destinationId, readyFrom: from, readyUntil: until, roadVolume: "40", roadLoading: "8", roadPallets: "20", roadEquipment: "curtainsider", roadTrailer: "curtainsider", roadDirection: "Eindhoven" };
  return { mode, cargoType: "dry bulk", weightTonnes: "1000", originId, destinationId, readyFrom: from, readyUntil: until, requiredVesselType: "DRY_CARGO" };
}

function editorType(entityId: string | undefined, cargo: WorldCargo | undefined, offer: WorldOffer | undefined, departure: WorldDeparture | undefined, asset: WorldAsset | undefined, forceType?: "ASSET"): EditorType {
  if (forceType) return forceType;
  if (cargo || entityId === "new_cargo") return "CARGO";
  if (offer || entityId === "new_offer") return "OFFER";
  if (departure || entityId === "new_departure") return "DEPARTURE";
  if (asset || entityId === "new_asset") return "ASSET";
  return "CARGO";
}

export function DemoCargoForm({ state, actorId, entityId, forceType, updateState, onCancel, now }: Props) {
  const actor = state.users.find((item) => item.id === actorId);
  const company = state.companies.find((item) => item.id === actor?.companyId);
  const existingCargo = state.cargos.find((item) => item.id === entityId);
  const existingOffer = state.offers.find((item) => item.id === entityId);
  const existingDeparture = state.departures.find((item) => item.id === entityId);
  const existingAsset = state.assets.find((item) => item.id === entityId);
  const type = editorType(entityId, existingCargo, existingOffer, existingDeparture, existingAsset, forceType);

  const makeInitial = (): EditorValues => {
    if (existingCargo) {
      const deepsea = existingCargo.deepseaRequirement;
      const liner = existingCargo.linerRequirements;
      const road = existingCargo.roadRequirements;
      return { ...EMPTY, ...cargoDefaults(existingCargo.mode, now), mode: existingCargo.mode, name: existingCargo.name, cargoType: existingCargo.cargoType, weightTonnes: `${existingCargo.weightTonnes}`, originId: existingCargo.origin.id, destinationId: existingCargo.destination.id, readyFrom: inputDate(existingCargo.readyFrom), readyUntil: inputDate(existingCargo.readyUntil), visibility: existingCargo.visibility, listingStatus: existingCargo.listingStatus === "ACTIVE" ? "ACTIVE" : existingCargo.listingStatus === "WITHDRAWN" ? "WITHDRAWN" : "DRAFT", requiredVesselType: existingCargo.requiredVesselType ?? "", deepseaTolerance: deepsea?.quantityTolerancePercent == null ? "" : `${deepsea.quantityTolerancePercent}`, deepseaMinDwt: deepsea?.minimumVesselDwtTonnes == null ? "" : `${deepsea.minimumVesselDwtTonnes}`, deepseaMaxDwt: deepsea?.maximumVesselDwtTonnes == null ? "" : `${deepsea.maximumVesselDwtTonnes}`, deepseaMaxDraft: deepsea?.maximumDraftMetres == null ? "" : `${deepsea.maximumDraftMetres}`, deepseaGear: deepsea?.requiredGear ?? "", deepseaClass: deepsea?.preferredVesselClass ?? "", linerPieceCount: liner ? `${liner.pieceCount}` : "", linerPieceWeight: liner ? `${liner.pieceWeightTonnes}` : "", linerPieceLength: liner ? `${liner.pieceLengthMetres}` : "", linerPieceWidth: liner ? `${liner.pieceWidthMetres}` : "", linerPieceHeight: liner ? `${liner.pieceHeightMetres}` : "", linerLifting: liner?.requiredLiftingTonnes == null ? "" : `${liner.requiredLiftingTonnes}`, linerStowage: liner?.requiredStowage ?? "EITHER", linerReadyAt: liner ? inputDate(liner.readyAt) : "", roadVolume: road?.volumeCubicMetres == null ? (cargoDefaults("ROAD", now).roadVolume ?? "") : `${road.volumeCubicMetres}`, roadLoading: road?.loadingMetres == null ? (cargoDefaults("ROAD", now).roadLoading ?? "") : `${road.loadingMetres}`, roadPallets: road?.palletPositions == null ? (cargoDefaults("ROAD", now).roadPallets ?? "") : `${road.palletPositions}`, roadEquipment: road?.requiredEquipment?.join(", ") ?? "curtainsider", roadTrailer: road?.requiredTrailerType ?? "curtainsider", roadAdr: (road?.adrClasses ?? []).join(", "), roadTempMin: road?.temperatureMinCelsius == null ? "" : `${road.temperatureMinCelsius}`, roadTempMax: road?.temperatureMaxCelsius == null ? "" : `${road.temperatureMaxCelsius}`, roadDirection: road?.direction ?? "Eindhoven" };
    }
    if (existingOffer) {
      const road = existingOffer.roadAvailability;
      const deepsea = existingOffer.deepseaAvailability;
      return { ...EMPTY, assetId: existingOffer.assetId, locationId: existingOffer.location.id, offerCapacity: `${existingOffer.capacityTonnes}`, cargoTypes: existingOffer.cargoTypes.join(", "), availableFrom: inputDate(existingOffer.availableFrom), availableUntil: inputDate(existingOffer.availableUntil), visibility: existingOffer.visibility, listingStatus: existingOffer.listingStatus === "ACTIVE" ? "ACTIVE" : existingOffer.listingStatus === "WITHDRAWN" ? "WITHDRAWN" : "DRAFT", direction: existingOffer.direction ?? "", maximumPositioningDistanceKm: existingOffer.maximumPositioningDistanceKm == null ? (existingOffer.projection?.maximumPositioningDistanceKm ?? "100") : `${existingOffer.maximumPositioningDistanceKm}`, roadCurrentDelivery: road ? inputDate(road.currentDeliveryExpectedAt) : inputDate(now), roadExpectedAvailability: road ? inputDate(road.expectedAvailabilityAt) : inputDate(addDays(now, 1)), roadUncertainty: road?.availabilityUncertaintyMinutes == null ? "15" : `${road.availabilityUncertaintyMinutes}`, roadAvailableVolume: road?.availableVolumeCubicMetres == null ? "90" : `${road.availableVolumeCubicMetres}`, roadAvailableLoading: road?.availableLoadingMetres == null ? "12" : `${road.availableLoadingMetres}`, roadAvailablePallets: road?.availablePalletPositions == null ? "30" : `${road.availablePalletPositions}`, offerEquipment: road?.equipment?.join(", ") ?? "curtainsider", offerAdr: (road?.adrClasses ?? []).join(", "), offerTrailer: road?.trailerType ?? "curtainsider", offerTempMin: road?.temperatureMinCelsius == null ? "" : `${road.temperatureMinCelsius}`, offerTempMax: road?.temperatureMaxCelsius == null ? "" : `${road.temperatureMaxCelsius}`, offerDirection: road?.preferredDirection ?? "Eindhoven", deepseaTravelDays: deepsea?.manualPositioningDays == null ? "" : `${deepsea.manualPositioningDays}`, deepseaUncertaintyDays: deepsea?.departureUncertaintyDays == null ? "" : `${deepsea.departureUncertaintyDays}`, deepseaBufferDays: deepsea?.positioningBufferDays == null ? "" : `${deepsea.positioningBufferDays}`, deepseaDistance: deepsea?.approximateMaxDistanceKm == null ? "" : `${deepsea.approximateMaxDistanceKm}`, deepseaRoute: deepsea?.routeChoice ?? "UNSPECIFIED" };
    }
    if (existingDeparture) {
      const service = existingDeparture.linerService;
      return { ...EMPTY, serviceName: existingDeparture.serviceName, originId: existingDeparture.origin.id, destinationId: existingDeparture.destination.id, departureCapacity: `${existingDeparture.capacityTonnes}`, cargoCutoffAt: inputDate(existingDeparture.cargoCutoffAt), departureAt: inputDate(existingDeparture.departureAt), visibility: existingDeparture.visibility, listingStatus: existingDeparture.listingStatus === "ACTIVE" ? "ACTIVE" : existingDeparture.listingStatus === "WITHDRAWN" ? "WITHDRAWN" : "DRAFT", serviceVesselActive: service?.vesselActive ?? true, serviceCommercialTonnes: service ? `${service.availableCommercialTonnes}` : "", serviceMaxPieceWeight: service ? `${service.maximumPieceWeightTonnes}` : "", serviceMaxPieceLength: service ? `${service.maximumPieceLengthMetres}` : "", serviceMaxPieceWidth: service ? `${service.maximumPieceWidthMetres}` : "", serviceMaxPieceHeight: service ? `${service.maximumPieceHeightMetres}` : "", serviceLifting: service ? `${service.liftingCapacityTonnes}` : "", serviceStowage: service?.stowage ?? "EITHER", serviceCargoTypes: service?.acceptedCargoTypes.join(", ") ?? "BREAKBULK" };
    }
    if (existingAsset) {
      const road = existingAsset.roadProfile;
      const deepsea = existingAsset.deepseaProfile;
      return { ...EMPTY, assetMode: existingAsset.mode, assetName: existingAsset.name, assetType: existingAsset.type, assetCapacity: `${existingAsset.capacityTonnes}`, assetEquipment: existingAsset.equipment.join(", "), assetActive: existingAsset.active, assignedDriverId: existingAsset.assignedDriverId ?? "", assetPayload: road?.payloadTonnes == null ? "" : `${road.payloadTonnes}`, assetVolume: road?.volumeCubicMetres == null ? "" : `${road.volumeCubicMetres}`, assetLoading: road?.loadingMetres == null ? "" : `${road.loadingMetres}`, assetPallets: road?.palletPositions == null ? "" : `${road.palletPositions}`, assetTrailer: road?.trailerType ?? "", assetAdr: (road?.adrClasses ?? []).join(", "), assetTempMin: road?.temperatureMinCelsius == null ? "" : `${road.temperatureMinCelsius}`, assetTempMax: road?.temperatureMaxCelsius == null ? "" : `${road.temperatureMaxCelsius}`, vesselClass: deepsea?.vesselClass ?? "HANDYSIZE", vesselDwt: deepsea?.dwtTonnes == null ? "" : `${deepsea.dwtTonnes}`, vesselDraft: deepsea?.summerDraftMetres == null ? "" : `${deepsea.summerDraftMetres}`, vesselGear: deepsea?.gearConfiguration ?? "" };
    }
    const dMode = company?.mode ?? "INLAND";
    if (type === "CARGO") return { ...EMPTY, name: "Nieuwe lading", ...cargoDefaults(dMode, now) };
    if (type === "OFFER") return { ...EMPTY, assetId: "", locationId: locationsFor(dMode)[0], offerCapacity: dMode === "ROAD" ? "24" : "1000", cargoTypes: dMode === "LINER" ? "BREAKBULK" : dMode === "ROAD" ? "general cargo" : "dry bulk", availableFrom: inputDate(addDays(now, 1)), availableUntil: inputDate(addDays(now, 7)), maximumPositioningDistanceKm: "100", roadCurrentDelivery: inputDate(now), roadExpectedAvailability: inputDate(addDays(now, 1)), roadUncertainty: "15", roadAvailableVolume: "90", roadAvailableLoading: "12", roadAvailablePallets: "30", offerEquipment: "curtainsider", offerTrailer: "curtainsider", offerDirection: "Eindhoven", deepseaTravelDays: "1", deepseaUncertaintyDays: "1", deepseaBufferDays: "1", deepseaDistance: "250", deepseaRoute: "SUEZ" };
    if (type === "DEPARTURE") return { ...EMPTY, serviceName: "Nieuwe lijndienst", originId: "loc-shanghai", destinationId: "loc-hamburg", departureCapacity: "4000", cargoCutoffAt: inputDate(addDays(now, 3)), departureAt: inputDate(addDays(now, 5)), serviceCommercialTonnes: "4000", serviceMaxPieceWeight: "1000", serviceMaxPieceLength: "20", serviceMaxPieceWidth: "4", serviceMaxPieceHeight: "4", serviceLifting: "1000" };
    return { ...EMPTY, assetMode: dMode === "LINER" ? "INLAND" : dMode, assetName: "Nieuw asset", assetType: dMode === "ROAD" ? "TRUCK" : "DRY_CARGO", assetCapacity: dMode === "ROAD" ? "24" : "1000", assetEquipment: dMode === "ROAD" ? "curtainsider" : "dry bulk", assetPayload: "24", assetVolume: "100", assetLoading: "13", assetPallets: "33", assetTrailer: "curtainsider", vesselDwt: "40000" };
  };

  const [initial] = useState<EditorValues>(makeInitial);
  const [values, setValues] = useState<EditorValues>(initial);
  const [error, setError] = useState("");
  const setValue = <K extends keyof EditorValues>(key: K, value: EditorValues[K]) => setValues((previous) => ({ ...previous, [key]: value }));
  const isUnchanged = (...keys: (keyof EditorValues)[]) => keys.every((key) => values[key] === initial[key]);

  const field = (id: keyof EditorValues, label: string, type: "text" | "number" | "datetime-local" = "text", props: { min?: string; placeholder?: string } = {}) => (
    <div className="space-y-1"><Label htmlFor={`demo-${String(id)}`}>{label}</Label><Input id={`demo-${String(id)}`} type={type} value={values[id] as string} min={props.min} placeholder={props.placeholder} onChange={(event) => setValue(id, event.target.value as EditorValues[typeof id])} /></div>
  );
  const select = (id: keyof EditorValues, label: string, options: Array<{ value: string; label: string }>) => (
    <div className="space-y-1"><Label htmlFor={`demo-${String(id)}`}>{label}</Label><Select id={`demo-${String(id)}`} value={values[id] as string} onChange={(event) => setValue(id, event.target.value as EditorValues[typeof id])}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></div>
  );
  const location = (id: "originId" | "destinationId" | "locationId", label: string) => select(id, label, [{ value: "", label: "Selecteer…" }, ...state.locations.map((item) => ({ value: item.id, label: item.name }))]);

  const buildCargo = (): CargoForm => {
    const deepseaKeys: (keyof EditorValues)[] = ["deepseaTolerance", "deepseaMinDwt", "deepseaMaxDwt", "deepseaMaxDraft", "deepseaGear", "deepseaClass"];
    const linerKeys: (keyof EditorValues)[] = ["linerPieceCount", "linerPieceWeight", "linerPieceLength", "linerPieceWidth", "linerPieceHeight", "linerLifting", "linerStowage", "linerReadyAt"];
    const roadKeys: (keyof EditorValues)[] = ["roadVolume", "roadLoading", "roadPallets", "roadEquipment", "roadTrailer", "roadAdr", "roadTempMin", "roadTempMax", "roadDirection"];
    return {
      mode: values.mode, name: values.name, cargoType: values.cargoType, weightTonnes: values.weightTonnes, originId: values.originId, destinationId: values.destinationId,
      readyFrom: exactDate(values.readyFrom, initial.readyFrom, existingCargo?.readyFrom), readyUntil: exactDate(values.readyUntil, initial.readyUntil, existingCargo?.readyUntil), visibility: values.visibility, requiredVesselType: optionalText(values.requiredVesselType),
      deepseaRequirement: values.mode === "DEEPSEA" && existingCargo?.deepseaRequirement && isUnchanged(...deepseaKeys) ? existingCargo.deepseaRequirement : values.mode === "DEEPSEA" ? { quantityTolerancePercent: Number(values.deepseaTolerance || "0"), minimumVesselDwtTonnes: nullableNumber(values.deepseaMinDwt), maximumVesselDwtTonnes: nullableNumber(values.deepseaMaxDwt), maximumDraftMetres: nullableNumber(values.deepseaMaxDraft), requiredGear: optionalText(values.deepseaGear), preferredVesselClass: optionalText(values.deepseaClass) as CargoForm["deepseaRequirement"] extends infer R ? R extends { preferredVesselClass?: infer V } ? V : never : never } : undefined,
      linerRequirements: values.mode === "LINER" && existingCargo?.linerRequirements && isUnchanged(...linerKeys) ? existingCargo.linerRequirements : values.mode === "LINER" ? { cargoType: values.cargoType.toUpperCase() as WorldLinerCargoType, pieceCount: Number(values.linerPieceCount), pieceWeightTonnes: Number(values.linerPieceWeight), pieceLengthMetres: Number(values.linerPieceLength), pieceWidthMetres: Number(values.linerPieceWidth), pieceHeightMetres: Number(values.linerPieceHeight), requiredLiftingTonnes: nullableNumber(values.linerLifting), requiredStowage: values.linerStowage, readyAt: exactDate(values.linerReadyAt, initial.linerReadyAt, existingCargo?.linerRequirements?.readyAt) } : undefined,
      roadRequirements: values.mode === "ROAD" && existingCargo?.roadRequirements && isUnchanged(...roadKeys) ? existingCargo.roadRequirements : values.mode === "ROAD" ? { volumeCubicMetres: nullableNumber(values.roadVolume), loadingMetres: nullableNumber(values.roadLoading), palletPositions: nullableNumber(values.roadPallets), requiredEquipment: textList(values.roadEquipment), requiredTrailerType: optionalText(values.roadTrailer), adrClasses: textList(values.roadAdr), temperatureMinCelsius: nullableNumber(values.roadTempMin), temperatureMaxCelsius: nullableNumber(values.roadTempMax), direction: optionalText(values.roadDirection) } : undefined,
    };
  };

  const buildAsset = (): AssetForm => ({
    mode: values.assetMode, name: values.assetName, type: values.assetType, capacityTonnes: values.assetCapacity, equipment: values.assetEquipment, assignedDriverId: values.assignedDriverId || undefined,
    roadProfile: values.assetMode === "ROAD" ? { payloadTonnes: nullableNumber(values.assetPayload), volumeCubicMetres: Number(values.assetVolume), loadingMetres: Number(values.assetLoading), palletPositions: Number(values.assetPallets), trailerType: optionalText(values.assetTrailer), adrClasses: textList(values.assetAdr), temperatureMinCelsius: nullableNumber(values.assetTempMin), temperatureMaxCelsius: nullableNumber(values.assetTempMax) } : undefined,
    deepseaProfile: values.assetMode === "DEEPSEA" ? { vesselClass: values.vesselClass as NonNullable<AssetForm["deepseaProfile"]>["vesselClass"], dwtTonnes: Number(values.vesselDwt), summerDraftMetres: nullableNumber(values.vesselDraft), gearConfiguration: optionalText(values.vesselGear) } : undefined,
  });

  const buildOffer = (): OfferForm => ({
    mode: (existingOffer?.mode ?? company?.mode ?? "INLAND") === "LINER" ? "INLAND" : (existingOffer?.mode ?? company?.mode ?? "INLAND") as OfferForm["mode"],
    assetId: values.assetId, locationId: values.locationId, capacityTonnes: values.offerCapacity, cargoTypes: values.cargoTypes, direction: optionalText(values.direction), visibility: values.visibility, maximumPositioningDistanceKm: nullableNumber(values.maximumPositioningDistanceKm),
    availableFrom: exactDate(values.availableFrom, initial.availableFrom, existingOffer?.availableFrom), availableUntil: exactDate(values.availableUntil, initial.availableUntil, existingOffer?.availableUntil),
    roadAvailability: (existingOffer?.mode ?? company?.mode) === "ROAD" ? { currentDeliveryExpectedAt: exactDate(values.roadCurrentDelivery, initial.roadCurrentDelivery, existingOffer?.roadAvailability?.currentDeliveryExpectedAt), expectedAvailabilityAt: exactDate(values.roadExpectedAvailability, initial.roadExpectedAvailability, existingOffer?.roadAvailability?.expectedAvailabilityAt), availabilityUncertaintyMinutes: Number(values.roadUncertainty), availableVolumeCubicMetres: Number(values.roadAvailableVolume), availableLoadingMetres: Number(values.roadAvailableLoading), availablePalletPositions: Number(values.roadAvailablePallets), equipment: textList(values.offerEquipment), adrClasses: textList(values.offerAdr), trailerType: optionalText(values.offerTrailer), temperatureMinCelsius: nullableNumber(values.offerTempMin), temperatureMaxCelsius: nullableNumber(values.offerTempMax), preferredDirection: optionalText(values.offerDirection) } : undefined,
    deepseaAvailability: (existingOffer?.mode ?? company?.mode) === "DEEPSEA" ? { manualPositioningDays: nullableNumber(values.deepseaTravelDays), departureUncertaintyDays: nullableNumber(values.deepseaUncertaintyDays), positioningBufferDays: nullableNumber(values.deepseaBufferDays), approximateMaxDistanceKm: nullableNumber(values.deepseaDistance), routeChoice: values.deepseaRoute as NonNullable<OfferForm["deepseaAvailability"]>["routeChoice"] } : undefined,
  });

  const buildDeparture = (): DepartureForm => {
    const service = existingDeparture?.linerService;
    const routeChanged = !same(values.originId, initial.originId) || !same(values.destinationId, initial.destinationId) || !same(values.departureAt, initial.departureAt);
    return {
      serviceName: values.serviceName, originId: values.originId, destinationId: values.destinationId, capacityTonnes: values.departureCapacity, visibility: values.visibility,
      cargoCutoffAt: exactDate(values.cargoCutoffAt, initial.cargoCutoffAt, existingDeparture?.cargoCutoffAt), departureAt: exactDate(values.departureAt, initial.departureAt, existingDeparture?.departureAt),
      linerService: {
        ...(service ?? {}), vesselActive: values.serviceVesselActive, vesselCompanyId: service?.vesselCompanyId ?? company?.id,
        portRotation: !routeChanged && service ? service.portRotation : [{ locationId: values.originId, sequence: 1, estimatedDeparture: values.departureAt }, { locationId: values.destinationId, sequence: 2, estimatedDeparture: values.departureAt }],
        availableCommercialTonnes: Number(values.serviceCommercialTonnes), maximumPieceWeightTonnes: Number(values.serviceMaxPieceWeight), maximumPieceLengthMetres: Number(values.serviceMaxPieceLength), maximumPieceWidthMetres: Number(values.serviceMaxPieceWidth), maximumPieceHeightMetres: Number(values.serviceMaxPieceHeight), liftingCapacityTonnes: Number(values.serviceLifting), stowage: values.serviceStowage, acceptedCargoTypes: textList(values.serviceCargoTypes).map((item) => item.toUpperCase() as WorldLinerCargoType),
      },
    };
  };

  const save = (publish: boolean) => {
    setError("");
    const next = structuredClone(state);
    try {
      const result = type === "CARGO"
        ? existingCargo ? editCargo(next, actorId, existingCargo.id, buildCargo(), now) : createCargo(next, actorId, buildCargo(), now)
        : type === "OFFER"
          ? existingOffer ? editOffer(next, actorId, existingOffer.id, buildOffer(), now) : createOffer(next, actorId, buildOffer(), now)
          : type === "DEPARTURE"
            ? existingDeparture ? editDeparture(next, actorId, existingDeparture.id, buildDeparture(), now) : createDeparture(next, actorId, buildDeparture(), now)
            : existingAsset ? editAsset(next, actorId, existingAsset.id, buildAsset(), now) : createAsset(next, actorId, buildAsset(), now);
      if (!result.ok) { setError(result.message); return; }
      if (type === "ASSET") {
        const activity = values.assetActive
          ? publishAsset(next, actorId, result.value.id, now)
          : withdrawAsset(next, actorId, result.value.id, now);
        if (!activity.ok) { setError(activity.message); return; }
      } else if (publish) {
        const published = type === "CARGO" ? publishCargo(next, actorId, result.value.id, now) : type === "OFFER" ? publishOffer(next, actorId, result.value.id, now) : publishDeparture(next, actorId, result.value.id, now);
        if (!published.ok) { setError(published.message); return; }
      }
      updateState(next);
      onCancel();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "De invoer kon niet worden opgeslagen.");
    }
  };

  const offerMode = existingOffer?.mode ?? company?.mode;
  const assetMode = values.assetMode;
  const isNew = !existingCargo && !existingOffer && !existingDeparture && !existingAsset;
  const modeOptions = ["INLAND", "DEEPSEA", "LINER", "ROAD"].map((mode) => ({ value: mode, label: mode }));

  return (
    <Card data-testid={`demo-${type.toLowerCase()}-form`}>
      <CardHeader><CardTitle>{isNew ? "Nieuw aanmaken" : "Bewerken"}</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        {error && <div role="alert" className="p-3 bg-destructive/10 text-destructive text-sm rounded-md">{error}</div>}
        {type === "CARGO" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field("name", "Naam / referentie")}
          {(!existingCargo && (company?.activities.includes("SHIPPER") || company?.activities.includes("CHARTERER"))) && <div className="space-y-1"><Label htmlFor="demo-mode">Transportmodus</Label><Select id="demo-mode" value={values.mode} onChange={(event) => setValues((previous) => ({ ...previous, ...cargoDefaults(event.target.value as WorldMode, now), name: previous.name }))}>{modeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></div>}
          {field("cargoType", "Ladingtype")}
          {field("weightTonnes", "Gewicht (ton)", "number", { min: "0" })}
          {location("originId", "Oorsprong")}
          {location("destinationId", "Bestemming")}
          {field("readyFrom", "Beschikbaar vanaf", "datetime-local")}
          {field("readyUntil", "Beschikbaar tot", "datetime-local")}
          {select("visibility", "Zichtbaarheid", [{ value: "OPEN_NETWORK", label: "Open netwerk" }, { value: "PRIVATE", label: "Privé" }])}
          {values.mode !== "LINER" && field("requiredVesselType", "Vereist assettype")}
          {values.mode === "DEEPSEA" && <><div className="sm:col-span-2 font-medium pt-2">Deepsea-eisen</div>{field("deepseaTolerance", "Hoeveelheidstolerantie (%)", "number", { min: "0" })}{field("deepseaMinDwt", "Minimale DWT", "number", { min: "0" })}{field("deepseaMaxDwt", "Maximale DWT", "number", { min: "0" })}{field("deepseaMaxDraft", "Maximale diepgang (m)", "number", { min: "0" })}{field("deepseaGear", "Vereiste laadgerei")}{field("deepseaClass", "Voorkeursklasse")}</>}
          {values.mode === "LINER" && <><div className="sm:col-span-2 font-medium pt-2">Breakbulk-eisen</div>{field("linerPieceCount", "Aantal stukken", "number", { min: "1" })}{field("linerPieceWeight", "Zwaarste stuk (ton)", "number", { min: "0" })}{field("linerPieceLength", "Max. lengte (m)", "number", { min: "0" })}{field("linerPieceWidth", "Max. breedte (m)", "number", { min: "0" })}{field("linerPieceHeight", "Max. hoogte (m)", "number", { min: "0" })}{field("linerLifting", "Vereist hijsvermogen (ton)", "number", { min: "0" })}{select("linerStowage", "Stuwage", [{ value: "EITHER", label: "Dek of ruim" }, { value: "DECK", label: "Dek" }, { value: "HOLD", label: "Ruim" }])}{field("linerReadyAt", "Gereed voor afvaart", "datetime-local")}</>}
          {values.mode === "ROAD" && <><div className="sm:col-span-2 font-medium pt-2">Wegtransport-eisen</div>{field("roadVolume", "Volume (m³)", "number", { min: "0" })}{field("roadLoading", "Laadmeter", "number", { min: "0" })}{field("roadPallets", "Palletplaatsen", "number", { min: "0" })}{field("roadEquipment", "Vereiste uitrusting (komma's)")}{field("roadTrailer", "Vereist trailertype")}{field("roadAdr", "ADR-klassen (komma's)")}{field("roadTempMin", "Minimumtemperatuur (°C)", "number")}{field("roadTempMax", "Maximumtemperatuur (°C)", "number")}{field("roadDirection", "Gewenste richting")}</>}
        </div>}
        {type === "OFFER" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1"><Label htmlFor="demo-assetId">Asset</Label><Select id="demo-assetId" value={values.assetId} onChange={(event) => setValue("assetId", event.target.value)}><option value="">Selecteer een bestaand asset…</option>{state.assets.filter((item) => item.companyId === company?.id && item.mode === offerMode).map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? "" : " (inactief)"}</option>)}</Select><p className="text-xs text-muted-foreground">Assets worden niet automatisch aangemaakt.</p></div>
          {field("offerCapacity", "Commerciële capaciteit (ton)", "number", { min: "0" })}{location("locationId", "Beschikbare locatie")}{field("direction", "Richting (optioneel)")}{field("availableFrom", "Beschikbaar vanaf", "datetime-local")}{field("availableUntil", "Beschikbaar tot", "datetime-local")}{field("cargoTypes", "Toegestane ladingtypes (komma's)")}{field("maximumPositioningDistanceKm", "Max. positionering (km)", "number", { min: "0" })}{select("visibility", "Zichtbaarheid", [{ value: "OPEN_NETWORK", label: "Open netwerk" }, { value: "PRIVATE", label: "Privé" }])}
          {offerMode === "ROAD" && <><div className="sm:col-span-2 font-medium pt-2">Wegbeschikbaarheid</div>{field("roadCurrentDelivery", "Huidige rit gereed", "datetime-local")}{field("roadExpectedAvailability", "Verwacht beschikbaar", "datetime-local")}{field("roadUncertainty", "Onzekerheid (minuten)", "number", { min: "0" })}{field("roadAvailableVolume", "Beschikbaar volume (m³)", "number", { min: "0" })}{field("roadAvailableLoading", "Beschikbare laadmeters", "number", { min: "0" })}{field("roadAvailablePallets", "Beschikbare palletplaatsen", "number", { min: "0" })}{field("offerEquipment", "Uitrusting (komma's)")}{field("offerTrailer", "Trailertype")}{field("offerAdr", "ADR-klassen (komma's)")}{field("offerTempMin", "Min. temperatuur (°C)", "number")}{field("offerTempMax", "Max. temperatuur (°C)", "number")}{field("offerDirection", "Voorkeursrichting")}</>}
          {offerMode === "DEEPSEA" && <><div className="sm:col-span-2 font-medium pt-2">Handmatige positioneringsschatting</div>{field("deepseaTravelDays", "Handmatige reisdagen", "number", { min: "0" })}{field("deepseaUncertaintyDays", "Vertrekonzekerheid (dagen)", "number", { min: "0" })}{field("deepseaBufferDays", "Positioneringsbuffer (dagen)", "number", { min: "0" })}{field("deepseaDistance", "Max. geschatte afstand (km)", "number", { min: "0" })}{select("deepseaRoute", "Route-intentie", ["UNSPECIFIED", "DIRECT", "SUEZ", "PANAMA", "CAPE_GOOD_HOPE", "OTHER"].map((item) => ({ value: item, label: item })))}</>}
        </div>}
        {type === "DEPARTURE" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field("serviceName", "Servicenaam")}{field("departureCapacity", "Capaciteit (ton)", "number", { min: "0" })}{location("originId", "Oorsprong")}{location("destinationId", "Bestemming")}{field("cargoCutoffAt", "Cargo cutoff", "datetime-local")}{field("departureAt", "Vertrek", "datetime-local")}{select("visibility", "Zichtbaarheid", [{ value: "OPEN_NETWORK", label: "Open netwerk" }, { value: "PRIVATE", label: "Privé" }])}<div className="sm:col-span-2 font-medium pt-2">Gepubliceerde breakbulk-capaciteit</div>
          <div className="flex items-center gap-2 h-9"><Input id="demo-serviceVesselActive" type="checkbox" checked={values.serviceVesselActive} onChange={(event) => setValue("serviceVesselActive", event.target.checked)} /><Label htmlFor="demo-serviceVesselActive">Schip actief</Label></div>{field("serviceCommercialTonnes", "Commerciële tonnen", "number", { min: "0" })}{field("serviceMaxPieceWeight", "Max. stukgewicht (ton)", "number", { min: "0" })}{field("serviceMaxPieceLength", "Max. stuklengte (m)", "number", { min: "0" })}{field("serviceMaxPieceWidth", "Max. stukbreedte (m)", "number", { min: "0" })}{field("serviceMaxPieceHeight", "Max. stukhoogte (m)", "number", { min: "0" })}{field("serviceLifting", "Hijsvermogen (ton)", "number", { min: "0" })}{select("serviceStowage", "Stuwage", [{ value: "EITHER", label: "Dek of ruim" }, { value: "DECK", label: "Dek" }, { value: "HOLD", label: "Ruim" }])}{field("serviceCargoTypes", "Geaccepteerde typen (komma's)")}
        </div>}
        {type === "ASSET" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field("assetName", "Naam / referentie")}<div className="space-y-1"><Label htmlFor="demo-assetMode">Modus</Label><Select id="demo-assetMode" value={values.assetMode} disabled={Boolean(existingAsset)} onChange={(event) => setValue("assetMode", event.target.value as WorldAsset["mode"])}>{["INLAND", "DEEPSEA", "ROAD"].map((item) => <option key={item} value={item}>{item}</option>)}</Select></div>{field("assetType", "Type")}{field("assetCapacity", "Capaciteit (ton)", "number", { min: "0" })}{field("assetEquipment", "Uitrusting (komma's)")}<div className="flex items-center gap-2 h-9"><Input id="demo-assetActive" type="checkbox" checked={values.assetActive} onChange={(event) => setValue("assetActive", event.target.checked)} /><Label htmlFor="demo-assetActive">Asset actief voor nieuwe kansen</Label></div>
          {assetMode === "ROAD" && <><div className="sm:col-span-2 font-medium pt-2">Wegprofiel</div>{field("assetPayload", "Laadvermogen (ton)", "number", { min: "0" })}{field("assetVolume", "Volume (m³)", "number", { min: "0" })}{field("assetLoading", "Laadmeters", "number", { min: "0" })}{field("assetPallets", "Palletplaatsen", "number", { min: "0" })}{field("assetTrailer", "Trailertype")}{field("assetAdr", "ADR-klassen (komma's)")}{field("assetTempMin", "Min. temperatuur (°C)", "number")}{field("assetTempMax", "Max. temperatuur (°C)", "number")}<div className="space-y-1"><Label htmlFor="demo-assignedDriverId">Toegewezen chauffeur</Label><Select id="demo-assignedDriverId" value={values.assignedDriverId} onChange={(event) => setValue("assignedDriverId", event.target.value)}><option value="">Geen</option>{state.users.filter((item) => item.companyId === company?.id && item.role === "DRIVER").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></div></>}
          {assetMode === "DEEPSEA" && <><div className="sm:col-span-2 font-medium pt-2">Deepsea-schipprofiel</div>{select("vesselClass", "Schipklasse", ["HANDYSIZE", "HANDYMAX", "SUPRAMAX", "ULTRAMAX", "PANAMAX", "KAMSARMAX", "POST_PANAMAX", "CAPESIZE", "NEWCASTLEMAX", "OTHER"].map((item) => ({ value: item, label: item })))}{field("vesselDwt", "DWT (ton)", "number", { min: "0" })}{field("vesselDraft", "Zomerdiepgang (m)", "number", { min: "0" })}{field("vesselGear", "Laadgerei")}</>}
        </div>}
        <div className="flex flex-wrap gap-3 pt-2"><Button type="button" onClick={() => save(false)} id="demo-save-draft">Opslaan</Button>{type !== "ASSET" && <Button type="button" className="bg-green-600 hover:bg-green-700" onClick={() => save(true)} id="demo-save-publish">Opslaan & publiceren</Button>}<Button type="button" variant="outline" onClick={onCancel}>Annuleren</Button></div>
      </CardContent>
    </Card>
  );
}