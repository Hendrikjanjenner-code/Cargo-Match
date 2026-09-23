/** Stable frontend-only wire contract. All identifiers and records are synthetic in demo mode. */
export type ImportModule = "SHIPMENTS" | "DOCUMENTS" | "IMPORT" | "CUSTOMS" | "CHARGES" | "RELEASE" | "DELIVERY" | "CONTROL" | "PARTNERS" | "EXCEPTIONS";
export type ImportAction = {
  type: "IMPORT_CONTROL"; shipmentId?: string;
  operation: "ARRIVING" | "ASSIGN_CUSTOMS_REVIEW" | "CUSTOMS_REVIEW_OPEN" | "CUSTOMS_REVIEW_COMPLETE" | "CREATE_SHIPMENT" | "EDIT_SHIPMENT" | "ADD_CHARGE" | "EDIT_CHARGE" | "CONFIGURE_GATE" | "SET_MODULE" | "UPLOAD_DOCUMENT" | "EXTRACT_DOCUMENT" | "REVIEW_DOCUMENT" | "CONFIRM_FIELD" | "CUSTOMS_EDIT" | "CUSTOMS_APPROVE" | "CUSTOMS_SUBMIT" | "CUSTOMS_EVENT" | "PAY_CHARGE" | "SET_GATE" | "FIND_DELIVERY" | "PLAN_DELIVERY" | "DELIVER" | "EXCEPTION" | "ASSIGN_PARTNER" | "CONFIRM_COMPANY" | "CONFIRM_REPRESENTATION" | "DELIVERY_CHOICE";
  module?: ImportModule; enabled?: boolean; documentId?: string; documentType?: string;
  name?: string; objectPath?: string; mimeType?: string; size?: number; accepted?: boolean;
  field?: string; value?: string | number; evidence?: string; chargeId?: string;
  gate?: string; satisfied?: boolean; matchId?: string; status?: string;
  exceptionId?: string; command?: "ASSIGN" | "COMMENT" | "RESOLVE" | "ESCALATE" | "SNOOZE";
  note?: string; userId?: string; until?: string; modules?: ImportModule[];
  shipment?: {reference: string; name: string; kind: string; origin: string; destination: string; port: string; eta: string; incoterm?: string; container?: string; masterReference?: string; houseReference?: string; requiredDocumentTypes?: string[]};
  charge?: {label: string; amount: number; currency: string; supplier: string; invoiceReference: string; estimated: boolean; vat: boolean};
  required?: boolean;
};
export interface ImportDocument {
  id: string; type: string; name: string; version: number; status: "PENDING" | "REVIEW_REQUIRED" | "ACCEPTED" | "REJECTED";
  fixtureId?: string; objectPath?: string; mimeType?: string; size?: number;
  fields: Record<string, string | number>; proposals: {field: string; value: string | number; sourceDocumentId: string; status: "PROPOSED" | "CONFIRMED"}[];
}
export interface ImportCharge { id: string; label: string; amount: number; currency: string; supplier: string; invoiceReference: string; estimated: boolean; vat: boolean; paid: boolean }
export interface ImportEvent { id: string; actorId: string; action: string; at: string; eventAt: string; source: string; oldValue?: unknown; newValue?: unknown }
export interface ImportException { id: string; title: string; status: "OPEN" | "RESOLVED" | "SNOOZED"; priority: "HIGH" | "MEDIUM"; reason: string; module: ImportModule; assigneeId?: string; until?: string; comments: string[] }
export interface ImportVessel {
  id: string; name: string; identification: string; type: string; status: "UNDERWAY" | "ANCHORED" | "IN_PORT" | "STALE" | "UNKNOWN";
  latitude?: number; longitude?: number; speedKnots?: number; course?: number; destination: string; eta: string; observedAt?: string;
  source: "SYNTHETIC_DEMO"; route: [number, number][];
}
export interface ImportShipmentView {
  customsReview?: {id: string; assigneeId: string; status: "ASSIGNED" | "OPENED" | "COMPLETED"; recommendation?: string; completedAt?: string};
  id: string; reference: string; name: string; kind: string; origin: string; destination: string; port: string; eta: string;
  status: string; vesselId: string; container?: string; masterReference?: string; houseReference?: string; incoterm?: string;
  fields: Record<string, string | number>; readiness: {status: "READY" | "BLOCKED"; reasons: string[]};
  documents: ImportDocument[]; charges: ImportCharge[]; totals: Record<string, {cost: number; vat: number; payable: number}>;
  customs?: {version: number; status: string; approvedVersion?: number; approvedBy?: string; goods: Record<string, string | number>; disclaimer: string};
  gates: {key: string; required: boolean; satisfied: boolean; evidence?: string}[];
  delivery: {status: string; listingIds: string[]; matchId?: string; evidence?: string; choice?: string; requirementId?: string};
  exceptions: ImportException[]; timeline: ImportEvent[]; allowedModules: ImportModule[];
  companyConfirmed: boolean; representationReviewed: boolean;
  parentId?: string;
}
export interface ImportControlView {
  demo: boolean; modules: ImportModule[]; dependencies: Record<ImportModule, ImportModule[]>;
  shipments: ImportShipmentView[]; vessels: ImportVessel[]; disclaimer: string;
}