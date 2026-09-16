import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after, before } from "node:test";

import { eq } from "drizzle-orm";

import app from "../src/app";
import {
  aisProviderManager,
  clearMockVesselMappings,
  registerMockVesselMapping,
} from "../src/services/ais";
import {
  companiesTable,
  db,
} from "@workspace/db";
import {
  createTestIdentity,
  disposeTestIdentity,
  addTestMembership,
} from "./support/testIdentity";

type Identity = Awaited<ReturnType<typeof createTestIdentity>>;
type ApiResponse = { status: number; body: any; headers: Headers };

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let owner: Identity;
let otherCompany: Identity;
let member: Identity;
let vesselId = "";
let capacityVesselId = "";
let locations: Record<string, string> = {};

const savedEnvironment = {
  AIS_MODE: process.env.AIS_MODE,
  AIS_PROVIDER_ORDER: process.env.AIS_PROVIDER_ORDER,
  AIS_MOCK_PRIMARY_SCENARIO: process.env.AIS_MOCK_PRIMARY_SCENARIO,
  AIS_MOCK_VESSEL_MAP: process.env.AIS_MOCK_VESSEL_MAP,
  NODE_ENV: process.env.NODE_ENV,
};

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

function cargoPayload(overrides: Record<string, unknown> = {}) {
  return {
    cargoName: `AIS integration cargo ${owner.user.id.slice(0, 8)}`,
    cargoType: "dry bulk",
    weightTonnes: 1_000,
    loadingLocationId: locations.Rotterdam,
    destinationLocationId: locations.Duisburg,
    loadingFrom: "2030-06-01T00:00:00.000Z",
    loadingUntil: "2030-06-03T00:00:00.000Z",
    expectedUnloadingDate: "2030-06-04",
    requiredVesselType: "DRY_CARGO",
    specialRequirements: "Manual availability remains authoritative",
    visibility: "OPEN_NETWORK",
    notes: "Private integration notes",
    listingStatus: "ACTIVE",
    ...overrides,
  };
}

function capacityPayload(overrides: Record<string, unknown> = {}) {
  return {
    vesselId: capacityVesselId,
    locationId: locations.Rotterdam,
    availableFrom: "2030-05-30T00:00:00.000Z",
    availableUntil: "2030-06-05T00:00:00.000Z",
    availabilityType: "FULLY_EMPTY",
    availableCapacityTonnes: 1_500,
    cargoCompatibility: ["dry bulk"],
    preferredDirection: "Rhine corridor",
    maximumPositioningDistanceKm: 50,
    visibility: "OPEN_NETWORK",
    notes: "Private capacity integration notes",
    listingStatus: "ACTIVE",
    ...overrides,
  };
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.AIS_MODE = "simulation";
  delete process.env.AIS_PROVIDER_ORDER;
  delete process.env.AIS_MOCK_PRIMARY_SCENARIO;
  delete process.env.AIS_MOCK_VESSEL_MAP;
  clearMockVesselMappings();
  aisProviderManager.clearCache();

  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;

  owner = await createTestIdentity();
  otherCompany = await createTestIdentity();
  member = await createTestIdentity({ withCompany: false });
  assert.ok(owner.company && otherCompany.company);
  await addTestMembership(member.user.id, owner.company.id, "MEMBER");

  const locationResponse = await call("GET", "/api/locations?pageSize=100");
  assert.equal(locationResponse.status, 200);
  for (const item of locationResponse.body.items) {
    locations[item.name] = item.id;
  }
  assert.ok(locations.Rotterdam && locations.Duisburg);

  const vesselResponse = await call(
    "POST",
    "/api/vessels",
    owner.cookie,
    {
      vesselName: `AIS integration vessel ${owner.user.id.slice(0, 8)}`,
      vesselType: "DRY_CARGO",
      totalCapacityTonnes: 2_000,
      cargoCompatibility: ["dry bulk"],
      active: true,
    },
  );
  assert.equal(vesselResponse.status, 201, JSON.stringify(vesselResponse.body));
  vesselId = vesselResponse.body.id;
  const capacityVesselResponse = await call(
    "POST",
    "/api/vessels",
    otherCompany.cookie,
    {
      vesselName: `AIS integration capacity vessel ${otherCompany.user.id.slice(0, 8)}`,
      vesselType: "DRY_CARGO",
      totalCapacityTonnes: 2_000,
      cargoCompatibility: ["dry bulk"],
      active: true,
    },
  );
  assert.equal(
    capacityVesselResponse.status,
    201,
    JSON.stringify(capacityVesselResponse.body),
  );
  capacityVesselId = capacityVesselResponse.body.id;
  // This explicit internal UUID mapping is the only identity link used by
  // either simulated provider.
  registerMockVesselMapping(vesselId, {
    "mock-alpha": "alpha-integration-001",
    "mock-beta": "beta-integration-001",
  });
});

after(async () => {
  clearMockVesselMappings();
  aisProviderManager.clearCache();
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const identity of [owner, otherCompany, member]) {
    if (identity) await disposeTestIdentity(identity);
  }
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("AIS route enforces authentication, ownership, member access, and privacy headers", async () => {
  const ownerResponse = await call(
    "GET",
    `/api/vessels/${vesselId}/ais`,
    owner.cookie,
  );
  assert.equal(ownerResponse.status, 200, JSON.stringify(ownerResponse.body));
  assert.equal(ownerResponse.body.status, "AVAILABLE");
  assert.equal(ownerResponse.body.simulation, true);
  assert.equal(ownerResponse.body.cacheHit, false);
  assert.equal(ownerResponse.body.telemetry.provider, "mock-alpha");
  assert.equal(ownerResponse.body.telemetry.providerVesselId, "alpha-integration-001");
  assert.equal(ownerResponse.body.telemetry.imo, null);
  assert.equal(ownerResponse.body.telemetry.eni, null);
  assert.equal(typeof ownerResponse.body.telemetry.receivedAt, "string");
  assert.equal(typeof ownerResponse.body.telemetry.observedAt, "string");
  assert.equal(ownerResponse.body.telemetry.dataFreshness, "FRESH");
  assert.match(
    ownerResponse.headers.get("cache-control") ?? "",
    /private/i,
  );
  assert.match(
    ownerResponse.headers.get("cache-control") ?? "",
    /no-store/i,
  );

  const cached = await call(
    "GET",
    `/api/vessels/${vesselId}/ais`,
    owner.cookie,
  );
  assert.equal(cached.status, 200);
  assert.equal(cached.body.cacheHit, true);
  assert.equal(cached.body.telemetry.providerVesselId, "alpha-integration-001");

  const memberResponse = await call(
    "GET",
    `/api/vessels/${vesselId}/ais`,
    member.cookie,
  );
  assert.equal(memberResponse.status, 200);
  assert.equal(memberResponse.body.status, "AVAILABLE");

  const anonymous = await call("GET", `/api/vessels/${vesselId}/ais`);
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get("cache-control") ?? "", /private/i);
  assert.match(anonymous.headers.get("cache-control") ?? "", /no-store/i);

  const otherTenant = await call(
    "GET",
    `/api/vessels/${vesselId}/ais`,
    otherCompany.cookie,
  );
  assert.equal(otherTenant.status, 404);

  const malformed = await call(
    "GET",
    "/api/vessels/not-a-uuid/ais",
    owner.cookie,
  );
  assert.equal(malformed.status, 400);
});

test("suspended companies cannot read AIS, and simulation is explicit", async () => {
  assert.ok(owner.company);
  await db
    .update(companiesTable)
    .set({ status: "SUSPENDED" })
    .where(eq(companiesTable.id, owner.company.id));
  const suspended = await call(
    "GET",
    `/api/vessels/${vesselId}/ais`,
    owner.cookie,
  );
  assert.equal(suspended.status, 403);
  await db
    .update(companiesTable)
    .set({ status: "ACTIVE" })
    .where(eq(companiesTable.id, owner.company.id));

  delete process.env.AIS_MODE;
  aisProviderManager.clearCache();
  const notConfigured = await call(
    "GET",
    `/api/vessels/${vesselId}/ais`,
    owner.cookie,
  );
  assert.equal(notConfigured.status, 200);
  assert.equal(notConfigured.body.status, "NOT_CONFIGURED");
  assert.equal(notConfigured.body.simulation, false);
  assert.equal(notConfigured.body.telemetry, null);
  assert.deepEqual(notConfigured.body.attempts, []);
  assert.equal(typeof notConfigured.body.checkedAt, "string");

  process.env.AIS_MODE = "simulation";
  process.env.NODE_ENV = "production";
  aisProviderManager.clearCache();
  const productionOff = await call(
    "GET",
    `/api/vessels/${vesselId}/ais`,
    owner.cookie,
  );
  assert.equal(productionOff.status, 200);
  assert.equal(productionOff.body.status, "NOT_CONFIGURED");
  assert.equal(productionOff.body.simulation, false);
  process.env.NODE_ENV = "test";
});

test("both AIS providers can fail without blocking manual matching and consent", async () => {
  process.env.AIS_MODE = "simulation";
  process.env.AIS_MOCK_PRIMARY_SCENARIO = "outage";
  clearMockVesselMappings();
  // Alpha is explicitly mapped and fails by scenario; beta has no mapping and
  // therefore returns NOT_FOUND. No fallback success is possible.
  registerMockVesselMapping(vesselId, {
    "mock-alpha": "alpha-integration-001",
  });
  aisProviderManager.clearCache();

  const unavailable = await call(
    "GET",
    `/api/vessels/${vesselId}/ais`,
    owner.cookie,
  );
  assert.equal(unavailable.status, 200);
  assert.equal(unavailable.body.status, "UNAVAILABLE");
  assert.equal(unavailable.body.telemetry, null);
  assert.deepEqual(unavailable.body.attempts, [
    { provider: "mock-alpha", outcome: "UNAVAILABLE" },
    { provider: "mock-beta", outcome: "NOT_FOUND" },
  ]);

  const cargo = await call(
    "POST",
    "/api/cargo",
    owner.cookie,
    cargoPayload(),
  );
  assert.equal(cargo.status, 201, JSON.stringify(cargo.body));
  const capacity = await call(
    "POST",
    "/api/capacity",
    otherCompany.cookie,
    capacityPayload(),
  );
  assert.equal(capacity.status, 201, JSON.stringify(capacity.body));

  // Existing privacy serializers continue to expose only marketplace-safe
  // fields; AIS identifiers and exact positions never leak into them.
  const marketplace = await call("GET", "/api/marketplace", owner.cookie);
  assert.equal(marketplace.status, 200, JSON.stringify(marketplace.body));
  const marketplaceText = JSON.stringify(marketplace.body);
  for (const field of [
    "providerVesselId",
    "mmsi",
    "imo",
    "observedAt",
    "receivedAt",
    "rawDataReference",
  ]) {
    assert.equal(marketplaceText.includes(field), false, field);
  }

  const matches = await call("GET", "/api/matches", owner.cookie);
  assert.equal(matches.status, 200, JSON.stringify(matches.body));
  const match = matches.body.items.find(
    (item: any) =>
      item.cargoListingId === cargo.body.id &&
      item.capacityOfferId === capacity.body.id,
  );
  assert.ok(match);
  const matchText = JSON.stringify(matches.body);
  assert.equal(matchText.includes("providerVesselId"), false);

  const interest = await call(
    "POST",
    `/api/matches/${match.id}/actions`,
    owner.cookie,
    { action: "INTEREST" },
  );
  assert.equal(interest.status, 200, JSON.stringify(interest.body));
  const accepted = await call(
    "POST",
    `/api/matches/${match.id}/actions`,
    otherCompany.cookie,
    { action: "ACCEPT" },
  );
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.status, "CONNECTED");

  const conversations = await call("GET", "/api/conversations", owner.cookie);
  assert.equal(conversations.status, 200, JSON.stringify(conversations.body));
  const conversationId = conversations.body.items.find(
    (item: any) => item.matchId === match.id,
  )?.id;
  assert.ok(conversationId);
  const message = await call(
    "POST",
    `/api/conversations/${conversationId}/messages`,
    owner.cookie,
    { body: "Manual workflow still works without AIS." },
  );
  assert.equal(message.status, 201, JSON.stringify(message.body));
  assert.equal(message.body.body, "Manual workflow still works without AIS.");
});