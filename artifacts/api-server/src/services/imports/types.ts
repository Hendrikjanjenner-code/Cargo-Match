export const IMPORT_MODULES = ["SHIPMENTS", "DOCUMENTS", "IMPORT", "CUSTOMS", "CHARGES", "RELEASE", "DELIVERY", "CONTROL", "PARTNERS", "EXCEPTIONS"] as const;
export type ImportModule = typeof IMPORT_MODULES[number];
export interface ImportActor { id: string; companyId: string; permissions: string[]; membershipRole: string }
export interface Document {
  id: string; type: string; name: string; version: number; status: "PENDING" | "REVIEW_REQUIRED" | "ACCEPTED" | "REJECTED";
  fixtureId?: string; objectPath?: string; mimeType?: string; size?: number;
  fields: Record<string, string | number>; proposals: {field: string; value: string | number; sourceDocumentId: string; status: "PROPOSED" | "CONFIRMED"}[];
}
export interface Charge { id: string; label: string; amount: number; currency: string; supplier: string; invoiceReference: string; estimated: boolean; vat: boolean; paid: boolean }
export interface ImportEvent { id: string; actorId: string; action: string; at: string; eventAt: string; source: string; oldValue?: unknown; newValue?: unknown }
export interface ImportException { id: string; title: string; status: "OPEN" | "RESOLVED" | "SNOOZED"; priority: "HIGH" | "MEDIUM"; reason: string; module: ImportModule; assigneeId?: string; until?: string; comments: string[] }
export interface Vessel {
  authorizedCompanyIds?: string[];
  id: string; name: string; identification: string; type: string; status: "UNDERWAY" | "ANCHORED" | "IN_PORT" | "STALE" | "UNKNOWN";
  latitude?: number; longitude?: number; speedKnots?: number; course?: number; destination: string; eta: string; observedAt?: string;
  source: "SYNTHETIC_DEMO"; route: [number, number][];
}
export interface Shipment {
  id: string; reference: string; name: string; kind: string; origin: string; destination: string; port: string; eta: string;
  status: string; vesselId: string; container?: string; masterReference?: string; houseReference?: string; incoterm?: string;
  companyId: string; consigneeCompanyId?: string; parentId?: string; responsibleId: string;
  requiredDocumentTypes?: string[];
  assignments: {userId: string; companyId: string; modules: ImportModule[]}[];
  fields: Record<string, string | number>; confirmedFields: Record<string, {value: string | number; evidence: string; actorId: string}>;
  documents: Document[]; charges: Charge[];
  customs: {version: number; status: string; approvedVersion?: number; approvedBy?: string; goods: Record<string, string | number>; disclaimer: string};
  gates: {key: string; required: boolean; satisfied: boolean; evidence?: string}[];
  delivery: {status: string; listingIds: string[]; matchId?: string; evidence?: string; choice?: string;
    requirementId?: string; transport?: {mode: "ROAD" | "INLAND" | "RAIL"; pickupFrom?: string; equipment: string[]; technical: import("../demo/types").Technical}};
  customsReview?: {id: string; assigneeId: string; status: "ASSIGNED" | "OPENED" | "COMPLETED"; recommendation?: string; completedAt?: string};
  exceptions: ImportException[]; timeline: ImportEvent[];
  companyConfirmed: boolean; representationReviewed: boolean;
}
export interface ImportState {
  demo: boolean; clock: string; entitlements: Record<string, ImportModule[]>; shipments: Shipment[]; vessels: Vessel[];
  audit?: ImportEvent[];
}
/** Auth/persistence-independent seams; caller must use its real matching and consent services. */
export interface ImportIntegration {
  findDelivery(shipment: Shipment): string[];
  isConnectedEligible(shipment: Shipment, matchId: string): boolean;
  findActor(userId: string): ImportActor | undefined;
  notify?(shipment: Shipment, eventKey: string, message: string): void;
}
export interface CustomsProvider { submit(reference: string, version: number): {status: string; source: string} }
export interface TrackingProvider { positions(): Vessel[] }
export interface PaymentProvider { record(reference: string): {status: string; source: string} }
export interface DocumentIntelligenceProvider { extract(document: Document): Document["proposals"] }
export interface ReleaseProvider { evidence(reference: string): {status: "UNKNOWN" | "SATISFIED" | "REVOKED"; source: string} }