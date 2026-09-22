import test from "node:test";
import assert from "node:assert/strict";
import { exceptionAction, partnerAction } from "../../cargomatch/src/demo/server/components/import/import-action-builders";
import { seedDemo } from "../src/services/demo/seed";
import { applyAction, projectSession } from "../src/services/demo/domain";
import type { Sandbox } from "../src/services/demo/types";

// These are the same builders called by the component event handlers, not
// independently constructed valid request examples.
for (const command of ["COMMENT", "ASSIGN", "SNOOZE", "ESCALATE", "RESOLVE"] as const) {
  test(`Exceptions form builds an accepted ${command} request with human explanation`, () => {
    const s: Sandbox = {state: seedDemo(), personaId: "michael", revision: 1, csrfToken: "unit"};
    const shipment = s.state.importControl!.shipments[0];
    shipment.exceptions.push({id: "operational-review", title: "DEMO operational review", reason: "Manual check", priority: "MEDIUM", module: "DOCUMENTS", status: "OPEN", comments: []});
    const request = exceptionAction(shipment.id, "operational-review", command, "  Delivery desk checked the supporting documents.  ", {userId: "michael", until: new Date(Date.now() + 86400000).toISOString()});
    assert.equal(request.note, "Delivery desk checked the supporting documents.");
    assert.equal(request.exceptionId, "operational-review");
    applyAction(s, request);
    const exception = shipment.exceptions.find(item => item.id === "operational-review")!;
    assert.equal(exception.comments.length, 1);
    if (command === "ASSIGN") assert.equal(exception.assigneeId, "michael");
    if (command === "SNOOZE") assert.equal(exception.status, "SNOOZED");
    if (command === "ESCALATE") assert.equal(exception.priority, "HIGH");
    if (command === "RESOLVE") assert.equal(exception.status, "RESOLVED");
  });
}

test("Exception form rejects blank explanation and incomplete assignment/snooze", () => {
  for (const command of ["COMMENT", "ASSIGN", "SNOOZE", "ESCALATE", "RESOLVE"] as const) {
    assert.throws(() => exceptionAction("shipment", "exception", command, " "), /toelichting/);
  }
  assert.throws(() => exceptionAction("shipment", "exception", "ASSIGN", "Checked"), /behandelaar/);
  assert.throws(() => exceptionAction("shipment", "exception", "SNOOZE", "Checked"), /datum/);
});

test("Partner form sends selected modules; existing assignment is deliberately replaced", () => {
  const s: Sandbox = {state: seedDemo(), personaId: "michael", revision: 1, csrfToken: "unit"};
  const request = partnerAction("china-fcl", "finance", ["SHIPMENTS", "CHARGES", "CHARGES"]);
  assert.deepEqual(request.modules, ["SHIPMENTS", "CHARGES"]);
  applyAction(s, {...request, evidence: "Finance colleague assigned to review these charges."});
  s.personaId = "finance";
  const view = projectSession(s).workspace.importControl!;
  assert.deepEqual(view.shipments[0].allowedModules.sort(), ["CHARGES", "SHIPMENTS"]);
  assert.equal(view.shipments[0].customs, undefined);
  assert.equal(view.shipments[0].documents.length, 0);
});

test("Partner form prevents an empty scope and domain rejects excessive permissions", () => {
  assert.throws(() => partnerAction("china-fcl", "finance", []), /module/);
  assert.throws(() => partnerAction("china-fcl", "", ["CHARGES"]), /collega/);
  const s: Sandbox = {state: seedDemo(), personaId: "michael", revision: 1, csrfToken: "unit"};
  const excessive = partnerAction("china-fcl", "finance", ["CUSTOMS"]);
  assert.throws(() => applyAction(s, {...excessive, evidence: "Not authorized"}), /onbevoegde/);
});