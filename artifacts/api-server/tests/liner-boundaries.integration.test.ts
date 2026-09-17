import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after, before } from "node:test";

import app from "../src/app";
import {
  addTestMembership,
  createTestIdentity,
  disposeTestIdentity,
} from "./support/testIdentity";

type Identity = Awaited<ReturnType<typeof createTestIdentity>>;
type ApiResponse = { status: number; body: any };

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let carrier: Identity;
let shipper: Identity;
let otherCarrier: Identity;
let member: Identity;
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

function companyPayload(name: string, activities: string[]) {
  return {
    name,
    country: "SG",
    activities,
    primaryContactName: "Liner Boundary Pilot",
    email: `${name.toLowerCase().replaceAll(" ", ".")}@example.invalid`,
    phone: "+6500000000",
    termsAccepted: true,
    privacyAccepted: true,
  };
}

async function register(
  identity: Identity,
  name: string,
  activities: string[],
) {
  const response = await call(
    "POST",
    "/api/company",
    identity.cookie,
    companyPayload(name, activities),
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  identity.company = response.body;
}

function linerVesselPayload(overrides: Record<string, unknown> = {}) {
  return {
    vesselName: "MV Liner Boundary",
    imoNumber: "9300001",
    ...overrides,
  };
}

function rotation(origin = locations.Singapore, destination = locations.Qingdao) {
  return [
    {
      locationId: origin,
      sequence: 1,
      estimatedArrival: "2035-06-20T00:00:00.000Z",
      estimatedDeparture: "2035-06-20T01:00:00.000Z",
    },
    {
      locationId: destination,
      sequence: 2,
      estimatedArrival: "2035-06-25T00:00:00.000Z",
      estimatedDeparture: "2035-06-25T01:00:00.000Z",
    },
  ];
}

function commercialCapacity(overrides: Record<string, unknown> = {}) {
  return {
    availableCommercialTonnes: 1_000,
    maximumPieceWeightTonnes: 10,
    maximumPieceLengthMetres: 10,
    maximumPieceWidthMetres: 10,
    maximumPieceHeightMetres: 10,
    liftingCapacityTonnes: 20,
    stowage: "HOLD",
    acceptedCargoTypes: ["BREAKBULK"],
    ...overrides,
  };
}

function sailingPayload(
  linerVesselId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    linerVesselId,
    voyageReference: "LB-2035-01",
    departureAt: "2035-06-20T00:00:00.000Z",
    cargoCutoffAt: "2035-06-10T00:00:00.000Z",
    visibility: "OPEN_NETWORK",
    listingStatus: "ACTIVE",
    portRotation: rotation(),
    commercialCapacity: commercialCapacity(),
    notes: "Liner boundary fixture",
    ...overrides,
  };
}

function cargoPayload(
  overrides: Record<string, unknown> = {},
) {
  return {
    cargoName: "Boundary breakbulk cargo",
    cargoType: "BREAKBULK",
    pieceCount: 10,
    // Ten pieces can have a heaviest piece of 10 t while the actual total is
    // 95 t; this is a valid mixed-piece cargo fixture.
    totalWeightTonnes: 95,
    pieceWeightTonnes: 10,
    pieceLengthMetres: 5,
    pieceWidthMetres: 5,
    pieceHeightMetres: 5,
    requiredLiftingTonnes: 10,
    requiredStowage: "HOLD",
    originLocationId: locations.Singapore,
    destinationLocationId: locations.Qingdao,
    readyAt: "2035-06-01T00:00:00.000Z",
    visibility: "OPEN_NETWORK",
    listingStatus: "ACTIVE",
    notes: "Private boundary fixture notes",
    ...overrides,
  };
}

function assertNotCreated(response: ApiResponse) {
  assert.ok(
    [400, 403, 404, 409].includes(response.status),
    `expected a rejected mutation, got ${response.status}: ${JSON.stringify(response.body)}`,
  );
}

before(async () => {
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;

  carrier = await createTestIdentity({ withCompany: false });
  shipper = await createTestIdentity({ withCompany: false });
  otherCarrier = await createTestIdentity({ withCompany: false });
  member = await createTestIdentity({ withCompany: false });

  await register(carrier, `Liner Carrier ${carrier.user.id.slice(-8)}`, ["CARRIER"]);
  await register(shipper, `Liner Shipper ${shipper.user.id.slice(-8)}`, ["SHIPPER"]);
  await register(
    otherCarrier,
    `Other Liner Carrier ${otherCarrier.user.id.slice(-8)}`,
    ["CARRIER"],
  );
  assert.ok(carrier.company && shipper.company && otherCarrier.company);
  await addTestMembership(member.user.id, carrier.company.id, "MEMBER");
  const ownerCompany = await call("GET", "/api/company", carrier.cookie);
  assert.equal(ownerCompany.body.membershipRole, "OWNER");
  const memberCompany = await call("GET", "/api/company", member.cookie);
  assert.equal(memberCompany.body.membershipRole, "MEMBER");

  const locationResponse = await call("GET", "/api/locations?pageSize=100");
  assert.equal(locationResponse.status, 200, JSON.stringify(locationResponse.body));
  for (const item of locationResponse.body.items) locations[item.name] = item.id;
  assert.ok(
    locations.Singapore && locations.Qingdao,
    "the reviewed liner location seed must be applied before integration tests",
  );
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const identity of [carrier, shipper, otherCarrier, member]) {
    if (identity) await disposeTestIdentity(identity);
  }
});

test("liner vertical enforces tenant, role, privacy, and matching boundaries", async () => {
  assert.ok(carrier.company && shipper.company && otherCarrier.company);

  // Liner vessels are actual carrier-owned records. Shippers and ordinary
  // members cannot create them, while another carrier is a separate tenant.
  assert.equal(
    (await call("POST", "/api/liner/vessels", shipper.cookie, linerVesselPayload())).status,
    403,
  );
  assert.equal(
    (await call("POST", "/api/liner/vessels", member.cookie, linerVesselPayload())).status,
    403,
  );
  const vesselResponse = await call(
    "POST",
    "/api/liner/vessels",
    carrier.cookie,
    linerVesselPayload(),
  );
  assert.equal(vesselResponse.status, 201, JSON.stringify(vesselResponse.body));
  const vesselId = vesselResponse.body.id;

  const otherVesselResponse = await call(
    "POST",
    "/api/liner/vessels",
    otherCarrier.cookie,
    linerVesselPayload({ vesselName: "MV Other Liner", imoNumber: "9300002" }),
  );
  assert.equal(otherVesselResponse.status, 201, JSON.stringify(otherVesselResponse.body));
  const otherVesselId = otherVesselResponse.body.id;
  const otherVessels = await call("GET", "/api/liner/vessels", otherCarrier.cookie);
  assert.equal(otherVessels.status, 200);
  assert.equal(otherVessels.body.items.some((item: any) => item.id === vesselId), false);
  assert.equal(
    (await call("GET", `/api/liner/vessels/${vesselId}`, otherCarrier.cookie)).status,
    404,
  );
  assert.equal(
    (await call(
      "PATCH",
      `/api/liner/vessels/${vesselId}`,
      otherCarrier.cookie,
      { active: false },
    )).status,
    404,
  );

  // Service ownership and carrier activity are checked before a service can
  // be used to publish a sailing.
  assert.equal(
    (await call(
      "POST",
      "/api/liner/services",
      shipper.cookie,
      {
        serviceName: "Shipper cannot publish",
        tradeLane: "Singapore-Qingdao",
        visibility: "OPEN_NETWORK",
        listingStatus: "ACTIVE",
      },
    )).status,
    403,
  );
  assert.equal(
    (await call(
      "POST",
      "/api/liner/services",
      member.cookie,
      {
        serviceName: "Member cannot publish",
        tradeLane: "Singapore-Qingdao",
        visibility: "OPEN_NETWORK",
        listingStatus: "ACTIVE",
      },
    )).status,
    403,
  );
  const serviceResponse = await call(
    "POST",
    "/api/liner/services",
    carrier.cookie,
    {
      serviceName: "Boundary Asia Service",
      tradeLane: "Singapore-Qingdao",
      visibility: "OPEN_NETWORK",
      listingStatus: "ACTIVE",
      notes: "Carrier-only service notes",
    },
  );
  assert.equal(serviceResponse.status, 201, JSON.stringify(serviceResponse.body));
  const serviceId = serviceResponse.body.id;

  const privateServiceResponse = await call(
    "POST",
    "/api/liner/services",
    carrier.cookie,
    {
      serviceName: "Private Boundary Service",
      tradeLane: "Singapore-Qingdao",
      visibility: "PRIVATE",
      listingStatus: "ACTIVE",
    },
  );
  assert.equal(privateServiceResponse.status, 201, JSON.stringify(privateServiceResponse.body));
  const privateServiceId = privateServiceResponse.body.id;

  const draftServiceResponse = await call(
    "POST",
    "/api/liner/services",
    carrier.cookie,
    {
      serviceName: "Draft Boundary Service",
      tradeLane: "Singapore-Qingdao",
      visibility: "OPEN_NETWORK",
      listingStatus: "DRAFT",
    },
  );
  assert.equal(draftServiceResponse.status, 201, JSON.stringify(draftServiceResponse.body));
  const draftServiceId = draftServiceResponse.body.id;

  // Cross-tenant list and direct reads never disclose an owned resource.
  const otherServices = await call("GET", "/api/liner/services", otherCarrier.cookie);
  assert.equal(otherServices.status, 200);
  assert.equal(otherServices.body.items.some((item: any) => item.id === serviceId), false);
  assert.equal(
    (await call("GET", `/api/liner/services/${serviceId}`, otherCarrier.cookie)).status,
    404,
  );
  assert.equal(
    (await call(
      "PATCH",
      `/api/liner/services/${serviceId}`,
      otherCarrier.cookie,
      { serviceName: "Cross-tenant patch" },
    )).status,
    404,
  );
  assert.equal(
    (await call(
      "POST",
      `/api/liner/services/${serviceId}/withdraw`,
      otherCarrier.cookie,
    )).status,
    404,
  );

  // A sailing cannot use a vessel or service belonging to another carrier.
  const mismatchedVessel = await call(
    "POST",
    `/api/liner/services/${serviceId}/sailings`,
    carrier.cookie,
    sailingPayload(otherVesselId, { voyageReference: "mismatched-vessel" }),
  );
  assertNotCreated(mismatchedVessel);
  const mismatchedService = await call(
    "POST",
    `/api/liner/services/${serviceId}/sailings`,
    otherCarrier.cookie,
    sailingPayload(otherVesselId, { voyageReference: "mismatched-service" }),
  );
  assertNotCreated(mismatchedService);

  assert.equal(
    (await call(
      "POST",
      `/api/liner/services/${serviceId}/sailings`,
      shipper.cookie,
      sailingPayload(vesselId, { voyageReference: "shipper-cannot-sail" }),
    )).status,
    403,
  );
  const invalidCutoff = await call(
    "POST",
    `/api/liner/services/${serviceId}/sailings`,
    carrier.cookie,
    sailingPayload(vesselId, {
      voyageReference: "invalid-cutoff",
      departureAt: "2035-06-10T00:00:00.000Z",
    }),
  );
  assert.equal(invalidCutoff.status, 400, JSON.stringify(invalidCutoff.body));

  const sailingResponse = await call(
    "POST",
    `/api/liner/services/${serviceId}/sailings`,
    carrier.cookie,
    sailingPayload(vesselId),
  );
  assert.equal(sailingResponse.status, 201, JSON.stringify(sailingResponse.body));
  const sailingId = sailingResponse.body.id;
  const invalidDepartureOnlyPatch = await call(
    "PATCH",
    `/api/liner/sailings/${sailingId}`,
    carrier.cookie,
    { departureAt: "2035-06-21T00:00:00.000Z" },
  );
  assert.equal(
    invalidDepartureOnlyPatch.status,
    400,
    JSON.stringify(invalidDepartureOnlyPatch.body),
  );

  const privateSailingResponse = await call(
    "POST",
    `/api/liner/services/${privateServiceId}/sailings`,
    carrier.cookie,
    sailingPayload(vesselId, {
      voyageReference: "private-sailing",
      visibility: "PRIVATE",
    }),
  );
  assert.equal(privateSailingResponse.status, 201, JSON.stringify(privateSailingResponse.body));
  const privateSailingId = privateSailingResponse.body.id;

  const draftSailingResponse = await call(
    "POST",
    `/api/liner/services/${draftServiceId}/sailings`,
    carrier.cookie,
    sailingPayload(vesselId, {
      voyageReference: "draft-sailing",
      listingStatus: "DRAFT",
    }),
  );
  assert.equal(draftSailingResponse.status, 201, JSON.stringify(draftSailingResponse.body));
  const draftSailingId = draftSailingResponse.body.id;

  assert.equal(
    (await call("GET", `/api/liner/sailings/${sailingId}`, otherCarrier.cookie)).status,
    404,
  );
  assert.equal(
    (await call(
      "PATCH",
      `/api/liner/sailings/${sailingId}`,
      otherCarrier.cookie,
      { voyageReference: "cross-tenant patch" },
    )).status,
    404,
  );
  assert.equal(
    (await call("POST", `/api/liner/sailings/${sailingId}/withdraw`, otherCarrier.cookie)).status,
    404,
  );
  assert.equal(
    (await call(
      "PATCH",
      `/api/liner/vessels/${vesselId}`,
      shipper.cookie,
      { active: false },
    )).status,
    403,
  );
  assert.equal(
    (await call(
      "PATCH",
      `/api/liner/services/${serviceId}`,
      shipper.cookie,
      { serviceName: "Shipper cannot patch" },
    )).status,
    403,
  );
  assert.equal(
    (await call(
      "POST",
      `/api/liner/services/${serviceId}/withdraw`,
      shipper.cookie,
    )).status,
    403,
  );
  assert.equal(
    (await call(
      "PATCH",
      `/api/liner/sailings/${sailingId}`,
      shipper.cookie,
      { voyageReference: "shipper cannot patch" },
    )).status,
    403,
  );
  assert.equal(
    (await call(
      "POST",
      `/api/liner/sailings/${sailingId}/withdraw`,
      shipper.cookie,
    )).status,
    403,
  );

  // Only open, active liner records are discoverable. The owner can still
  // read its private/draft records, but another tenant cannot.
  for (const id of [privateServiceId, draftServiceId]) {
    assert.equal((await call("GET", `/api/liner/services/${id}`, carrier.cookie)).status, 200);
    assert.equal((await call("GET", `/api/liner/services/${id}`, otherCarrier.cookie)).status, 404);
  }
  for (const id of [privateSailingId, draftSailingId]) {
    assert.equal((await call("GET", `/api/liner/sailings/${id}`, carrier.cookie)).status, 200);
    assert.equal((await call("GET", `/api/liner/sailings/${id}`, otherCarrier.cookie)).status, 404);
  }

  const privateCargoResponse = await call(
    "POST",
    "/api/liner/cargo",
    shipper.cookie,
    cargoPayload({
      cargoName: "Private boundary cargo",
      visibility: "PRIVATE",
    }),
  );
  assert.equal(privateCargoResponse.status, 201, JSON.stringify(privateCargoResponse.body));
  const privateCargoId = privateCargoResponse.body.id;

  const draftCargoResponse = await call(
    "POST",
    "/api/liner/cargo",
    shipper.cookie,
    cargoPayload({
      cargoName: "Draft boundary cargo",
      listingStatus: "DRAFT",
    }),
  );
  assert.equal(draftCargoResponse.status, 201, JSON.stringify(draftCargoResponse.body));
  const draftCargoId = draftCargoResponse.body.id;

  assert.equal(
    (await call("POST", "/api/liner/cargo", carrier.cookie, cargoPayload())).status,
    403,
  );
  assert.equal(
    (await call("POST", "/api/liner/cargo", member.cookie, cargoPayload())).status,
    403,
  );
  const cargoResponse = await call(
    "POST",
    "/api/liner/cargo",
    shipper.cookie,
    cargoPayload({ cargoName: "Matched positive-control cargo" }),
  );
  assert.equal(cargoResponse.status, 201, JSON.stringify(cargoResponse.body));
  const cargoId = cargoResponse.body.id;

  const otherCargoList = await call("GET", "/api/liner/cargo", otherCarrier.cookie);
  assert.equal(otherCargoList.status, 200);
  assert.equal(otherCargoList.body.items.some((item: any) => item.id === cargoId), false);
  for (const id of [cargoId, privateCargoId, draftCargoId]) {
    assert.equal((await call("GET", `/api/liner/cargo/${id}`, otherCarrier.cookie)).status, 404);
    assert.equal(
      (await call("PATCH", `/api/liner/cargo/${id}`, otherCarrier.cookie, { cargoName: "leak" }))
        .status,
      404,
    );
    assert.equal(
      (await call("POST", `/api/liner/cargo/${id}/withdraw`, otherCarrier.cookie)).status,
      404,
    );
  }
  assert.equal((await call("GET", `/api/liner/cargo/${cargoId}`, shipper.cookie)).status, 200);
  const carrierCargoPatch = await call(
    "PATCH",
    `/api/liner/cargo/${cargoId}`,
    carrier.cookie,
    { cargoName: "Carrier cannot patch cargo" },
  );
  assert.ok([403, 404].includes(carrierCargoPatch.status));
  const carrierCargoWithdraw = await call(
    "POST",
    `/api/liner/cargo/${cargoId}/withdraw`,
    carrier.cookie,
  );
  assert.ok([403, 404].includes(carrierCargoWithdraw.status));

  const marketplace = await call("GET", "/api/liner/marketplace?pageSize=100", otherCarrier.cookie);
  assert.equal(marketplace.status, 200, JSON.stringify(marketplace.body));
  const marketplaceIds = marketplace.body.items.map((item: any) => item.id);
  assert.ok(marketplaceIds.includes(sailingId));
  assert.ok(marketplaceIds.includes(cargoId));
  const hiddenListings: Array<[string, string]> = [
    ["private service", privateServiceId],
    ["draft service", draftServiceId],
    ["private sailing", privateSailingId],
    ["draft sailing", draftSailingId],
    ["private cargo", privateCargoId],
    ["draft cargo", draftCargoId],
  ];
  for (const [label, hiddenId] of hiddenListings) {
    assert.equal(marketplaceIds.includes(hiddenId), false, `hidden ${label} leaked: ${hiddenId}`);
  }

  // Each hard matching boundary is tested against the same otherwise valid
  // route. No empty match list can make these assertions pass: the positive
  // control must be present first.
  const positiveMatches = await call("GET", "/api/liner/matches", carrier.cookie);
  assert.equal(positiveMatches.status, 200, JSON.stringify(positiveMatches.body));
  const positive = positiveMatches.body.items.find(
    (item: any) => item.linerCargoId === cargoId && item.linerSailingId === sailingId,
  );
  assert.ok(positive, "the compatible liner cargo/sailing pair must match");

  const rejectedCases: Array<[string, Record<string, unknown>]> = [
    ["too-heavy-total", { pieceCount: 1_001, pieceWeightTonnes: 1, totalWeightTonnes: 1_001 }],
    ["too-heavy-piece", { pieceWeightTonnes: 11 }],
    ["too-long", { pieceLengthMetres: 11 }],
    ["too-wide", { pieceWidthMetres: 11 }],
    ["too-tall", { pieceHeightMetres: 11 }],
    ["insufficient-lift", { requiredLiftingTonnes: 21 }],
    ["wrong-stowage", { requiredStowage: "DECK" }],
    ["ready-after-cutoff", { readyAt: "2035-06-11T00:00:00.000Z" }],
    [
      "reversed-rotation",
      {
        originLocationId: locations.Qingdao,
        destinationLocationId: locations.Singapore,
      },
    ],
  ];
  const rejectedCargoIds: Array<[string, string]> = [];
  for (const [name, overrides] of rejectedCases) {
    const response = await call(
      "POST",
      "/api/liner/cargo",
      shipper.cookie,
      cargoPayload({ cargoName: `Rejected ${name}`, ...overrides }),
    );
    assert.equal(response.status, 201, `${name}: ${JSON.stringify(response.body)}`);
    rejectedCargoIds.push([name, response.body.id]);
  }
  const afterRejected = await call("GET", "/api/liner/matches", carrier.cookie);
  assert.equal(afterRejected.status, 200, JSON.stringify(afterRejected.body));
  for (const [name, rejectedCargoId] of rejectedCargoIds) {
    assert.equal(
      afterRejected.body.items.some((item: any) => item.linerCargoId === rejectedCargoId),
      false,
      `ineligible cargo matched (${name}): ${rejectedCargoId}`,
    );
  }

  // The existing generic match feed is mode-isolated: a liner match belongs
  // only to /api/liner/matches, never to the inland/default or deepsea feed.
  const defaultMatches = await call("GET", "/api/matches", carrier.cookie);
  assert.equal(defaultMatches.status, 200);
  assert.equal(
    defaultMatches.body.items.some(
      (item: any) => item.linerCargoId === cargoId || item.linerSailingId === sailingId,
    ),
    false,
  );
  const deepseaMatches = await call(
    "GET",
    "/api/matches?transportMode=DEEPSEA_BULK",
    carrier.cookie,
  );
  assert.equal(deepseaMatches.status, 200);
  assert.equal(
    deepseaMatches.body.items.some(
      (item: any) => item.linerCargoId === cargoId || item.linerSailingId === sailingId,
    ),
    false,
  );

  const invalidPieceCount = await call(
    "POST",
    "/api/liner/cargo",
    shipper.cookie,
    cargoPayload({ cargoName: "Invalid piece count", pieceCount: 0 }),
  );
  assert.equal(invalidPieceCount.status, 400, JSON.stringify(invalidPieceCount.body));

  // Liner matches use the same consent workflow but a separate namespace.
  assert.equal(
    (await call("GET", `/api/liner/matches/${positive.id}`, otherCarrier.cookie)).status,
    404,
  );
  const interest = await call(
    "POST",
    `/api/liner/matches/${positive.id}/actions`,
    shipper.cookie,
    { action: "INTEREST" },
  );
  assert.equal(interest.status, 200, JSON.stringify(interest.body));
  const materialEdit = await call(
    "PATCH",
    `/api/liner/cargo/${cargoId}`,
    shipper.cookie,
    { pieceLengthMetres: 4 },
  );
  assert.equal(materialEdit.status, 200, JSON.stringify(materialEdit.body));
  const staleAccept = await call(
    "POST",
    `/api/liner/matches/${positive.id}/actions`,
    carrier.cookie,
    { action: "ACCEPT" },
  );
  assert.ok(
    [409, 422].includes(staleAccept.status),
    `old consent must be rejected: ${JSON.stringify(staleAccept.body)}`,
  );
  const resetMatches = await call("GET", "/api/liner/matches", carrier.cookie);
  assert.equal(resetMatches.status, 200, JSON.stringify(resetMatches.body));
  const resetMatch = resetMatches.body.items.find((item: any) => item.id === positive.id);
  assert.ok(resetMatch);
  assert.equal(resetMatch.status, "NEW");
  const renewedInterest = await call(
    "POST",
    `/api/liner/matches/${positive.id}/actions`,
    shipper.cookie,
    { action: "INTEREST" },
  );
  assert.equal(renewedInterest.status, 200, JSON.stringify(renewedInterest.body));
  const accepted = await call(
    "POST",
    `/api/liner/matches/${positive.id}/actions`,
    carrier.cookie,
    { action: "ACCEPT" },
  );
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.status, "CONNECTED");
  assert.ok(accepted.body.connectedCargo);
  assert.ok(accepted.body.ownedSailing);

  const carrierConversations = await call("GET", "/api/conversations", carrier.cookie);
  assert.equal(carrierConversations.status, 200);
  const shipperConversations = await call("GET", "/api/conversations", shipper.cookie);
  assert.equal(shipperConversations.status, 200);
  const carrierConversation = carrierConversations.body.items.find(
    (item: any) => item.matchId === positive.id,
  );
  const shipperConversation = shipperConversations.body.items.find(
    (item: any) => item.matchId === positive.id,
  );
  assert.ok(carrierConversation);
  assert.ok(shipperConversation);
  assert.equal(carrierConversation.id, shipperConversation.id);
  assert.equal(
    carrierConversations.body.items.filter((item: any) => item.matchId === positive.id).length,
    1,
  );
  assert.equal(
    (await call("GET", `/api/conversations/${carrierConversation.id}`, otherCarrier.cookie)).status,
    404,
  );

  const firstMessage = await call(
    "POST",
    `/api/conversations/${carrierConversation.id}/messages`,
    shipper.cookie,
    { body: "Liner consent message" },
  );
  assert.equal(firstMessage.status, 201, JSON.stringify(firstMessage.body));
  const carrierMessages = await call(
    "GET",
    `/api/conversations/${carrierConversation.id}/messages`,
    carrier.cookie,
  );
  assert.equal(carrierMessages.status, 200);
  const receivedMessage = carrierMessages.body.items.find(
    (item: any) => item.id === firstMessage.body.id,
  );
  assert.ok(receivedMessage);
  assert.equal(receivedMessage.body, "Liner consent message");
  const read = await call(
    "POST",
    `/api/conversations/${carrierConversation.id}/read`,
    carrier.cookie,
    { messageIds: [firstMessage.body.id] },
  );
  assert.equal(read.status, 200, JSON.stringify(read.body));
  const carrierMessagesAfterRead = await call(
    "GET",
    `/api/conversations/${carrierConversation.id}/messages`,
    carrier.cookie,
  );
  assert.ok(
    carrierMessagesAfterRead.body.items.find((item: any) => item.id === firstMessage.body.id)
      .readAt,
  );
  const secondMessage = await call(
    "POST",
    `/api/conversations/${carrierConversation.id}/messages`,
    carrier.cookie,
    { body: "Carrier received and replied" },
  );
  assert.equal(secondMessage.status, 201, JSON.stringify(secondMessage.body));
  const shipperMessages = await call(
    "GET",
    `/api/conversations/${carrierConversation.id}/messages`,
    shipper.cookie,
  );
  assert.equal(shipperMessages.status, 200);
  assert.ok(shipperMessages.body.items.some((item: any) => item.id === secondMessage.body.id));
  assert.equal(
    (await call(
      "GET",
      `/api/conversations/${carrierConversation.id}/messages`,
      otherCarrier.cookie,
    )).status,
    404,
  );
  assert.equal(
    (await call(
      "POST",
      `/api/conversations/${carrierConversation.id}/messages`,
      otherCarrier.cookie,
      { body: "Third company must not read or write" },
    )).status,
    404,
  );
  assert.equal(
    (await call(
      "POST",
      `/api/conversations/${carrierConversation.id}/read`,
      otherCarrier.cookie,
      { messageIds: [firstMessage.body.id] },
    )).status,
    404,
  );

  const withdrawal = await call(
    "POST",
    `/api/liner/cargo/${cargoId}/withdraw`,
    shipper.cookie,
  );
  assert.equal(withdrawal.status, 200, JSON.stringify(withdrawal.body));
  const connectedAfterWithdrawal = await call(
    "GET",
    `/api/liner/matches/${positive.id}`,
    carrier.cookie,
  );
  assert.equal(connectedAfterWithdrawal.status, 200, JSON.stringify(connectedAfterWithdrawal.body));
  assert.equal(connectedAfterWithdrawal.body.status, "CONNECTED");
  assert.equal(
    (await call("GET", `/api/conversations/${carrierConversation.id}`, carrier.cookie)).status,
    200,
  );

  // Keep a final cross-tenant mutation check after consent has been created.
  assert.equal(
    (await call(
      "PATCH",
      `/api/liner/vessels/${vesselId}`,
      otherCarrier.cookie,
      { active: false },
    )).status,
    404,
  );
});