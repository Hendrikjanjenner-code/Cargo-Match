import assert from "node:assert/strict";
import test from "node:test";

import { evaluateEligibility, scoreEligiblePair } from "../src/services/matching";
import { anonymousCargo, matchScore } from "../src/lib/privacy";

const now = new Date("2030-01-01T00:00:00.000Z");
const location = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Rotterdam",
  country: "NL",
  region: "South Holland",
  latitude: 51.9244,
  longitude: 4.4777,
  privacyLatitude: 51.9244,
  privacyLongitude: 4.4777,
  locationType: "PORT" as const,
  active: true,
};

function pair(overrides: Record<string, unknown> = {}) {
  const cargo = {
    id: "00000000-0000-4000-8000-000000000010",
    companyId: "00000000-0000-4000-8000-000000000100",
    cargoName: "Private customer cargo",
    cargoType: "dry bulk",
    weightTonnes: 1_000,
    loadingLocationId: location.id,
    destinationLocationId: "00000000-0000-4000-8000-000000000002",
    loadingFrom: new Date("2030-01-02T00:00:00.000Z"),
    loadingUntil: new Date("2030-01-04T00:00:00.000Z"),
    expectedUnloadingDate: null,
    requiredVesselType: "DRY_CARGO" as const,
    specialRequirements: null,
    visibility: "OPEN_NETWORK" as const,
    notes: "Never disclose this",
    listingStatus: "ACTIVE" as const,
    createdAt: now,
    updatedAt: now,
  };
  const capacity = {
    id: "00000000-0000-4000-8000-000000000011",
    companyId: "00000000-0000-4000-8000-000000000101",
    vesselId: "00000000-0000-4000-8000-000000000012",
    locationId: location.id,
    availableFrom: new Date("2030-01-01T00:00:00.000Z"),
    availableUntil: new Date("2030-01-05T00:00:00.000Z"),
    availabilityType: "FULLY_EMPTY" as const,
    availableCapacityTonnes: 1_500,
    cargoCompatibility: ["dry bulk"],
    preferredDirection: "Rhine corridor",
    maximumPositioningDistanceKm: 50,
    visibility: "OPEN_NETWORK" as const,
    notes: "Private capacity notes",
    listingStatus: "ACTIVE" as const,
    createdAt: now,
    updatedAt: now,
  };
  const vessel = {
    id: capacity.vesselId,
    companyId: capacity.companyId,
    vesselName: "Private Vessel",
    eniNumber: "ENI-SECRET",
    vesselType: "DRY_CARGO" as const,
    totalCapacityTonnes: 1_500,
    lengthMetres: null,
    widthMetres: null,
    maximumDraftMetres: null,
    cargoCompatibility: ["dry bulk"],
    homeRegion: "South Holland",
    notes: "Private vessel notes",
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  const destination = {
    ...location,
    id: cargo.destinationLocationId,
    name: "Duisburg",
    region: "North Rhine-Westphalia",
    country: "DE",
    latitude: 51.4344,
    longitude: 6.7623,
  };
  const cargoCompany = {
    id: cargo.companyId,
    name: "Cargo Owner",
    country: "NL",
    activities: ["SHIPPER"],
    primaryContactName: "Private Contact",
    email: "owner@example.invalid",
    phone: "+31000000000",
    vatRegistrationNumber: null,
    verified: false,
    status: "ACTIVE" as const,
    createdAt: now,
    updatedAt: now,
  };
  const capacityCompany = {
    ...cargoCompany,
    id: capacity.companyId,
    name: "Capacity Owner",
    activities: ["CARRIER"],
  };
  return {
    cargo: { ...cargo, ...(overrides.cargo as object) },
    capacity: { ...capacity, ...(overrides.capacity as object) },
    vessel: { ...vessel, ...(overrides.vessel as object) },
    loading: location,
    destination,
    capacityLocation: {
      ...location,
      ...((overrides.capacityLocation as object | undefined) ?? {}),
    },
    cargoCompany,
    capacityCompany,
  } as any;
}

test("eligibility rejects insufficient capacity, wrong vessel type, and distance", () => {
  assert.equal(
    evaluateEligibility(
      pair({ capacity: { availableCapacityTonnes: 500 } }),
      now,
    ).eligible,
    false,
  );
  assert.equal(
    evaluateEligibility(
      pair({ vessel: { vesselType: "TANKER" } }),
      now,
    ).eligible,
    false,
  );
  assert.equal(
    evaluateEligibility(
      pair({
        capacityLocation: {
          ...location,
          latitude: 52.3676,
          longitude: 4.9041,
        },
        capacity: { maximumPositioningDistanceKm: 1 },
      }),
      now,
    ).eligible,
    false,
  );
});

test("eligibility rejects stored capacity claims above vessel capacity", () => {
  const result = evaluateEligibility(
    pair({
      capacity: { availableCapacityTonnes: 1_501 },
      vessel: { totalCapacityTonnes: 1_500 },
    }),
    now,
  );
  assert.deepEqual(result, {
    eligible: false,
    reason: "invalid_physical_capacity",
  });
  assert.equal(
    evaluateEligibility(
      pair({ cargo: { weightTonnes: Number.NaN } }),
      now,
    ).eligible,
    false,
  );
});

test("eligible pairs are scored only after eligibility and components remain bounded", () => {
  const input = pair();
  const eligibility = evaluateEligibility(input, now);
  assert.equal(eligibility.eligible, true);
  if (!eligibility.eligible) return;
  const score = scoreEligiblePair(input, eligibility.distanceKm);
  assert.ok(score.totalScore >= 0 && score.totalScore <= 100);
  assert.ok(score.distanceScore >= 0 && score.distanceScore <= 100);
  assert.ok(score.evaluationInputs.distanceBand.includes("km"));
});

test("anonymous cargo and score serializers never expose exact private inputs", () => {
  const input = pair();
  const anonymous = anonymousCargo(input.cargo, input.loading, input.destination);
  assert.equal("cargoName" in anonymous, false);
  assert.equal("weightTonnes" in anonymous, false);
  assert.equal("notes" in anonymous, false);
  assert.equal("loadingFrom" in anonymous, false);
  const score = matchScore({
    totalScore: 81.234,
    distanceScore: 81.234,
    timingScore: 96.6,
    capacityScore: 100,
    vesselTypeScore: 100,
    directionScore: 100,
    cargoCompatibilityScore: 100,
    evaluationInputs: {
      distanceBand: "17.2 km exact",
      timingBand: "exact 2030-01-02",
      capacityBand: "1000 tonnes exact",
      vesselTypeBand: "Type compatible",
      directionBand: "Direction aligned",
      cargoCompatibilityBand: "Cargo compatible",
    },
    calculationVersion: "v1",
    calculatedAt: now,
    explanation: "Safe",
  } as never);
  assert.equal(score.totalScore, 81);
  assert.equal(score.components.timingScore, 97);
  assert.equal(matchScore({ totalScore: 96.6 } as never).totalScore, 97);
  assert.equal(score.evaluationInputs.distanceBand, "Broad distance band");
  assert.equal(score.evaluationInputs.timingBand, "Timing fit");
  assert.equal(score.evaluationInputs.capacityBand, "Capacity band");
});