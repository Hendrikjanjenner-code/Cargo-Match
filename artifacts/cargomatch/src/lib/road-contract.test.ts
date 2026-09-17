import assert from "node:assert/strict";
import test from "node:test";
import {
  CreateRoadCapacityBody,
  CreateRoadCargoBody,
  CreateRoadAssetBody,
  UpdateRoadAssetBody,
} from "../../../../lib/api-zod/src/generated/api";
import { roadAssetFormPayload, roadAssetTypes, roadDriverActions, roadProjectionViewModel, type RoadAssignment } from "./road-api";

const assetId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const destinationId = "33333333-3333-4333-8333-333333333333";

test("driver opportunity controls remain available independently of confirmation and previous flags", () => {
  for (const status of ["ASSIGNED", "CONFIRMED", "FLAGGED"] as const) {
    const assignment = { status, confirmedAt: status === "CONFIRMED" ? "2030-01-01T10:00:00Z" : null } as RoadAssignment;
    assert.equal(roadDriverActions(assignment, "NEW").canFlag, true);
    assert.equal(roadDriverActions(assignment, "INTEREST_SENT").canFlag, true);
    assert.equal(roadDriverActions(assignment, "CONNECTED").canFlag, false);
    assert.equal(roadDriverActions(assignment, "NEW").canConfirm, status !== "CONFIRMED");
  }
  assert.deepEqual(roadDriverActions(undefined, "NEW"), { canConfirm: false, canFlag: false });
});

test("the actual asset form omits blank create temperatures but clears them on edit", () => {
  const fields = {
    assetType: "TRUCK_TRAILER_COMBINATION", assetName: "Road Pilot 24t Unit",
    payloadTonnes: "24", volumeCubicMetres: "90", loadingMetres: "13",
    palletPositions: "33", equipment: "", adrClasses: "",
    temperatureMinCelsius: "", temperatureMaxCelsius: "",
  };
  const created = roadAssetFormPayload(fields, false);
  assert.equal(CreateRoadAssetBody.safeParse(created).success, true);
  assert.equal(created.temperatureMinCelsius, undefined);
  const edited = roadAssetFormPayload(fields, true);
  assert.equal(UpdateRoadAssetBody.safeParse(edited).success, true);
  assert.equal(edited.temperatureMinCelsius, null);
});

test("asset select option values stay transport enum-safe while labels remain readable", () => {
  assert.deepEqual(roadAssetTypes, ["TRUCK", "TRACTOR", "TRAILER", "TRUCK_TRAILER_COMBINATION"]);
  const renderedValues = roadAssetTypes.map((type) => type);
  assert.equal(renderedValues.includes("TRUCK_TRAILER_COMBINATION"), true);
  assert.equal(renderedValues.includes("TRUCK TRAILER COMBINATION"), false);
});

test("ROAD form payloads match the generated flat capacity and nested cargo contracts", () => {
  const capacity = CreateRoadCapacityBody.safeParse({
    roadAssetId: assetId,
    currentDeliveryLocationId: locationId,
    currentDeliveryExpectedAt: "2030-01-01T10:00:00.000Z",
    expectedAvailabilityLocationId: destinationId,
    expectedAvailabilityAt: "2030-01-01T14:00:00.000Z",
    availabilityUncertaintyMinutes: 30,
    availabilitySource: "MANUAL",
    availableCapacityTonnes: 12,
    availableVolumeCubicMetres: 60,
    availableLoadingMetres: 13.6,
    availablePalletPositions: 33,
    cargoCompatibility: ["ALL"],
    visibility: "OPEN_NETWORK",
    listingStatus: "DRAFT",
  });
  assert.equal(capacity.success, true);
  if (!capacity.success) return;
  assert.equal("roadExtension" in capacity.data, false);

  const cargo = CreateRoadCargoBody.safeParse({
    cargoName: "Contract test cargo",
    cargoType: "GENERAL",
    weightTonnes: 12,
    loadingLocationId: locationId,
    destinationLocationId: destinationId,
    loadingFrom: "2030-01-02T08:00:00.000Z",
    loadingUntil: "2030-01-02T12:00:00.000Z",
    visibility: "OPEN_NETWORK",
    listingStatus: "DRAFT",
    roadRequirements: {
      volumeCubicMetres: 60,
      loadingMetres: 13.6,
      palletPositions: 33,
      requiredEquipment: [],
      adrClasses: [],
    },
  });
  assert.equal(cargo.success, true);
});

test("road projection view model keeps two opportunities distinguishable without sensitive values", () => {
  const first = roadProjectionViewModel({
    projection: {
      cargoTypeBand: "General cargo", originRegion: "Rotterdam region", destinationRegion: "Ruhr region",
      loadingDateBand: "early Jan 2030", loadingTimeWindowBand: "Morning · Short window",
      weightBand: "5–15 t", equipmentBand: "Loading assistance", temperatureBand: "Ambient",
      adrBand: "No ADR indicated", dimensionalRequirementsBand: "20–50 m³; 5–10 lm; 10–25 pallets",
      freeAreaBand: "Rotterdam region", freeTimeBand: "Within 24 hours", freeCapacityBand: "15–25 t",
      capacityEquipmentBand: "Loading assistance", capacityTemperatureBand: "Ambient", capacityAdrBand: "No ADR indicated",
    },
  });
  const second = roadProjectionViewModel({
    projection: {
      ...first,
      originRegion: "Brabant region",
      destinationRegion: "Limburg region",
      weightBand: "15–25 t",
      temperatureBand: "Chilled",
      freeAreaBand: "Brabant region",
    },
  });
  assert.ok(first && second);
  assert.notDeepEqual(first, second);
  assert.equal(JSON.stringify(first).includes("Customer name"), false);
  assert.equal(JSON.stringify(first).includes("exact depot"), false);
  assert.equal(first.loadingTimeWindowBand.includes("14:17"), false);
});