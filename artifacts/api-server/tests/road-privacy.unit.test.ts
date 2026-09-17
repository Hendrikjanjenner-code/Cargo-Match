import assert from "node:assert/strict";
import test from "node:test";
import { anonymousCapacity, anonymousCargo, matchScore } from "../src/lib/privacy";
import { hasRoadCommercialAuthority, type CurrentMembership } from "../src/lib/http";

test("road commercial permission never follows from operational membership", () => {
  const current = (role: string, active = true) => ({
    membership: { role, active },
  }) as CurrentMembership;
  assert.equal(hasRoadCommercialAuthority(current("MEMBER")), false);
  assert.equal(hasRoadCommercialAuthority(current("OWNER")), true);
  assert.equal(hasRoadCommercialAuthority(current("ADMIN")), true);
  assert.equal(hasRoadCommercialAuthority(current("ADMIN", false)), false);
});

test("road anonymous projections do not require a vessel or disclose identifying fields", () => {
  const from = new Date("2030-01-01T14:17:00Z");
  const until = new Date("2030-01-01T18:49:00Z");
  const location = { region: "Noord-Brabant", name: "Private exact depot" } as any;
  const capacity = anonymousCapacity({
    id: "capacity",
    transportMode: "ROAD",
    availableFrom: from,
    availableUntil: until,
    availableCapacityTonnes: 13.713,
    preferredDirection: "Private route",
    maximumPositioningDistanceKm: 73,
    cargoCompatibility: ["Private commodity"],
    notes: "Private planner note",
    companyId: "Private carrier",
  } as any, null, location);
  const cargo = anonymousCargo({
    id: "cargo",
    transportMode: "ROAD",
    cargoType: "general",
    cargoName: "Private cargo",
    companyId: "Private shipper",
    requiredVesselType: null,
    weightTonnes: 11.919,
    loadingFrom: from,
    loadingUntil: until,
  } as any, location, location);
  assert.equal(capacity.vesselType, null);
  assert.equal(capacity.tonnageBand, "5–15 t");
  assert.equal(cargo.tonnageBand, "5–15 t");
  const serialized = JSON.stringify({ capacity, cargo });
  for (const privateValue of ["Private", "13.713", "11.919", "14:17", "18:49"]) {
    assert.equal(serialized.includes(privateValue), false, privateValue);
  }
});

test("road shared score remains provisional and never relays unrecognized evaluation data", () => {
  const score = matchScore({
    totalScore: 80,
    distanceScore: 20,
    timingScore: 20,
    capacityScore: 20,
    vesselTypeScore: 0,
    directionScore: 10,
    cargoCompatibilityScore: 10,
    calculationVersion: "road-v1",
    evaluationInputs: {
      exactLocation: "Private depot",
      distanceBand: "Private exact distance",
      timingBand: "Private timestamp",
    },
  } as any);
  assert.equal(score.provisional, true);
  assert.equal(score.components.vesselTypeScore, 0);
  assert.equal(JSON.stringify(score).includes("Private"), false);
});