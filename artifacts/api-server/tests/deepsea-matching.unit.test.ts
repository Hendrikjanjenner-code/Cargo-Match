import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateEligibility,
  scoreDeepseaEligiblePair,
} from "../src/services/matching";
import { anonymousCapacity } from "../src/lib/privacy";
import { validateDeepseaCargoRequirement } from "../src/services/deepsea";

const now = new Date("2030-01-01T00:00:00.000Z");
const port = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Singapore",
  country: "SG",
  region: "Singapore",
  latitude: 1.2644,
  longitude: 103.82,
  privacyLatitude: 1.2644,
  privacyLongitude: 103.82,
  locationType: "PORT" as const,
  active: true,
};

function deepseaPair(overrides: Record<string, unknown> = {}) {
  const cargo = {
    id: "00000000-0000-4000-8000-000000000010",
    companyId: "00000000-0000-4000-8000-000000000100",
    transportMode: "DEEPSEA_BULK" as const,
    cargoName: "Dry bulk",
    cargoType: "iron ore",
    weightTonnes: 75_000,
    loadingLocationId: port.id,
    destinationLocationId: "00000000-0000-4000-8000-000000000002",
    loadingFrom: new Date("2030-01-20T00:00:00.000Z"),
    loadingUntil: new Date("2030-01-25T00:00:00.000Z"),
    expectedUnloadingDate: null,
    requiredVesselType: "DRY_CARGO" as const,
    specialRequirements: null,
    visibility: "OPEN_NETWORK" as const,
    notes: null,
    listingStatus: "ACTIVE" as const,
    createdAt: now,
    updatedAt: now,
  };
  const capacity = {
    id: "00000000-0000-4000-8000-000000000011",
    companyId: "00000000-0000-4000-8000-000000000101",
    vesselId: "00000000-0000-4000-8000-000000000012",
    locationId: port.id,
    transportMode: "DEEPSEA_BULK" as const,
    availableFrom: new Date("2030-01-15T00:00:00.000Z"),
    availableUntil: new Date("2030-02-01T00:00:00.000Z"),
    availabilityType: "FULLY_EMPTY" as const,
    availableCapacityTonnes: 75_000,
    cargoCompatibility: ["iron ore"],
    preferredDirection: "Asia",
    maximumPositioningDistanceKm: 100,
    visibility: "OPEN_NETWORK" as const,
    availabilityConfidence: "EXPECTED" as const,
    notes: null,
    listingStatus: "ACTIVE" as const,
    createdAt: now,
    updatedAt: now,
  };
  const vessel = {
    id: capacity.vesselId,
    companyId: capacity.companyId,
    transportMode: "DEEPSEA_BULK" as const,
    vesselName: "MV Pilot",
    eniNumber: null,
    vesselType: "DRY_CARGO" as const,
    totalCapacityTonnes: 75_000,
    lengthMetres: null,
    widthMetres: null,
    maximumDraftMetres: null,
    cargoCompatibility: ["iron ore"],
    homeRegion: "Asia",
    notes: null,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  const company = {
    id: cargo.companyId,
    name: "Cargo",
    country: "SG",
    activities: ["SHIPPER"],
    primaryContactName: "Contact",
    email: "cargo@example.invalid",
    phone: "+6500000000",
    vatRegistrationNumber: null,
    verified: false,
    status: "ACTIVE" as const,
    createdAt: now,
    updatedAt: now,
  };
  return {
    cargo: { ...cargo, ...(overrides.cargo as object) },
    capacity: { ...capacity, ...(overrides.capacity as object) },
    vessel: { ...vessel, ...(overrides.vessel as object) },
    loading: port,
    destination: { ...port, id: cargo.destinationLocationId, name: "Qingdao" },
    capacityLocation: {
      ...port,
      ...(overrides.capacityLocation as object),
    },
    cargoCompany: company,
    capacityCompany: { ...company, id: capacity.companyId, name: "Owner" },
    deepseaProfile: {
      vesselId: vessel.id,
      vesselClass: "KAMSARMAX" as const,
      dwtTonnes: 82_000,
      summerDraftMetres: 13,
      gearConfiguration: "gearless",
      createdAt: now,
      updatedAt: now,
      ...(overrides.deepseaProfile as object),
    },
    deepseaRequirement: {
      cargoListingId: cargo.id,
      quantityTolerancePercent: 10,
      minimumVesselDwtTonnes: 70_000,
      maximumVesselDwtTonnes: 90_000,
      maximumDraftMetres: 14,
      requiredGear: null,
      preferredVesselClass: null,
      createdAt: now,
      updatedAt: now,
      ...(overrides.deepseaRequirement as object),
    },
    deepseaExtension: {
      capacityOfferId: capacity.id,
      manualPositioningDays: 2,
      approximateMaxDistanceKm: 100,
      previousVoyageContext: null,
      createdAt: now,
      updatedAt: now,
      ...(overrides.deepseaExtension as object),
    },
  } as any;
}

test("deepsea matching is isolated from inland rows", () => {
  const pair = deepseaPair({
    cargo: { transportMode: "INLAND_WATERWAY" },
  });
  assert.deepEqual(evaluateEligibility(pair, now), {
    eligible: false,
    reason: "transport_mode_mismatch",
  });
});

test("deepsea checks vessel DWT separately from offered cargo tonnage", () => {
  const pair = deepseaPair({
    capacity: { availableCapacityTonnes: 80_000 },
    deepseaProfile: { dwtTonnes: 79_000 },
  });
  assert.equal(evaluateEligibility(pair, now).eligible, false);
});

test("unknown required gear or draft excludes deepsea eligibility", () => {
  const gearPair = deepseaPair({
    deepseaRequirement: { requiredGear: "cranes" },
    deepseaProfile: { gearConfiguration: null },
  });
  assert.deepEqual(evaluateEligibility(gearPair, now), {
    eligible: false,
    reason: "required_gear_unknown",
  });
  const draftPair = deepseaPair({
    deepseaProfile: { summerDraftMetres: null },
  });
  assert.deepEqual(evaluateEligibility(draftPair, now), {
    eligible: false,
    reason: "draft_incompatible",
  });
});

test("preferred vessel class is a score preference, while gear labels match exactly", () => {
  const preferredClassPair = deepseaPair({
    deepseaRequirement: { preferredVesselClass: "PANAMAX" },
  });
  const preferredClassResult = evaluateEligibility(preferredClassPair, now);
  assert.equal(preferredClassResult.eligible, true);
  if (preferredClassResult.eligible) {
    const score = scoreDeepseaEligiblePair(
      preferredClassPair,
      preferredClassResult.distanceKm,
    );
    assert.equal(score.vesselTypeScore, 0);
  }

  const substringGearPair = deepseaPair({
    deepseaRequirement: { requiredGear: "geared" },
    deepseaProfile: { gearConfiguration: "ungeared" },
  });
  assert.deepEqual(evaluateEligibility(substringGearPair, now), {
    eligible: false,
    reason: "gear_incompatible",
  });
  const normalizedGearPair = deepseaPair({
    deepseaRequirement: { requiredGear: "  SHIP CRANES " },
    deepseaProfile: { gearConfiguration: "ship cranes" },
  });
  assert.equal(evaluateEligibility(normalizedGearPair, now).eligible, true);
});

test("required vessel type remains a hard deepsea eligibility constraint", () => {
  const pair = deepseaPair({
    vessel: { vesselType: "TANKER" },
  });
  assert.deepEqual(evaluateEligibility(pair, now), {
    eligible: false,
    reason: "vessel_type_incompatible",
  });
});

test("quantity tolerance has a strict 100 percent boundary and defaults to zero", () => {
  assert.equal(validateDeepseaCargoRequirement({}), true);
  assert.equal(
    validateDeepseaCargoRequirement({ quantityTolerancePercent: 100 }),
    false,
  );
  const defaultRequirementPair = deepseaPair({
    deepseaRequirement: { quantityTolerancePercent: 0 },
    capacity: { availableCapacityTonnes: 34_999 },
  });
  assert.deepEqual(evaluateEligibility(defaultRequirementPair, now), {
    eligible: false,
    reason: "insufficient_cargo_tonnage",
  });

  const maxTolerancePair = deepseaPair({
    deepseaRequirement: { quantityTolerancePercent: 99.99 },
    capacity: { availableCapacityTonnes: 8 },
  });
  assert.equal(evaluateEligibility(maxTolerancePair, now).eligible, true);

  const invalidTolerancePair = deepseaPair({
    deepseaRequirement: { quantityTolerancePercent: 100 },
  });
  assert.deepEqual(evaluateEligibility(invalidTolerancePair, now), {
    eligible: false,
    reason: "invalid_quantity_tolerance",
  });
});

test("unknown positioning estimate remains provisional, not a verified route", () => {
  const pair = deepseaPair({
    deepseaExtension: { manualPositioningDays: null },
  });
  const result = evaluateEligibility(pair, now);
  assert.equal(result.eligible, true);
  if (result.eligible) {
    assert.equal(result.provisional, true);
    const score = scoreDeepseaEligiblePair(pair, result.distanceKm);
    assert.match(score.explanation, /provisional/i);
  }
});

test("privacy-safe deepsea capacity exposes bands and an explicit provisional flag", () => {
  const pair = deepseaPair({
    deepseaExtension: { manualPositioningDays: null },
  });
  const listing = anonymousCapacity(
    pair.capacity,
    pair.vessel,
    pair.capacityLocation,
    pair.deepseaProfile,
    pair.deepseaExtension,
  );
  assert.equal(listing.transportMode, "DEEPSEA_BULK");
  assert.equal(listing.provisional, true);
  assert.equal(listing.positioningConfidence, "PROVISIONAL");
  assert.equal(listing.dwtBand, "65–85k DWT");
  assert.equal("availableCapacityTonnes" in listing, false);
});

test("deepsea rejects a known positioning buffer that misses the laycan", () => {
  const pair = deepseaPair({
    capacity: {
      availableFrom: new Date("2030-01-24T00:00:00.000Z"),
      availableUntil: new Date("2030-01-24T12:00:00.000Z"),
    },
    deepseaExtension: { manualPositioningDays: 3 },
  });
  assert.deepEqual(evaluateEligibility(pair, now), {
    eligible: false,
    reason: "laycan_incompatible_with_positioning",
  });
});

test("deepsea uses approximate geodesic positioning bounds", () => {
  const pair = deepseaPair({
    capacityLocation: { latitude: 2 },
    deepseaExtension: { approximateMaxDistanceKm: 1 },
  });
  assert.deepEqual(evaluateEligibility(pair, now), {
    eligible: false,
    reason: "outside_approximate_positioning_distance",
  });
});