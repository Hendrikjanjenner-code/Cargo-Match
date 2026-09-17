import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after, before } from "node:test";

import { and, eq } from "drizzle-orm";
import app from "../src/app";
import {
  cargoListingsTable,
  companyMembersTable,
  db,
  interestsTable,
  matchesTable,
} from "@workspace/db";
import {
  addTestMembership,
  createTestIdentity,
  disposeTestIdentity,
} from "./support/testIdentity";

type Identity = Awaited<ReturnType<typeof createTestIdentity>>;
type ApiResponse = { status: number; body: any };

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let A: Identity;
let B: Identity;
let C: Identity;
let D: Identity;
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

function companyPayload(name: string) {
  return {
    name,
    country: "SG",
    activities: ["SHIPPER", "CARRIER"],
    primaryContactName: "Deepsea Pilot",
    email: `${name.toLowerCase().replaceAll(" ", ".")}@example.invalid`,
    phone: "+6500000000",
    termsAccepted: true,
    privacyAccepted: true,
  };
}

async function register(identity: Identity, name: string) {
  const response = await call(
    "POST",
    "/api/company",
    identity.cookie,
    companyPayload(name),
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  identity.company = response.body;
}

function deepseaVesselPayload(overrides: Record<string, unknown> = {}) {
  return {
    transportMode: "DEEPSEA_BULK",
    vesselName: "MV Pilot Kamsarmax",
    vesselType: "DRY_CARGO",
    // The generic vessel cargo capacity is deliberately lower than DWT.
    totalCapacityTonnes: 50_000,
    cargoCompatibility: ["dry bulk", "iron ore"],
    active: true,
    deepseaProfile: {
      vesselClass: "KAMSARMAX",
      dwtTonnes: 80_000,
      summerDraftMetres: 13,
      gearConfiguration: "ship cranes",
    },
    ...overrides,
  };
}

function deepseaCargoPayload(overrides: Record<string, unknown> = {}) {
  return {
    transportMode: "DEEPSEA_BULK",
    cargoName: "Iron ore pilot cargo",
    cargoType: "iron ore dry bulk",
    weightTonnes: 35_000,
    loadingLocationId: locations.Singapore,
    destinationLocationId: locations.Qingdao,
    loadingFrom: "2030-06-01T00:00:00.000Z",
    loadingUntil: "2030-06-10T00:00:00.000Z",
    expectedUnloadingDate: "2030-06-20",
    requiredVesselType: "DRY_CARGO",
    specialRequirements: "Keep cargo requirements private",
    visibility: "OPEN_NETWORK",
    notes: "Private deepsea cargo notes",
    listingStatus: "ACTIVE",
    deepseaRequirement: {
      quantityTolerancePercent: 10,
      minimumVesselDwtTonnes: 70_000,
      maximumVesselDwtTonnes: 90_000,
      maximumDraftMetres: 14,
      requiredGear: "ship cranes",
      preferredVesselClass: "KAMSARMAX",
    },
    ...overrides,
  };
}

function deepseaCapacityPayload(
  vesselId: string,
  overrides: Record<string, unknown> = {},
) {
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
    notes: "Private deepsea capacity notes",
    listingStatus: "ACTIVE",
    availabilityConfidence: "EXPECTED",
    // Null is intentional: matching remains eligible but provisional.
    deepseaExtension: {
      manualPositioningDays: null,
        routeChoice: "DIRECT",
        routeNotes: "  manually selected route  ",
        departureUncertaintyDays: 0.5,
        positioningBufferDays: 1.25,
      approximateMaxDistanceKm: 5_000,
      previousVoyageContext: "Open position after an Asia-Pacific voyage",
    },
    ...overrides,
  };
}

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;

  A = await createTestIdentity({ withCompany: false });
  B = await createTestIdentity({ withCompany: false });
  C = await createTestIdentity({ withCompany: false });
  D = await createTestIdentity({ withCompany: false });
  await register(A, `Deepsea Capacity ${A.user.id.slice(-8)}`);
  await register(B, `Deepsea Charterer ${B.user.id.slice(-8)}`);
  await register(C, `Deepsea Tenant ${C.user.id.slice(-8)}`);

  const locationResponse = await call("GET", "/api/locations?pageSize=100");
  assert.equal(locationResponse.status, 200, JSON.stringify(locationResponse.body));
  for (const item of locationResponse.body.items) locations[item.name] = item.id;
  assert.ok(
    locations.Singapore && locations.Qingdao,
    "the reviewed deepsea location seed must be applied before integration tests",
  );
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const identity of [A, B, C, D]) {
    if (identity) await disposeTestIdentity(identity);
  }
});

test("deepsea API vertical enforces isolation, privacy, consent, and revalidation", async () => {
  assert.ok(A.company && B.company && C.company);
  await addTestMembership(D.user.id, A.company.id, "MEMBER");

  const roleDenied = await call("POST", "/api/vessels", D.cookie, {
    ...deepseaVesselPayload(),
    vesselName: "Member cannot create",
  });
  assert.equal(roleDenied.status, 403);

  const vesselResponse = await call(
    "POST",
    "/api/vessels",
    A.cookie,
    deepseaVesselPayload(),
  );
  assert.equal(vesselResponse.status, 201, JSON.stringify(vesselResponse.body));
  assert.equal(vesselResponse.body.transportMode, "DEEPSEA_BULK");
  assert.equal(vesselResponse.body.deepseaProfile.dwtTonnes, 80_000);
  const vesselId = vesselResponse.body.id;

  // Omitting transportMode intentionally defaults to inland and cannot attach
  // an inland capacity offer to a deepsea vessel.
  const crossModeCapacity = await call(
    "POST",
    "/api/capacity",
    A.cookie,
    deepseaCapacityPayload(vesselId, { transportMode: undefined }),
  );
  assert.equal(crossModeCapacity.status, 400);

  // DWT is not cargo capacity: the generic vessel capacity remains the
  // authoritative maximum for an offered cargo-tonnage claim.
  const exceedsVesselCapacity = await call(
    "POST",
    "/api/capacity",
    A.cookie,
    deepseaCapacityPayload(vesselId, { availableCapacityTonnes: 60_000 }),
  );
  assert.equal(exceedsVesselCapacity.status, 400);

  const capacityResponse = await call(
    "POST",
    "/api/capacity",
    A.cookie,
    deepseaCapacityPayload(vesselId),
  );
  assert.equal(capacityResponse.status, 201, JSON.stringify(capacityResponse.body));
  assert.equal(capacityResponse.body.transportMode, "DEEPSEA_BULK");
  assert.equal(capacityResponse.body.availabilityConfidence, "EXPECTED");
  assert.equal(capacityResponse.body.deepseaExtension.manualPositioningDays, null);
  assert.equal(capacityResponse.body.deepseaExtension.routeChoice, "DIRECT");
  assert.equal(capacityResponse.body.deepseaExtension.routeNotes, "manually selected route");
  assert.equal(capacityResponse.body.deepseaExtension.departureUncertaintyDays, 0.5);
  assert.equal(capacityResponse.body.deepseaExtension.positioningBufferDays, 1.25);
  const capacityId = capacityResponse.body.id;

  const clearedExtension = await call(
    "PATCH",
    `/api/capacity/${capacityId}`,
    A.cookie,
    { deepseaExtension: null },
  );
  assert.equal(clearedExtension.status, 200, JSON.stringify(clearedExtension.body));
  assert.equal(clearedExtension.body.deepseaExtension, null);
  const reloadedCapacity = await call(
    "GET",
    `/api/capacity/${capacityId}`,
    A.cookie,
  );
  assert.equal(reloadedCapacity.status, 200);
  assert.equal(reloadedCapacity.body.deepseaExtension, null);
  const restoredExtension = await call(
    "PATCH",
    `/api/capacity/${capacityId}`,
    A.cookie,
    { deepseaExtension: deepseaCapacityPayload(vesselId).deepseaExtension },
  );
  assert.equal(restoredExtension.status, 200, JSON.stringify(restoredExtension.body));

  const cargoResponse = await call(
    "POST",
    "/api/cargo",
    B.cookie,
    deepseaCargoPayload(),
  );
  assert.equal(cargoResponse.status, 201, JSON.stringify(cargoResponse.body));
  assert.equal(cargoResponse.body.transportMode, "DEEPSEA_BULK");
  assert.equal(cargoResponse.body.deepseaRequirement.minimumVesselDwtTonnes, 70_000);
  const cargoId = cargoResponse.body.id;

  const inlandVessels = await call("GET", "/api/vessels", A.cookie);
  assert.equal(inlandVessels.status, 200);
  assert.equal(
    inlandVessels.body.items.some((item: any) => item.id === vesselId),
    false,
  );
  const deepseaVessels = await call(
    "GET",
    "/api/vessels?transportMode=DEEPSEA_BULK",
    A.cookie,
  );
  assert.ok(deepseaVessels.body.items.some((item: any) => item.id === vesselId));

  const inlandCargo = await call("GET", "/api/cargo", B.cookie);
  assert.equal(inlandCargo.status, 200);
  assert.equal(inlandCargo.body.items.some((item: any) => item.id === cargoId), false);
  const deepseaCargo = await call(
    "GET",
    "/api/cargo?transportMode=DEEPSEA_BULK",
    B.cookie,
  );
  assert.ok(deepseaCargo.body.items.some((item: any) => item.id === cargoId));

  const inlandCapacity = await call("GET", "/api/capacity", A.cookie);
  assert.equal(inlandCapacity.status, 200);
  assert.equal(
    inlandCapacity.body.items.some((item: any) => item.id === capacityId),
    false,
  );
  const deepseaCapacity = await call(
    "GET",
    "/api/capacity?transportMode=DEEPSEA_BULK",
    A.cookie,
  );
  assert.ok(deepseaCapacity.body.items.some((item: any) => item.id === capacityId));

  const marketplace = await call(
    "GET",
    "/api/marketplace?transportMode=DEEPSEA_BULK",
    C.cookie,
  );
  assert.equal(marketplace.status, 200, JSON.stringify(marketplace.body));
  const marketplaceCargo = marketplace.body.items.find(
    (item: any) => item.id === cargoId,
  );
  const marketplaceCapacity = marketplace.body.items.find(
    (item: any) => item.id === capacityId,
  );
  assert.ok(marketplaceCargo);
  assert.ok(marketplaceCapacity);
  assert.equal(marketplaceCargo.transportMode, "DEEPSEA_BULK");
  assert.equal(marketplaceCargo.weightTonnes, undefined);
  assert.equal(marketplaceCargo.notes, undefined);
  assert.equal(marketplaceCapacity.provisional, true);
  assert.equal(marketplaceCapacity.availabilityConfidence, "EXPECTED");
  assert.equal(marketplaceCapacity.availableCapacityTonnes, undefined);
  assert.equal(marketplaceCapacity.dwtTonnes, undefined);

  const matches = await call(
    "GET",
    "/api/matches?transportMode=DEEPSEA_BULK",
    A.cookie,
  );
  assert.equal(matches.status, 200, JSON.stringify(matches.body));
  const summary = matches.body.items.find(
    (item: any) =>
      item.cargoListingId === cargoId && item.capacityOfferId === capacityId,
  );
  assert.ok(summary);
  assert.equal(summary.deepseaMatch.provisional, true);
  assert.equal(summary.deepseaMatch.vesselClass, "KAMSARMAX");
  assert.equal(summary.deepseaMatch.dwtBand, "65–85k DWT");
  assert.equal(summary.capacity.provisional, true);
  assert.equal(summary.capacity.availableCapacityTonnes, undefined);
  assert.equal(summary.capacity.notes, undefined);
  assert.equal(summary.cargo.weightTonnes, undefined);
  assert.equal(summary.cargo.loadingFrom, undefined);

  // A third tenant cannot use a match id as a discovery shortcut.
  assert.equal(
    (await call("GET", `/api/matches/${summary.id}`, C.cookie)).status,
    404,
  );

  const interest = await call(
    "POST",
    `/api/matches/${summary.id}/actions`,
    B.cookie,
    { action: "INTEREST" },
  );
  assert.equal(interest.status, 200, JSON.stringify(interest.body));
  assert.equal(interest.body.status, "INTEREST_SENT");
  assert.equal(interest.body.deepseaMatch.provisional, true);
  const accepted = await call(
    "POST",
    `/api/matches/${summary.id}/actions`,
    A.cookie,
    { action: "ACCEPT" },
  );
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.status, "CONNECTED");
  assert.ok(accepted.body.connectedCargo);
  assert.ok(accepted.body.ownedCapacity);
  assert.equal(accepted.body.connectedCargo.notes, undefined);
  assert.equal(accepted.body.ownedCapacity.deepseaExtension.manualPositioningDays, null);

  const conversations = await call("GET", "/api/conversations", A.cookie);
  const conversation = conversations.body.items.find(
    (item: any) => item.matchId === summary.id,
  );
  assert.ok(conversation);
  const message = await call(
    "POST",
    `/api/conversations/${conversation.id}/messages`,
    B.cookie,
    { body: "Deepsea pilot introduction" },
  );
  assert.equal(message.status, 201, JSON.stringify(message.body));
  assert.equal(message.body.body, "Deepsea pilot introduction");

  const incompatibleCargo = await call(
    "POST",
    "/api/cargo",
    B.cookie,
    deepseaCargoPayload({
      cargoName: "Coal cargo should not match iron ore capacity",
      cargoType: "coal",
    }),
  );
  assert.equal(
    incompatibleCargo.status,
    201,
    JSON.stringify(incompatibleCargo.body),
  );
  const incompatibleMatches = await call(
    "GET",
    "/api/matches?transportMode=DEEPSEA_BULK",
    B.cookie,
  );
  assert.equal(incompatibleMatches.status, 200);
  assert.equal(
    incompatibleMatches.body.items.some(
      (item: any) =>
        item.cargoListingId === incompatibleCargo.body.id &&
        item.capacityOfferId === capacityId,
    ),
    false,
  );

  // A second pending consent is reset by a material edit, and then expires
  // (with its consent removed) when its cargo is withdrawn.
  const secondCargo = await call(
    "POST",
    "/api/cargo",
    B.cookie,
    deepseaCargoPayload({ cargoName: "Second pilot cargo" }),
  );
  assert.equal(secondCargo.status, 201, JSON.stringify(secondCargo.body));
  const secondMatch = await call(
    "GET",
    "/api/matches?transportMode=DEEPSEA_BULK",
    B.cookie,
  );
  const secondSummary = secondMatch.body.items.find(
    (item: any) => item.cargoListingId === secondCargo.body.id,
  );
  assert.ok(secondSummary);
  assert.equal(
    (await call(
      "POST",
      `/api/matches/${secondSummary.id}/actions`,
      B.cookie,
      { action: "INTEREST" },
    )).status,
    200,
  );
  const materialEdit = await call(
    "PATCH",
    `/api/cargo/${secondCargo.body.id}`,
    B.cookie,
    { loadingUntil: "2030-06-11T00:00:00.000Z" },
  );
  assert.equal(materialEdit.status, 200, JSON.stringify(materialEdit.body));
  const [resetMatch] = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.id, secondSummary.id));
  assert.equal(resetMatch.status, "NEW");
  assert.equal(resetMatch.isStale, false);
  assert.equal(
    (await db
      .select()
      .from(interestsTable)
      .where(eq(interestsTable.matchId, secondSummary.id))).length,
    0,
  );

  assert.equal(
    (await call(
      "POST",
      `/api/matches/${secondSummary.id}/actions`,
      B.cookie,
      { action: "INTEREST" },
    )).status,
    200,
  );
  const withdrawal = await call(
    "POST",
    `/api/cargo/${secondCargo.body.id}/withdraw`,
    B.cookie,
  );
  assert.equal(withdrawal.status, 200, JSON.stringify(withdrawal.body));
  const [expiredMatch] = await db
    .select()
    .from(matchesTable)
    .where(eq(matchesTable.id, secondSummary.id));
  assert.equal(expiredMatch.status, "EXPIRED");
  assert.equal(expiredMatch.isStale, true);
  assert.equal(
    (await db
      .select()
      .from(interestsTable)
      .where(eq(interestsTable.matchId, secondSummary.id))).length,
    0,
  );
  assert.equal(
    (await call(
      "POST",
      `/api/matches/${secondSummary.id}/actions`,
      A.cookie,
      { action: "ACCEPT" },
    )).status,
    409,
  );

  // Keep direct tenant/capacity rows isolated as a final regression check.
  const CMemberRows = await db
    .select()
    .from(companyMembersTable)
    .where(
      and(eq(companyMembersTable.userId, C.user.id), eq(companyMembersTable.companyId, A.company.id)),
    );
  assert.equal(CMemberRows.length, 0);
  const [storedCargo] = await db
    .select()
    .from(cargoListingsTable)
    .where(eq(cargoListingsTable.id, cargoId));
  assert.equal(storedCargo.transportMode, "DEEPSEA_BULK");
});