import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after, before } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import app from "../src/app";
import { expireListings, lockDomain } from "../src/services/matching";
import {
  capacityOffersTable,
  cargoListingsTable,
  companyMembersTable,
  companiesTable,
  conversationsTable,
  interestsTable,
  matchesTable,
  db,
  vesselsTable,
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
let primaryCargoId = "";
let primaryCapacityId = "";
let primaryMatchId = "";
let connectedConversationId = "";

async function call(
  method: string,
  path: string,
  cookie?: string,
  body?: unknown,
): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie: cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

function companyPayload(name: string) {
  return {
    name,
    country: "NL",
    activities: ["SHIPPER", "CARRIER"],
    primaryContactName: "Pilot Contact",
    email: `${name.toLowerCase().replaceAll(" ", ".")}@example.invalid`,
    phone: "+31100000000",
    termsAccepted: true,
    privacyAccepted: true,
  };
}

function cargoPayload(overrides: Record<string, unknown> = {}) {
  return {
    cargoName: "Private cargo name",
    cargoType: "dry bulk",
    weightTonnes: 1_000,
    loadingLocationId: locations.Rotterdam,
    destinationLocationId: locations.Duisburg,
    loadingFrom: "2030-06-01T00:00:00.000Z",
    loadingUntil: "2030-06-03T00:00:00.000Z",
    expectedUnloadingDate: "2030-06-04",
    requiredVesselType: "DRY_CARGO",
    specialRequirements: "Private requirements",
    visibility: "OPEN_NETWORK",
    notes: "Private listing notes",
    listingStatus: "ACTIVE",
    ...overrides,
  };
}

function capacityPayload(
  vesselId: string,
  overrides: Record<string, unknown> = {},
) {
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
    notes: "Private capacity notes",
    listingStatus: "ACTIVE",
    ...overrides,
  };
}

async function runAtOnce<T>(operations: Array<() => Promise<T>>) {
  let ready = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return Promise.all(
    operations.map(async (operation) => {
      ready += 1;
      if (ready === operations.length) release();
      await gate;
      return operation();
    }),
  );
}

async function holdDomainLock() {
  let acquired!: () => void;
  let release!: () => void;
  const lockAcquired = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const lockReleased = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transaction = db.transaction(async (tx) => {
    await lockDomain(tx);
    acquired();
    await lockReleased;
  });
  await lockAcquired;
  return { release, transaction };
}

async function waitForDomainWaiters(count: number) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS waiting
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND granted = false
    `);
    const waiting = Number((result.rows[0] as { waiting: number }).waiting);
    if (waiting >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${count} domain lock waiter(s)`);
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
  await register(A, "CargoMatch Test Shipper");
  await register(B, "CargoMatch Test Carrier");
  await register(C, "CargoMatch Test Observer");

  const locationResponse = await call("GET", "/api/locations?pageSize=100");
  assert.equal(locationResponse.status, 200);
  for (const item of locationResponse.body.items) {
    locations[item.name] = item.id;
  }
  assert.ok(locations.Rotterdam && locations.Duisburg && locations.Antwerp);
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const identity of [A, B, C, D]) {
    if (identity) await disposeTestIdentity(identity);
  }
});

test("anonymous access is denied while catalogue locations remain public", async () => {
  const health = await call("GET", "/api/healthz");
  assert.equal(health.status, 200);
  const locationsResponse = await call("GET", "/api/locations");
  assert.equal(locationsResponse.status, 200);
  assert.equal("latitude" in locationsResponse.body.items[0], false);
  assert.equal("longitude" in locationsResponse.body.items[0], false);
  assert.equal((await call("GET", "/api/marketplace")).status, 401);
  assert.equal((await call("GET", "/api/cargo")).status, 401);
});

test("concurrent onboarding admits one company for one user", async () => {
  const identity = await createTestIdentity({ withCompany: false });
  const name = `CargoMatch Test Concurrent ${identity.user.id.slice(0, 8)}`;
  try {
    const responses = await runAtOnce([
      () => call("POST", "/api/company", identity.cookie, companyPayload(`${name} A`)),
      () => call("POST", "/api/company", identity.cookie, companyPayload(`${name} B`)),
    ]);
    assert.deepEqual(
      responses.map((response) => response.status).sort((a, b) => a - b),
      [201, 409],
    );
    const memberships = await db
      .select()
      .from(companyMembersTable)
      .where(eq(companyMembersTable.userId, identity.user.id));
    assert.equal(memberships.length, 1);
    const companies = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, memberships[0].companyId));
    assert.equal(companies.length, 1);
  } finally {
    const memberships = await db
      .select({ companyId: companyMembersTable.companyId })
      .from(companyMembersTable)
      .where(eq(companyMembersTable.userId, identity.user.id));
    for (const membership of memberships) {
      await db
        .delete(companiesTable)
        .where(eq(companiesTable.id, membership.companyId));
    }
    await disposeTestIdentity(identity);
  }
});

test("full A/B workflow enforces privacy, tenant isolation, connection, messages, and read state", async () => {
  const vesselResponse = await call(
    "POST",
    "/api/vessels",
    B.cookie,
    {
      vesselName: "Carrier Vessel",
      vesselType: "DRY_CARGO",
      totalCapacityTonnes: 2_000,
      cargoCompatibility: ["dry bulk"],
      active: true,
    },
  );
  assert.equal(vesselResponse.status, 201, JSON.stringify(vesselResponse.body));
  const vesselId = vesselResponse.body.id;

  const cargoResponse = await call(
    "POST",
    "/api/cargo",
    A.cookie,
    cargoPayload(),
  );
  assert.equal(cargoResponse.status, 201, JSON.stringify(cargoResponse.body));
  primaryCargoId = cargoResponse.body.id;

  const capacityResponse = await call(
    "POST",
    "/api/capacity",
    B.cookie,
    capacityPayload(vesselId),
  );
  assert.equal(capacityResponse.status, 201, JSON.stringify(capacityResponse.body));
  primaryCapacityId = capacityResponse.body.id;

  const privateCargo = await call(
    "POST",
    "/api/cargo",
    A.cookie,
    cargoPayload({
      cargoName: "Should never be public",
      visibility: "PRIVATE",
    }),
  );
  assert.equal(privateCargo.status, 201);

  const marketplace = await call("GET", "/api/marketplace", C.cookie);
  assert.equal(marketplace.status, 200, JSON.stringify(marketplace.body));
  assert.ok(marketplace.body.items.some((item: any) => item.id === primaryCargoId));
  assert.ok(marketplace.body.items.some((item: any) => item.id === primaryCapacityId));
  assert.equal(
    marketplace.body.items.some((item: any) => item.cargoName === "Private cargo name"),
    false,
  );
  assert.equal(
    marketplace.body.items.some((item: any) => item.cargoName === "Should never be public"),
    false,
  );
  assert.equal(
    marketplace.body.items.some((item: any) => "weightTonnes" in item || "notes" in item),
    false,
  );

  const AMatches = await call("GET", "/api/matches", A.cookie);
  assert.equal(AMatches.status, 200, JSON.stringify(AMatches.body));
  const primarySummary = AMatches.body.items.find(
    (item: any) =>
      item.cargoListingId === primaryCargoId &&
      item.capacityOfferId === primaryCapacityId,
  );
  assert.ok(primarySummary);
  primaryMatchId = primarySummary.id;
  assert.equal(primarySummary.score.totalScore % 1, 0);
  assert.equal(typeof primarySummary.score.evaluationInputs.distanceBand, "string");
  assert.equal(primarySummary.initiatedByMe, false);
  assert.equal(primarySummary.canAccept, false);

  assert.equal(
    (await call("GET", `/api/matches/${primaryMatchId}`, C.cookie)).status,
    404,
  );
  const interest = await call(
    "POST",
    `/api/matches/${primaryMatchId}/actions`,
    A.cookie,
    { action: "INTEREST" },
  );
  assert.equal(interest.status, 200, JSON.stringify(interest.body));
  assert.equal(interest.body.initiatedByMe, true);
  assert.equal(interest.body.canAccept, false);
  assert.equal(interest.body.status, "INTEREST_SENT");
  assert.equal(interest.body.disclosureState, "OWNER");
  assert.ok(interest.body.ownedCargo);
  assert.equal(interest.body.connectedCapacity, null);

  const pendingForB = await call("GET", `/api/matches/${primaryMatchId}`, B.cookie);
  assert.equal(pendingForB.status, 200);
  assert.equal(pendingForB.body.initiatedByMe, false);
  assert.equal(pendingForB.body.canAccept, true);

  const accepted = await call(
    "POST",
    `/api/matches/${primaryMatchId}/actions`,
    B.cookie,
    { action: "ACCEPT" },
  );
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.status, "CONNECTED");
  assert.equal(accepted.body.disclosureState, "CONNECTED");
  assert.ok(accepted.body.connectedCargo);
  assert.ok(accepted.body.ownedCapacity);
  assert.equal(accepted.body.connectedCapacity, null);
  assert.equal(accepted.body.connectedCargo.notes, undefined);
  assert.equal(accepted.body.ownedCapacity.notes, "Private capacity notes");
  assert.equal(accepted.body.connectedCompanies.length, 2);

  const AConversations = await call("GET", "/api/conversations", A.cookie);
  assert.equal(AConversations.status, 200);
  assert.equal(AConversations.body.items.length, 1);
  connectedConversationId = AConversations.body.items[0].id;
  const blankMessage = await call(
    "POST",
    `/api/conversations/${connectedConversationId}/messages`,
    A.cookie,
    { body: " \n\t " },
  );
  assert.equal(blankMessage.status, 400);
  const beforeMessage = await call(
    "GET",
    `/api/conversations/${connectedConversationId}/messages`,
    A.cookie,
  );
  assert.equal(beforeMessage.body.items.length, 0);
  const message = await call(
    "POST",
    `/api/conversations/${connectedConversationId}/messages`,
    A.cookie,
    { body: "Connected message" },
  );
  assert.equal(message.status, 201, JSON.stringify(message.body));
  assert.equal(message.body.senderUserId, A.user.id);
  const withLastMessage = await call("GET", "/api/conversations", B.cookie);
  assert.equal(withLastMessage.status, 200, JSON.stringify(withLastMessage.body));
  assert.equal(withLastMessage.body.items[0].lastMessage.id, message.body.id);
  const BMessages = await call(
    "GET",
    `/api/conversations/${connectedConversationId}/messages`,
    B.cookie,
  );
  assert.equal(BMessages.status, 200);
  assert.equal(BMessages.body.items.length, 1);
  assert.equal(BMessages.body.items[0].body, "Connected message");
  assert.equal(BMessages.body.items[0].readAt, null);
  const read = await call(
    "POST",
    `/api/conversations/${connectedConversationId}/read`,
    B.cookie,
    { messageIds: [message.body.id] },
  );
  assert.equal(read.status, 200, JSON.stringify(read.body));
  const BConversation = await call(
    "GET",
    `/api/conversations/${connectedConversationId}`,
    B.cookie,
  );
  assert.equal(BConversation.body.unreadCount, 0);

  await addTestMembership(D.user.id, A.company!.id, "MEMBER");
  const roleDenied = await call("POST", "/api/vessels", D.cookie, {
    vesselName: "Not allowed",
    vesselType: "DRY_CARGO",
    totalCapacityTonnes: 100,
    cargoCompatibility: ["dry bulk"],
  });
  assert.equal(roleDenied.status, 403);

  await db
    .update(companiesTable)
    .set({ status: "SUSPENDED" })
    .where(eq(companiesTable.id, A.company!.id));
  assert.equal((await call("GET", "/api/marketplace", A.cookie)).status, 403);
  assert.equal(
    (await call("GET", "/api/conversations", A.cookie)).status,
    403,
  );
  await db
    .update(companiesTable)
    .set({ status: "ACTIVE" })
    .where(eq(companiesTable.id, A.company!.id));
});

test("eligibility rejects wrong types, insufficient capacity, max distance, and expired listings", async () => {
  const vesselResponse = await call(
    "GET",
    "/api/vessels",
    B.cookie,
  );
  const vesselId = vesselResponse.body.items.find(
    (item: any) => item.vesselName === "Carrier Vessel",
  ).id;
  const insufficient = await call(
    "POST",
    "/api/cargo",
    A.cookie,
    cargoPayload({ weightTonnes: 3_000 }),
  );
  assert.equal(insufficient.status, 201);
  const wrongType = await call(
    "POST",
    "/api/cargo",
    A.cookie,
    cargoPayload({ requiredVesselType: "TANKER" }),
  );
  assert.equal(wrongType.status, 201);
  const farCapacity = await call(
    "POST",
    "/api/capacity",
    B.cookie,
    capacityPayload(vesselId, {
      locationId: locations.Antwerp,
      maximumPositioningDistanceKm: 1,
      availableCapacityTonnes: 1_500,
    }),
  );
  assert.equal(farCapacity.status, 201);
  const expired = await call(
    "POST",
    "/api/cargo",
    A.cookie,
    cargoPayload({
      loadingFrom: "2020-01-01T00:00:00.000Z",
      loadingUntil: "2020-01-02T00:00:00.000Z",
    }),
  );
  assert.equal(expired.status, 201);
  await expireListings(new Date("2020-01-03T00:00:00.000Z"));
  const expiredRead = await call(
    "GET",
    `/api/cargo/${expired.body.id}`,
    A.cookie,
  );
  assert.equal(expiredRead.status, 200);
  assert.equal(expiredRead.body.listingStatus, "EXPIRED");

  const matches = await call("GET", "/api/matches", A.cookie);
  assert.equal(matches.status, 200);
  assert.equal(
    matches.body.items.some((item: any) => item.cargoListingId === insufficient.body.id),
    false,
  );
  assert.equal(
    matches.body.items.some((item: any) => item.cargoListingId === wrongType.body.id),
    false,
  );
});

test("capacity writes enforce vessel totals and protect outstanding offers", async () => {
  const vesselResponse = await call("POST", "/api/vessels", B.cookie, {
    vesselName: "Capacity Guard Vessel",
    vesselType: "DRY_CARGO",
    totalCapacityTonnes: 2_000,
    cargoCompatibility: ["dry bulk"],
  });
  assert.equal(vesselResponse.status, 201, JSON.stringify(vesselResponse.body));
  const vesselId = vesselResponse.body.id;

  const tooLargeCreate = await call(
    "POST",
    "/api/capacity",
    B.cookie,
    capacityPayload(vesselId, { availableCapacityTonnes: 2_001 }),
  );
  assert.equal(tooLargeCreate.status, 400, JSON.stringify(tooLargeCreate.body));

  const activeOffer = await call(
    "POST",
    "/api/capacity",
    B.cookie,
    capacityPayload(vesselId, { availableCapacityTonnes: 1_500 }),
  );
  assert.equal(activeOffer.status, 201, JSON.stringify(activeOffer.body));

  const draftOffer = await call(
    "POST",
    "/api/capacity",
    B.cookie,
    capacityPayload(vesselId, {
      availableCapacityTonnes: 1_800,
      listingStatus: "DRAFT",
    }),
  );
  assert.equal(draftOffer.status, 201, JSON.stringify(draftOffer.body));

  const tooLargeUpdate = await call(
    "PATCH",
    `/api/capacity/${activeOffer.body.id}`,
    B.cookie,
    { availableCapacityTonnes: 2_001 },
  );
  assert.equal(tooLargeUpdate.status, 400, JSON.stringify(tooLargeUpdate.body));

  const smallerVesselResponse = await call("POST", "/api/vessels", B.cookie, {
    vesselName: "Capacity Guard Smaller Vessel",
    vesselType: "DRY_CARGO",
    totalCapacityTonnes: 1_000,
    cargoCompatibility: ["dry bulk"],
  });
  assert.equal(
    smallerVesselResponse.status,
    201,
    JSON.stringify(smallerVesselResponse.body),
  );
  const smallerVesselId = smallerVesselResponse.body.id;

  const invalidSwitch = await call(
    "PATCH",
    `/api/capacity/${activeOffer.body.id}`,
    B.cookie,
    { vesselId: smallerVesselId },
  );
  assert.equal(invalidSwitch.status, 400, JSON.stringify(invalidSwitch.body));

  const rejectedReduction = await call(
    "PATCH",
    `/api/vessels/${vesselId}`,
    B.cookie,
    { totalCapacityTonnes: 1_000 },
  );
  assert.equal(
    rejectedReduction.status,
    409,
    JSON.stringify(rejectedReduction.body),
  );

  const activeOfferReduction = await call(
    "PATCH",
    `/api/capacity/${activeOffer.body.id}`,
    B.cookie,
    { availableCapacityTonnes: 900 },
  );
  assert.equal(
    activeOfferReduction.status,
    200,
    JSON.stringify(activeOfferReduction.body),
  );
  const draftOfferReduction = await call(
    "PATCH",
    `/api/capacity/${draftOffer.body.id}`,
    B.cookie,
    { availableCapacityTonnes: 900 },
  );
  assert.equal(
    draftOfferReduction.status,
    200,
    JSON.stringify(draftOfferReduction.body),
  );

  const validSwitch = await call(
    "PATCH",
    `/api/capacity/${activeOffer.body.id}`,
    B.cookie,
    { vesselId: smallerVesselId },
  );
  assert.equal(validSwitch.status, 200, JSON.stringify(validSwitch.body));
  assert.equal(validSwitch.body.vesselId, smallerVesselId);

  const acceptedReduction = await call(
    "PATCH",
    `/api/vessels/${vesselId}`,
    B.cookie,
    { totalCapacityTonnes: 1_000 },
  );
  assert.equal(
    acceptedReduction.status,
    200,
    JSON.stringify(acceptedReduction.body),
  );
  assert.equal(acceptedReduction.body.totalCapacityTonnes, 1_000);
});

test("capacity and vessel mutations serialize without leaving an invalid offer", async () => {
  const vesselResponse = await call("POST", "/api/vessels", B.cookie, {
    vesselName: "Capacity Race Vessel",
    vesselType: "DRY_CARGO",
    totalCapacityTonnes: 2_000,
    cargoCompatibility: ["dry bulk"],
  });
  assert.equal(vesselResponse.status, 201, JSON.stringify(vesselResponse.body));
  const vesselId = vesselResponse.body.id;
  const smallerVesselResponse = await call("POST", "/api/vessels", B.cookie, {
    vesselName: "Capacity Race Smaller Vessel",
    vesselType: "DRY_CARGO",
    totalCapacityTonnes: 1_000,
    cargoCompatibility: ["dry bulk"],
  });
  assert.equal(
    smallerVesselResponse.status,
    201,
    JSON.stringify(smallerVesselResponse.body),
  );
  const smallerVesselId = smallerVesselResponse.body.id;
  const offer = await call(
    "POST",
    "/api/capacity",
    B.cookie,
    capacityPayload(vesselId, {
      availableCapacityTonnes: 1_500,
      notes: "Capacity validation race",
    }),
  );
  assert.equal(offer.status, 201, JSON.stringify(offer.body));

  const heldLock = await holdDomainLock();
  const switchPromise = call(
    "PATCH",
    `/api/capacity/${offer.body.id}`,
    B.cookie,
    { vesselId: smallerVesselId },
  );
  await waitForDomainWaiters(1);
  const reductionPromise = call(
    "PATCH",
    `/api/vessels/${vesselId}`,
    B.cookie,
    { totalCapacityTonnes: 1_000 },
  );
  await waitForDomainWaiters(2);
  heldLock.release();
  const [switchResponse, reductionResponse] = await Promise.all([
    switchPromise,
    reductionPromise,
  ]);
  await heldLock.transaction;

  assert.equal(switchResponse.status, 400, JSON.stringify(switchResponse.body));
  assert.equal(
    reductionResponse.status,
    409,
    JSON.stringify(reductionResponse.body),
  );
  const [storedVessel] = await db
    .select({ totalCapacityTonnes: vesselsTable.totalCapacityTonnes })
    .from(vesselsTable)
    .where(eq(vesselsTable.id, vesselId));
  const [storedOffer] = await db
    .select({
      vesselId: capacityOffersTable.vesselId,
      availableCapacityTonnes: capacityOffersTable.availableCapacityTonnes,
    })
    .from(capacityOffersTable)
    .where(eq(capacityOffersTable.id, offer.body.id));
  assert.equal(storedVessel.totalCapacityTonnes, 2_000);
  assert.equal(storedOffer.vesselId, vesselId);
  assert.equal(storedOffer.availableCapacityTonnes, 1_500);
});

test("listing changes recalculate score and concurrent acceptance creates one conversation", async () => {
  const vesselResponse = await call("GET", "/api/vessels", B.cookie);
  const vesselId = vesselResponse.body.items.find(
    (item: any) => item.vesselName === "Carrier Vessel",
  ).id;
  const cargo = await call(
    "POST",
    "/api/cargo",
    A.cookie,
    cargoPayload({ cargoName: "Score change cargo", weightTonnes: 1_000 }),
  );
  const capacity = await call(
    "POST",
    "/api/capacity",
    B.cookie,
    capacityPayload(vesselId, { availableCapacityTonnes: 1_600 }),
  );
  const before = await call("GET", "/api/matches", A.cookie);
  const match = before.body.items.find(
    (item: any) =>
      item.cargoListingId === cargo.body.id &&
      item.capacityOfferId === capacity.body.id,
  );
  assert.ok(match);
  const update = await call(
    "PATCH",
    `/api/cargo/${cargo.body.id}`,
    A.cookie,
    { loadingLocationId: locations.Dordrecht },
  );
  assert.equal(update.status, 200, JSON.stringify(update.body));
  const afterUpdate = await call("GET", "/api/matches", A.cookie);
  const updatedMatch = afterUpdate.body.items.find((item: any) => item.id === match.id);
  assert.ok(updatedMatch);
  assert.notEqual(
    updatedMatch.score.components.distanceScore,
    match.score.components.distanceScore,
  );

  const secondCargo = await call(
    "POST",
    "/api/cargo",
    A.cookie,
    cargoPayload({ cargoName: "Concurrent cargo" }),
  );
  const secondCapacity = await call(
    "POST",
    "/api/capacity",
    B.cookie,
    capacityPayload(vesselId, { availableCapacityTonnes: 1_700 }),
  );
  const currentMatches = await call("GET", "/api/matches", A.cookie);
  const concurrentMatch = currentMatches.body.items.find(
    (item: any) =>
      item.cargoListingId === secondCargo.body.id &&
      item.capacityOfferId === secondCapacity.body.id,
  );
  assert.ok(concurrentMatch);
  const interest = await call(
    "POST",
    `/api/matches/${concurrentMatch.id}/actions`,
    A.cookie,
    { action: "INTEREST" },
  );
  assert.equal(interest.status, 200);
  const accepts = await Promise.all([
    call(
      "POST",
      `/api/matches/${concurrentMatch.id}/actions`,
      B.cookie,
      { action: "ACCEPT" },
    ),
    call(
      "POST",
      `/api/matches/${concurrentMatch.id}/actions`,
      B.cookie,
      { action: "ACCEPT" },
    ),
  ]);
  assert.equal(accepts.filter((response) => response.status === 200).length, 1);
  assert.equal(accepts.filter((response) => response.status === 422 || response.status === 409).length, 1);
  const conversations = await db
    .select()
    .from(conversationsTable)
    .innerJoin(matchesTable, eq(matchesTable.id, conversationsTable.matchId))
    .where(eq(matchesTable.id, concurrentMatch.id));
  assert.equal(conversations.length, 1);
});

test("recalculation preserves consent until a material edit, and terminal listings cannot revive", async () => {
  const vesselResponse = await call("GET", "/api/vessels", B.cookie);
  const vesselId = vesselResponse.body.items.find(
    (item: any) => item.vesselName === "Carrier Vessel",
  ).id;
  const cargo = await call(
    "POST",
    "/api/cargo",
    C.cookie,
    cargoPayload({ cargoName: "Consent lifecycle cargo" }),
  );
  const capacity = await call(
    "POST",
    "/api/capacity",
    B.cookie,
    capacityPayload(vesselId),
  );
  const before = await call("GET", "/api/matches", C.cookie);
  const match = before.body.items.find(
    (item: any) =>
      item.cargoListingId === cargo.body.id &&
      item.capacityOfferId === capacity.body.id,
  );
  assert.ok(match);
  const interest = await call(
    "POST",
    `/api/matches/${match.id}/actions`,
    C.cookie,
    { action: "INTEREST" },
  );
  assert.equal(interest.status, 200);

  const unchangedRecalculation = await call(
    "POST",
    "/api/cargo",
    C.cookie,
    cargoPayload({ cargoName: "Unrelated cargo" }),
  );
  assert.equal(unchangedRecalculation.status, 201);
  const pending = await call("GET", `/api/matches/${match.id}`, C.cookie);
  assert.equal(pending.status, 200);
  assert.equal(pending.body.status, "INTEREST_SENT");
  assert.equal(pending.body.initiatedByMe, true);

  const edited = await call(
    "PATCH",
    `/api/cargo/${cargo.body.id}`,
    C.cookie,
    { specialRequirements: "Edited requirements" },
  );
  assert.equal(edited.status, 200);
  const reset = await call("GET", `/api/matches/${match.id}`, C.cookie);
  assert.equal(reset.status, 200);
  assert.equal(reset.body.status, "NEW");
  assert.equal(reset.body.initiatedByMe, false);
  const interests = await db
    .select()
    .from(interestsTable)
    .where(eq(interestsTable.matchId, match.id));
  assert.equal(interests.length, 0);
  assert.equal(
    (await call(
      "POST",
      `/api/matches/${match.id}/actions`,
      C.cookie,
      { action: "INTEREST" },
    )).status,
    200,
  );
  assert.equal(
    (await call(
      "POST",
      `/api/matches/${match.id}/actions`,
      C.cookie,
      { action: "DECLINE" },
    )).status,
    422,
  );
  assert.equal(
    (await call(
      "POST",
      `/api/matches/${match.id}/actions`,
      B.cookie,
      { action: "DECLINE" },
    )).status,
    200,
  );

  const terminalCargo = await call(
    "POST",
    "/api/cargo",
    C.cookie,
    cargoPayload({ cargoName: "Terminal cargo" }),
  );
  assert.equal(
    (await call(
      "POST",
      `/api/cargo/${terminalCargo.body.id}/withdraw`,
      C.cookie,
    )).status,
    200,
  );
  const revived = await call(
    "PATCH",
    `/api/cargo/${terminalCargo.body.id}`,
    C.cookie,
    { listingStatus: "ACTIVE" },
  );
  assert.equal(revived.status, 409);
});

test("concurrent cargo withdraw and publish cannot revive a terminal listing", async () => {
  const cargo = await call(
    "POST",
    "/api/cargo",
    A.cookie,
    cargoPayload({ cargoName: "Deterministic cargo race" }),
  );
  assert.equal(cargo.status, 201);
  const heldLock = await holdDomainLock();
  const withdrawPromise = call(
    "POST",
    `/api/cargo/${cargo.body.id}/withdraw`,
    A.cookie,
  );
  await waitForDomainWaiters(1);
  const publishPromise = call("PATCH", `/api/cargo/${cargo.body.id}`, A.cookie, {
    listingStatus: "ACTIVE",
    notes: "publish race",
  });
  await waitForDomainWaiters(2);
  heldLock.release();
  const [withdraw, publish] = await Promise.all([
    withdrawPromise,
    publishPromise,
  ]);
  await heldLock.transaction;
  assert.equal(withdraw.status, 200, JSON.stringify(withdraw.body));
  assert.ok([200, 409].includes(publish.status), JSON.stringify(publish.body));
  const [stored] = await db
    .select({ listingStatus: cargoListingsTable.listingStatus })
    .from(cargoListingsTable)
    .where(eq(cargoListingsTable.id, cargo.body.id));
  assert.equal(stored.listingStatus, "WITHDRAWN");
});

test("concurrent capacity withdraw and publish cannot revive a terminal listing", async () => {
  const vesselResponse = await call("GET", "/api/vessels", B.cookie);
  const capacity = await call(
    "POST",
    "/api/capacity",
    B.cookie,
    capacityPayload(
      vesselResponse.body.items.find(
        (item: any) => item.vesselName === "Carrier Vessel",
      ).id,
      {
        notes: "Deterministic capacity race",
      },
    ),
  );
  assert.equal(capacity.status, 201);
  const heldLock = await holdDomainLock();
  const withdrawPromise = call(
    "POST",
    `/api/capacity/${capacity.body.id}/withdraw`,
    B.cookie,
  );
  await waitForDomainWaiters(1);
  const publishPromise = call(
    "PATCH",
    `/api/capacity/${capacity.body.id}`,
    B.cookie,
    {
      listingStatus: "ACTIVE",
      notes: "publish race",
    },
  );
  await waitForDomainWaiters(2);
  heldLock.release();
  const [withdraw, publish] = await Promise.all([
    withdrawPromise,
    publishPromise,
  ]);
  await heldLock.transaction;
  assert.equal(withdraw.status, 200, JSON.stringify(withdraw.body));
  assert.ok([200, 409].includes(publish.status), JSON.stringify(publish.body));
  const [stored] = await db
    .select({ listingStatus: capacityOffersTable.listingStatus })
    .from(capacityOffersTable)
    .where(eq(capacityOffersTable.id, capacity.body.id));
  assert.equal(stored.listingStatus, "WITHDRAWN");
});

test("members cannot mutate listings and decline is counterparty-only", async () => {
  assert.ok(A.company);
  const denied = await call(
    "PATCH",
    `/api/cargo/${primaryCargoId}`,
    D.cookie,
    { notes: "member must not edit" },
  );
  assert.equal(denied.status, 403);
});