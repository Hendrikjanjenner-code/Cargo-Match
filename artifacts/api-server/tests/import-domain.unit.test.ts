import test from "node:test";
import assert from "node:assert/strict";
import { seedDemo, getPersona } from "../src/services/demo/seed";
import { applyAction, projectSession, refreshMatches } from "../src/services/demo/domain";
import { applyImportAction, assertDocumentAccess, chargeTotals, createImportState, fixtureContent, importModules, pickupReady, projectImportControl, readiness } from "../src/services/imports/domain";
import type { Sandbox } from "../src/services/demo/types";

function sandbox(): Sandbox { return {state: seedDemo(), personaId: "michael", csrfToken: "unit", revision: 1}; }
test("older visitor sandboxes gain import scenarios without replacing existing commercial state", () => {
  const s = sandbox();
  delete s.state.importControl;
  s.state.companies = s.state.companies.filter(c => !["globaltrade", "customs-demo", "textile-demo"].includes(c.id));
  const preserved = structuredClone(s.state.listings);
  refreshMatches(s.state);
  assert.deepEqual(s.state.listings, preserved);
  assert.equal(projectSession(s).context.company.name, "GLOBALTRADE IMPORTS DEMO BV");
  assert.equal(projectSession(s).workspace.importControl!.vessels.length, 8);
});
function action(s: Sandbox, operation: string, extra: Record<string, unknown> = {}) {
  applyAction(s, {type: "IMPORT_CONTROL", operation, shipmentId: "china-fcl", evidence: "DEMO manual evidence verified", ...extra});
}
function prepare(s: Sandbox) {
  for (const document of s.state.importControl!.shipments[0].documents) {
    action(s, "EXTRACT_DOCUMENT", {documentId: document.id});
    action(s, "REVIEW_DOCUMENT", {documentId: document.id, accepted: true});
  }
  action(s, "CONFIRM_FIELD", {field: "weightKg", value: 18420});
  s.personaId = "customs-specialist";
  for (const [field, value] of Object.entries({hsCode: "8501", origin: "CN", classificationConfirmed: "yes", valuationConfirmed: "yes"})) action(s, "CUSTOMS_EDIT", {field, value});
  action(s, "CUSTOMS_APPROVE"); action(s, "CUSTOMS_SUBMIT"); action(s, "CUSTOMS_EVENT", {status: "RELEASED"});
  s.personaId = "michael";
  for (const charge of s.state.importControl!.shipments[0].charges) action(s, "PAY_CHARGE", {chargeId: charge.id});
  for (const gate of ["carrier", "terminal", "delivery_order"]) action(s, "SET_GATE", {gate, satisfied: true});
}
test("import mismatch is computed from documents; totals preserve VAT and currency", () => {
  const s = sandbox(), shipment = s.state.importControl!.shipments[0];
  assert.match(readiness(shipment).reasons.join(" "), /180 kg/);
  assert.equal(chargeTotals(shipment).EUR.cost, 95707);
  shipment.charges.push({...shipment.charges[0], id: "vat", amount: 100, vat: true});
  shipment.charges.push({...shipment.charges[0], id: "usd", amount: 50, currency: "USD"});
  assert.equal(chargeTotals(shipment).EUR.cost, 95707);
  assert.equal(chargeTotals(shipment).EUR.vat, 100);
  assert.equal(chargeTotals(shipment).USD.cost, 50);
});
test("module permission does not confer cross-tenant or cross-house access", () => {
  const s = sandbox(), state = s.state.importControl!;
  const laura = getPersona("laura")!;
  const view = projectImportControl(state, laura);
  assert.deepEqual(view.shipments.map(s => s.id), ["india-house-1"]);
  assert.equal(view.shipments[0].fields.value, undefined);
  assert.equal(view.shipments[0].documents.some(d => d.type === "INVOICE"), false);
  assert.throws(() => assertDocumentAccess(state, laura, "india-house-2", "india-house-2-doc-0"), /toestemming/);
  assert.throws(() => assertDocumentAccess(state, laura, "india-house-1", "india-house-1-doc-0"), /Vertrouwelijk/);
  assert.equal(projectImportControl(state, {...getPersona("michael")!, id: "unassigned-manager"}).shipments.length, 0);
  s.personaId = "finance"; assert.throws(() => action(s, "CUSTOMS_APPROVE"), /toestemming/);
  s.personaId = "laura"; assert.throws(() => action(s, "SET_GATE", {shipmentId: "india-house-1", gate: "terminal", satisfied: true}), /Ontvanger/);
});
test("full workflow keeps consent distinct from planning, rechecks release, and is idempotent", () => {
  const s = sandbox(), shipment = s.state.importControl!.shipments[0];
  action(s, "FIND_DELIVERY"); const count = s.state.listings.length;
  action(s, "FIND_DELIVERY"); assert.equal(s.state.listings.length, count);
  assert.throws(() => action(s, "PLAN_DELIVERY", {matchId: "missing"}), /vrijgave/);
  prepare(s); assert.equal(readiness(shipment).status, "READY"); assert.equal(pickupReady(shipment), true);
  action(s, "FIND_DELIVERY");
  const match = s.state.matches.find(m => m.cargoId === "import-cargo-china-fcl-road" && m.status === "NEW");
  assert.ok(match, "existing real matcher should produce a compatible option");
  applyAction(s, {type: "INTEREST", matchId: match.id});
  assert.throws(() => action(s, "PLAN_DELIVERY", {matchId: match.id}), /verbinding/);
  const capacity = s.state.listings.find(l => l.id === match.capacityId)!;
  s.personaId = capacity.companyId === "transroute" ? "thomas" : capacity.companyId === "rhineflow" ? "eva" : "anna";
  applyAction(s, {type: "ACCEPT", matchId: match.id});
  s.personaId = "michael";
  assert.equal(projectSession(s).workspace.opportunities.find(m => m.id === match.id)?.status, "CONNECTED");
  assert.notEqual(shipment.delivery.status, "PLANNED");
  action(s, "PLAN_DELIVERY", {matchId: match.id});
  action(s, "SET_GATE", {gate: "terminal", satisfied: false});
  assert.equal(shipment.delivery.status, "BLOCKED");
  assert.throws(() => action(s, "DELIVER"), /vrijgave/);
  action(s, "SET_GATE", {gate: "terminal", satisfied: true});
  action(s, "PLAN_DELIVERY", {matchId: match.id}); action(s, "DELIVER");
  assert.equal(shipment.delivery.status, "DELIVERED");
});
test("material change revokes approval; disabled modules do not pass gates", () => {
  const s = sandbox(), shipment = s.state.importControl!.shipments[0];
  prepare(s);
  action(s, "CONFIRM_FIELD", {field: "weightKg", value: 18419});
  assert.equal(shipment.customs.approvedVersion, undefined);
  assert.equal(pickupReady(shipment), false);
  action(s, "SET_MODULE", {module: "CUSTOMS", enabled: false});
  assert.equal(pickupReady(shipment), false);
  assert.throws(() => action(s, "CUSTOMS_SUBMIT"), /toestemming/);
  assert.throws(() => action(s, "CONFIGURE_GATE", {gate: "customs", required: false}), /verplicht/);
  assert.throws(() => action(s, "SET_GATE", {gate: "customs", satisfied: true}), /bronmodule/);
});
test("documents are metadata only; untrusted object paths are never registered", () => {
  const s = sandbox(), shipment = s.state.importControl!.shipments[0];
  assert.match(fixtureContent(shipment.documents[0]), /SYNTHETIC/);
  assert.throws(() => action(s, "UPLOAD_DOCUMENT", {documentType: "INVOICE", objectPath: "/objects/stolen"}), /geverifieerd/);
  applyAction(s, {type: "IMPORT_CONTROL", operation: "UPLOAD_DOCUMENT", shipmentId: shipment.id, documentType: "INVOICE", objectPath: "/objects/test"},
    {trustedDocument: {objectPath: "/objects/test", name: "invoice.pdf", size: 123, mimeType: "application/pdf"}});
  const uploaded = shipment.documents.at(-1)!;
  assert.equal(uploaded.version, 2);
  action(s, "EXTRACT_DOCUMENT", {documentId: uploaded.id});
  assert.equal(uploaded.status, "REVIEW_REQUIRED"); assert.deepEqual(uploaded.proposals, []);
});
test("synthetic provider actions cannot be invoked by a real-state adapter", () => {
  const s = sandbox(); prepare(s); s.state.importControl!.demo = false;
  const actor = getPersona("customs-specialist")!;
  assert.throws(() => applyImportAction(s.state.importControl!, actor, {operation: "CUSTOMS_EVENT", shipmentId: "china-fcl", status: "HELD", evidence: "test"},
    {findActor: getPersona, findDelivery: () => [], isConnectedEligible: () => false}), /uitsluitend/);
});
test("legacy managers do not see every legacy import", () => {
  const s = sandbox(); s.personaId = "david";
  s.state.imports.push({...structuredClone(s.state.imports[0]), id: "foreign-import", receiverCompanyId: "secret"});
  assert.deepEqual(projectSession(s).workspace.imports.map(s => s.id), ["import-lcl"]);
});
test("generic real initialization has no synthetic data and enforces company module administration", () => {
  const actor = {...getPersona("michael")!, companyId: "real-tenant", id: "real-user"};
  const state = createImportState(actor.companyId);
  const integration = {findActor: () => undefined, findDelivery: () => [], isConnectedEligible: () => false};
  assert.equal(state.demo, false); assert.equal(state.shipments.length, 0); assert.equal(state.vessels.length, 0);
  assert.throws(() => applyImportAction(state, {...actor, membershipRole: "MEMBER"}, {operation: "SET_MODULE", module: "SHIPMENTS", enabled: true}, integration), /bedrijfsbeheerder/);
  assert.throws(() => applyImportAction(state, actor, {operation: "SET_MODULE", module: "IMPORT", enabled: true}, integration), /afhankelijke/);
  applyImportAction(state, actor, {operation: "SET_MODULE", module: "SHIPMENTS", enabled: true}, integration);
  assert.deepEqual(importModules(state, actor), ["SHIPMENTS"]);
  applyImportAction(state, actor, {operation: "CREATE_SHIPMENT", shipment: {reference: "REF-1", name: "Own cargo", kind: "AIR", origin: "Arbitrary origin", destination: "Arbitrary destination", port: "Hub", eta: new Date().toISOString()}}, integration);
  assert.equal(state.shipments[0].companyId, "real-tenant");
  assert.equal(state.shipments[0].status, "DRAFT");
  assert.equal(readiness(state.shipments[0]).status, "BLOCKED");
});
test("charges and configurable gates remain auditable and cannot hide unpaid obligations", () => {
  const s = sandbox(), shipment = s.state.importControl!.shipments[0];
  prepare(s);
  action(s, "ADD_CHARGE", {charge: {label: "Storage", amount: 12.50, currency: "EUR", supplier: "DEMO Terminal", invoiceReference: "DEMO-1", estimated: false, vat: false}});
  assert.equal(pickupReady(shipment), false);
  const charge = shipment.charges.at(-1)!;
  action(s, "PAY_CHARGE", {chargeId: charge.id});
  assert.equal(pickupReady(shipment), true);
  action(s, "EDIT_CHARGE", {chargeId: charge.id, charge: {...charge, amount: 15}});
  assert.equal(charge.paid, false);
  action(s, "CONFIGURE_GATE", {gate: "inspection", required: true});
  assert.equal(shipment.gates.find(g => g.key === "inspection")?.satisfied, false);
  action(s, "SET_GATE", {gate: "inspection", satisfied: true});
  assert.ok(shipment.timeline.some(e => e.action === "EDIT_CHARGE" && e.actorId === "michael" && e.oldValue && e.newValue));
});
test("material shipment changes invalidate matched listing consent instead of silently keeping a connection", () => {
  const s = sandbox(), shipment = s.state.importControl!.shipments[0];
  action(s, "FIND_DELIVERY");
  const match = s.state.matches.find(m => shipment.delivery.listingIds.includes(m.cargoId))!;
  match.status = "CONNECTED"; match.leftConsent = true; match.rightConsent = true;
  action(s, "CONFIRM_FIELD", {field: "weightKg", value: 19000});
  assert.equal(match.leftConsent, false); assert.equal(match.rightConsent, false);
  assert.equal(s.state.listings.find(l => l.id === match.cargoId)!.quantity, 19);
});
test("readiness checks import identity, instructions and configurable document requirements", () => {
  const s = sandbox(), shipment = s.state.importControl!.shipments[0];
  prepare(s);
  for (const field of ["eori", "commodityCode", "originCountry", "customsValue", "importInstructions"]) {
    const old = shipment.fields[field]; delete shipment.fields[field];
    assert.ok(readiness(shipment).reasons.some(r => r.startsWith(`${field}:`)), field);
    shipment.fields[field] = old;
  }
  shipment.requiredDocumentTypes = ["AWB", "LICENSE"];
  assert.match(readiness(shipment).reasons.join(" "), /AWB/);
  assert.match(readiness(shipment).reasons.join(" "), /LICENSE/);
});
test("track grants and financial projections do not broaden with ownership or operational profile", () => {
  const s = sandbox(), state = s.state.importControl!;
  state.vessels.push({...structuredClone(state.vessels[0]), id: "unshared", authorizedCompanyIds: ["other-tenant"]});
  const ownerView = projectImportControl(state, getPersona("michael")!);
  assert.equal(ownerView.vessels.length, 8);
  assert.equal("authorizedCompanyIds" in ownerView.vessels[0], false);
  const forwarderView = projectImportControl(state, getPersona("david")!);
  assert.equal(forwarderView.shipments[0].fields.value, undefined);
  assert.equal(forwarderView.shipments[0].fields.customsValue, undefined);
  assert.equal(forwarderView.shipments[0].documents.some(d => d.type === "INVOICE"), false);
  assert.equal(forwarderView.shipments[0].charges.some(c => c.label === "Goods value"), false);
  assert.throws(() => assertDocumentAccess(state, getPersona("david")!, "china-fcl", "china-fcl-doc-0"), /Vertrouwelijk/);
  const receiver = projectImportControl(state, getPersona("laura")!);
  assert.equal(receiver.shipments[0].parentId, undefined);
  assert.deepEqual(receiver.vessels.map(v => v.id), ["vessel-2"]);
});
test("arrival readiness automatically produces delivery options and idempotent notifications", () => {
  const s = sandbox(), shipment = s.state.importControl!.shipments[0];
  assert.equal(shipment.delivery.listingIds.length, 0);
  prepare(s);
  assert.equal(shipment.delivery.listingIds.length, 3);
  const notices = s.state.notifications.filter(n => n.id.startsWith(`import-${shipment.id}-pickup-ready`));
  assert.ok(notices.length > 0);
  action(s, "SET_GATE", {gate: "terminal", satisfied: true});
  assert.equal(s.state.notifications.filter(n => n.id.startsWith(`import-${shipment.id}-pickup-ready`)).length, notices.length);
  const exception = shipment.exceptions[0];
  exception.status = "SNOOZED"; exception.until = new Date(Date.now() - 1000).toISOString();
  const view = projectImportControl(s.state.importControl!, getPersona("michael")!);
  assert.equal(view.shipments[0].exceptions.find(e => e.id === exception.id)?.status, "OPEN");
  assert.ok(projectSession(s).workspace.notifications.some(n => n.importShipmentId === shipment.id));
  action(s, "SET_MODULE", {module: "RELEASE", enabled: false});
  assert.equal(projectSession(s).workspace.notifications.some(n => n.importShipmentId === shipment.id), false);
});