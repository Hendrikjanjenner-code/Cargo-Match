import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after, before } from "node:test";

import { ListMyMatchesResponse, ListRoadCapacityResponse, ListRoadMatchesResponse } from "@workspace/api-zod";
import app from "../src/app";
import { addTestMembership, createTestIdentity, disposeTestIdentity } from "./support/testIdentity";

type Identity = Awaited<ReturnType<typeof createTestIdentity>>;
type ApiResponse = { status: number; body: any };

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let shipper: Identity;
let carrier: Identity;
let observer: Identity;
let driver: Identity;
let locations: Record<string, string> = {};
let matchId = "";

async function call(method: string, path: string, cookie?: string, body?: unknown): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie: cookie } : {}),
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
    primaryContactName: "Road integration",
    email: `${identity.user.id}@example.invalid`,
    phone: "+31100000000",
    termsAccepted: true,
    privacyAccepted: true,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  identity.company = response.body;
}

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  shipper = await createTestIdentity({ withCompany: false });
  carrier = await createTestIdentity({ withCompany: false });
  observer = await createTestIdentity({ withCompany: false });
  driver = await createTestIdentity({ withCompany: false });
  await register(shipper, "Road Integration Shipper");
  await register(carrier, "Road Integration Carrier");
  await register(observer, "Road Integration Observer");
  await addTestMembership(driver.user.id, carrier.company!.id, "MEMBER");
  const locationResponse = await call("GET", "/api/locations?pageSize=100");
  assert.equal(locationResponse.status, 200);
  for (const item of locationResponse.body.items) locations[item.name] = item.id;
  assert.ok(locations.Rotterdam && locations.Duisburg);
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const identity of [shipper, carrier, observer, driver]) {
    if (identity) await disposeTestIdentity(identity);
  }
});

test("ROAD shared match consent uses generated schemas and hides it from third companies", async () => {
  const asset = await call("POST", "/api/road/assets", carrier.cookie, {
    assetType: "TRUCK_TRAILER_COMBINATION",
    assetName: "Integration Truck",
    payloadTonnes: 24,
    volumeCubicMetres: 90,
    loadingMetres: 13,
    palletPositions: 33,
    equipment: ["liftgate"],
    adrClasses: ["3"],
  });
  assert.equal(asset.status, 201, JSON.stringify(asset.body));

  const cargo = await call("POST", "/api/road/cargo", shipper.cookie, {
    cargoName: "Integration cargo",
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
      requiredEquipment: ["liftgate"],
      adrClasses: ["3"],
    },
  });
  assert.equal(cargo.status, 201, JSON.stringify(cargo.body));

  const capacity = await call("POST", "/api/road/capacity", carrier.cookie, {
    roadAssetId: asset.body.id,
    currentDeliveryLocationId: locations.Rotterdam,
    currentDeliveryExpectedAt: "2035-01-02T12:00:00.000Z",
    expectedAvailabilityLocationId: locations.Rotterdam,
    expectedAvailabilityAt: "2035-01-02T13:00:00.000Z",
    availabilityUncertaintyMinutes: 30,
    availableCapacityTonnes: 12,
    availableVolumeCubicMetres: 80,
    availableLoadingMetres: 12,
    availablePalletPositions: 30,
    equipment: ["liftgate"],
    adrClasses: ["3"],
    preferredDirection: "Duisburg",
    maximumPositioningDistanceKm: 500,
    cargoCompatibility: ["ALL"],
    visibility: "OPEN_NETWORK",
    listingStatus: "ACTIVE",
  });
  assert.equal(capacity.status, 201, JSON.stringify(capacity.body));
  for (const reduction of [
    { payloadTonnes: 11 }, { volumeCubicMetres: 79 },
    { loadingMetres: 11 }, { palletPositions: 29 },
  ]) {
    const edit = await call("PATCH", `/api/road/assets/${asset.body.id}`, carrier.cookie, reduction);
    assert.equal(edit.status, 409, JSON.stringify({ reduction, body: edit.body }));
  }
  const unchangedAsset = await call("GET", `/api/road/assets/${asset.body.id}`, carrier.cookie);
  assert.equal(unchangedAsset.body.payloadTonnes, 24);

  const temperatureAsset = await call("POST", "/api/road/assets", carrier.cookie, {
    assetType: "TRUCK", assetName: "Temperature boundary unit",
    payloadTonnes: 24, volumeCubicMetres: 90, loadingMetres: 13, palletPositions: 33,
    temperatureMinCelsius: 2, temperatureMaxCelsius: 8,
  });
  assert.equal(temperatureAsset.status, 201);
  for (const invalid of [{ temperatureMinCelsius: 10 }, { temperatureMaxCelsius: 0 }]) {
    const edit = await call("PATCH", `/api/road/assets/${temperatureAsset.body.id}`, carrier.cookie, invalid);
    assert.equal(edit.status, 400, JSON.stringify(edit.body));
  }

  const matches = await call("GET", "/api/matches?transportMode=ROAD", shipper.cookie);
  assert.equal(matches.status, 200, JSON.stringify(matches.body));
  const shared = ListMyMatchesResponse.parse(matches.body);
  const found = shared.items.find((item: any) => item.cargoListingId === cargo.body.id && item.capacityOfferId === capacity.body.id);
  assert.ok(found, JSON.stringify(matches.body));
  matchId = found.id;
  const driverNotifications = await call("GET", "/api/notifications", driver.cookie);
  assert.equal(driverNotifications.status, 200);
  assert.equal(driverNotifications.body.items.some((item: any) => item.relatedMatchId === matchId), false);
  const plannerNotifications = await call("GET", "/api/notifications", carrier.cookie);
  assert.equal(plannerNotifications.status, 200);
  assert.equal(plannerNotifications.body.items.some((item: any) => item.relatedMatchId === matchId && item.type === "NEW_MATCH" && item.relatedMatchDomain === "ROAD"), true);

  const roadMatches = await call("GET", "/api/road/matches", carrier.cookie);
  assert.equal(roadMatches.status, 200, JSON.stringify(roadMatches.body));
  const roadMatchPage = ListRoadMatchesResponse.parse(roadMatches.body);
  const roadProjection = roadMatchPage.items.find((item) => item.id === matchId)?.projection;
  assert.ok(roadProjection);
  for (const field of [
    "cargoTypeBand", "originRegion", "destinationRegion", "loadingDateBand",
    "loadingTimeWindowBand", "weightBand", "equipmentBand", "temperatureBand",
    "adrBand", "dimensionalRequirementsBand", "freeAreaBand", "freeTimeBand",
    "freeCapacityBand", "capacityEquipmentBand", "capacityTemperatureBand", "capacityAdrBand",
  ]) assert.equal(typeof roadProjection[field as keyof typeof roadProjection], "string", field);
  assert.equal(JSON.stringify(roadProjection).includes("Integration cargo"), false);
  assert.equal(JSON.stringify(roadProjection).includes("Integration Truck"), false);
  assert.equal(JSON.stringify(roadProjection).includes("Private"), false);
  const roadDetail = await call("GET", `/api/road/matches/${matchId}`, carrier.cookie);
  assert.equal(roadDetail.status, 200, JSON.stringify(roadDetail.body));
  assert.deepEqual(roadDetail.body.projection, roadProjection);
  const observerMatches = await call("GET", "/api/matches?transportMode=ROAD", observer.cookie);
  assert.equal(observerMatches.status, 200);
  assert.equal(observerMatches.body.items.some((item: any) => item.id === matchId), false);

  const interest = await call("POST", `/api/matches/${matchId}/actions`, shipper.cookie, { action: "INTEREST" });
  assert.equal(interest.status, 200, JSON.stringify(interest.body));
  const accepted = await call("POST", `/api/matches/${matchId}/actions`, carrier.cookie, { action: "ACCEPT" });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));

  const observerConversations = await call("GET", "/api/conversations", observer.cookie);
  assert.equal(observerConversations.status, 200);
  assert.equal(observerConversations.body.items.some((item: any) => item.matchId === matchId), false);
});

test("ROAD MEMBER receives only assigned operational capacity and cannot see unassigned matches", async () => {
  const beforeAssignment = await call("GET", "/api/road/capacity", driver.cookie);
  assert.equal(beforeAssignment.status, 200, JSON.stringify(beforeAssignment.body));
  ListRoadCapacityResponse.parse(beforeAssignment.body);
  assert.equal(beforeAssignment.body.items.length, 0);
  const beforeAssets = await call("GET", "/api/road/assets", driver.cookie);
  assert.equal(beforeAssets.status, 200);
  assert.equal(beforeAssets.body.items.length, 0);
  const plannerAssets = (await call("GET", "/api/road/assets", carrier.cookie)).body.items;
  for (const asset of plannerAssets) {
    assert.equal((await call("GET", `/api/road/assets/${asset.id}`, driver.cookie)).status, 404);
  }
  assert.equal((await call("GET", "/api/road/cargo", driver.cookie)).status, 403);

  const drivers = await call("GET", "/api/road/drivers", carrier.cookie);
  assert.equal(drivers.status, 200);
  const capacityId = (await call("GET", "/api/road/capacity", carrier.cookie)).body.items[0].id;
  const assignment = await call("POST", `/api/road/capacity/${capacityId}/assignments`, carrier.cookie, {
    driverUserId: driver.user.id,
  });
  assert.equal(assignment.status, 201, JSON.stringify(assignment.body));
  assert.equal(typeof assignment.body.id, "string");
  const assigned = await call("GET", "/api/road/capacity", driver.cookie);
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.items.length, 1);
  const assignedAssets = await call("GET", "/api/road/assets", driver.cookie);
  assert.equal(assignedAssets.body.items.length, 1);
  assert.equal(assignedAssets.body.items[0].notes, null);
  const memberMatches = await call("GET", "/api/road/matches", driver.cookie);
  assert.equal(memberMatches.status, 200);
  assert.equal(memberMatches.body.items.length >= 1, true);

  assert.equal(assigned.body.items[0].assignments[0].id, assignment.body.id);
  assert.equal((await call("GET", `/api/matches/${matchId}`, driver.cookie)).status, 404);
  assert.equal((await call("POST", `/api/matches/${matchId}/actions`, driver.cookie, { action: "ACCEPT" })).status, 403);
  assert.equal((await call("PATCH", `/api/road/capacity/${capacityId}`, driver.cookie, { availableCapacityTonnes: 1 })).status, 403);
  assert.equal((await call("PATCH", `/api/capacity/${capacityId}`, carrier.cookie, { availableCapacityTonnes: 1 })).status, 400);

  const capacityBefore = (await call("GET", `/api/road/capacity/${capacityId}`, carrier.cookie)).body;
  const confirm = await call("POST", `/api/road/assignments/${assignment.body.id}/confirm`, driver.cookie, { note: "Delivery status checked" });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  assert.equal(confirm.body.status, "CONFIRMED");
  const firstCargo = (await call("GET", "/api/road/cargo", shipper.cookie)).body.items[0];
  const nextCargo = await call("POST", "/api/road/cargo", shipper.cookie, {
    cargoName: "Another next load", cargoType: firstCargo.cargoType,
    weightTonnes: firstCargo.weightTonnes, loadingLocationId: firstCargo.loadingLocationId,
    destinationLocationId: firstCargo.destinationLocationId,
    loadingFrom: firstCargo.loadingFrom, loadingUntil: firstCargo.loadingUntil,
    listingStatus: "ACTIVE", visibility: "OPEN_NETWORK",
    roadRequirements: { volumeCubicMetres: 20, loadingMetres: 5, palletPositions: 10, requiredEquipment: ["liftgate"], adrClasses: ["3"] },
  });
  assert.equal(nextCargo.status, 201, JSON.stringify(nextCargo.body));
  const nextMatch = (await call("GET", "/api/road/matches", driver.cookie)).body.items.find((item: any) => item.cargoListingId === nextCargo.body.id);
  assert.ok(nextMatch);
  const flagged = await call("POST", `/api/road/assignments/${assignment.body.id}/flag`, driver.cookie, { matchId: nextMatch.id, reason: "Planner should review this return load" });
  assert.equal(flagged.status, 200, JSON.stringify(flagged.body));
  assert.equal(flagged.body.flaggedMatchId, nextMatch.id);
  const confirmedAgain = await call("POST", `/api/road/assignments/${assignment.body.id}/confirm`, driver.cookie, {});
  assert.equal(confirmedAgain.status, 200);
  assert.equal(confirmedAgain.body.flaggedMatchId, nextMatch.id);
  assert.equal(confirmedAgain.body.status, "FLAGGED");
  const flaggedAgain = await call("POST", `/api/road/assignments/${assignment.body.id}/flag`, driver.cookie, { matchId: nextMatch.id, reason: "Planner should review this return load" });
  assert.equal(flaggedAgain.status, 200);
  const capacityAfter = (await call("GET", `/api/road/capacity/${capacityId}`, carrier.cookie)).body;
  assert.equal(capacityAfter.availableCapacityTonnes, capacityBefore.availableCapacityTonnes);
  assert.equal(capacityAfter.availableFrom, capacityBefore.availableFrom);
  assert.equal(capacityAfter.listingStatus, capacityBefore.listingStatus);
  assert.equal(capacityAfter.assignments[0].flaggedReason, "Planner should review this return load");
  const plannerNotifications = await call("GET", "/api/notifications", carrier.cookie);
  assert.equal(plannerNotifications.status, 200, JSON.stringify(plannerNotifications.body));
  assert.equal(plannerNotifications.body.items.some((item: any) => item.type === "ROAD_OPPORTUNITY_FLAGGED" && item.relatedMatchId === nextMatch.id), true);
  assert.equal((await call("POST", `/api/road/assignments/${assignment.body.id}/confirm`, carrier.cookie, {})).status, 403);
  assert.equal((await call("POST", `/api/road/assignments/${assignment.body.id}/flag`, observer.cookie, { matchId, reason: "Unauthorized" })).status, 404);

  const conversations = (await call("GET", "/api/conversations", carrier.cookie)).body.items;
  const conversation = conversations.find((item: any) => item.matchId === matchId);
  assert.ok(conversation);
  assert.equal((await call("GET", `/api/conversations/${conversation.id}`, driver.cookie)).status, 404);
  assert.equal((await call("POST", `/api/conversations/${conversation.id}/messages`, driver.cookie, { body: "No commercial authority" })).status, 404);
  assert.equal((await call("POST", `/api/conversations/${conversation.id}/messages`, observer.cookie, { body: "Not a participant" })).status, 404);
  const message = await call("POST", `/api/conversations/${conversation.id}/messages`, carrier.cookie, { body: "Let us discuss the return load; this is not a booking." });
  assert.equal(message.status, 201, JSON.stringify(message.body));
  const shipperMessages = await call("GET", `/api/conversations/${conversation.id}/messages`, shipper.cookie);
  assert.equal(shipperMessages.body.items.some((item: any) => item.id === message.body.id), true);

  const withdrawal = await call("POST", `/api/road/capacity/${capacityId}/withdraw`, carrier.cookie);
  assert.equal(withdrawal.status, 200, JSON.stringify(withdrawal.body));
  const staleFlag = await call("POST", `/api/road/assignments/${assignment.body.id}/flag`, driver.cookie, { matchId: nextMatch.id, reason: "Expired opportunity" });
  assert.equal(staleFlag.status, 409, JSON.stringify(staleFlag.body));
  // An already agreed introduction remains a conversation, not a reservation.
  assert.equal((await call("GET", `/api/conversations/${conversation.id}`, carrier.cookie)).status, 200);
});