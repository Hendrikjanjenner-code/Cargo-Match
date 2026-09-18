import { evaluateEligibility, scoreEligiblePair, scoreDeepseaEligiblePair, scoreRoadEligiblePair, type PairInput } from "../matching";
import { evaluateLinerEligibility, type LinerPair } from "../liner";
import type { Asset, DemoState, Listing } from "./types";

type Place = {region: string; latitude: number; longitude: number};
/** Explicit adapter into pure production matchers. These transient objects
 * are NEVER passed to a repository or persisted in real tables. Identity and
 * all dates/technical constraints come from the isolated demo state. Database
 * row metadata omitted here is not consumed by the pure calculation. */
export function corePair(state: DemoState, cargo: Listing, capacity: Listing, asset: Asset, places: Record<string, Place>): PairInput {
  const c = cargo.technical ?? {}, p = capacity.technical ?? {}, a = asset.technical ?? {};
  const transportMode = cargo.mode === "DEEPSEA" ? "DEEPSEA_BULK" : cargo.mode === "ROAD" ? "ROAD" : "INLAND_WATERWAY";
  const loc = (name: string) => ({id: name, name, country: "", ...places[name], active: !!places[name]});
  const company = (id: string) => ({...state.companies.find(c => c.id === id), status: "ACTIVE"});
  return {
    cargo: {id: cargo.id, companyId: cargo.companyId, transportMode, cargoName: cargo.name, cargoType: c.cargoType ?? "", weightTonnes: cargo.quantity, requiredVesselType: c.requiredVesselType, loadingFrom: new Date(cargo.availableFrom), loadingUntil: new Date(cargo.availableUntil), listingStatus: cargo.status, visibility: cargo.visibility},
    capacity: {id: capacity.id, companyId: capacity.companyId, transportMode, vesselId: asset.id, locationId: capacity.origin, availableFrom: new Date(capacity.availableFrom), availableUntil: new Date(capacity.availableUntil), availableCapacityTonnes: capacity.quantity, maximumPositioningDistanceKm: p.maximumPositioningDistanceKm ?? Number.NaN, cargoCompatibility: p.cargoType ? [p.cargoType] : [], preferredDirection: p.preferredDirection ?? "", listingStatus: capacity.status, visibility: capacity.visibility},
    vessel: cargo.mode === "ROAD" ? null : {id: asset.id, companyId: asset.companyId, transportMode, vesselType: a.vesselType, totalCapacityTonnes: asset.capacity, active: true},
    loading: loc(cargo.origin), destination: loc(cargo.destination), capacityLocation: loc(capacity.origin),
    cargoCompany: company(cargo.companyId), capacityCompany: company(capacity.companyId),
    deepseaProfile: cargo.mode === "DEEPSEA" ? {vesselId: asset.id, vesselClass: a.vesselClass, dwtTonnes: asset.capacity, summerDraftMetres: a.draft ?? null, gearConfiguration: a.gear ?? null} : null,
    deepseaRequirement: cargo.mode === "DEEPSEA" ? {cargoListingId: cargo.id, quantityTolerancePercent: c.quantityTolerancePercent ?? 0, minimumVesselDwtTonnes: c.minimumDwt ?? null, maximumVesselDwtTonnes: c.maximumDwt ?? null, maximumDraftMetres: c.maxDraft ?? null, requiredGear: c.gear ?? null, preferredVesselClass: c.vesselClass ?? null} : null,
    deepseaExtension: cargo.mode === "DEEPSEA" ? {capacityOfferId: capacity.id, manualPositioningDays: p.manualPositioningDays ?? null, departureUncertaintyDays: p.uncertaintyDays ?? null, positioningBufferDays: p.positioningBufferDays ?? null, approximateMaxDistanceKm: p.maximumPositioningDistanceKm ?? null, routeChoice: "UNSPECIFIED", routeNotes: null, previousVoyageContext: null} : null,
    roadAsset: cargo.mode === "ROAD" ? {id: asset.id, companyId: asset.companyId, active: true, payloadTonnes: asset.capacity, volumeCubicMetres: asset.volume, loadingMetres: a.loadingMetres, palletPositions: a.pallets, equipment: asset.equipment, trailerType: asset.type, temperatureMinCelsius: a.temperatureMin ?? null, temperatureMaxCelsius: a.temperatureMax ?? null, adrClasses: a.adrClasses ?? []} : null,
    roadRequirement: cargo.mode === "ROAD" ? {cargoListingId: cargo.id, volumeCubicMetres: cargo.volume ?? null, loadingMetres: c.loadingMetres ?? null, palletPositions: c.pallets ?? null, requiredEquipment: cargo.equipment, requiredTrailerType: c.requiredTrailerType ?? null, temperatureMinCelsius: c.temperatureMin ?? null, temperatureMaxCelsius: c.temperatureMax ?? null, adrClasses: c.adrClasses ?? [], direction: c.preferredDirection ?? null} : null,
    roadExtension: cargo.mode === "ROAD" ? {capacityOfferId: capacity.id, roadAssetId: asset.id, expectedAvailabilityLocationId: capacity.origin, currentDeliveryExpectedAt: new Date(p.currentDeliveryExpectedAt ?? "invalid"), expectedAvailabilityAt: new Date(p.expectedAvailabilityAt ?? "invalid"), availabilityUncertaintyMinutes: p.availabilityUncertaintyMinutes ?? Number.NaN, availableVolumeCubicMetres: capacity.volume, availableLoadingMetres: p.loadingMetres, availablePalletPositions: p.pallets, equipment: capacity.equipment, trailerType: asset.type, temperatureMinCelsius: p.temperatureMin ?? null, temperatureMaxCelsius: p.temperatureMax ?? null, adrClasses: p.adrClasses ?? [], preferredDirection: p.preferredDirection ?? null} : null,
  } as unknown as PairInput;
}
export function linerPair(state: DemoState, cargo: Listing, capacity: Listing, asset: Asset): LinerPair {
  const c = cargo.technical ?? {}, p = capacity.technical ?? {};
  return {
    cargo: {id: cargo.id, companyId: cargo.companyId, listingStatus: cargo.status, visibility: cargo.visibility, readyAt: new Date(cargo.availableFrom), originLocationId: cargo.origin, destinationLocationId: cargo.destination, totalWeightTonnes: cargo.quantity, pieceWeightTonnes: c.pieceWeight, pieceCount: c.pieceCount, pieceLengthMetres: c.pieceLength, pieceWidthMetres: c.pieceWidth, pieceHeightMetres: c.pieceHeight, requiredLiftingTonnes: c.requiredLifting ?? null, requiredStowage: c.stowage, cargoType: c.cargoType},
    sailing: {id: capacity.id, listingStatus: capacity.status, visibility: capacity.visibility, cargoCutoffAt: new Date(p.cutoffAt ?? "invalid"), departureAt: new Date(capacity.availableFrom)},
    service: {companyId: capacity.companyId, listingStatus: capacity.status, visibility: capacity.visibility},
    vessel: {companyId: asset.companyId, active: true},
    capacity: {availableCommercialTonnes: capacity.quantity, maximumPieceWeightTonnes: p.maxPieceWeight, maximumPieceLengthMetres: p.maxPieceLength, maximumPieceWidthMetres: p.maxPieceWidth, maximumPieceHeightMetres: p.maxPieceHeight, liftingCapacityTonnes: p.liftingCapacity, stowage: p.stowage, acceptedCargoTypes: p.cargoType ? [p.cargoType] : []},
    cargoCompany: {...state.companies.find(c => c.id === cargo.companyId), status: "ACTIVE"},
    serviceCompany: {...state.companies.find(c => c.id === capacity.companyId), status: "ACTIVE"},
    origin: {id: cargo.origin, active: true}, destination: {id: cargo.destination, active: true},
    rotation: [{locationId: capacity.origin, sequence: 1, estimatedDeparture: new Date(capacity.availableFrom)}, {locationId: capacity.destination, sequence: 2, estimatedDeparture: new Date(capacity.availableUntil)}],
  } as unknown as LinerPair;
}
export function coreEvaluation(state: DemoState, cargo: Listing, capacity: Listing, asset: Asset, places: Record<string, Place>, now: Date) {
  if (cargo.mode === "LINER") {
    const pair = linerPair(state, cargo, capacity, asset);
    const result = evaluateLinerEligibility(pair, now);
    const dimension = Math.min(pair.capacity.maximumPieceWeightTonnes / pair.cargo.pieceWeightTonnes, pair.capacity.maximumPieceLengthMetres / pair.cargo.pieceLengthMetres, pair.capacity.maximumPieceWidthMetres / pair.cargo.pieceWidthMetres, pair.capacity.maximumPieceHeightMetres / pair.cargo.pieceHeightMetres) * 100;
    const weight = Math.min(100, capacity.quantity / cargo.quantity * 100);
    const lifting = pair.cargo.requiredLiftingTonnes == null ? 100 : Math.min(100, pair.capacity.liftingCapacityTonnes / pair.cargo.requiredLiftingTonnes * 100);
    return {eligible: result.eligible, score: result.eligible ? Math.min(100, dimension) * .25 + weight * .2 + lifting * .15 + 40 : 0};
  }
  const pair = corePair(state, cargo, capacity, asset, places);
  const result = evaluateEligibility(pair, now);
  if (!result.eligible) return {eligible: false, score: 0};
  const score = cargo.mode === "DEEPSEA" ? scoreDeepseaEligiblePair(pair, result.distanceKm, now) : cargo.mode === "ROAD" ? scoreRoadEligiblePair(pair, result.distanceKm) : scoreEligiblePair(pair, result.distanceKm);
  return {eligible: true, score: score.totalScore};
}