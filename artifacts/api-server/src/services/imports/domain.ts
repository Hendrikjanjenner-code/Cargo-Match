import { randomUUID } from "node:crypto";
import { DemoError } from "../demo/types";
import { IMPORT_MODULES, type ImportModule, type ImportState, type ImportActor, type Shipment, type Document, type ImportIntegration } from "./types";
import { SyntheticCustomsProvider, SyntheticPaymentProvider, SyntheticDocumentIntelligence } from "./providers";
export type { ImportActor, ImportState, ImportIntegration } from "./types";

/** Empty real-tenant bootstrap. Entitlements are separate from membership permissions. */
export function createImportState(companyId: string, now = new Date()): ImportState {
  return {demo: false, clock: now.toISOString(), entitlements: {[companyId]: []}, shipments: [], vessels: []};
}

export const IMPORT_DEPENDENCIES: Record<ImportModule, ImportModule[]> = {
  SHIPMENTS: [], DOCUMENTS: ["SHIPMENTS"], IMPORT: ["SHIPMENTS", "DOCUMENTS"], CUSTOMS: ["IMPORT"], CHARGES: ["SHIPMENTS"],
  RELEASE: ["SHIPMENTS"], DELIVERY: ["SHIPMENTS"], CONTROL: ["SHIPMENTS"], PARTNERS: ["SHIPMENTS"], EXCEPTIONS: ["SHIPMENTS"],
};
const fail = (status: number, message: string): never => { throw new DemoError(status, status === 403 ? "FORBIDDEN" : status === 409 ? "INVALID_STATE" : "INVALID_INPUT", message); };
const text = (v: unknown, max = 500): string => typeof v === "string" && v.trim() && v.length <= max ? v.trim() : fail(400, "Een geldig tekstveld is vereist.");
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail(400, "Ongeldig object.");
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail(400, "Een boolean is vereist.");
const numeric = (v: unknown): number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e12 ? v : fail(400, "Een geldig positief bedrag is vereist.");
const date = (v: unknown): string => { const s = text(v); return Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : fail(400, "Ongeldige datum."); };
export function importModules(state: ImportState, actor: ImportActor): ImportModule[] {
  const entitled = state.entitlements[actor.companyId] ?? [];
  const enabled = (m: ImportModule): boolean => entitled.includes(m) && actor.permissions.includes(`IMPORT_${m}`) && IMPORT_DEPENDENCIES[m].every(enabled);
  return IMPORT_MODULES.filter(enabled);
}
export function shipmentModules(state: ImportState, actor: ImportActor, shipment: Shipment): ImportModule[] {
  const assignment = shipment.assignments.find(a => a.userId === actor.id && a.companyId === actor.companyId);
  return assignment ? importModules(state, actor).filter(m => assignment.modules.includes(m)) : [];
}
function authorized(state: ImportState, actor: ImportActor, id: unknown, module: ImportModule): Shipment {
  const shipment = state.shipments.find(s => s.id === id);
  if (!shipment || !shipmentModules(state, actor, shipment).includes(module)) return fail(403, "Geen toestemming voor deze zending en module.");
  return shipment;
}
export function assertDocumentAccess(state: ImportState, actor: ImportActor, shipmentId: string, documentId: string): Document {
  const s = authorized(state, actor, shipmentId, "DOCUMENTS");
  const d = s.documents.find(d => d.id === documentId);
  if (d?.type === "INVOICE" && !(actor.companyId === s.companyId && shipmentModules(state, actor, s).includes("CHARGES"))) return fail(403, "Vertrouwelijk inkoopdocument.");
  return d ?? fail(403, "Geen toegang tot document.");
}
export function fixtureContent(document: Document): string {
  if (!document.fixtureId || !/^(china-fcl|india-house-[123]|import-inland|import-rail)-(invoice|packing_list|bill_of_lading|origin)$/.test(document.fixtureId)) return fail(404, "Geen synthetisch document beschikbaar.");
  return `CARGOMATCH — DEMO / SYNTHETIC — NOT A LEGAL DOCUMENT\n${document.name}\nFixture: ${document.fixtureId}\n${Object.entries(document.fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\nGeen echte handelsdocumenten of vertegenwoordiging.\n`;
}
const latestDocuments = (s: Shipment) => s.documents.filter(d => !s.documents.some(other => other.type === d.type && other.version > d.version));
export function readiness(s: Shipment) {
  const reasons: string[] = [];
  for (const field of ["weightKg", "packages", "value"]) if (typeof s.fields[field] !== "number" || Number(s.fields[field]) <= 0) reasons.push(`${field}: positief bevestigd zendinggegeven vereist`);
  if (typeof s.fields.currency !== "string" || !/^[A-Z]{3}$/.test(s.fields.currency)) reasons.push("currency: geldige valuta vereist");
  for (const field of ["eori", "commodityCode", "originCountry", "customsValue", "importInstructions"]) if (!s.fields[field] || (field === "customsValue" && (typeof s.fields[field] !== "number" || Number(s.fields[field]) <= 0))) reasons.push(`${field}: vereist importgegeven ontbreekt`);
  const docs = latestDocuments(s);
  for (const type of s.requiredDocumentTypes ?? ["INVOICE", "PACKING_LIST", "BILL_OF_LADING", "ORIGIN"]) {
    if (!docs.some(d => d.type === type && d.status === "ACCEPTED")) reasons.push(`${type}: document ontbreekt of review vereist`);
  }
  const keys = ["weightKg", "packages", "container", "shipper", "consignee", "currency", "reference"];
  for (const field of keys) {
    const vals = docs.filter(d => d.fields[field] !== undefined).map(d => d.fields[field]);
    if (new Set(vals).size > 1 && !s.confirmedFields[field]) {
      const numbers = vals.filter((v): v is number => typeof v === "number");
      reasons.push(`${field}: verschil${numbers.length === vals.length ? ` ${Math.max(...numbers) - Math.min(...numbers)}${field === "weightKg" ? " kg" : ""}` : ""} — gecontroleerde correctie vereist`);
    }
  }
  return {status: reasons.length ? "BLOCKED" as const : "READY" as const, reasons};
}
export function chargeTotals(s: Shipment) {
  const totals: Record<string, {cost: number; vat: number; payable: number}> = {};
  for (const c of s.charges) {
    const t = totals[c.currency] ??= {cost: 0, vat: 0, payable: 0};
    t[c.vat ? "vat" : "cost"] = Math.round((t[c.vat ? "vat" : "cost"] + c.amount) * 100) / 100;
    t.payable = Math.round((t.payable + c.amount) * 100) / 100;
  }
  return totals;
}
export function effectiveGates(s: Shipment) {
  return s.gates.map(g => g.key === "customs" ? {...g, satisfied: s.customs.status === "RELEASED" && s.customs.approvedVersion === s.customs.version && readiness(s).status === "READY"} :
    g.key === "payment" ? {...g, satisfied: s.charges.length > 0 && s.charges.every(c => c.paid)} : {...g});
}
export const pickupReady = (s: Shipment) => effectiveGates(s).filter(g => g.required).every(g => g.satisfied) && effectiveGates(s).some(g => g.required);
function invalidate(s: Shipment) {
  s.customs.version += 1; s.customs.status = "DRAFT"; delete s.customs.approvedVersion; delete s.customs.approvedBy;
  if (s.delivery.status === "PLANNED") s.delivery.status = "BLOCKED";
}
export function syncImportExceptions(s: Shipment, now = new Date()) {
  for (const e of s.exceptions) if (e.status === "SNOOZED" && e.until && Date.parse(e.until) <= now.getTime()) { e.status = "OPEN"; delete e.until; }
  const r = readiness(s);
  for (const reason of r.reasons) {
    const id = `review-${s.id}-${reason.split(":")[0]}`;
    const existing = s.exceptions.find(e => e.id === id);
    if (existing) { if (existing.status === "RESOLVED") existing.status = "OPEN"; }
    else s.exceptions.push({id, title: reason, status: "OPEN", priority: "HIGH", reason: "Juridische documentreview blokkeert readiness en vrijgave.", module: "DOCUMENTS", comments: []});
  }
  for (const e of s.exceptions.filter(e => e.id.startsWith(`review-${s.id}-`))) if (!r.reasons.some(reason => `review-${s.id}-${reason.split(":")[0]}` === e.id)) e.status = "RESOLVED";
  const financialRisk = Date.parse(s.eta) - now.getTime() < 3 * 86400000 && !pickupReady(s) && s.charges.some(c => !c.paid);
  const riskId = `risk-demurrage-${s.id}`, existing = s.exceptions.find(e => e.id === riskId);
  if (financialRisk && !existing) s.exceptions.push({id: riskId, title: "ETA binnen 72 uur: kosten- en opslagrisico", status: "OPEN", priority: "MEDIUM", reason: "Verwachte aankomst binnen 72 uur, openstaande kosten en onvolledige vrijgave. Geen berekende demurrage zonder tarief en vrije dagen.", module: "CHARGES", comments: []});
  if (existing) existing.status = financialRisk ? existing.status === "RESOLVED" ? "OPEN" : existing.status : "RESOLVED";
}
export function projectImportControl(state: ImportState, actor: ImportActor) {
  const modules = importModules(state, actor);
  const visible = state.shipments.filter(s => shipmentModules(state, actor, s).includes("SHIPMENTS"));
  const shipments = visible.map(s => {
    const allowedModules = shipmentModules(state, actor, s);
    const see = (m: ImportModule) => allowedModules.includes(m);
    const consignee = actor.companyId === s.consigneeCompanyId && actor.companyId !== s.companyId;
    const financial = actor.companyId === s.companyId && see("CHARGES");
    const fields = financial ? {...s.fields} : Object.fromEntries(Object.entries(s.fields).filter(([k]) => !["value", "customsValue", "supplier", "purchasePrice"].includes(k)));
    const documents = see("DOCUMENTS") ? structuredClone(s.documents.filter(d => financial || d.type !== "INVOICE")).map(d => financial ? d : {...d, fields: Object.fromEntries(Object.entries(d.fields).filter(([k]) => !["value", "customsValue", "supplier", "purchasePrice"].includes(k))), proposals: d.proposals.filter(p => !["value", "customsValue", "supplier", "purchasePrice"].includes(p.field))}) : [];
    const charges = see("CHARGES") ? structuredClone(s.charges.filter(c => financial || !/goods|ocean|origin/i.test(c.label))) : [];
    const publicShipment = {id: s.id, reference: s.reference, name: s.name, kind: s.kind, origin: s.origin, destination: s.destination, port: s.port, eta: s.eta, status: s.delivery.status === "DELIVERED" ? "DELIVERED" : pickupReady(s) ? "READY_FOR_PICKUP" : s.status, vesselId: see("CONTROL") ? s.vesselId : "", container: s.container, houseReference: s.houseReference, ...(consignee ? {} : {parentId: s.parentId, masterReference: s.masterReference, incoterm: s.incoterm}),
      fields, readiness: see("IMPORT") || see("CUSTOMS") ? readiness(s) : {status: readiness(s).status, reasons: []},
      documents, charges, totals: chargeTotals({...s, charges}), ...(see("CUSTOMS") ? {customs: structuredClone(s.customs)} : {}),
      ...(see("CUSTOMS") || see("PARTNERS") ? {customsReview: structuredClone(s.customsReview)} : {}),
      gates: see("RELEASE") ? effectiveGates(s) : [], delivery: see("DELIVERY") ? structuredClone(s.delivery) : {status: s.delivery.status, listingIds: []},
      exceptions: see("EXCEPTIONS") ? s.exceptions.filter(e => see(e.module)).map(e => ({...structuredClone(e), ...(e.status === "SNOOZED" && e.until && Date.parse(e.until) <= Date.now() ? {status: "OPEN" as const, until: undefined} : {})})) : [],
      timeline: s.timeline.filter(e => consignee ? ["CONFIRM_COMPANY", "CONFIRM_REPRESENTATION", "DELIVERY_CHOICE", "DELIVER"].includes(e.action) && e.actorId === actor.id : e.action === "SYNTHETIC_SEED" || see(eventModule(e.action))).map(e => ({id: e.id, actorId: e.actorId, action: e.action, at: e.at, eventAt: e.eventAt, source: e.source, ...(allowedModules.length === IMPORT_MODULES.length && financial ? {oldValue: structuredClone(e.oldValue), newValue: structuredClone(e.newValue)} : {})})),
      allowedModules, companyConfirmed: s.companyConfirmed, representationReviewed: s.representationReviewed};
    return publicShipment;
  });
  return {demo: state.demo, modules, dependencies: IMPORT_DEPENDENCIES, shipments,
    vessels: state.demo && modules.includes("CONTROL") && visible.some(s => shipmentModules(state, actor, s).includes("CONTROL")) ? state.vessels.filter(v => v.authorizedCompanyIds?.includes(actor.companyId)).map(({authorizedCompanyIds: _grants, ...v}) => structuredClone(v)) : [],
    disclaimer: state.demo ? "DEMO / SYNTHETIC — geen live AIS, echte aangifte, betaling of boeking. Routes zijn illustratief." : "Geregistreerde gegevens; geen autonome juridische beslissingen."};
}
function eventModule(operation: string): ImportModule {
  if (operation.includes("DOCUMENT")) return "DOCUMENTS";
  if (operation.startsWith("CUSTOMS")) return "CUSTOMS";
  if (operation.includes("CHARGE") || operation === "RECORD_PAYMENT") return "CHARGES";
  if (operation.includes("GATE")) return "RELEASE";
  if (["FIND_DELIVERY", "PLAN_DELIVERY", "DELIVER", "DELIVERY_CHOICE"].includes(operation)) return "DELIVERY";
  if (operation === "EXCEPTION") return "EXCEPTIONS";
  if (operation === "ASSIGN_PARTNER" || operation === "ASSIGN_CUSTOMS_REVIEW") return "PARTNERS";
  if (["CONFIRM_FIELD", "CONFIRM_COMPANY", "CONFIRM_REPRESENTATION"].includes(operation)) return "IMPORT";
  return "SHIPMENTS";
}
export interface ImportActionOptions { now?: Date; trustedDocument?: {objectPath: string; name: string; mimeType: string; size: number} }
export interface VerifiedImportDocument { objectPath: string; name: string; mimeType: string; size: number; documentType?: string }
/** Call only after the storage adapter verifies owner, shipment and completed object metadata.
 * Never expose this argument as a JSON action property. No document bytes enter domain state.
 */
export function attachImportDocument(state: ImportState, actor: ImportActor, shipmentId: string, metadata: VerifiedImportDocument, integration?: ImportIntegration): Document {
  applyImportAction(state, actor, {operation: "UPLOAD_DOCUMENT", shipmentId, documentType: metadata.documentType ?? "OTHER", objectPath: metadata.objectPath},
    integration ?? {findActor: () => undefined, findDelivery: s => s.delivery.listingIds, isConnectedEligible: () => false}, {trustedDocument: metadata});
  return authorized(state, actor, shipmentId, "DOCUMENTS").documents.at(-1)!;
}
export function applyImportAction(state: ImportState, actor: ImportActor, input: unknown, integration: ImportIntegration, options: ImportActionOptions = {}): void {
  const a = record(input), op = text(a.operation), now = (options.now ?? new Date()).toISOString();
  if (op === "SET_MODULE") {
    if (!actor.permissions.includes("IMPORT_ADMIN") || !["OWNER", "ADMIN"].includes(actor.membershipRole)) return fail(403, "Alleen een bevoegde bedrijfsbeheerder kan modules wijzigen.");
    const m = text(a.module) as ImportModule; if (!IMPORT_MODULES.includes(m)) return fail(400, "Onbekende module.");
    const enabled = bool(a.enabled), current = state.entitlements[actor.companyId] ?? [];
    if (enabled && !IMPORT_DEPENDENCIES[m].every(d => current.includes(d))) return fail(409, "Schakel eerst de afhankelijke modules in.");
    state.entitlements[actor.companyId] = enabled ? [...new Set([...current, m])] : current.filter(x => x !== m);
    (state.audit ??= []).push({id: randomUUID(), actorId: actor.id, action: "SET_MODULE", at: now, eventAt: now, source: state.demo ? "SYNTHETIC_DEMO" : "MANUAL_RECORDED", oldValue: [...current], newValue: [...state.entitlements[actor.companyId]]});
    return;
  }
  if (op === "CREATE_SHIPMENT") {
    if (!importModules(state, actor).includes("SHIPMENTS")) return fail(403, "Geen shipmentrechten.");
    const data = shipmentInput(a.shipment);
    const s: Shipment = {...data, id: `shipment-${randomUUID()}`, status: "DRAFT", vesselId: "", companyId: actor.companyId, responsibleId: actor.id,
      assignments: [{userId: actor.id, companyId: actor.companyId, modules: importModules(state, actor)}], fields: {}, confirmedFields: {}, documents: [], charges: [],
      customs: {version: 1, status: "DRAFT", goods: {}, disclaimer: "Menselijke review verplicht. Geen juridische vertegenwoordiging."},
      gates: ["customs", "payment", "carrier", "terminal", "delivery_order"].map(key => ({key, required: true, satisfied: false})),
      delivery: {status: "NOT_PLANNED", listingIds: []}, exceptions: [], timeline: [], companyConfirmed: false, representationReviewed: false};
    state.shipments.push(s); audit(s, actor, op, now, null, data, state.demo); syncImportExceptions(s, new Date(now)); return;
  }
  const s = authorized(state, actor, a.shipmentId, eventModule(op));
  if (!state.demo && ["PAY_CHARGE", "CUSTOMS_SUBMIT", "CUSTOMS_EVENT"].includes(op)) return fail(409, "Geen productieprovider geconfigureerd; gesimuleerde acties zijn uitsluitend voor demo.");
  const consignee = actor.companyId === s.consigneeCompanyId && actor.companyId !== s.companyId;
  const financial = actor.companyId === s.companyId && shipmentModules(state, actor, s).includes("CHARGES");
  if (consignee && !["UPLOAD_DOCUMENT", "EXTRACT_DOCUMENT", "CONFIRM_COMPANY", "CONFIRM_REPRESENTATION", "DELIVERY_CHOICE", "PAY_CHARGE"].includes(op)) return fail(403, "Ontvanger mag alleen eigen portaalacties uitvoeren.");
  const shipmentMetadata = () => ({reference: s.reference, name: s.name, kind: s.kind, origin: s.origin, destination: s.destination, port: s.port, eta: s.eta, container: s.container, incoterm: s.incoterm, masterReference: s.masterReference, houseReference: s.houseReference, requiredDocumentTypes: s.requiredDocumentTypes});
  const before = structuredClone({shipment: shipmentMetadata(), fields: s.fields, customs: s.customs, gates: effectiveGates(s), delivery: s.delivery, documents: s.documents, charges: s.charges, assignments: s.assignments, exceptions: s.exceptions});
  const wasReady = pickupReady(s);
  const evidence = () => text(a.evidence, 2000);
  if (op === "ARRIVING") {
    if (!state.demo || actor.companyId !== s.companyId || s.status !== "IN_TRANSIT") return fail(409, "Alleen de demo-eigenaar kan een reizende zending als naderend registreren.");
    evidence(); s.status = "ARRIVING";
    if (s.delivery.transport) s.delivery.listingIds = integration.findDelivery(s);
  } else if (op === "ASSIGN_CUSTOMS_REVIEW") {
    if (!state.demo || actor.companyId !== s.companyId) return fail(403, "Alleen de demo-zendingeigenaar kan deze partnerreview delen.");
    const target = integration.findActor(text(a.userId));
    if (!target?.permissions.includes("IMPORT_CUSTOMS_APPROVE")) return fail(403, "Bevoegde douanepartner vereist.");
    const modules: ImportModule[] = ["SHIPMENTS", "DOCUMENTS", "IMPORT", "CUSTOMS", "EXCEPTIONS"];
    if (!modules.every(m => shipmentModules(state, actor, s).includes(m) && importModules(state, target).includes(m))) return fail(403, "Onvoldoende moduletoestemming.");
    evidence();
    if (s.customsReview && s.customsReview.assigneeId !== target.id) s.assignments = s.assignments.filter(x => x.userId !== s.customsReview!.assigneeId);
    const previous = s.assignments.find(x => x.userId === target.id);
    if (previous) previous.modules = modules; else s.assignments.push({userId: target.id, companyId: target.companyId, modules});
    s.customsReview = {id: `customs-review-${s.id}`, assigneeId: target.id, status: "ASSIGNED"};
    const id = `classification-${s.id}`;
    if (!s.exceptions.some(e => e.id === id)) s.exceptions.push({id, title: "CLASSIFICATION REVIEW REQUIRED", status: "OPEN", priority: "HIGH", reason: "Menselijke partnerreview vereist.", module: "CUSTOMS", assigneeId: target.id, comments: []});
    integration.notify?.(s, `review-assigned-${randomUUID()}`, "Douanereview toegewezen.");
  } else if (op === "CUSTOMS_REVIEW_OPEN" || op === "CUSTOMS_REVIEW_COMPLETE") {
    if (!state.demo || s.customsReview?.assigneeId !== actor.id) return fail(403, "Alleen de toegewezen douanepartner mag deze review behandelen.");
    if (op === "CUSTOMS_REVIEW_OPEN") {
      if (s.customsReview.status !== "ASSIGNED") return fail(409, "De review is niet nieuw.");
      s.customsReview.status = "OPENED";
    } else {
      if (s.customsReview.status !== "OPENED") return fail(409, "Open eerst de toegewezen review.");
      s.customsReview.recommendation = evidence(); s.customsReview.status = "COMPLETED"; s.customsReview.completedAt = now;
      const exception = s.exceptions.find(e => e.id === `classification-${s.id}`); if (exception) exception.status = "RESOLVED";
      integration.notify?.(s, `review-complete-${randomUUID()}`, "Douanereview voltooid; readiness herberekend. Menselijke goedkeuring en vrijgave blijven afzonderlijk.");
    }
  } else if (op === "EDIT_SHIPMENT") {
    const data = shipmentInput(a.shipment);
    if ("requiredDocumentTypes" in data && (actor.companyId !== s.companyId || !actor.permissions.includes("IMPORT_ADMIN"))) return fail(403, "Alleen de bevoegde eigenaar configureert verplichte documenten.");
    evidence(); Object.assign(s, data); invalidate(s);
  }
  else if (op === "UPLOAD_DOCUMENT") {
    const proof = options.trustedDocument;
    if (!proof || proof.objectPath !== a.objectPath || !proof.objectPath.startsWith("/objects/")) return fail(403, "Upload vereist een door de opslagroute geverifieerd object.");
    const type = text(a.documentType, 80);
    if (!DOCUMENT_TYPES.includes(type) || (!financial && type === "INVOICE")) return fail(403, "Documenttype niet toegestaan.");
    s.documents.push({id: `document-${randomUUID()}`, type, name: text(proof.name), objectPath: proof.objectPath, mimeType: proof.mimeType, size: proof.size, version: Math.max(0, ...s.documents.filter(d => d.type === type).map(d => d.version)) + 1, status: "REVIEW_REQUIRED", fields: {}, proposals: []});
    s.confirmedFields = {}; invalidate(s);
  } else if (op === "EXTRACT_DOCUMENT" || op === "REVIEW_DOCUMENT") {
    const d = assertDocumentAccess(state, actor, s.id, text(a.documentId));
    if (consignee && d.type === "INVOICE") return fail(403, "Vertrouwelijk document.");
    if (op === "EXTRACT_DOCUMENT") {
      d.proposals = new SyntheticDocumentIntelligence(state.demo).extract(d);
      d.status = "REVIEW_REQUIRED"; invalidate(s);
    } else { evidence(); d.status = bool(a.accepted) ? "ACCEPTED" : "REJECTED"; invalidate(s); }
  } else if (op === "CONFIRM_FIELD") {
    const field = text(a.field, 80);
    if (!["weightKg", "packages", "volumeM3", "value", "currency", "container", "shipper", "consignee", "reference", "eori", "commodityCode", "originCountry", "customsValue", "importInstructions"].includes(field)) return fail(400, "Onbekend shipmentveld.");
    const value = ["weightKg", "packages", "volumeM3", "value", "customsValue"].includes(field) ? numeric(a.value) : text(a.value, 2000);
    const proof = evidence(); s.fields[field] = value; s.confirmedFields[field] = {value, evidence: proof, actorId: actor.id};
    for (const d of s.documents) for (const p of d.proposals) if (p.field === field && p.value === value) p.status = "CONFIRMED";
    invalidate(s);
  } else if (op === "CUSTOMS_EDIT") {
    const field = text(a.field); if (!["hsCode", "origin", "valuationConfirmed", "classificationConfirmed", "goodsDescription"].includes(field)) return fail(400, "Onbekend douaneveld.");
    const value = text(a.value); evidence(); s.customs.goods[field] = value; invalidate(s);
  } else if (op === "CUSTOMS_APPROVE") {
    if (!actor.permissions.includes("IMPORT_CUSTOMS_APPROVE")) return fail(403, "Bevoegde douanegoedkeurder vereist.");
    if (readiness(s).status !== "READY" || !s.customs.goods.hsCode || !s.customs.goods.origin || s.customs.goods.classificationConfirmed !== "yes" || s.customs.goods.valuationConfirmed !== "yes") return fail(409, "Documenten, classificatie, oorsprong en waardering moeten menselijk bevestigd zijn.");
    evidence(); s.customs.approvedVersion = s.customs.version; s.customs.approvedBy = actor.id; s.customs.status = "APPROVED";
    if (state.demo) s.status = "CUSTOMS_PREPARED";
  } else if (op === "CUSTOMS_SUBMIT") {
    if (!state.demo) return fail(409, "Geen productie-douaneprovider geconfigureerd.");
    if (s.customs.approvedVersion !== s.customs.version || s.customs.status !== "APPROVED" || readiness(s).status !== "READY") return fail(409, "Actuele bevoegde goedkeuring vereist.");
    evidence(); s.customs.status = new SyntheticCustomsProvider(state.demo).submit(s.reference, s.customs.version).status;
  } else if (op === "CUSTOMS_EVENT") {
    if (!state.demo) return fail(403, "Synthetische events zijn uitsluitend voor demo.");
    const status = text(a.status); if (!["RELEASED", "HELD"].includes(status)) return fail(400, "Onbekende providerstatus.");
    if (!["SUBMITTED", "RELEASED", "HELD"].includes(s.customs.status) || s.customs.approvedVersion !== s.customs.version) return fail(409, "Dien eerst een goedgekeurde versie in.");
    evidence(); s.customs.status = status;
    if (status === "RELEASED") s.status = "CUSTOMS_RELEASED";
  } else if (op === "ADD_CHARGE" || op === "EDIT_CHARGE") {
    const c = chargeInput(a.charge); evidence();
    if (op === "ADD_CHARGE") s.charges.push({...c, id: `charge-${randomUUID()}`, paid: false});
    else { const old = s.charges.find(c => c.id === a.chargeId); if (!old || (!financial && /goods|ocean|origin/i.test(old.label))) return fail(403, "Onbekende of vertrouwelijke kostenregel."); Object.assign(old, c, {paid: false}); }
  } else if (op === "RECORD_PAYMENT") {
    if (state.demo || actor.companyId !== s.companyId || !["OWNER", "ADMIN"].includes(actor.membershipRole)) return fail(403, "Alleen een bedrijfsbeheerder kan een werkelijke betaling handmatig registreren.");
    const c = s.charges.find(c => c.id === a.chargeId);
    if (!c) return fail(403, "Geen toegang tot kostenregel.");
    evidence(); c.paid = true;
  } else if (op === "PAY_CHARGE") {
    const c = s.charges.find(c => c.id === a.chargeId); if (!c || (!financial && /goods|ocean|origin/i.test(c.label))) return fail(403, "Geen toegang tot kostenregel.");
    evidence(); new SyntheticPaymentProvider(state.demo).record(c.invoiceReference); c.paid = true;
  } else if (op === "SET_GATE" || op === "CONFIGURE_GATE") {
    const key = text(a.gate, 80); const proof = evidence();
    let gate = s.gates.find(g => g.key === key);
    if (op === "CONFIGURE_GATE") {
      if (actor.companyId !== s.companyId || !actor.permissions.includes("IMPORT_ADMIN")) return fail(403, "Alleen de bevoegde eigenaar kan vrijgavevoorwaarden configureren.");
      const required = bool(a.required); if (["customs", "payment"].includes(key) && !required) return fail(409, "Douane en betalingscontrole blijven verplicht.");
      if (!gate) { gate = {key, required, satisfied: false}; s.gates.push(gate); } else gate.required = required;
      gate.evidence = proof;
    } else {
      if (!gate || ["customs", "payment"].includes(key)) return fail(409, "Deze voorwaarde vereist bewijs uit de bronmodule.");
      gate.satisfied = bool(a.satisfied); gate.evidence = proof;
      if (key === "terminal" && gate.satisfied) s.status = state.demo && s.customs.status === "RELEASED" ? "TERMINAL_AVAILABLE" : "ARRIVED";
    }
  } else if (op === "FIND_DELIVERY") {
    s.delivery.listingIds = [...new Set(integration.findDelivery(s))];
  } else if (op === "PLAN_DELIVERY") {
    const matchId = text(a.matchId), proof = evidence();
    if (!pickupReady(s) || !integration.isConnectedEligible(s, matchId)) return fail(409, "Alle vrijgavevoorwaarden en actuele wederzijdse verbinding vereist; interesse is geen boeking.");
    s.delivery = {...s.delivery, status: "PLANNED", matchId, evidence: proof};
  } else if (op === "DELIVER") {
    const proof = evidence();
    if (!pickupReady(s) || s.delivery.status !== "PLANNED" || !s.delivery.matchId || !integration.isConnectedEligible(s, s.delivery.matchId)) return fail(409, "Actuele vrijgave en afzonderlijke planning vereist.");
    s.delivery.status = "DELIVERED"; s.delivery.evidence = proof; s.status = "DELIVERED";
  } else if (op === "EXCEPTION") {
    const e = s.exceptions.find(e => e.id === a.exceptionId);
    if (!e || !shipmentModules(state, actor, s).includes(e.module)) return fail(403, "Geen toegang tot uitzondering.");
    const command = text(a.command), note = text(a.note, 2000);
    if (command === "ASSIGN") { const target = integration.findActor(text(a.userId)); if (!target || !shipmentModules(state, target, s).includes(e.module)) return fail(403, "Toegewezen bevoegde collega vereist."); e.assigneeId = target.id; }
    else if (command === "RESOLVE") { if (e.id.startsWith("review-") && readiness(s).reasons.some(r => e.id === `review-${s.id}-${r.split(":")[0]}`)) return fail(409, "Los eerst het onderliggende documentprobleem op."); e.status = "RESOLVED"; }
    else if (command === "ESCALATE") e.priority = "HIGH";
    else if (command === "SNOOZE") { const until = date(a.until); if (until <= now) return fail(400, "Snooze moet in de toekomst liggen."); e.until = until; e.status = "SNOOZED"; }
    else if (command !== "COMMENT") return fail(400, "Onbekende uitzonderingactie.");
    e.comments.push(`${actor.id}: ${note}`);
  } else if (op === "ASSIGN_PARTNER") {
    if (actor.companyId !== s.companyId) return fail(403, "Alleen de zendingeigenaar kan taken delen.");
    const target = integration.findActor(text(a.userId)); if (!target || !Array.isArray(a.modules)) return fail(400, "Partner en modules vereist.");
    const modules = a.modules as ImportModule[];
    if (!modules.length || !modules.every(m => shipmentModules(state, actor, s).includes(m) && importModules(state, target).includes(m))) return fail(403, "Geen onbevoegde modules delen.");
    evidence();
    const existing = s.assignments.find(x => x.userId === target.id); if (existing) existing.modules = [...modules];
    else s.assignments.push({userId: target.id, companyId: target.companyId, modules: [...modules]});
  } else if (op === "CONFIRM_COMPANY") { evidence(); s.companyConfirmed = true; }
  else if (op === "CONFIRM_REPRESENTATION") { evidence(); s.representationReviewed = true; }
  else if (op === "DELIVERY_CHOICE") { evidence(); s.delivery.choice = text(a.value); }
  else return fail(400, "Onbekende importactie.");
  if (!pickupReady(s) && s.delivery.status === "PLANNED") s.delivery.status = "BLOCKED";
  if (s.delivery.listingIds.length || (!wasReady && pickupReady(s) && (!state.demo || s.delivery.transport))) s.delivery.listingIds = [...new Set(integration.findDelivery(s))];
  if (!wasReady && pickupReady(s)) integration.notify?.(s, `pickup-ready-v${s.customs.version}`, "Alle verplichte vrijgavevoorwaarden voldaan; vervoersopties opnieuw beoordeeld. Geen boeking.");
  syncImportExceptions(s, new Date(now));
  audit(s, actor, op, now, before, {shipment: shipmentMetadata(), fields: s.fields, customs: s.customs, gates: effectiveGates(s), delivery: s.delivery, documents: s.documents, charges: s.charges, assignments: s.assignments, exceptions: s.exceptions, evidence: a.evidence ?? a.note}, state.demo);
}
function audit(s: Shipment, actor: ImportActor, action: string, now: string, oldValue: unknown, newValue: unknown, demo: boolean) {
  s.timeline.push({id: randomUUID(), actorId: actor.id, action, at: now, eventAt: now, source: demo ? "SYNTHETIC_DEMO" : "MANUAL_RECORDED", oldValue, newValue: structuredClone(newValue)});
}
function shipmentInput(input: unknown) {
  const a = record(input);
  const result = {reference: text(a.reference, 100), name: text(a.name), kind: text(a.kind, 80), origin: text(a.origin, 200), destination: text(a.destination, 200), port: text(a.port, 200), eta: date(a.eta),
    ...(a.incoterm === undefined ? {} : {incoterm: text(a.incoterm, 20)}), ...(a.container === undefined ? {} : {container: text(a.container, 100)}),
    ...(a.masterReference === undefined ? {} : {masterReference: text(a.masterReference, 100)}), ...(a.houseReference === undefined ? {} : {houseReference: text(a.houseReference, 100)})};
  if (a.requiredDocumentTypes !== undefined) {
    if (!Array.isArray(a.requiredDocumentTypes) || !a.requiredDocumentTypes.length || a.requiredDocumentTypes.length > 30 || !a.requiredDocumentTypes.every(t => typeof t === "string" && DOCUMENT_TYPES.includes(t))) return fail(400, "Geldige verplichte documenttypen vereist.");
    return {...result, requiredDocumentTypes: [...new Set(a.requiredDocumentTypes as string[])]};
  }
  return result;
}
export const DOCUMENT_TYPES = ["INVOICE", "PACKING_LIST", "BILL_OF_LADING", "SEA_WAYBILL", "AWB", "ORIGIN", "CERTIFICATE", "LICENSE", "IMPORT_LICENSE", "HEALTH_CERTIFICATE", "PHYTOSANITARY_CERTIFICATE", "INSURANCE", "ARRIVAL_NOTICE", "CUSTOMS_DECLARATION", "DELIVERY_ORDER", "REPRESENTATION", "OTHER"];
function chargeInput(input: unknown) {
  const a = record(input), currency = text(a.currency, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return fail(400, "ISO-valutacode vereist.");
  return {label: text(a.label), amount: numeric(a.amount), currency, supplier: text(a.supplier), invoiceReference: text(a.invoiceReference), estimated: bool(a.estimated), vat: bool(a.vat)};
}