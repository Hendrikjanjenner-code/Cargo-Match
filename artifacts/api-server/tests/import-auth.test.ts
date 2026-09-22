import { test } from "node:test";
import assert from "node:assert/strict";
import { realActor, emptyImportState, assertRealAction } from "../src/services/imports-auth/policy";
import { applyImportAction, projectImportControl, assertDocumentAccess } from "../src/services/imports/domain";
import type { ImportIntegration } from "../src/services/imports/types";
import { ExecuteImportActionBody, GetImportSessionResponse } from "@workspace/api-zod";

const integration: ImportIntegration = { findActor: () => undefined, findDelivery: () => [], isConnectedEligible: () => false };
test("generated wire validation preserves operation fields and projection", () => {
  const input = { operation: "SET_MODULE", module: "DOCUMENTS", enabled: false };
  assert.deepEqual(ExecuteImportActionBody.parse(input), input);
  const { actor, state } = fixture();
  const view = projectImportControl(state, actor);
  const result = GetImportSessionResponse.parse({ demo: false, workspace: { importControl: view }, context: { importModules: view.modules, companyId: actor.companyId } });
  assert.deepEqual(result.workspace.importControl, view);
  assert.equal(result.context.companyId, actor.companyId);
});
function fixture() {
  const actor = realActor("real-user", "company-a", "OWNER"), state = emptyImportState(actor.companyId);
  applyImportAction(state, actor, { operation: "CREATE_SHIPMENT", shipment: {
    reference: "ACTUAL-USER-REF", name: "User entry", kind: "FCL", origin: "Origin", destination: "Destination", port: "Port", eta: "2027-01-01T00:00:00Z",
  } }, integration);
  return { actor, state, shipmentId: state.shipments[0].id };
}
test("real initialization never contains demo personas, tracking or shipments", () => {
  const state = emptyImportState("company-a");
  assert.equal(state.demo, false);
  assert.deepEqual(state.shipments, []);
  assert.deepEqual(state.vessels, []);
  assert.deepEqual(Object.keys(state.entitlements), ["company-a"]);
});
test("cross-company and unassigned same-company members cannot project shipments", () => {
  const { state } = fixture();
  assert.deepEqual(projectImportControl(state, realActor("other", "company-b", "OWNER")).shipments, []);
  assert.deepEqual(projectImportControl(state, realActor("colleague", "company-a", "MEMBER")).shipments, []);
});
test("direct cross-tenant document and action identifiers remain forbidden", () => {
  const { state, shipmentId } = fixture(), other = realActor("other", "company-b", "OWNER");
  assert.throws(() => assertDocumentAccess(state, other, shipmentId, "document"), /toestemming/);
  assert.throws(() => applyImportAction(state, other, { operation: "CONFIRM_FIELD", shipmentId, field: "weightKg", value: 10, evidence: "review" }, integration), /toestemming/);
});
test("module configuration is membership-authorized, not profile-authorized", () => {
  const { state, actor } = fixture();
  assert.throws(() => applyImportAction(state, realActor(actor.id, actor.companyId, "MEMBER"), { operation: "SET_MODULE", module: "DOCUMENTS", enabled: false }, integration), /bedrijfsbeheerder/);
  applyImportAction(state, actor, { operation: "SET_MODULE", module: "DOCUMENTS", enabled: false }, integration);
  const view = projectImportControl(state, actor);
  assert.equal(view.modules.includes("IMPORT"), false);
  assert.equal(view.modules.includes("CUSTOMS"), false);
  assert.equal(view.shipments[0].gates.find(g => g.key === "customs")?.satisfied, false);
});
test("production simulation and unconfigured matching explicitly fail", () => {
  const actor = realActor("u", "c", "OWNER");
  for (const operation of ["CUSTOMS_EVENT", "CUSTOMS_SUBMIT", "PAY_CHARGE", "FIND_DELIVERY", "PLAN_DELIVERY", "DELIVER"]) {
    assert.throws(() => assertRealAction({ operation }, actor));
  }
  assert.doesNotThrow(() => assertRealAction({ operation: "RECORD_PAYMENT" }, actor));
  assert.throws(() => assertRealAction({ operation: "RECORD_PAYMENT" }, realActor("u", "c", "MEMBER")));
});
test("direct object path claims cannot attach document metadata", () => {
  const { state, actor, shipmentId } = fixture();
  assert.throws(() => applyImportAction(state, actor, { operation: "UPLOAD_DOCUMENT", shipmentId, objectPath: "/objects/other-tenant", documentType: "INVOICE" }, integration), /opslagroute/);
  assert.equal(state.shipments[0].documents.length, 0);
});
test("real shared domain cannot forge customs release or manually pass customs gate", () => {
  const { state, actor, shipmentId } = fixture();
  assert.throws(() => applyImportAction(state, actor, { operation: "CUSTOMS_EVENT", shipmentId, status: "RELEASED", evidence: "claim" }, integration), /demo/);
  assert.throws(() => applyImportAction(state, actor, { operation: "SET_GATE", shipmentId, gate: "customs", satisfied: true, evidence: "claim" }, integration), /bronmodule/);
  assert.notEqual(projectImportControl(state, actor).shipments[0].status, "READY_FOR_PICKUP");
});