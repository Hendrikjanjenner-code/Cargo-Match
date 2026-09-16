import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";

import { db, vesselExternalIdentifiersTable } from "@workspace/db";

import app from "../src/app";
import { getVerifiedAisIdentity } from "../src/services/aisIdentity";
import { verifyAisIdentity } from "../src/services/aisIdentityVerification";
import {
  addTestMembership,
  createTestIdentity,
  disposeTestIdentity,
} from "./support/testIdentity";
import {
  aisIdentityEvidence,
  aisIdentityPayload,
} from "./support/aisIdentityFixtures";

type Identity = Awaited<ReturnType<typeof createTestIdentity>>;
type ApiResponse = { status: number; body: any; headers: Headers };

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let owner: Identity;
let otherTenant: Identity;
let member: Identity;
let vesselId = "";
let otherOwnerVesselId = "";
let otherVesselId = "";

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

async function createVessel(cookie: string, label: string) {
  const response = await call("POST", "/api/vessels", cookie, {
    vesselName: `${label} ${Date.now()} ${Math.random()}`,
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
  otherTenant = await createTestIdentity();
  member = await createTestIdentity({ withCompany: false });
  assert.ok(owner.company && otherTenant.company);
  await addTestMembership(member.user.id, owner.company.id, "MEMBER");

  vesselId = await createVessel(owner.cookie, "Identity fixture vessel");
  otherOwnerVesselId = await createVessel(
    owner.cookie,
    "Other owner identity vessel",
  );
  otherVesselId = await createVessel(
    otherTenant.cookie,
    "Other tenant identity vessel",
  );
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const identity of [owner, otherTenant, member]) {
    if (identity) await disposeTestIdentity(identity);
  }
});

test("identity reads are tenant-scoped and members can read", async () => {
  const anonymous = await call(
    "GET",
    `/api/vessels/${vesselId}/ais-identities`,
  );
  assert.equal(anonymous.status, 401);

  const memberResponse = await call(
    "GET",
    `/api/vessels/${vesselId}/ais-identities`,
    member.cookie,
  );
  assert.equal(memberResponse.status, 200);
  assert.deepEqual(memberResponse.body.items, []);
  assert.deepEqual(memberResponse.body.conflicts, []);
  assert.equal(memberResponse.body.canManage, false);

  const otherResponse = await call(
    "GET",
    `/api/vessels/${vesselId}/ais-identities`,
    otherTenant.cookie,
  );
  assert.equal(otherResponse.status, 404);
});

test("owner registration persists evidence and exposes only verified identities", async () => {
  const unverified = await call(
    "POST",
    `/api/vessels/${vesselId}/ais-identities`,
    owner.cookie,
    aisIdentityPayload("244123456"),
  );
  assert.equal(unverified.status, 201, JSON.stringify(unverified.body));
  assert.equal(unverified.body.verified, false);
  const mappingId = unverified.body.id;

  const selfAsserted = await call(
    "POST",
    `/api/vessels/${otherOwnerVesselId}/ais-identities`,
    owner.cookie,
    aisIdentityPayload("244123456", {
      verified: true,
      evidence: aisIdentityEvidence("tenant-asserted"),
    }),
  );
  assert.equal(selfAsserted.status, 400);

  const beforeVerification = await getVerifiedAisIdentity(
    owner.company!.id,
    vesselId,
  );
  assert.equal(beforeVerification, null);

  const tenantPromotion = await call(
    "PATCH",
    `/api/vessels/${vesselId}/ais-identities/${mappingId}`,
    owner.cookie,
    {
      verified: true,
      evidence: aisIdentityEvidence(),
    },
  );
  assert.equal(tenantPromotion.status, 400);

  const verified = await verifyAisIdentity({
    companyId: owner.company!.id,
    vesselId,
    mappingId,
    evidence: aisIdentityEvidence("operator-registry"),
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.evidence?.source, "operator-registry");
  assert.ok(verified.verifiedAt);

  const identity = await getVerifiedAisIdentity(owner.company!.id, vesselId);
  assert.ok(identity);
  assert.equal(identity.tenantId, owner.company!.id);
  assert.equal(identity.externalIdentifiers?.[0]?.identifierType, "MMSI");
  assert.equal(identity.externalIdentifiers?.[0]?.identifierValue, "244123456");
  assert.equal(identity.externalIdentifiers?.[0]?.verified, true);

  const list = await call(
    "GET",
    `/api/vessels/${vesselId}/ais-identities`,
    owner.cookie,
  );
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].identifierValue, "244123456");
  assert.equal(list.body.canManage, true);
});

test("writes require owner/admin and duplicate identities are atomic conflicts", async () => {
  const memberWrite = await call(
    "POST",
    `/api/vessels/${vesselId}/ais-identities`,
    member.cookie,
    aisIdentityPayload("244123456"),
  );
  assert.equal(memberWrite.status, 403);

  const crossTenantDraft = await call(
    "POST",
    `/api/vessels/${otherVesselId}/ais-identities`,
    otherTenant.cookie,
    aisIdentityPayload("244123456"),
  );
  assert.equal(
    crossTenantDraft.status,
    201,
    JSON.stringify(crossTenantDraft.body),
  );

  const duplicateDraft = await call(
    "POST",
    `/api/vessels/${otherVesselId}/ais-identities`,
    otherTenant.cookie,
    aisIdentityPayload("244123456"),
  );
  assert.equal(duplicateDraft.status, 409, JSON.stringify(duplicateDraft.body));
  assert.equal(duplicateDraft.body.code, "IDENTITY_CONFLICT");
  assert.equal(duplicateDraft.body.error, "AIS identifier conflict");

  await assert.rejects(
    verifyAisIdentity({
      companyId: otherTenant.company!.id,
      vesselId: otherVesselId,
      mappingId: crossTenantDraft.body.id,
      evidence: aisIdentityEvidence("operator-registry"),
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "IDENTITY_CONFLICT",
  );
  assert.equal(
    JSON.stringify(duplicateDraft.body).includes(owner.company!.id),
    false,
  );

  const conflicts = await call(
    "GET",
    `/api/vessels/${otherVesselId}/ais-identities`,
    otherTenant.cookie,
  );
  assert.equal(conflicts.status, 200);
  assert.equal(conflicts.body.items.length, 1);
  assert.equal(conflicts.body.items[0].verified, false);
  assert.equal(conflicts.body.conflicts.length, 2);
  assert.equal(conflicts.body.conflicts[0].identifierValue, "244123456");
});

test("legacy verified rows without operator approval stay non-operational", async () => {
  const legacy = await call(
    "POST",
    `/api/vessels/${vesselId}/ais-identities`,
    owner.cookie,
    aisIdentityPayload("244123458"),
  );
  assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
  await db
    .update(vesselExternalIdentifiersTable)
    .set({
      verified: true,
      verifiedAt: new Date(),
      operatorReviewedAt: null,
    })
    .where(eq(vesselExternalIdentifiersTable.id, legacy.body.id));

  const beforeApproval = await getVerifiedAisIdentity(
    owner.company!.id,
    vesselId,
  );
  assert.ok(beforeApproval);
  assert.equal(
    beforeApproval.externalIdentifiers?.some(
      (identifier) => identifier.identifierValue === "244123458",
    ),
    false,
  );
  const legacyList = await call(
    "GET",
    `/api/vessels/${vesselId}/ais-identities`,
    owner.cookie,
  );
  const legacyView = legacyList.body.items.find(
    (item: { id: string }) => item.id === legacy.body.id,
  );
  assert.equal(legacyView?.verified, false);

  await verifyAisIdentity({
    companyId: owner.company!.id,
    vesselId,
    mappingId: legacy.body.id,
    evidence: aisIdentityEvidence("legacy-review"),
  });
  const afterApproval = await getVerifiedAisIdentity(
    owner.company!.id,
    vesselId,
  );
  assert.equal(
    afterApproval?.externalIdentifiers?.some(
      (identifier) => identifier.identifierValue === "244123458",
    ),
    true,
  );
});

test("verified mapping revisions hash the full remaining set", async () => {
  const imo = String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const second = await call(
    "POST",
    `/api/vessels/${vesselId}/ais-identities`,
    owner.cookie,
    aisIdentityPayload(imo, {
      identifierType: "IMO",
      evidence: aisIdentityEvidence("imo-registry"),
    }),
  );
  assert.equal(second.status, 201, JSON.stringify(second.body));
  await verifyAisIdentity({
    companyId: owner.company!.id,
    vesselId,
    mappingId: second.body.id,
    evidence: aisIdentityEvidence("operator-imo-registry"),
  });

  const before = await getVerifiedAisIdentity(owner.company!.id, vesselId);
  assert.ok(before);
  assert.match(before.mappingRevision ?? "", /^[0-9a-f]{64}$/);

  const firstList = await call(
    "GET",
    `/api/vessels/${vesselId}/ais-identities`,
    owner.cookie,
  );
  const mmsi = firstList.body.items.find(
    (item: { identifierValue: string }) => item.identifierValue === "244123456",
  );
  assert.ok(mmsi);
  const deleted = await call(
    "DELETE",
    `/api/vessels/${vesselId}/ais-identities/${mmsi.id}`,
    owner.cookie,
  );
  assert.equal(deleted.status, 204);

  const after = await getVerifiedAisIdentity(owner.company!.id, vesselId);
  assert.ok(after);
  assert.match(after.mappingRevision ?? "", /^[0-9a-f]{64}$/);
  assert.notEqual(after.mappingRevision, before.mappingRevision);
  assert.deepEqual(
    after.externalIdentifiers
      ?.map((identifier) => identifier.identifierValue)
      .sort(),
    [imo, "244123458"].sort(),
  );
});

test("tenant evidence edits clear the trusted operator marker", async () => {
  const list = await call(
    "GET",
    `/api/vessels/${vesselId}/ais-identities`,
    owner.cookie,
  );
  const approved = list.body.items.find(
    (item: { identifierValue: string; verified: boolean }) =>
      item.identifierValue === "244123458" && item.verified,
  );
  assert.ok(approved);
  const edited = await call(
    "PATCH",
    `/api/vessels/${vesselId}/ais-identities/${approved.id}`,
    owner.cookie,
    { evidence: aisIdentityEvidence("tenant-edit") },
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.verified, false);
  assert.equal(
    (
      await getVerifiedAisIdentity(owner.company!.id, vesselId)
    )?.externalIdentifiers?.some(
      (identifier) => identifier.identifierValue === "244123458",
    ),
    false,
  );
});

test("tenant-local keys reject a draft beside approval and allow revocation", async () => {
  const list = await call(
    "GET",
    `/api/vessels/${vesselId}/ais-identities`,
    owner.cookie,
  );
  const approved = list.body.items.find(
    (item: { identifierType: string; verified: boolean }) =>
      item.identifierType === "IMO" && item.verified,
  );
  assert.ok(approved);

  const duplicateDraft = await call(
    "POST",
    `/api/vessels/${vesselId}/ais-identities`,
    owner.cookie,
    aisIdentityPayload(approved.identifierValue, {
      identifierType: "IMO",
    }),
  );
  assert.equal(duplicateDraft.status, 409);

  const revoked = await call(
    "PATCH",
    `/api/vessels/${vesselId}/ais-identities/${approved.id}`,
    owner.cookie,
    { verified: false },
  );
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.verified, false);
  assert.equal(
    (
      await getVerifiedAisIdentity(owner.company!.id, vesselId)
    )?.externalIdentifiers?.some(
      (identifier) => identifier.identifierValue === approved.identifierValue,
    ) ?? false,
    false,
  );
});

test("unknown mappings and cross-tenant service reads disclose nothing", async () => {
  const missing = await call(
    "PATCH",
    `/api/vessels/${vesselId}/ais-identities/00000000-0000-4000-8000-000000000000`,
    owner.cookie,
    { verified: false },
  );
  assert.equal(missing.status, 404);

  const crossTenant = await getVerifiedAisIdentity(
    otherTenant.company!.id,
    vesselId,
  );
  assert.equal(crossTenant, null);
});
