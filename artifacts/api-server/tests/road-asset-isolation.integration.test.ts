import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after, before } from "node:test";

import { inArray } from "drizzle-orm";
import app from "../src/app";
import { db, interestsTable, matchesTable } from "@workspace/db";
import {
  createTestIdentity,
  disposeTestIdentity,
} from "./support/testIdentity";

type Identity = Awaited<ReturnType<typeof createTestIdentity>>;
type ApiResponse = { status: number; body: any };

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let cargoOwner: Identity;
let targetRoadOwner: Identity;
let otherRoadOwner: Identity;
let inlandOwner: Identity;
let deepseaOwner: Identity;
let locations: Record<string, string> = {};

async function call(
  method: string,
  path: string,
  cookie?: string,
  body?: unknown,
): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function register(identity: Identity, name: string) {
  const response = await call("POST", "/api/company", identity.cookie, {
    name,
    country: "NL",
    activities: ["SHIPPER", "CARRIER"],
    primaryContactName: "Road isolation regression",
    email: `${identity.user.id}@example.invalid`,
    phone: "+31100000000",
    termsAccepted: true,
    privacyAccepted: true,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  identity.company = response.body;
}

function roadAssetPayload(name: string, equipment: string[], adrClasses: string[]) {
  return {
    assetType: "TRUCK_TRAILER_COMBINATION",
    assetName: name,
    payloadTonnes: 24,
    volumeCubicMetres: 90,
    loadingMetres: 13,
    palletPositions: 33,
    equipment,
    adrClasses,
  };
}

function roadCargoPayload(
  name: string,
  requiredEquipment: string[],
  adrClasses: string[],
) {
  return {
    cargoName: name,
    cargoType: "general",
    weightTonnes: 10,
    loadingLocationId: locations.Rotterdam,
    destinationLocationId: locations.Duisburg,
    loadingFrom: "2035-01-02T14:00:00.000Z",
    loadingUntil: "2035-01-02T18:00:00.000Z",
    visibility: "OPEN_NETWORK",
    listingStatus: "ACTIVE",
    roadRequirements: {
      volumeCubicMetres: 20,
      loadingMetres: 5,
      palletPositions: 10,
      requiredEquipment,
      adrClasses,
    },
  };
}

function roadCapacityPayload(roadAssetId: string) {
  return {
    roadAssetId,
    currentDeliveryLocationId: locations.Rotterdam,
    currentDeliveryExpectedAt: "2035-01-02T12:00:00.000Z",
    expectedAvailabilityLocationId: locations.Rotterdam,
    expectedAvailabilityAt: "2035-01-02T13:00:00.000Z",
    availabilityUncertaintyMinutes: 30,
    availableCapacityTonnes: 12,
    availableVolumeCubicMetres: 80,
    availableLoadingMetres: 12,
    availablePalletPositions: 30,
    equipment: [],
    adrClasses: [],
    preferredDirection: "Duisburg",
    maximumPositioningDistanceKm: 500,
    cargoCompatibility: ["ALL"],
    visibility: "OPEN_NETWORK",
    listingStatus: "ACTIVE",
  };
}

function inlandCargoPayload() {
  return {
    cargoName: "Isolation inland cargo",
    cargoType: "dry bulk",
    weightTonnes: 1_000,
    loadingLocationId: locations.Rotterdam,
    destinationLocationId: locations.Duisburg,
    loadingFrom: "2030-06-01T00:00:00.000Z",
    loadingUntil: "2030-06-03T00:00:00.000Z",
    expectedUnloadingDate: "2030-06-04",
    requiredVesselType: "DRY_CARGO",
    visibility: "OPEN_NETWORK",
    listingStatus: "ACTIVE",
  };
}

function inlandCapacityPayload(vesselId: string) {
  return {
    vesselId,
    locationId: locations.Rotterdam,
    availableFrom: "2030-05-30T00:00:00.000Z",
    availableUntil: "2030-06-05T00:00:00.000Z",
    availabilityType: "FULLY_EMPTY",
    availableCapacityTonnes: 1_500,
    cargoCompatibility: ["dry bulk"],
    preferredDirection: "Rhine corridor",
    maximumPositioningDistanceKm: 50,
    visibility: "OPEN_NETWORK",
    listingStatus: "ACTIVE",
  };
}

function deepseaVesselPayload() {
  return {
    transportMode: "DEEPSEA_BULK",
    vesselName: "MV Isolation Kamsarmax",
    vesselType: "DRY_CARGO",
    totalCapacityTonnes: 50_000,
    cargoCompatibility: ["iron ore dry bulk"],
    active: true,
    deepseaProfile: {
      vesselClass: "KAMSARMAX",
      dwtTonnes: 80_000,
      summerDraftMetres: 13,
      gearConfiguration: "ship cranes",
    },
  };
}

function deepseaCargoPayload() {
  return {
    transportMode: "DEEPSEA_BULK",
    cargoName: "Isolation deepsea cargo",
    cargoType: "iron ore dry bulk",
    weightTonnes: 35_000,
    loadingLocationId: locations.Singapore,
    destinationLocationId: locations.Qingdao,
    loadingFrom: "2030-06-01T00:00:00.000Z",
    loadingUntil: "2030-06-10T00:00:00.000Z",
    expectedUnloadingDate: "2030-06-20",
    requiredVesselType: "DRY_CARGO",
    visibility: "OPEN_NETWORK",
    listingStatus: "ACTIVE",
    deepseaRequirement: {
      quantityTolerancePercent: 10,
      minimumVesselDwtTonnes: 70_000,
      maximumVesselDwtTonnes: 90_000,
      maximumDraftMetres: 14,
      requiredGear: "ship cranes",
      preferredVesselClass: "KAMSARMAX",
    },
  };
}

function deepseaCapacityPayload(vesselId: string) {
  return {
    transportMode: "DEEPSEA_BULK",
    vesselId,
    locationId: locations.Singapore,
    availableFrom: "2030-05-20T00:00:00.000Z",
    availableUntil: "2030-06-30T00:00:00.000Z",
    availabilityType: "FULLY_EMPTY",
    availableCapacityTonnes: 40_000,
    cargoCompatibility: ["iron ore dry bulk"],
    preferredDirection: "Asia",
    maximumPositioningDistanceKm: 5_000,
    visibility: "OPEN_NETWORK",
    listingStatus: "ACTIVE",
    availabilityConfidence: "EXPECTED",
    deepseaExtension: {
      manualPositioningDays: null,
      routeChoice: "DIRECT",
      routeNotes: "manually selected route",
      departureUncertaintyDays: 0.5,
      positioningBufferDays: 1.25,
      approximateMaxDistanceKm: 5_000,
      previousVoyageContext: "Open position after an Asia-Pacific voyage",
    },
  };
}

async function findMatch(
  transportMode: string,
  cargoListingId: string,
  capacityOfferId: string,
) {
  const response = await call(
    "GET",
    `/api/matches?transportMode=${transportMode}&pageSize=100`,
    cargoOwner.cookie,
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const match = response.body.items.find(
    (item: any) =>
      item.cargoListingId === cargoListingId &&
      item.capacityOfferId === capacityOfferId,
  );
  assert.ok(match, JSON.stringify(response.body));
  return match;
}

async function interest(matchId: string) {
  const response = await call(
    "POST",
    `/api/matches/${matchId}/actions`,
    cargoOwner.cookie,
    { action: "INTEREST" },
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.status, "INTEREST_SENT");
}

async function databaseState(matchIds: string[]) {
  const [matches, interests] = await Promise.all([
    db
      .select({ id: matchesTable.id, status: matchesTable.status, isStale: matchesTable.isStale })
      .from(matchesTable)
      .where(inArray(matchesTable.id, matchIds)),
    db
      .select({
        matchId: interestsTable.matchId,
        status: interestsTable.status,
        companyId: interestsTable.companyId,
      })
      .from(interestsTable)
      .where(inArray(interestsTable.matchId, matchIds)),
  ]);
  return {
    matches: new Map(matches.map((row) => [row.id, row])),
    interests: new Map(interests.map((row) => [row.matchId, row])),
  };
}

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;

  cargoOwner = await createTestIdentity({ withCompany: false });
  targetRoadOwner = await createTestIdentity({ withCompany: false });
  otherRoadOwner = await createTestIdentity({ withCompany: false });
  inlandOwner = await createTestIdentity({ withCompany: false });
  deepseaOwner = await createTestIdentity({ withCompany: false });
  await register(cargoOwner, `Isolation Cargo ${cargoOwner.user.id.slice(-8)}`);
  await register(targetRoadOwner, `Isolation Target Road ${targetRoadOwner.user.id.slice(-8)}`);
  await register(otherRoadOwner, `Isolation Other Road ${otherRoadOwner.user.id.slice(-8)}`);
  await register(inlandOwner, `Isolation Inland ${inlandOwner.user.id.slice(-8)}`);
  await register(deepseaOwner, `Isolation Deepsea ${deepseaOwner.user.id.slice(-8)}`);

  const locationResponse = await call("GET", "/api/locations?pageSize=100");
  assert.equal(locationResponse.status, 200, JSON.stringify(locationResponse.body));
  for (const item of locationResponse.body.items) locations[item.name] = item.id;
  assert.ok(
    locations.Rotterdam &&
      locations.Duisburg &&
      locations.Singapore &&
      locations.Qingdao,
    "the reviewed catalogue location seed must be applied before integration tests",
  );
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const identity of [
    cargoOwner,
    targetRoadOwner,
    otherRoadOwner,
    inlandOwner,
    deepseaOwner,
  ]) {
    if (identity) await disposeTestIdentity(identity);
  }
});

test("ROAD asset recalculation isolates pending interests by asset", async () => {
  const targetAsset = await call(
    "POST",
    "/api/road/assets",
    targetRoadOwner.cookie,
    roadAssetPayload("Isolation target asset", ["liftgate"], ["3"]),
  );
  assert.equal(targetAsset.status, 201, JSON.stringify(targetAsset.body));

  const otherAsset = await call(
    "POST",
    "/api/road/assets",
    otherRoadOwner.cookie,
    roadAssetPayload("Isolation other asset", ["refrigerated"], ["9"]),
  );
  assert.equal(otherAsset.status, 201, JSON.stringify(otherAsset.body));

  const targetCargo = await call(
    "POST",
    "/api/road/cargo",
    cargoOwner.cookie,
    roadCargoPayload("Isolation target road cargo", ["liftgate"], ["3"]),
  );
  assert.equal(targetCargo.status, 201, JSON.stringify(targetCargo.body));
  const otherCargo = await call(
    "POST",
    "/api/road/cargo",
    cargoOwner.cookie,
    roadCargoPayload("Isolation other road cargo", ["refrigerated"], ["9"]),
  );
  assert.equal(otherCargo.status, 201, JSON.stringify(otherCargo.body));

  const targetCapacity = await call(
    "POST",
    "/api/road/capacity",
    targetRoadOwner.cookie,
    roadCapacityPayload(targetAsset.body.id),
  );
  assert.equal(targetCapacity.status, 201, JSON.stringify(targetCapacity.body));
  const otherCapacity = await call(
    "POST",
    "/api/road/capacity",
    otherRoadOwner.cookie,
    roadCapacityPayload(otherAsset.body.id),
  );
  assert.equal(otherCapacity.status, 201, JSON.stringify(otherCapacity.body));

  const inlandVessel = await call("POST", "/api/vessels", inlandOwner.cookie, {
    vesselName: "Isolation inland vessel",
    vesselType: "DRY_CARGO",
    totalCapacityTonnes: 2_000,
    cargoCompatibility: ["dry bulk"],
    active: true,
  });
  assert.equal(inlandVessel.status, 201, JSON.stringify(inlandVessel.body));
  const inlandCargo = await call(
    "POST",
    "/api/cargo",
    cargoOwner.cookie,
    inlandCargoPayload(),
  );
  assert.equal(inlandCargo.status, 201, JSON.stringify(inlandCargo.body));
  const inlandCapacity = await call(
    "POST",
    "/api/capacity",
    inlandOwner.cookie,
    inlandCapacityPayload(inlandVessel.body.id),
  );
  assert.equal(inlandCapacity.status, 201, JSON.stringify(inlandCapacity.body));

  const deepseaVessel = await call(
    "POST",
    "/api/vessels",
    deepseaOwner.cookie,
    deepseaVesselPayload(),
  );
  assert.equal(deepseaVessel.status, 201, JSON.stringify(deepseaVessel.body));
  const deepseaCargo = await call(
    "POST",
    "/api/cargo",
    cargoOwner.cookie,
    deepseaCargoPayload(),
  );
  assert.equal(deepseaCargo.status, 201, JSON.stringify(deepseaCargo.body));
  const deepseaCapacity = await call(
    "POST",
    "/api/capacity",
    deepseaOwner.cookie,
    deepseaCapacityPayload(deepseaVessel.body.id),
  );
  assert.equal(deepseaCapacity.status, 201, JSON.stringify(deepseaCapacity.body));

  const targetMatch = await findMatch(
    "ROAD",
    targetCargo.body.id,
    targetCapacity.body.id,
  );
  const otherRoadMatch = await findMatch(
    "ROAD",
    otherCargo.body.id,
    otherCapacity.body.id,
  );
  const inlandMatch = await findMatch(
    "INLAND_WATERWAY",
    inlandCargo.body.id,
    inlandCapacity.body.id,
  );
  const deepseaMatch = await findMatch(
    "DEEPSEA_BULK",
    deepseaCargo.body.id,
    deepseaCapacity.body.id,
  );
  const matchIds = [
    targetMatch.id,
    otherRoadMatch.id,
    inlandMatch.id,
    deepseaMatch.id,
  ];

  for (const matchId of matchIds) await interest(matchId);
  const initial = await databaseState(matchIds);
  for (const matchId of matchIds) {
    assert.equal(initial.matches.get(matchId)?.status, "INTEREST_SENT");
    assert.equal(initial.interests.get(matchId)?.status, "PENDING");
    assert.equal(initial.interests.get(matchId)?.companyId, cargoOwner.company!.id);
  }

  const patch = await call(
    "PATCH",
    `/api/road/assets/${targetAsset.body.id}`,
    targetRoadOwner.cookie,
    { assetName: "Isolation target asset (patched)" },
  );
  assert.equal(patch.status, 200, JSON.stringify(patch.body));

  const afterPatch = await databaseState(matchIds);
  assert.equal(afterPatch.matches.get(targetMatch.id)?.status, "NEW");
  assert.equal(afterPatch.matches.get(targetMatch.id)?.isStale, false);
  assert.equal(afterPatch.interests.has(targetMatch.id), false);
  for (const matchId of [otherRoadMatch.id, inlandMatch.id, deepseaMatch.id]) {
    assert.equal(afterPatch.matches.get(matchId)?.status, "INTEREST_SENT");
    assert.equal(afterPatch.interests.get(matchId)?.status, "PENDING");
  }

  await interest(targetMatch.id);
  const afterResend = await databaseState(matchIds);
  assert.equal(afterResend.matches.get(targetMatch.id)?.status, "INTEREST_SENT");
  assert.equal(afterResend.interests.get(targetMatch.id)?.status, "PENDING");

  const deactivated = await call(
    "POST",
    `/api/road/assets/${targetAsset.body.id}/deactivate`,
    targetRoadOwner.cookie,
  );
  assert.equal(deactivated.status, 200, JSON.stringify(deactivated.body));
  assert.equal(deactivated.body.active, false);

  const afterDeactivate = await databaseState(matchIds);
  assert.equal(afterDeactivate.matches.get(targetMatch.id)?.status, "EXPIRED");
  assert.equal(afterDeactivate.matches.get(targetMatch.id)?.isStale, true);
  assert.equal(afterDeactivate.interests.has(targetMatch.id), false);
  for (const matchId of [otherRoadMatch.id, inlandMatch.id, deepseaMatch.id]) {
    assert.equal(afterDeactivate.matches.get(matchId)?.status, "INTEREST_SENT");
    assert.equal(afterDeactivate.interests.get(matchId)?.status, "PENDING");
  }
});