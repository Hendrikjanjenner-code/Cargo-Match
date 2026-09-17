import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after, before } from "node:test";

import app from "../src/app";
import { verifyAisIdentity } from "../src/services/aisIdentityVerification";
import { registerAisIdentity } from "../src/services/aisIdentity";
import {
  addTestMembership,
  createTestIdentity,
  disposeTestIdentity,
} from "./support/testIdentity";
import {
  db,
  locationsTable,
  vesselExternalIdentifiersTable,
  availabilitySuggestionsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

type Identity = Awaited<ReturnType<typeof createTestIdentity>>;
type ApiResponse = { status: number; body: any; headers: Headers };

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let owner: Identity;
let member: Identity;
let otherOwner: Identity;
let vesselId = "";
let locationId = "";
let alternateLocationId = "";
let suggestionId = "";

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
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    headers: response.headers,
  };
}

async function createVessel() {
  const response = await call("POST", "/api/vessels", owner.cookie, {
    vesselName: `Suggestion vessel ${Date.now()}`,
    vesselType: "DRY_CARGO",
    totalCapacityTonnes: 2_000,
    cargoCompatibility: ["dry bulk"],
    active: true,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.id as string;
}

before(async () => {
  process.env.NODE_ENV = "test";
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  owner = await createTestIdentity();
  member = await createTestIdentity({ withCompany: false });
  otherOwner = await createTestIdentity();
  assert.ok(owner.company);
  await addTestMembership(member.user.id, owner.company.id, "MEMBER");
  vesselId = await createVessel();
  const locations = await db
    .select({ id: locationsTable.id })
    .from(locationsTable)
    .where(eq(locationsTable.active, true))
    .limit(2);
  assert.ok(locations.length >= 2);
  locationId = locations[0].id;
  alternateLocationId = locations[1].id;
  const mapping = await registerAisIdentity({
    actorUserId: owner.user.id,
    companyId: owner.company.id,
    vesselId,
    identifierType: "MMSI",
    identifierValue: "244123987",
  });
  await verifyAisIdentity({
    companyId: owner.company.id,
    vesselId,
    mappingId: mapping.id,
    evidence: {
      source: "fixture",
      reference: "fixture://suggestion",
      capturedAt: new Date().toISOString(),
    },
  });
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const identity of [owner, member, otherOwner]) {
    if (identity) await disposeTestIdentity(identity);
  }
});

function suggestionPayload(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    vesselId,
    locationId,
    expectedAvailableFrom: "2030-06-01T00:00:00.000Z",
    expectedAvailableUntil: "2030-06-02T00:00:00.000Z",
    sourceReference: "operator plan fixture",
    sourceObservedAt: now.toISOString(),
    participationConfirmed: true,
    sourceUseConfirmed: true,
    uncertaintyAcknowledged: true,
    ...overrides,
  };
}

function capacityPayload(overrides: Record<string, unknown> = {}) {
  return {
    vesselId,
    locationId,
    availableFrom: "2030-06-01T00:00:00.000Z",
    availableUntil: "2030-06-02T00:00:00.000Z",
    availabilityType: "FULLY_EMPTY",
    availableCapacityTonnes: 500,
    cargoCompatibility: ["dry bulk"],
    preferredDirection: "North",
    maximumPositioningDistanceKm: 25,
    visibility: "PRIVATE",
    listingStatus: "DRAFT",
    availabilityConfidence: "EXPECTED",
    availabilitySuggestionId: suggestionId,
    suggestionConfirmed: true,
    ...overrides,
  };
}

async function createSuggestion(overrides: Record<string, unknown> = {}) {
  return call(
    "POST",
    "/api/availability-suggestions",
    owner.cookie,
    suggestionPayload(overrides),
  );
}

test("suggestions require reviewed identity, stay private, and convert once", async () => {
  const created = await createSuggestion();
  assert.equal(created.status, 201, JSON.stringify(created.body));
  suggestionId = created.body.id;

  const memberRead = await call(
    "GET",
    "/api/availability-suggestions",
    member.cookie,
  );
  assert.equal(memberRead.status, 403);
  const otherRead = await call(
    "GET",
    "/api/availability-suggestions",
    otherOwner.cookie,
  );
  assert.equal(otherRead.status, 200);
  assert.deepEqual(otherRead.body.items, []);
  assert.equal(otherRead.headers.get("cache-control"), "private, no-store");
  const crossTenantDismiss = await call(
    "POST",
    `/api/availability-suggestions/${suggestionId}/dismiss`,
    otherOwner.cookie,
  );
  assert.equal(crossTenantDismiss.status, 404);
  const listed = await call(
    "GET",
    "/api/availability-suggestions",
    owner.cookie,
  );
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.items[0].status, "PENDING");
  assert.equal(listed.body.items[0].uncertainty, "UNCERTAIN");
  assert.equal(listed.body.items[0].canConfirm, true);

  const converted = await call(
    "POST",
    "/api/capacity",
    owner.cookie,
    capacityPayload({
      locationId: alternateLocationId,
      availableFrom: "2030-06-03T00:00:00.000Z",
      availableUntil: "2030-06-04T00:00:00.000Z",
    }),
  );
  assert.equal(converted.status, 201, JSON.stringify(converted.body));
  assert.equal(converted.body.listingStatus, "DRAFT");
  assert.equal(converted.body.availabilityConfidence, "EXPECTED");

  const duplicate = await call(
    "POST",
    "/api/capacity",
    owner.cookie,
    capacityPayload(),
  );
  assert.equal(duplicate.status, 409);
  const after = await call(
    "GET",
    "/api/availability-suggestions",
    owner.cookie,
  );
  assert.equal(after.body.items[0].status, "CONVERTED");
  assert.equal(after.body.items[0].capacityOfferId, converted.body.id);
});

test("manual fallback remains available without a suggestion", async () => {
  const response = await call("POST", "/api/capacity", owner.cookie, {
    ...capacityPayload(),
    availabilitySuggestionId: undefined,
    suggestionConfirmed: undefined,
    availabilityConfidence: "CONFIRMED",
    availableFrom: "2030-07-01T00:00:00.000Z",
    availableUntil: "2030-07-02T00:00:00.000Z",
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.availabilityConfidence, "CONFIRMED");
});

test("validation and explicit confirmation failures leave a suggestion pending", async () => {
  const unverifiedVessel = await createVessel();
  const unverified = await createSuggestion({ vesselId: unverifiedVessel });
  assert.equal(unverified.status, 409);

  const falseAcknowledgement = await createSuggestion({
    participationConfirmed: false,
  });
  assert.equal(falseAcknowledgement.status, 400);
  const stale = await createSuggestion({
    sourceObservedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(stale.status, 400);

  const created = await createSuggestion();
  assert.equal(created.status, 201);
  suggestionId = created.body.id;
  const invalidCapacity = await call(
    "POST",
    "/api/capacity",
    owner.cookie,
    capacityPayload({ availableCapacityTonnes: 50_000 }),
  );
  assert.equal(invalidCapacity.status, 400);
  const notConfirmed = await call(
    "POST",
    "/api/capacity",
    owner.cookie,
    capacityPayload({ suggestionConfirmed: false }),
  );
  assert.equal(notConfirmed.status, 400);
  const active = await call(
    "POST",
    "/api/capacity",
    owner.cookie,
    capacityPayload({ listingStatus: "ACTIVE" }),
  );
  assert.equal(active.status, 400);
  const listed = await call(
    "GET",
    "/api/availability-suggestions",
    owner.cookie,
  );
  const pending = listed.body.items.find(
    (item: { id: string }) => item.id === suggestionId,
  );
  assert.equal(pending.status, "PENDING");
});

test("concurrent confirmation creates at most one capacity and dismiss prevents conversion", async () => {
  const concurrent = await createSuggestion();
  assert.equal(concurrent.status, 201);
  suggestionId = concurrent.body.id;
  const responses = await Promise.all([
    call("POST", "/api/capacity", owner.cookie, capacityPayload()),
    call("POST", "/api/capacity", owner.cookie, capacityPayload()),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status).sort((a, b) => a - b),
    [201, 409],
  );

  const dismissed = await createSuggestion();
  assert.equal(dismissed.status, 201);
  suggestionId = dismissed.body.id;
  const dismiss = await call(
    "POST",
    `/api/availability-suggestions/${suggestionId}/dismiss`,
    owner.cookie,
  );
  assert.equal(dismiss.status, 200);
  const afterDismiss = await call(
    "POST",
    "/api/capacity",
    owner.cookie,
    capacityPayload(),
  );
  assert.equal(afterDismiss.status, 409);
});

test("expired and revoked suggestions cannot be confirmed", async () => {
  const elapsedStart = await createSuggestion();
  assert.equal(elapsedStart.status, 201);
  suggestionId = elapsedStart.body.id;
  await db
    .update(availabilitySuggestionsTable)
    .set({ expectedAvailableFrom: new Date(Date.now() - 1_000) })
    .where(eq(availabilitySuggestionsTable.id, suggestionId));
  const elapsedConversion = await call(
    "POST",
    "/api/capacity",
    owner.cookie,
    capacityPayload({
      locationId: alternateLocationId,
      availableFrom: "2030-08-01T00:00:00.000Z",
      availableUntil: "2030-08-02T00:00:00.000Z",
    }),
  );
  assert.equal(elapsedConversion.status, 409);

  const expired = await createSuggestion();
  assert.equal(expired.status, 201);
  suggestionId = expired.body.id;
  await db
    .update(availabilitySuggestionsTable)
    .set({ expiresAt: new Date(Date.now() - 1_000) })
    .where(eq(availabilitySuggestionsTable.id, suggestionId));
  const expiredConversion = await call(
    "POST",
    "/api/capacity",
    owner.cookie,
    capacityPayload(),
  );
  assert.equal(expiredConversion.status, 409);

  const revoked = await createSuggestion();
  assert.equal(revoked.status, 201);
  suggestionId = revoked.body.id;
  await db
    .update(vesselExternalIdentifiersTable)
    .set({ verified: false, operatorReviewedAt: null, verifiedAt: null })
    .where(eq(vesselExternalIdentifiersTable.vesselId, vesselId));
  const listed = await call(
    "GET",
    "/api/availability-suggestions",
    owner.cookie,
  );
  const row = listed.body.items.find(
    (item: { id: string }) => item.id === suggestionId,
  );
  assert.equal(row.status, "INVALIDATED");
  const revokedConversion = await call(
    "POST",
    "/api/capacity",
    owner.cookie,
    capacityPayload(),
  );
  assert.equal(revokedConversion.status, 409);
});