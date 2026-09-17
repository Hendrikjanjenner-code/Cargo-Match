import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateEligibility,
  scoreDeepseaEligiblePair,
  scoreEligiblePair,
  scoreRoadEligiblePair,
} from "../../../api-server/src/services/matching";
import { evaluateLinerEligibility } from "../../../api-server/src/services/liner";
import { evaluateWorldDeparture, evaluateWorldOffer } from "./world-matching";
import type { WorldState } from "./world-types";

const now = new Date("2030-01-01T00:00:00.000Z");
const iso = (value: string) => new Date(value).toISOString();
const loc = (id: string, name = id) => ({ id, name, region: "Netherlands", country: "NL", latitude: 51.2, longitude: 6.8, active: true });
const origin = loc("origin", "Duisburg");
const destination = { ...loc("destination", "Eindhoven"), latitude: 52.1, longitude: 5.1 };
const companies = [
  { id: "shipper", name: "Shipper", mode: "INLAND", activities: ["SHIPPER"], status: "ACTIVE", fictional: true as const },
  { id: "carrier", name: "Carrier", mode: "INLAND", activities: ["CARRIER"], status: "ACTIVE", fictional: true as const },
];
const state = (cargo: any, asset: any, offer?: any, departure?: any): WorldState => ({
  version: 2, createdAt: now.toISOString(), updatedAt: now.toISOString(), companies,
  users: [], locations: [origin, destination], cargos: [cargo], assets: asset ? [asset] : [],
  offers: offer ? [offer] : [], departures: departure ? [departure] : [], matches: [], messages: [], operationalEvidence: [],
});

test("world inland adapter shares the core eligibility and exact score fixture", () => {
  const cargo = { id: "cargo", mode: "INLAND", companyId: "shipper", cargoType: "dry bulk", weightTonnes: 10, origin, destination, readyFrom: iso("2030-01-02T14:00Z"), readyUntil: iso("2030-01-02T18:00Z"), listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", requiredVesselType: "DRY_CARGO" };
  const asset = { id: "asset", mode: "INLAND", companyId: "carrier", name: "Barge", type: "DRY_CARGO", active: true, capacityTonnes: 20, equipment: [] };
  const offer = { id: "offer", mode: "INLAND", companyId: "carrier", assetId: "asset", location: origin, availableFrom: iso("2030-01-02T13:00Z"), availableUntil: iso("2030-01-03T14:00Z"), capacityTonnes: 12, cargoTypes: ["all"], maximumPositioningDistanceKm: 100, direction: "Germany", listingStatus: "ACTIVE", visibility: "OPEN_NETWORK" };
  const core = {
    cargo: { ...cargo, companyStatus: "ACTIVE", loadingFrom: new Date(cargo.readyFrom), loadingUntil: new Date(cargo.readyUntil) },
    capacity: { ...offer, companyStatus: "ACTIVE", availableFrom: new Date(offer.availableFrom), availableUntil: new Date(offer.availableUntil), availableCapacityTonnes: offer.capacityTonnes, cargoCompatibility: offer.cargoTypes, preferredDirection: offer.direction },
    vessel: { id: asset.id, active: true, vesselType: asset.type, totalCapacityTonnes: asset.capacityTonnes },
    loading: origin, destination, capacityLocation: origin, cargoCompany: { id: "shipper", status: "ACTIVE" }, capacityCompany: { id: "carrier", status: "ACTIVE" },
  } as any;
  const expected = evaluateEligibility(core, now);
  const actual = evaluateWorldOffer(cargo, offer, state(cargo, asset, offer), now);
  assert.equal(actual.eligible, expected.eligible);
  assert.ok(expected.eligible && actual.eligible);
  assert.equal(actual.score, scoreEligiblePair(core, expected.distanceKm).totalScore);
  offer.capacityTonnes = 9;
  core.capacity.availableCapacityTonnes = 9;
  assert.equal(evaluateWorldOffer(cargo, offer, state(cargo, asset, offer), now).reason, evaluateEligibility(core, now).reason);
});

test("world deepsea adapter shares core hard limits and manual-estimate provenance", () => {
  const cargo = { id: "cargo", mode: "DEEPSEA", companyId: "shipper", cargoType: "iron ore", weightTonnes: 75, origin, destination, readyFrom: iso("2030-01-20"), readyUntil: iso("2030-01-25"), listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", requiredVesselType: "DRY_CARGO", deepseaRequirement: { quantityTolerancePercent: 10, minimumVesselDwtTonnes: 70, maximumVesselDwtTonnes: 90, maximumDraftMetres: 14, requiredGear: "gearless", preferredVesselClass: "KAMSARMAX" } };
  const asset = { id: "asset", mode: "DEEPSEA", companyId: "carrier", name: "MV", type: "DRY_CARGO", active: true, capacityTonnes: 75, equipment: [], deepseaProfile: { vesselClass: "KAMSARMAX", dwtTonnes: 82, summerDraftMetres: 13, gearConfiguration: "gearless" } };
  const offer = { id: "offer", mode: "DEEPSEA", companyId: "carrier", assetId: "asset", location: origin, availableFrom: iso("2030-01-15"), availableUntil: iso("2030-02-01"), capacityTonnes: 75, cargoTypes: ["iron ore"], maximumPositioningDistanceKm: 100, listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", deepseaAvailability: { manualPositioningDays: 2, departureUncertaintyDays: 0, positioningBufferDays: 0, approximateMaxDistanceKm: 100 } };
  const core = {
    cargo: { transportMode: "DEEPSEA_BULK", companyId: "shipper", cargoType: cargo.cargoType, weightTonnes: cargo.weightTonnes, loadingFrom: new Date(cargo.readyFrom), loadingUntil: new Date(cargo.readyUntil), listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", requiredVesselType: "DRY_CARGO" },
    capacity: { transportMode: "DEEPSEA_BULK", companyId: "carrier", availableFrom: new Date(offer.availableFrom), availableUntil: new Date(offer.availableUntil), availableCapacityTonnes: 75, cargoCompatibility: offer.cargoTypes, maximumPositioningDistanceKm: 100, listingStatus: "ACTIVE", visibility: "OPEN_NETWORK" },
    vessel: { active: true, vesselType: "DRY_CARGO", transportMode: "DEEPSEA_BULK" }, loading: origin, destination, capacityLocation: origin, cargoCompany: { id: "shipper", status: "ACTIVE" }, capacityCompany: { id: "carrier", status: "ACTIVE" },
    deepseaProfile: asset.deepseaProfile, deepseaRequirement: cargo.deepseaRequirement, deepseaExtension: { ...offer.deepseaAvailability, approximateMaxDistanceKm: 100 },
  } as any;
  const expected = evaluateEligibility(core, now);
  const actual = evaluateWorldOffer(cargo, offer, state(cargo, asset, offer), now);
  assert.equal(actual.eligible, expected.eligible);
  assert.ok(actual.eligible && actual.provisional);
  assert.equal(actual.evaluationInputs?.verification, "NOT_VERIFIED");
  assert.equal(actual.score, scoreDeepseaEligiblePair(core, 0, now).totalScore);
  asset.deepseaProfile.gearConfiguration = "geared";
  core.deepseaProfile.gearConfiguration = "geared";
  assert.equal(evaluateWorldOffer(cargo, offer, state(cargo, asset, offer), now).reason, evaluateEligibility(core, now).reason);
});

test("world road adapter shares core equipment, deadhead, direction, and availability rules", () => {
  const cargo = { id: "cargo", mode: "ROAD", companyId: "shipper", cargoType: "general", weightTonnes: 10, origin, destination, readyFrom: iso("2030-01-01T14:00Z"), readyUntil: iso("2030-01-01T18:00Z"), listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", roadRequirements: { volumeCubicMetres: 20, loadingMetres: 5, palletPositions: 10, requiredEquipment: ["liftgate"], adrClasses: ["3"], direction: "Netherlands" } };
  const asset = { id: "asset", mode: "ROAD", companyId: "carrier", name: "Truck", type: "TRUCK", active: true, capacityTonnes: 20, equipment: ["liftgate"], roadProfile: { payloadTonnes: 20, volumeCubicMetres: 90, loadingMetres: 13.6, palletPositions: 33, adrClasses: ["3"] } };
  const offer = { id: "offer", mode: "ROAD", companyId: "carrier", assetId: "asset", location: origin, availableFrom: iso("2030-01-01T13:30Z"), availableUntil: iso("2030-01-02T14:00Z"), capacityTonnes: 12, cargoTypes: ["all"], maximumPositioningDistanceKm: 100, listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", roadAvailability: { currentDeliveryExpectedAt: iso("2030-01-01T13:00Z"), expectedAvailabilityAt: iso("2030-01-01T14:00Z"), availabilityUncertaintyMinutes: 30, availableVolumeCubicMetres: 80, availableLoadingMetres: 12, availablePalletPositions: 30, equipment: ["liftgate"], adrClasses: ["3"], preferredDirection: "Netherlands" } };
  const core = {
    cargo: { transportMode: "ROAD", companyId: "shipper", cargoType: cargo.cargoType, weightTonnes: 10, loadingFrom: new Date(cargo.readyFrom), loadingUntil: new Date(cargo.readyUntil), listingStatus: "ACTIVE", visibility: "OPEN_NETWORK" },
    capacity: { transportMode: "ROAD", companyId: "carrier", availableFrom: new Date(offer.availableFrom), availableUntil: new Date(offer.availableUntil), availableCapacityTonnes: 12, cargoCompatibility: ["all"], maximumPositioningDistanceKm: 100, listingStatus: "ACTIVE", visibility: "OPEN_NETWORK" },
    vessel: null, loading: origin, destination, capacityLocation: origin, cargoCompany: { id: "shipper", status: "ACTIVE" }, capacityCompany: { id: "carrier", status: "ACTIVE" },
    roadAsset: { id: "asset", companyId: "carrier", active: true, payloadTonnes: 20, volumeCubicMetres: 90, loadingMetres: 13.6, palletPositions: 33, equipment: ["liftgate"], adrClasses: ["3"] },
    roadRequirement: cargo.roadRequirements,
    roadExtension: { roadAssetId: "asset", expectedAvailabilityLocationId: "origin", currentDeliveryExpectedAt: new Date(offer.roadAvailability.currentDeliveryExpectedAt), expectedAvailabilityAt: new Date(offer.roadAvailability.expectedAvailabilityAt), availabilityUncertaintyMinutes: 30, availableVolumeCubicMetres: 80, availableLoadingMetres: 12, availablePalletPositions: 30, equipment: ["liftgate"], adrClasses: ["3"], preferredDirection: "Netherlands" },
  } as any;
  const expected = evaluateEligibility(core, now);
  const actual = evaluateWorldOffer(cargo, offer, state(cargo, asset, offer), now);
  assert.equal(actual.eligible, expected.eligible);
  assert.ok(expected.eligible && actual.eligible);
  assert.equal(actual.score, scoreRoadEligiblePair(core, expected.distanceKm).totalScore);
  // A planner's offer cannot invent or enlarge the registered vehicle's
  // temperature capability, even when it fits the cargo's requested range.
  Object.assign(cargo.roadRequirements, { temperatureMinCelsius: 2, temperatureMaxCelsius: 8 });
  const temperatureCases = [
    { name: "unknown asset capability", assetMin: undefined, assetMax: undefined, offerMin: 2, offerMax: 8, eligible: false },
    { name: "offer below registered minimum", assetMin: 2, assetMax: 8, offerMin: 0, offerMax: 8, eligible: false },
    { name: "offer above registered maximum", assetMin: 2, assetMax: 8, offerMin: 2, offerMax: 10, eligible: false },
    { name: "unknown minimum boundary", assetMin: undefined, assetMax: 8, offerMin: 2, offerMax: 8, eligible: false },
    { name: "unknown maximum boundary", assetMin: 2, assetMax: undefined, offerMin: 2, offerMax: 8, eligible: false },
    { name: "exact registered capability", assetMin: 2, assetMax: 8, offerMin: 2, offerMax: 8, eligible: true },
    { name: "narrower valid offer", assetMin: 0, assetMax: 10, offerMin: 2, offerMax: 8, eligible: true },
    { name: "inherit registered capability", assetMin: 2, assetMax: 8, offerMin: undefined, offerMax: undefined, eligible: true },
  ];
  for (const item of temperatureCases) {
    const registered = { temperatureMinCelsius: item.assetMin, temperatureMaxCelsius: item.assetMax };
    const advertised = { temperatureMinCelsius: item.offerMin, temperatureMaxCelsius: item.offerMax };
    Object.assign(asset.roadProfile, registered);
    Object.assign(core.roadAsset, registered);
    Object.assign(offer.roadAvailability, advertised);
    Object.assign(core.roadExtension, advertised);
    const coreResult = evaluateEligibility(core, now);
    const demoResult = evaluateWorldOffer(cargo, offer, state(cargo, asset, offer), now);
    assert.equal(coreResult.eligible, item.eligible, `core: ${item.name}`);
    assert.equal(demoResult.eligible, coreResult.eligible, `demo: ${item.name}`);
    if (!coreResult.eligible) {
      assert.equal(coreResult.reason, "temperature_capability_overclaimed", item.name);
      assert.equal(demoResult.reason, coreResult.reason, item.name);
    }
  }
  offer.location = destination;
  offer.roadAvailability.expectedAvailabilityAt = iso("2030-01-01T14:00Z");
  core.capacityLocation = destination;
  core.roadExtension.expectedAvailabilityLocationId = "destination";
  assert.equal(evaluateWorldOffer(cargo, offer, state(cargo, asset, offer), now).reason, evaluateEligibility(core, now).reason);
});

test("world liner adapter shares core cutoff, conventional cargo, and ordered rotation rules", () => {
  const cargo = { id: "cargo", mode: "LINER", companyId: "shipper", cargoType: "BREAKBULK", weightTonnes: 20, origin, destination, readyFrom: iso("2030-01-10"), readyUntil: iso("2030-01-11"), listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", linerRequirements: { cargoType: "BREAKBULK", pieceCount: 2, pieceWeightTonnes: 10, pieceLengthMetres: 8, pieceWidthMetres: 3, pieceHeightMetres: 3, requiredLiftingTonnes: 12, requiredStowage: "HOLD", readyAt: iso("2030-01-10") } };
  const departure = { id: "sailing", companyId: "carrier", serviceName: "Conventional service", origin, destination, departureAt: iso("2030-01-20"), cargoCutoffAt: iso("2030-01-15"), capacityTonnes: 20, listingStatus: "ACTIVE", visibility: "OPEN_NETWORK", linerService: { vesselActive: true, vesselCompanyId: "carrier", portRotation: [{ locationId: "origin", sequence: 1, estimatedDeparture: iso("2030-01-19T12:00Z") }, { locationId: "destination", sequence: 2, estimatedDeparture: iso("2030-01-23T12:00Z") }], availableCommercialTonnes: 20, maximumPieceWeightTonnes: 10, maximumPieceLengthMetres: 8, maximumPieceWidthMetres: 3, maximumPieceHeightMetres: 3, liftingCapacityTonnes: 12, stowage: "HOLD", acceptedCargoTypes: ["BREAKBULK"] } };
  const linerCompanies = [{ ...companies[0], activities: ["SHIPPER"] }, { ...companies[1], activities: ["CARRIER"] }];
  const world = { ...state(cargo, null, undefined, departure), companies: linerCompanies };
  const core = {
    cargo: { companyId: "shipper", cargoType: "BREAKBULK", totalWeightTonnes: 20, pieceCount: 2, pieceWeightTonnes: 10, pieceLengthMetres: 8, pieceWidthMetres: 3, pieceHeightMetres: 3, requiredLiftingTonnes: 12, requiredStowage: "HOLD", originLocationId: "origin", destinationLocationId: "destination", readyAt: new Date(cargo.linerRequirements.readyAt), listingStatus: "ACTIVE", visibility: "OPEN_NETWORK" },
    sailing: { departureAt: new Date(departure.departureAt), cargoCutoffAt: new Date(departure.cargoCutoffAt), listingStatus: "ACTIVE", visibility: "OPEN_NETWORK" },
    service: { companyId: "carrier", listingStatus: "ACTIVE", visibility: "OPEN_NETWORK" }, vessel: { active: true, companyId: "carrier" }, capacity: departure.linerService,
    cargoCompany: { id: "shipper", status: "ACTIVE", activities: ["SHIPPER"] }, serviceCompany: { id: "carrier", status: "ACTIVE", activities: ["CARRIER"] }, origin, destination,
    rotation: departure.linerService.portRotation.map((call) => ({ ...call, estimatedDeparture: new Date(call.estimatedDeparture) })),
  } as any;
  const expected = evaluateLinerEligibility(core, now);
  const actual = evaluateWorldDeparture(cargo, departure, world, now);
  assert.equal(actual.eligible, expected.eligible);
  departure.linerService.portRotation = [
    { ...departure.linerService.portRotation[0], sequence: 2 },
    { ...departure.linerService.portRotation[1], sequence: 1 },
  ];
  core.rotation = departure.linerService.portRotation.map((call) => ({ ...call, estimatedDeparture: new Date(call.estimatedDeparture) }));
  assert.equal(evaluateWorldDeparture(cargo, departure, world, now).reason, evaluateLinerEligibility(core, now).reason);
  departure.linerService.portRotation = [
    { locationId: "origin", sequence: 1, estimatedDeparture: iso("2030-01-19T12:00Z") },
    { locationId: "destination", sequence: 2, estimatedDeparture: iso("2030-01-23T12:00Z") },
  ];
  core.rotation = departure.linerService.portRotation.map((call) => ({ ...call, estimatedDeparture: new Date(call.estimatedDeparture) }));
  cargo.linerRequirements.cargoType = "BREAKBULK";
  cargo.cargoType = "CONTAINER";
  core.cargo.cargoType = "CONTAINER";
  assert.equal(evaluateWorldDeparture(cargo, departure, world, now).reason, evaluateLinerEligibility(core, now).reason);
});