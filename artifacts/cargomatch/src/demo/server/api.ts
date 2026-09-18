export type Mode = "INLAND" | "DEEPSEA" | "LINER" | "ROAD" | "RAIL" | "AIR" | "IMPORT";

export interface DemoPersona {
  id: string;
  name: string;
  companyId: string;
  membershipRole: "OWNER" | "ADMIN" | "MEMBER";
  operationalProfile: string;
  platformRole: "USER" | "DEMO_ADMIN";
  primaryMode: Mode;
  permissions: string[];
  assignedAssetIds: string[];
}

export interface DemoCompany {
  id: string;
  name: string;
  activities: string[];
  modes: Mode[];
  demo: true;
}

export interface DemoAsset {
  id: string;
  companyId: string;
  mode: Mode;
  name: string;
  type: string;
  capacity: number;
  volume?: number;
  equipment: string[];
  location: string;
  availableAt: string;
  technical?: DemoTechnical;
  demo: true;
}

export interface DemoTechnical {
  wagonCount?: number;
  wagonType?: string;
  temperatureMin?: number;
  temperatureMax?: number;
  cargoType?: string;
  cutoffAt?: string;
  pieceWeight?: number;
  maxPieceWeight?: number;
  manualPositioningDays?: number;
  positioningBufferDays?: number;
  uncertaintyDays?: number;
  draft?: number;
  maxDraft?: number;
  gear?: string;
  vesselClass?: string;
  loadingMetres?: number;
  pallets?: number;
  adrClasses?: string[];
  vesselType?: string;
  requiredVesselType?: string;
  maximumPositioningDistanceKm?: number;
  minimumDwt?: number;
  maximumDwt?: number;
  quantityTolerancePercent?: number;
  requiredTrailerType?: string;
  availabilityUncertaintyMinutes?: number;
  currentDeliveryExpectedAt?: string;
  expectedAvailabilityAt?: string;
  preferredDirection?: string;
  pieceCount?: number;
  pieceLength?: number;
  pieceWidth?: number;
  pieceHeight?: number;
  maxPieceLength?: number;
  maxPieceWidth?: number;
  maxPieceHeight?: number;
  liftingCapacity?: number;
  requiredLifting?: number;
  stowage?: string;
}

export interface DemoListing {
  id: string;
  companyId: string;
  mode: Mode;
  kind: "CARGO" | "CAPACITY";
  name: string;
  assetId?: string;
  origin: string;
  destination: string;
  quantity: number;
  volume?: number;
  equipment: string[];
  availableFrom: string;
  availableUntil: string;
  technical?: DemoTechnical;
  status: "DRAFT" | "ACTIVE" | "WITHDRAWN";
  visibility: "OPEN_NETWORK" | "PRIVATE";
  demo: true;
}

export interface DemoOpportunity {
  id: string;
  cargoId: string;
  capacityId: string;
  mode: Mode;
  origin: string;
  destination: string;
  quantity: number;
  score: number;
  provisional: true;
  status: string;
  ownSide: "CARGO" | "CAPACITY";
  counterpartyName?: string;
  assetName?: string;
  contact?: string;
}

export interface DemoMatch extends DemoOpportunity {
  leftConsent: boolean;
  rightConsent: boolean;
}

export interface DemoMessage {
  id: string;
  matchId: string;
  senderName: string;
  body: string;
  createdAt: string;
  demo: true;
}

export interface DemoNotification {
  id: string;
  userId: string;
  title: string;
  read: boolean;
  createdAt: string;
  demo: true;
}

export interface DemoReferral {
  id: string;
  fromUserId: string;
  toUserId: string;
  opportunityId: string;
  note: string;
  status: "SENT" | "REVIEWED";
  createdAt: string;
  demo: true;
}

export interface DemoImportShipment {
  id: string;
  name: string;
  receiverCompanyId: string;
  status: string;
  arrivalAt: string;
  documents: { id: string; name: string; status: string }[];
  charges: { id: string; label: string; amount: number; currency: string }[];
  paymentStatus: string;
  releaseStatus: string;
  pickupStatus: string;
  demo: true;
}

export interface DemoAudit {
  id: string;
  actorId: string;
  action: string;
  createdAt: string;
  demo: true;
}

export interface DemoSession {
  demo: true;
  csrfToken: string;
  revision: number;
  seededAt: string;
  stale: boolean;
  catalogue: { locations: string[] };
  context: {
    user: DemoPersona;
    company: DemoCompany;
    permissions: string[];
    allowedModes: Mode[];
    modules: Record<string, "ACTIVE" | "PILOT" | "COMING_LATER" | "HIDDEN">;
  };
  personas: DemoPersona[];
  workspace: {
    assets: DemoAsset[];
    cargos: DemoListing[];
    capacity: DemoListing[];
    opportunities: DemoOpportunity[];
    matches: DemoMatch[];
    messages: DemoMessage[];
    notifications: DemoNotification[];
    referrals: DemoReferral[];
    imports: DemoImportShipment[];
    companies: DemoCompany[];
    audit: DemoAudit[];
    evidence: { assetId: string; actorId: string; availableAt: string; createdAt: string; demo: true }[];
  };
}

export type DemoAction = 
  | { type: "INTEREST" | "ACCEPT" | "DECLINE"; matchId: string }
  | { type: "MESSAGE"; matchId: string; body: string }
  | { type: "CONFIRM_AVAILABILITY"; assetId: string; availableAt: string }
  | { type: "SEND_TO_PLANNER"; matchId: string; note?: string }
  | { type: "REVIEW_REFERRAL"; referralId: string }
  | { type: "SAVE_ASSET"; assetId?: string; mode?: Mode; assetType?: string; name?: string; location?: string; availableAt?: string; capacity?: number; volume?: number; equipment?: string[]; technical?: DemoTechnical }
  | { type: "SAVE_LISTING"; listingId?: string; listing: Partial<DemoListing> }
  | { type: "PUBLISH_LISTING" | "WITHDRAW_LISTING"; listingId: string }
  | { type: "IMPORT_STEP"; shipmentId: string; step: "ARRIVED" | "DOCUMENTS_READY" | "PAYMENT_SIMULATED" | "RELEASED" | "PICKUP_READY" }
  | { type: "READ_NOTIFICATION"; notificationId: string }
  | { type: "RESET"; confirmation: "RESET DEMO" };

const BASE_URL = "/api/demo";

export class DemoApiError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message);
    this.name = "DemoApiError";
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.method === "POST" || options.method === "PUT") {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  if (res.status === 204) {
    return null as any;
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new DemoApiError(data?.code || "UNKNOWN_ERROR", data?.error || "De demo kon niet worden geladen. Probeer opnieuw.", res.status);
  }

  return data;
}

export const demoApi = {
  getSession: (signal?: AbortSignal) => request<DemoSession>("/session", { signal, cache: "no-store" }),
  start: (personaId?: string, signal?: AbortSignal) => request<DemoSession>("/start", {
    signal,
    method: "POST",
    headers: { "X-Demo-Request": "1" },
    body: JSON.stringify({ personaId })
  }),
  switchPersona: (personaId: string, csrf: string, revision: number, signal?: AbortSignal) => request<DemoSession>("/switch", {
    signal,
    method: "POST",
    headers: {
      "X-Demo-Request": "1",
      "X-Demo-CSRF": csrf,
      "X-Demo-Revision": String(revision)
    },
    body: JSON.stringify({ personaId })
  }),
  logout: (csrf: string, revision: number, signal?: AbortSignal) => request<void>("/logout", {
    signal,
    method: "POST",
    headers: {
      "X-Demo-Request": "1",
      "X-Demo-CSRF": csrf,
      "X-Demo-Revision": String(revision)
    },
    body: JSON.stringify({})
  }),
  executeAction: (action: DemoAction, csrf: string, revision: number, signal?: AbortSignal) => request<DemoSession>("/actions", {
    signal,
    method: "POST",
    headers: {
      "X-Demo-Request": "1",
      "X-Demo-CSRF": csrf,
      "X-Demo-Revision": String(revision)
    },
    body: JSON.stringify(action)
  }),
};
