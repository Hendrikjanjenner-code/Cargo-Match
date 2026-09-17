import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateRoadEligibility,
  scoreRoadEligiblePair,
  type PairInput,
} from "../src/services/matching";

function pair(overrides: Record<string, unknown> = {}) {
  const now = new Date("2030-01-01T10:00:00.000Z");
  const cargo = {
    transportMode: "ROAD",
    listingStatus: "ACTIVE",
    visibility: "OPEN_NETWORK",
    cargoType: "general",
    loadingFrom: new Date("2030-01-01T14:00:00.000Z"),
    loadingUntil: new Date("2030-01-01T18:00:00.000Z"),
    weightTonnes: 10,
    ...overrides,
  };
  const capacity = {
    transportMode: "ROAD",
    listingStatus: "ACTIVE",
    visibility: "OPEN_NETWORK",
    availableFrom: new Date("2030-01-01T13:30:00.000Z"),
    availableUntil: new Date("2030-01-02T14:00:00.000Z"),
    availableCapacityTonnes: 12,
    cargoCompatibility: ["ALL"],
    maximumPositioningDistanceKm: 100,
  };
  return {
    cargo,
    capacity,
    vessel: null,
    loading: { active: true, latitude: 51.2, longitude: 6.8 },
    destination: { active: true, latitude: 52.1, longitude: 5.1, name: "Eindhoven", region: "Netherlands", country: "NL" },
    capacityLocation: { active: true, latitude: 51.2, longitude: 6.8 },
    cargoCompany: { id: "shipper", status: "ACTIVE" },
    capacityCompany: { id: "carrier", status: "ACTIVE" },
    deepseaProfile: null,
    deepseaRequirement: null,
    deepseaExtension: null,
    roadAsset: {
      id: "asset",
      companyId: "carrier",
      active: true,
      payloadTonnes: 20,
      volumeCubicMetres: 90,
      loadingMetres: 13.6,
      palletPositions: 33,
      equipment: ["liftgate"],
      adrClasses: ["3"],
      temperatureMinCelsius: -20,
      temperatureMaxCelsius: 20,
    },
    roadRequirement: {
      volumeCubicMetres: 20,
      loadingMetres: 5,
      palletPositions: 10,
      requiredEquipment: ["liftgate"],
      adrClasses: ["3"],
    },
    roadExtension: {
      roadAssetId: "asset",
      expectedAvailabilityAt: new Date("2030-01-01T14:00:00.000Z"),
      currentDeliveryExpectedAt: new Date("2030-01-01T13:00:00.000Z"),
      availabilityUncertaintyMinutes: 30,
      availableVolumeCubicMetres: 80,
      availableLoadingMetres: 12,
      availablePalletPositions: 30,
      equipment: ["liftgate"],
      adrClasses: ["3"],
      temperatureMinCelsius: -18,
      temperatureMaxCelsius: 18,
      preferredDirection: "Netherlands",
    },
  } as unknown as PairInput;
}

test("road matching accepts four simultaneous capacity limits without a vessel", () => {
  const candidate = pair();
  const result = evaluateRoadEligibility(candidate, new Date("2030-01-01T10:00:00.000Z"));
  assert.equal(result.eligible, true);
  if (result.eligible) {
    const score = scoreRoadEligiblePair(candidate, result.distanceKm);
    assert.equal(score.vesselTypeScore, 0);
    assert.equal(score.evaluationInputs.mode, "ROAD");
  }
});

test("road matching rejects a single insufficient capacity dimension", () => {
  const result = evaluateRoadEligibility(
    pair({ weightTonnes: 10 }),
    new Date("2030-01-01T10:00:00.000Z"),
  );
  assert.equal(result.eligible, true);
  const constrained = pair();
  (constrained.roadRequirement as any).palletPositions = 31;
  const rejected = evaluateRoadEligibility(constrained, new Date("2030-01-01T10:00:00.000Z"));
  assert.deepEqual(rejected, { eligible: false, reason: "insufficient_road_dimensions" });
});

test("road matching remains provisional when availability is manually uncertain", () => {
  const candidate = pair();
  const result = evaluateRoadEligibility(candidate, new Date("2030-01-01T10:00:00.000Z"));
  assert.equal(result.eligible, true);
  assert.equal(result.provisional, true);
});

test("road discovery invariants reject withdrawn, private, and inactive opportunities", () => {
  const candidate = pair();
  candidate.cargo.listingStatus = "WITHDRAWN";
  assert.equal(evaluateRoadEligibility(candidate).eligible, false);
  candidate.cargo.listingStatus = "ACTIVE";
  candidate.cargo.visibility = "PRIVATE";
  assert.equal(evaluateRoadEligibility(candidate).eligible, false);
  candidate.cargo.visibility = "OPEN_NETWORK";
  candidate.capacity.listingStatus = "WITHDRAWN";
  assert.equal(evaluateRoadEligibility(candidate).eligible, false);
  candidate.capacity.listingStatus = "ACTIVE";
  candidate.roadAsset!.active = false;
  assert.equal(evaluateRoadEligibility(candidate).eligible, false);
  candidate.roadAsset!.active = true;
  candidate.capacityCompany.status = "SUSPENDED";
  assert.equal(evaluateRoadEligibility(candidate).eligible, false);
});

test("every road dimension, equipment and ADR requirement is a hard limit", () => {
  const checks: Array<(candidate: PairInput) => void> = [
    (candidate) => { candidate.cargo.weightTonnes = 13; },
    (candidate) => { candidate.roadRequirement!.volumeCubicMetres = 81; },
    (candidate) => { candidate.roadRequirement!.loadingMetres = 12.1; },
    (candidate) => { candidate.roadRequirement!.palletPositions = 31; },
    (candidate) => { candidate.roadRequirement!.requiredEquipment = ["crane"]; },
    (candidate) => { candidate.roadRequirement!.adrClasses = ["1"]; },
    (candidate) => { candidate.roadExtension!.availableVolumeCubicMetres = NaN; },
    (candidate) => { candidate.roadExtension!.availableLoadingMetres = -1; },
    (candidate) => { candidate.capacity.transportMode = "INLAND_WATERWAY"; },
    (candidate) => { candidate.roadExtension!.temperatureMinCelsius = -30; },
  ];
  for (const alter of checks) {
    const candidate = pair();
    alter(candidate);
    assert.equal(evaluateRoadEligibility(candidate, new Date("2030-01-01T10:00:00Z")).eligible, false);
  }
});

test("future availability allows waiting, not loading before uncertain completion or after offer expiry", () => {
  const candidate = pair();
  candidate.cargo.loadingFrom = new Date("2030-01-01T16:00:00Z");
  candidate.capacity.availableUntil = new Date("2030-01-01T17:00:00Z");
  assert.equal(evaluateRoadEligibility(candidate, new Date("2030-01-01T10:00:00Z")).eligible, true);
  candidate.cargo.loadingUntil = new Date("2030-01-01T14:15:00Z");
  candidate.cargo.loadingFrom = new Date("2030-01-01T14:00:00Z");
  assert.equal(evaluateRoadEligibility(candidate, new Date("2030-01-01T10:00:00Z")).eligible, false);
  candidate.cargo.loadingFrom = new Date("2030-01-03T14:00:00Z");
  candidate.cargo.loadingUntil = new Date("2030-01-03T18:00:00Z");
  assert.equal(evaluateRoadEligibility(candidate, new Date("2030-01-01T10:00:00Z")).eligible, false);
});

test("road temperature requirements use registered capabilities when the offer does not narrow them", () => {
  const candidate = pair();
  candidate.roadExtension!.temperatureMinCelsius = null;
  candidate.roadExtension!.temperatureMaxCelsius = null;
  candidate.roadRequirement!.temperatureMinCelsius = 2;
  candidate.roadRequirement!.temperatureMaxCelsius = 8;
  assert.equal(evaluateRoadEligibility(candidate, new Date("2030-01-01T10:00:00Z")).eligible, true);
  candidate.roadAsset!.temperatureMinCelsius = null;
  candidate.roadAsset!.temperatureMaxCelsius = null;
  candidate.roadExtension!.temperatureMinCelsius = 2;
  candidate.roadExtension!.temperatureMaxCelsius = 8;
  assert.equal(evaluateRoadEligibility(candidate, new Date("2030-01-01T10:00:00Z")).eligible, false);
});

test("road equipment must contain the entire declared cargo temperature range", () => {
  for (const [minimum, maximum, eligible] of [
    [-5, 4, false], [4, 10, false], [-5, 10, false],
    [2, 8, true], [3, 7, true], [9, 10, false],
    [4, 4, true], [null, 4, true], [1, null, false],
  ] as const) {
    const candidate = pair();
    candidate.roadAsset!.temperatureMinCelsius = 2;
    candidate.roadAsset!.temperatureMaxCelsius = 8;
    candidate.roadExtension!.temperatureMinCelsius = 2;
    candidate.roadExtension!.temperatureMaxCelsius = 8;
    candidate.roadRequirement!.temperatureMinCelsius = minimum;
    candidate.roadRequirement!.temperatureMaxCelsius = maximum;
    const result = evaluateRoadEligibility(candidate, new Date("2030-01-01T10:00:00Z"));
    assert.equal(result.eligible, eligible, `${minimum} to ${maximum} against 2 to 8`);
  }
  const unknown = pair();
  unknown.roadAsset!.temperatureMinCelsius = null;
  unknown.roadExtension!.temperatureMinCelsius = null;
  unknown.roadRequirement!.temperatureMinCelsius = -5;
  unknown.roadRequirement!.temperatureMaxCelsius = 4;
  assert.equal(evaluateRoadEligibility(unknown, new Date("2030-01-01T10:00:00Z")).eligible, false);
});

test("road loading and availability windows must overlap for a positive duration", () => {
  const candidate = pair();
  candidate.cargo.loadingUntil = new Date("2030-01-01T14:30:00Z");
  assert.deepEqual(evaluateRoadEligibility(candidate, new Date("2030-01-01T10:00:00Z")),
    { eligible: false, reason: "future_availability_outside_window" });
  candidate.cargo.loadingUntil = new Date("2030-01-01T14:31:00Z");
  assert.equal(evaluateRoadEligibility(candidate, new Date("2030-01-01T10:00:00Z")).eligible, true);
  candidate.cargo.loadingFrom = new Date(candidate.capacity.availableUntil);
  candidate.cargo.loadingUntil = new Date("2030-01-02T15:00:00Z");
  assert.equal(evaluateRoadEligibility(candidate, new Date("2030-01-01T10:00:00Z")).eligible, false);
});