export const MODES = ["INLAND", "DEEPSEA", "LINER", "ROAD", "RAIL", "AIR", "IMPORT"] as const;
export type Mode = typeof MODES[number];
export interface Persona {
  id: string; name: string; companyId: string;
  membershipRole: "OWNER" | "ADMIN" | "MEMBER";
  operationalProfile: string; platformRole: "USER" | "DEMO_ADMIN";
  primaryMode: Mode; permissions: string[]; assignedAssetIds: string[];
}
export interface DemoCompany {
  id: string; name: string; activities: string[]; modes: Mode[]; demo: true;
}
export interface Technical {
  wagonCount?: number; wagonType?: string; temperatureMin?: number; temperatureMax?: number;
  cargoType?: string; cutoffAt?: string; pieceWeight?: number; maxPieceWeight?: number;
  manualPositioningDays?: number; positioningBufferDays?: number; uncertaintyDays?: number;
  draft?: number; maxDraft?: number; gear?: string; vesselClass?: string;
  loadingMetres?: number; pallets?: number; adrClasses?: string[];
  vesselType?: string; requiredVesselType?: string; maximumPositioningDistanceKm?: number;
  minimumDwt?: number; maximumDwt?: number; quantityTolerancePercent?: number;
  requiredTrailerType?: string; availabilityUncertaintyMinutes?: number; currentDeliveryExpectedAt?: string;
  expectedAvailabilityAt?: string; preferredDirection?: string;
  pieceCount?: number; pieceLength?: number; pieceWidth?: number; pieceHeight?: number;
  maxPieceLength?: number; maxPieceWidth?: number; maxPieceHeight?: number;
  liftingCapacity?: number; requiredLifting?: number; stowage?: string;
}
export interface Asset {
  id: string; companyId: string; mode: Mode; name: string; type: string; capacity: number;
  volume?: number; equipment: string[]; location: string; availableAt: string;
  technical?: Technical; demo: true;
}
export interface Listing {
  id: string; companyId: string; mode: Mode; kind: "CARGO" | "CAPACITY"; name: string;
  assetId?: string; origin: string; destination: string; quantity: number; volume?: number;
  equipment: string[]; availableFrom: string; availableUntil: string;
  technical?: Technical;
  status: "DRAFT" | "ACTIVE" | "WITHDRAWN"; visibility: "OPEN_NETWORK" | "PRIVATE"; demo: true;
}
export interface Match {
  id: string; cargoId: string; capacityId: string;
  leftConsent: boolean; rightConsent: boolean;
  status: "NEW" | "INTEREST_SENT" | "CONNECTED" | "DECLINED" | "STALE";
}
export interface Message {
  id: string; matchId: string; senderName: string; body: string; createdAt: string; demo: true;
}
export interface Notification {
  id: string; userId: string; title: string; read: boolean; createdAt: string; demo: true;
}
export interface Referral {
  id: string; fromUserId: string; toUserId: string; opportunityId: string; note: string;
  status: "SENT" | "REVIEWED"; createdAt: string; demo: true;
}
export interface ImportShipment {
  id: string; name: string; receiverCompanyId: string; status: string; arrivalAt: string;
  documents: {id: string; name: string; status: string}[];
  charges: {id: string; label: string; amount: number; currency: string}[];
  paymentStatus: string; releaseStatus: string; pickupStatus: string; demo: true;
}
export interface Audit { id: string; actorId: string; action: string; createdAt: string; demo: true }
export interface DemoState {
  version: 1; seededAt: string; companies: DemoCompany[]; assets: Asset[]; listings: Listing[];
  matches: Match[]; messages: Message[]; notifications: Notification[]; referrals: Referral[];
  imports: ImportShipment[]; audit: Audit[];
  evidence: {assetId: string; actorId: string; availableAt: string; createdAt: string; demo: true}[];
}
export interface Sandbox {
  csrfToken: string; personaId: string; revision: number; state: DemoState;
}
export interface Opportunity {
  id: string; cargoId: string; capacityId: string; mode: Mode; origin: string; destination: string;
  quantity: number; score: number; provisional: true; status: Match["status"]; ownSide: "CARGO" | "CAPACITY";
  counterpartyName?: string; assetName?: string; contact?: string;
  source: "FICTIONAL_MANUAL"; verification: "NOT_VERIFIED";
}
export class DemoError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const denied = (): never => { throw new DemoError(403, "FORBIDDEN", "Deze demoactie is niet toegestaan voor dit profiel."); };