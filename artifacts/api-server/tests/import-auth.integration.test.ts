import assert from "node:assert/strict";
import { once } from "node:events";
import test, { before, after } from "node:test";
import app from "../src/app";
import { createTestIdentity, addTestMembership, disposeTestIdentity } from "./support/testIdentity";

type Identity = Awaited<ReturnType<typeof createTestIdentity>>;
let owner: Identity, other: Identity, member: Identity, unaffiliated: Identity;
let server: ReturnType<typeof app.listen>, base: string, shipmentId: string, chargeId: string;
async function call(method: string, path: string, identity?: Identity, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}/api${path}`, { method, headers: {
    ...(identity ? { cookie: identity.cookie } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers,
  }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() as any };
}
const action = (identity: Identity, body: unknown) => call("POST", "/import/actions", identity, body);
before(async () => {
  server = app.listen(0); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
  owner = await createTestIdentity(); other = await createTestIdentity();
  member = await createTestIdentity({ withCompany: false }); unaffiliated = await createTestIdentity({ withCompany: false });
  await addTestMembership(member.user.id, owner.company!.id);
});
after(async () => {
  for (const identity of [member, unaffiliated, owner, other]) if (identity) await disposeTestIdentity(identity);
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
test("real session authentication, active membership, empty state and tenant-scoped member directory", async () => {
  assert.equal((await call("GET", "/import/session")).status, 401);
  assert.equal((await call("GET", "/import/session", unaffiliated)).status, 403);
  const result = await call("GET", "/import/session", owner);
  assert.equal(result.status, 200); assert.equal(result.body.demo, false);
  assert.deepEqual(result.body.workspace.importControl.shipments, []);
  assert.deepEqual(result.body.workspace.importControl.vessels, []);
  assert.ok(result.body.context.permissions.includes("IMPORT_ADMIN"));
  assert.deepEqual(result.body.context.members.map((m: any) => m.id).sort(), [owner.user.id, member.user.id].sort());
});
test("authenticated creation, persistence, member authority and cross-company isolation", async () => {
  const input = { operation: "CREATE_SHIPMENT", shipment: { reference: "AUTH-IMPORT", name: "Manual import", kind: "FCL", origin: "Yantian", destination: "Eindhoven", port: "Rotterdam", eta: "2027-01-01T00:00:00Z" } };
  assert.equal((await action(member, input)).status, 403);
  const result = await action(owner, input); assert.equal(result.status, 200, JSON.stringify(result.body));
  shipmentId = result.body.workspace.importControl.shipments[0].id;
  assert.equal((await call("GET", "/import/session", owner)).body.workspace.importControl.shipments[0].id, shipmentId);
  assert.deepEqual((await call("GET", "/import/session", other)).body.workspace.importControl.shipments, []);
  assert.equal((await action(other, { operation: "CONFIRM_FIELD", shipmentId, field: "weightKg", value: 100, evidence: "review" })).status, 403);
});
test("module toggle persists, member cannot administer, and missing module blocks direct action", async () => {
  const input = { operation: "SET_MODULE", module: "CHARGES", enabled: false };
  assert.equal((await action(member, input)).status, 403);
  assert.equal((await action(owner, input)).status, 200);
  assert.equal((await call("GET", "/import/session", owner)).body.context.importModules.includes("CHARGES"), false);
  const charge = { label: "Freight", amount: 120, currency: "EUR", supplier: "Supplier", invoiceReference: "INV-001", estimated: false, vat: false };
  assert.equal((await action(owner, { operation: "ADD_CHARGE", shipmentId, charge, evidence: "Invoice" })).status, 403);
  assert.equal((await action(owner, { ...input, enabled: true })).status, 200);
  const result = await action(owner, { operation: "ADD_CHARGE", shipmentId, charge, evidence: "Invoice" });
  assert.equal(result.status, 200); chargeId = result.body.workspace.importControl.shipments[0].charges[0].id;
});
test("manual payment and carrier evidence work without false customs release or provider simulation", async () => {
  assert.equal((await action(owner, { operation: "PAY_CHARGE", shipmentId, chargeId, evidence: "fake" })).status, 409);
  const result = await action(owner, { operation: "RECORD_PAYMENT", shipmentId, chargeId, evidence: "Bank statement reviewed manually" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const shipment = result.body.workspace.importControl.shipments[0];
  assert.equal(shipment.charges[0].paid, true);
  assert.equal(shipment.timeline.at(-1).action, "RECORD_PAYMENT");
  assert.equal(shipment.timeline.at(-1).source, "MANUAL_RECORDED");
  assert.notEqual(shipment.status, "READY_FOR_PICKUP");
  assert.equal((await action(owner, { operation: "SET_GATE", shipmentId, gate: "carrier", satisfied: true, evidence: "Carrier release reference checked" })).status, 200);
  assert.equal((await action(owner, { operation: "SET_GATE", shipmentId, gate: "customs", satisfied: true, evidence: "Unverified claim" })).status, 409);
  assert.equal((await action(owner, { operation: "CUSTOMS_EVENT", shipmentId, status: "RELEASED", evidence: "fake" })).status, 409);
});
test("forged metadata and cross-company document paths are rejected", async () => {
  const body = { shipmentId, objectPath: "/objects/import-documents/not-owned", documentType: "INVOICE" };
  assert.equal((await call("POST", "/import/uploads/complete", other, body)).status, 403);
  const forged = await call("POST", "/import/uploads/complete", owner, body);
  assert.ok([403, 404].includes(forged.status), JSON.stringify(forged));
  assert.equal((await call("GET", `/import/documents/${shipmentId}/unknown`, other)).status, 403);
  assert.equal((await action(owner, { operation: "UPLOAD_DOCUMENT", ...body })).status, 400);
});
test("global same-origin write policy rejects hostile browser origin", async () => {
  const result = await call("POST", "/import/actions", owner, { operation: "SET_MODULE", module: "CHARGES", enabled: false }, { origin: "https://attacker.invalid" });
  assert.equal(result.status, 403);
});