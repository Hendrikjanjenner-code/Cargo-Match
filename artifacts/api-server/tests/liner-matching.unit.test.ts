import assert from "node:assert/strict";
import test from "node:test";

import { evaluateLinerEligibility } from "../src/services/liner";

const now = new Date("2030-01-01T00:00:00.000Z");
const originId = "00000000-0000-4000-8000-000000000001";
const destinationId = "00000000-0000-4000-8000-000000000002";

function linerPair(overrides: Record<string, any> = {}) {
  const cargo = {
    id: "00000000-0000-4000-8000-000000000010",
    companyId: "00000000-0000-4000-8000-000000000100",
    cargoName: "Generator",
    cargoType: "PROJECT_CARGO",
    pieceCount: 2,
    totalWeightTonnes: 20,
    pieceWeightTonnes: 10,
    pieceLengthMetres: 8,
    pieceWidthMetres: 3,
    pieceHeightMetres: 3,
    requiredLiftingTonnes: 12,
    requiredStowage: "HOLD",
    originLocationId: originId,
    destinationLocationId: destinationId,
    readyAt: new Date("2030-01-10T00:00:00.000Z"),
    visibility: "OPEN_NETWORK",
    listingStatus: "ACTIVE",
  };
  const service = {
    id: "00000000-0000-4000-8000-000000000020",
    companyId: "00000000-0000-4000-8000-000000000101",
    serviceName: "Asia project service",
    tradeLane: "Asia",
    visibility: "OPEN_NETWORK",
    listingStatus: "ACTIVE",
  };
  const sailing = {
    id: "00000000-0000-4000-8000-000000000030",
    serviceId: service.id,
    linerVesselId: "00000000-0000-4000-8000-000000000040",
    voyageReference: "P-001",
    departureAt: new Date("2030-01-20T00:00:00.000Z"),
    cargoCutoffAt: new Date("2030-01-15T00:00:00.000Z"),
    visibility: "OPEN_NETWORK",
    listingStatus: "ACTIVE",
  };
  const capacity = {
    sailingId: sailing.id,
    availableCommercialTonnes: 20,
    maximumPieceWeightTonnes: 10,
    maximumPieceLengthMetres: 8,
    maximumPieceWidthMetres: 3,
    maximumPieceHeightMetres: 3,
    liftingCapacityTonnes: 12,
    stowage: "HOLD",
    acceptedCargoTypes: ["PROJECT_CARGO"],
  };
  const company = {
    name: "Company", country: "SG", activities: ["SHIPPER"], status: "ACTIVE",
  };
  return {
    cargo: { ...cargo, ...overrides.cargo },
    service: { ...service, ...overrides.service },
    sailing: { ...sailing, ...overrides.sailing },
    capacity: { ...capacity, ...overrides.capacity },
    vessel: { id: sailing.linerVesselId, companyId: service.companyId, vesselName: "MV Actual", imoNumber: "9300001", active: true, ...overrides.vessel },
    cargoCompany: { id: cargo.companyId, ...company, ...overrides.cargoCompany },
    serviceCompany: { id: service.companyId, ...company, name: "Carrier", activities: ["CARRIER"], ...overrides.serviceCompany },
    origin: { id: originId, active: true, ...overrides.origin },
    destination: { id: destinationId, active: true, ...overrides.destination },
    rotation: overrides.rotation ?? [
      { sailingId: sailing.id, locationId: originId, sequence: 1, estimatedArrival: new Date("2030-01-19T00:00:00.000Z"), estimatedDeparture: new Date("2030-01-19T12:00:00.000Z") },
      { sailingId: sailing.id, locationId: destinationId, sequence: 2, estimatedArrival: new Date("2030-01-23T00:00:00.000Z"), estimatedDeparture: new Date("2030-01-23T12:00:00.000Z") },
    ],
  } as any;
}

test("liner eligibility accepts exact commercial capacity and dimensions at the boundary", () => {
  assert.deepEqual(evaluateLinerEligibility(linerPair(), now), { eligible: true, originSequence: 1, destinationSequence: 2 });
});

test("liner eligibility rejects cutoff equality and cargo not ready by cutoff", () => {
  assert.equal(evaluateLinerEligibility(linerPair({ sailing: { cargoCutoffAt: now } }), now).eligible, false);
  assert.deepEqual(evaluateLinerEligibility(linerPair({ cargo: { readyAt: new Date("2030-01-15T00:00:00.001Z") } }), now), { eligible: false, reason: "cutoff_or_readiness_incompatible" });
});

test("liner eligibility requires an ordered origin-before-destination rotation", () => {
  assert.deepEqual(evaluateLinerEligibility(linerPair({ rotation: [
    { locationId: destinationId, sequence: 1, estimatedArrival: now, estimatedDeparture: new Date("2030-01-19T12:00:00.000Z") },
    { locationId: originId, sequence: 2, estimatedArrival: now, estimatedDeparture: new Date("2030-01-20T12:00:00.000Z") },
  ] }), now), { eligible: false, reason: "rotation_does_not_serve_ready_origin_before_destination" });
});

test("liner eligibility rejects capacity and piece limits beyond their exact boundaries", () => {
  assert.equal(evaluateLinerEligibility(linerPair({ cargo: { totalWeightTonnes: 20.01 } }), now).eligible, false);
  assert.equal(evaluateLinerEligibility(linerPair({ cargo: { pieceLengthMetres: 8.01 } }), now).eligible, false);
});

test("liner eligibility enforces cargo company activity, carrier activity, stowage, and lifting", () => {
  assert.equal(evaluateLinerEligibility(linerPair({ cargoCompany: { activities: ["CARRIER"] } }), now).eligible, false);
  assert.equal(evaluateLinerEligibility(linerPair({ serviceCompany: { activities: ["SHIPPER"] } }), now).eligible, false);
  assert.equal(evaluateLinerEligibility(linerPair({ cargo: { requiredStowage: "DECK" } }), now).eligible, false);
  assert.equal(evaluateLinerEligibility(linerPair({ cargo: { requiredLiftingTonnes: 12.01 } }), now).eligible, false);
});

test("liner eligibility disallows same-company pairs and vessels not owned by the service carrier", () => {
  assert.equal(evaluateLinerEligibility(linerPair({ serviceCompany: { id: "00000000-0000-4000-8000-000000000100" } }), now).eligible, false);
  assert.equal(evaluateLinerEligibility(linerPair({ vessel: { companyId: "00000000-0000-4000-8000-000000000999" } }), now).eligible, false);
});