import { randomUUID } from "node:crypto";
import { applyImportAction, projectImportControl, importModules, shipmentModules, type ImportActionOptions } from "../imports/domain";
import type { ImportIntegration } from "../imports/types";
import { isCapacityWithinVessel } from "../matching";
import { coreEvaluation } from "./core-adapter";
import { PERSONAS, getPersona, seedDemo } from "./seed";
import { DemoError, denied, MODES, type Asset, type DemoState, type Listing, type Match, type Mode, type Opportunity, type Persona, type Sandbox, type Technical } from "./types";

export const LOCATIONS: Record<string, {region: string; latitude: number; longitude: number}> = {
  Malaysia: {region: "Southeast Asia", latitude: 1.36, longitude: 103.55},
  Indonesia: {region: "Southeast Asia", latitude: 1.05, longitude: 103.96},
  China: {region: "East Asia", latitude: 31.2, longitude: 121.5},
  Singapore: {region: "Southeast Asia", latitude: 1.3, longitude: 103.8},
  "South Africa": {region: "Southern Africa", latitude: -33.9, longitude: 18.4},
  Rotterdam: {region: "South Holland", latitude: 51.92, longitude: 4.48},
  Duisburg: {region: "North Rhine-Westphalia", latitude: 51.43, longitude: 6.76},
  Antwerp: {region: "Flanders", latitude: 51.22, longitude: 4.4},
  Eindhoven: {region: "North Brabant", latitude: 51.44, longitude: 5.47},
  Utrecht: {region: "Utrecht region", latitude: 52.09, longitude: 5.12},
  Cologne: {region: "North Rhine-Westphalia", latitude: 50.94, longitude: 6.96},
  AMS: {region: "Amsterdam / Schiphol region", latitude: 52.31, longitude: 4.77},
  DXB: {region: "Dubai region", latitude: 25.25, longitude: 55.36},
  Shanghai: {region: "East China", latitude: 31.23, longitude: 121.47},
  Hamburg: {region: "Northern Germany", latitude: 53.55, longitude: 9.99},
  Tilburg: {region: "North Brabant", latitude: 51.56, longitude: 5.09},
};
const has = (actor: Persona, permission: string) => actor.permissions.includes(permission);
const isOperational = (actor: Persona) => has(actor, "VIEW_ASSIGNED_ASSET");
const permittedMode = (state: DemoState, actor: Persona, mode: Mode) => state.companies.find(c => c.id === actor.companyId)?.modes.includes(mode);
const nowText = () => new Date().toISOString();
const invalid = (message = "Ongeldige demo-invoer."): never => { throw new DemoError(400, "INVALID_INPUT", message); };
const conflict = (message: string): never => { throw new DemoError(409, "INVALID_STATE", message); };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) return invalid();
  return value.trim();
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1e9) return invalid();
  return value;
}
function date(value: unknown): string {
  const s = text(value, 40); if (Number.isNaN(Date.parse(s))) return invalid("Een geldige datum en tijd is vereist.");
  return new Date(s).toISOString();
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 30) return invalid();
  return value.map(v => text(v, 80));
}
function location(value: unknown): string { const s = text(value); return LOCATIONS[s] ? s : invalid("Kies een locatie uit de democatalogus."); }
function technical(value: unknown): Technical {
  if (value === undefined) return {};
  const input = record(value); const result: Record<string, unknown> = {};
  const numbers = ["wagonCount", "pieceWeight", "maxPieceWeight", "draft", "maxDraft", "loadingMetres", "pallets", "maximumPositioningDistanceKm", "minimumDwt", "maximumDwt", "pieceCount", "pieceLength", "pieceWidth", "pieceHeight", "maxPieceLength", "maxPieceWidth", "maxPieceHeight", "liftingCapacity", "requiredLifting"];
  const nonnegative = ["manualPositioningDays", "positioningBufferDays", "uncertaintyDays", "quantityTolerancePercent", "availabilityUncertaintyMinutes"];
  for (const [key, v] of Object.entries(input)) {
    if (numbers.includes(key)) result[key] = number(v);
    else if (nonnegative.includes(key)) {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 365) return invalid();
      result[key] = v;
    } else if (key === "temperatureMin" || key === "temperatureMax") {
      if (typeof v !== "number" || !Number.isFinite(v) || v < -100 || v > 100) return invalid();
      result[key] = v;
    } else if (["wagonType", "cargoType", "gear", "vesselClass", "vesselType", "requiredVesselType", "requiredTrailerType", "preferredDirection", "stowage"].includes(key)) result[key] = text(v, 80);
    else if (["cutoffAt", "currentDeliveryExpectedAt", "expectedAvailabilityAt"].includes(key)) result[key] = date(v);
    else if (key === "adrClasses") result[key] = strings(v);
    else return invalid(`Onbekend technisch veld: ${key}`);
  }
  if (typeof result.wagonCount === "number" && !Number.isInteger(result.wagonCount)) return invalid();
  if (typeof result.pallets === "number" && !Number.isInteger(result.pallets)) return invalid();
  if (typeof result.pieceCount === "number" && !Number.isInteger(result.pieceCount)) return invalid();
  if (typeof result.quantityTolerancePercent === "number" && result.quantityTolerancePercent >= 100) return invalid();
  if (result.stowage !== undefined && !["HOLD", "DECK", "EITHER"].includes(String(result.stowage))) return invalid();
  if (typeof result.temperatureMin === "number" && typeof result.temperatureMax === "number" && result.temperatureMin > result.temperatureMax) return invalid();
  return result as Technical;
}
function includes(haystack: string[], needles: string[]) { return needles.every(n => haystack.includes(n)); }

/** Reuses the production physical-capacity guard and manual deepsea time model.
 * Rail and air are deliberately conservative demo-pilot compatibility checks.
 */
export function eligible(state: DemoState, cargo: Listing, capacity: Listing, now = new Date()): boolean {
  if (cargo.kind !== "CARGO" || capacity.kind !== "CAPACITY" || cargo.mode !== capacity.mode || cargo.companyId === capacity.companyId) return false;
  if ([cargo, capacity].some(l => l.status !== "ACTIVE" || l.visibility !== "OPEN_NETWORK" || Date.parse(l.availableUntil) <= now.getTime())) return false;
  const asset = state.assets.find(a => a.id === capacity.assetId && a.companyId === capacity.companyId && a.mode === capacity.mode);
  if (!asset || !isCapacityWithinVessel(capacity.quantity, asset.capacity)) return false;
  if (["INLAND", "DEEPSEA", "ROAD", "LINER"].includes(cargo.mode)) {
    return coreEvaluation(state, cargo, capacity, asset, LOCATIONS, now).eligible;
  }
  if (capacity.quantity < cargo.quantity) return false;
  if ((cargo.volume ?? 0) > (capacity.volume ?? asset.volume ?? 0) || (capacity.volume ?? 0) > (asset.volume ?? 0)) return false;
  if (!includes(asset.equipment, capacity.equipment) || !includes(capacity.equipment, cargo.equipment)) return false;
  const ct = cargo.technical ?? {}, pt = capacity.technical ?? {}, at = asset.technical ?? {};
  if (ct.cargoType && pt.cargoType !== ct.cargoType) return false;
  if (ct.gear && at.gear !== ct.gear) return false;
  if (ct.maxDraft && (!at.draft || at.draft > ct.maxDraft)) return false;
  if ((ct.temperatureMin !== undefined || ct.temperatureMax !== undefined) &&
    (pt.temperatureMin === undefined || pt.temperatureMax === undefined || pt.temperatureMin > (ct.temperatureMin ?? ct.temperatureMax!) || pt.temperatureMax < (ct.temperatureMax ?? ct.temperatureMin!))) return false;
  if (pt.temperatureMin !== undefined && (at.temperatureMin === undefined || pt.temperatureMin < at.temperatureMin)) return false;
  if (pt.temperatureMax !== undefined && (at.temperatureMax === undefined || pt.temperatureMax > at.temperatureMax)) return false;
  for (const key of ["loadingMetres", "pallets"] as const) {
    if ((ct[key] ?? 0) > (pt[key] ?? at[key] ?? 0) || (pt[key] ?? 0) > (at[key] ?? 0)) return false;
  }
  if (!includes(pt.adrClasses ?? at.adrClasses ?? [], ct.adrClasses ?? [])) return false;
  if (Math.max(Date.parse(cargo.availableFrom), Date.parse(capacity.availableFrom)) >= Math.min(Date.parse(cargo.availableUntil), Date.parse(capacity.availableUntil))) return false;
  if (capacity.origin !== cargo.origin || capacity.destination !== cargo.destination) return false;
  if (cargo.mode === "RAIL") {
    if (!ct.wagonCount || !pt.wagonCount || !at.wagonCount || ct.wagonCount > pt.wagonCount || pt.wagonCount > at.wagonCount || !ct.wagonType || ct.wagonType !== pt.wagonType || pt.wagonType !== at.wagonType) return false;
  }
  if (cargo.mode === "AIR" || cargo.mode === "LINER") {
    if (!pt.cutoffAt || Date.parse(pt.cutoffAt) <= now.getTime() || Date.parse(cargo.availableFrom) > Date.parse(pt.cutoffAt)) return false;
    if (cargo.mode === "AIR" && (cargo.volume === undefined || capacity.volume === undefined || Date.parse(pt.cutoffAt) >= Date.parse(capacity.availableFrom))) return false;
    if (cargo.mode === "LINER" && (!ct.pieceWeight || !pt.maxPieceWeight || ct.pieceWeight > pt.maxPieceWeight || pt.maxPieceWeight > (at.maxPieceWeight ?? 0))) return false;
  }
  return true;
}
function sides(state: DemoState, match: Match) {
  return {cargo: state.listings.find(l => l.id === match.cargoId)!, capacity: state.listings.find(l => l.id === match.capacityId)!};
}
function canSeeMatch(state: DemoState, actor: Persona, match: Match): boolean {
  const {cargo, capacity} = sides(state, match);
  if (!cargo || !capacity || !has(actor, "VIEW_MATCHES")) return false;
  if (actor.companyId !== cargo.companyId && actor.companyId !== capacity.companyId) return false;
  return !isOperational(actor) || actor.assignedAssetIds.includes(capacity.assetId ?? "");
}
function connected(state: DemoState, actor: Persona, match: Match) {
  const {cargo, capacity} = sides(state, match);
  return !isOperational(actor) && canSeeMatch(state, actor, match) && match.status === "CONNECTED" && eligible(state, cargo, capacity);
}
export function refreshMatches(state: DemoState, now = new Date()) {
  // Add the new isolated scenarios to an older persisted sandbox without
  // discarding the visitor's existing listings, conversations or consent.
  if (!state.importControl || state.importFixtureRevision !== 1) {
    const additions = seedDemo(new Date(state.seededAt));
    state.importControl ??= additions.importControl;
    for (const company of additions.companies) {
      if (!state.companies.some(existing => existing.id === company.id)) state.companies.push(company);
    }
    for (const listing of additions.listings.filter(l => l.id.startsWith("capacity-import-"))) {
      if (!state.listings.some(existing => existing.id === listing.id)) state.listings.push(listing);
    }
    const road = state.listings.find(l => l.id === "capacity-import-road");
    if (road?.destination === "Eindhoven" && road.technical?.preferredDirection === "Utrecht") {
      road.technical.preferredDirection = "Eindhoven";
      invalidateListing(state, road.id);
    }
    state.importFixtureRevision = 1;
  }
  for (const cargo of state.listings.filter(l => l.kind === "CARGO")) for (const capacity of state.listings.filter(l => l.kind === "CAPACITY")) {
    if (!eligible(state, cargo, capacity, now)) continue;
    if (!state.matches.some(m => m.cargoId === cargo.id && m.capacityId === capacity.id))
      state.matches.push({id: `match-${randomUUID()}`, cargoId: cargo.id, capacityId: capacity.id, leftConsent: false, rightConsent: false, status: "NEW"});
  }
  for (const match of state.matches) {
    const {cargo, capacity} = sides(state, match);
    if (!cargo || !capacity || !eligible(state, cargo, capacity, now)) {
      match.status = "STALE"; match.leftConsent = false; match.rightConsent = false;
    }
  }
}
function projectMatch(state: DemoState, actor: Persona, match: Match): Opportunity {
  const {cargo, capacity} = sides(state, match);
  const ownCargo = cargo.companyId === actor.companyId;
  const disclosed = connected(state, actor, match);
  const otherCompany = state.companies.find(c => c.id === (ownCargo ? capacity.companyId : cargo.companyId))!;
  const asset = state.assets.find(a => a.id === capacity.assetId);
  const margin = Math.min(1, cargo.quantity / capacity.quantity);
  const score = asset && ["INLAND", "DEEPSEA", "ROAD", "LINER"].includes(cargo.mode)
    ? coreEvaluation(state, cargo, capacity, asset, LOCATIONS, new Date()).score
    : Math.round(70 + margin * 30);
  return {
    id: match.id, cargoId: cargo.id, capacityId: capacity.id, mode: cargo.mode,
    origin: disclosed ? cargo.origin : LOCATIONS[cargo.origin]?.region ?? "Onbekende regio",
    destination: disclosed ? cargo.destination : LOCATIONS[cargo.destination]?.region ?? "Onbekende regio",
    quantity: ownCargo || disclosed ? cargo.quantity : Math.ceil(cargo.quantity / 100) * 100,
    score: Math.round(score), provisional: true, status: match.status, ownSide: ownCargo ? "CARGO" : "CAPACITY",
    source: "FICTIONAL_MANUAL", verification: "NOT_VERIFIED",
    ...(disclosed ? { counterpartyName: otherCompany.name, assetName: asset?.name, contact: `${otherCompany.id}@example.com` } : {}),
  };
}
export function projectSession(sandbox: Sandbox) {
  const actor = getPersona(sandbox.personaId); if (!actor) return denied();
  const state = sandbox.state;
  const company = state.companies.find(c => c.id === actor.companyId)!;
  const matches = state.matches.filter(m => canSeeMatch(state, actor, m));
  const opportunities = matches.filter(m => m.status !== "STALE" && m.status !== "DECLINED").map(m => projectMatch(state, actor, m));
  const ownListings = state.listings.filter(l => l.companyId === actor.companyId && (!isOperational(actor) || actor.assignedAssetIds.includes(l.assetId ?? "")));
  const connectedCompanyIds = new Set(matches.filter(m => connected(state, actor, m)).flatMap(m => {const s = sides(state, m); return [s.cargo.companyId, s.capacity.companyId];}));
  return {
    demo: true as const, csrfToken: sandbox.csrfToken, revision: sandbox.revision, seededAt: state.seededAt,
    stale: Date.now() - Date.parse(state.seededAt) > 7 * 86_400_000,
     context: { user: actor, company, permissions: actor.permissions, allowedModes: company.modes,
       importModules: state.importControl && process.env.DEMO_IMPORT_ENABLED !== "false" ? importModules(state.importControl, actor) : [],
      modules: {
        INLAND: "ACTIVE", DEEPSEA: "ACTIVE", LINER: "ACTIVE", ROAD: "PILOT", RAIL: "PILOT", AIR: "PILOT",
        IMPORT: process.env.DEMO_IMPORT_ENABLED === "false" ? "HIDDEN" : "PILOT",
        AIR_CARGO: "PILOT", CARGOMATCH_IMPORT: process.env.DEMO_IMPORT_ENABLED === "false" ? "HIDDEN" : "PILOT",
        DEMO_MODE: "ACTIVE", GUIDED_DEMO: process.env.DEMO_GUIDED_ENABLED === "false" ? "HIDDEN" : "PILOT",
      } },
    // Public catalogue only: explicit static personas, never account records.
    personas: PERSONAS,
    workspace: {
      assets: state.assets.filter(a => a.companyId === actor.companyId && (!isOperational(actor) || actor.assignedAssetIds.includes(a.id))),
      cargos: ownListings.filter(l => l.kind === "CARGO"), capacity: ownListings.filter(l => l.kind === "CAPACITY"),
      opportunities, matches: matches.map(m => ({...projectMatch(state, actor, m), leftConsent: m.leftConsent, rightConsent: m.rightConsent})),
      messages: state.messages.filter(message => matches.some(m => m.id === message.matchId && connected(state, actor, m))),
       notifications: state.notifications.filter(n => {
         if (n.userId !== actor.id) return false;
         if (!n.importShipmentId) return true;
         const shipment = state.importControl?.shipments.find(s => s.id === n.importShipmentId);
         return process.env.DEMO_IMPORT_ENABLED !== "false" && !!shipment &&
           shipmentModules(state.importControl!, actor, shipment).includes("RELEASE");
       }),
      referrals: state.referrals.filter(r => r.fromUserId === actor.id || r.toUserId === actor.id),
       imports: process.env.DEMO_IMPORT_ENABLED !== "false" ? state.imports.filter(i => (has(actor, "MANAGE_IMPORT") && actor.companyId === "globalline" && i.id === "import-lcl") || (has(actor, "VIEW_IMPORT_RECEIVER") && i.receiverCompanyId === actor.companyId)) : [],
       importControl: state.importControl && process.env.DEMO_IMPORT_ENABLED !== "false" ? projectImportControl(state.importControl, actor) : undefined,
      companies: state.companies.filter(c => c.id === actor.companyId || connectedCompanyIds.has(c.id) || has(actor, "VIEW_ADMIN")),
      audit: has(actor, "VIEW_ADMIN") ? state.audit : [],
      evidence: state.evidence.filter(e => actor.assignedAssetIds.includes(e.assetId) || (has(actor, "MANAGE_CAPACITY") && state.assets.some(a => a.id === e.assetId && a.companyId === actor.companyId))),
    },
    catalogue: {locations: Object.keys(LOCATIONS)},
  };
}
function notify(state: DemoState, userId: string, title: string) {
  state.notifications.push({id: randomUUID(), userId, title, read: false, createdAt: nowText(), demo: true});
}
function invalidateListing(state: DemoState, listingId: string) {
  for (const match of state.matches.filter(m => m.cargoId === listingId || m.capacityId === listingId)) {
    match.status = "NEW"; match.leftConsent = false; match.rightConsent = false;
    // Messages belong to the old consent context, and cannot be redisclosed by
    // reaccepting materially edited cargo/capacity.
    state.messages = state.messages.filter(message => message.matchId !== match.id);
  }
}
function mode(value: unknown): Mode {
  return typeof value === "string" && MODES.includes(value as Mode) && value !== "IMPORT" ? value as Mode : invalid();
}
function authorizedListing(state: DemoState, actor: Persona, listing: Listing) {
  return listing.companyId === actor.companyId && permittedMode(state, actor, listing.mode) &&
    has(actor, listing.kind === "CARGO" ? "EDIT_OWN_CARGO" : "MANAGE_CAPACITY");
}
function validateListingLimits(state: DemoState, listing: Listing) {
  if (Date.parse(listing.availableFrom) >= Date.parse(listing.availableUntil)) return invalid("Het eindtijdstip moet na het begintijdstip liggen.");
  const t = listing.technical ?? {};
  if (["INLAND", "DEEPSEA", "ROAD", "LINER"].includes(listing.mode) && !t.cargoType) return invalid("Een technische goederensoort is vereist.");
  if ((listing.mode === "INLAND" || listing.mode === "DEEPSEA") && listing.kind === "CARGO" && !t.requiredVesselType) return invalid("Een vereist scheepstype is nodig.");
  if (listing.mode === "LINER" && listing.kind === "CARGO" && (!t.pieceCount || !t.pieceWeight || !t.pieceLength || !t.pieceWidth || !t.pieceHeight || !t.stowage)) return invalid("Breakbulk vereist stukaantal, stukgewicht, afmetingen en stuwage.");
  if (listing.mode === "RAIL" && (!t.wagonCount || !t.wagonType)) return invalid("Spoor vereist aantal wagons en wagontype.");
  if (listing.mode === "AIR" && listing.volume === undefined) return invalid("Luchtvracht vereist volume in m³.");
  if (listing.kind === "CAPACITY") {
    const asset = state.assets.find(a => a.id === listing.assetId && a.companyId === listing.companyId && a.mode === listing.mode);
    if (!asset) return denied();
    if (!isCapacityWithinVessel(listing.quantity, asset.capacity) || (listing.volume ?? 0) > (asset.volume ?? 0) || !includes(asset.equipment, listing.equipment)) return invalid("Capaciteit overschrijdt de geregistreerde assetlimieten.");
    const at = asset.technical ?? {};
    for (const key of ["wagonCount", "maxPieceWeight", "maxPieceLength", "maxPieceWidth", "maxPieceHeight", "liftingCapacity", "loadingMetres", "pallets"] as const) if ((t[key] ?? 0) > (at[key] ?? 0)) return invalid("Technische capaciteit overschrijdt de assetlimiet.");
    if (t.temperatureMin !== undefined && (at.temperatureMin === undefined || t.temperatureMin < at.temperatureMin)) return invalid("Temperatuurcapaciteit overschrijdt de assetlimiet.");
    if (t.temperatureMax !== undefined && (at.temperatureMax === undefined || t.temperatureMax > at.temperatureMax)) return invalid("Temperatuurcapaciteit overschrijdt de assetlimiet.");
    if (!includes(at.adrClasses ?? [], t.adrClasses ?? [])) return invalid("ADR-capaciteit overschrijdt de assetlimiet.");
    if (["INLAND", "DEEPSEA", "ROAD"].includes(listing.mode) && !t.maximumPositioningDistanceKm) return invalid("Een positioneringslimiet is vereist.");
    if (listing.mode === "ROAD" && (!t.loadingMetres || !t.pallets || !listing.volume || t.availabilityUncertaintyMinutes === undefined || !t.currentDeliveryExpectedAt || !t.expectedAvailabilityAt || Date.parse(t.currentDeliveryExpectedAt) > Date.parse(t.expectedAvailabilityAt))) return invalid("Wegcapaciteit vereist maten en een geldige leverings-/beschikbaarheidsvolgorde.");
    if (listing.mode === "RAIL" && t.wagonType !== at.wagonType) return invalid();
    if ((listing.mode === "AIR" || listing.mode === "LINER") && !t.cutoffAt) return invalid("Een cargo cutoff is vereist.");
    if (listing.mode === "AIR" && Date.parse(t.cutoffAt!) >= Date.parse(listing.availableFrom)) return invalid("Cutoff moet voor vertrek liggen.");
    if (listing.mode === "DEEPSEA" && t.manualPositioningDays === undefined) return invalid("Een expliciete handmatige positioneringsschatting is vereist.");
    if (listing.mode === "LINER" && (!t.maxPieceWeight || !t.maxPieceLength || !t.maxPieceWidth || !t.maxPieceHeight || !t.liftingCapacity || !t.stowage)) return invalid("Lijndienstcapaciteit vereist stuklimieten, hijscapaciteit en stuwage.");
  }
}
export function demoImportIntegration(state: DemoState): ImportIntegration {
  return {
    findActor: getPersona,
    notify(shipment, eventKey, message) {
      for (const assignment of shipment.assignments) {
        const actor = getPersona(assignment.userId);
        if (!actor || !state.importControl || !importModules(state.importControl, actor).includes("RELEASE") || !assignment.modules.includes("RELEASE")) continue;
        const id = `import-${shipment.id}-${eventKey}-${actor.id}`;
        if (!state.notifications.some(n => n.id === id)) state.notifications.push({id, userId: actor.id, title: `${shipment.reference}: ${message}`, importShipmentId: shipment.id, read: false, createdAt: nowText(), demo: true});
      }
    },
    findDelivery(shipment) {
      const ids: string[] = [];
      for (const mode of ["ROAD", "INLAND", "RAIL"] as const) {
        const template = state.listings.find(l => l.id === `cargo-${mode.toLowerCase()}`);
        if (!template) continue;
        const id = `import-cargo-${shipment.id}-${mode.toLowerCase()}`;
        const previous = state.listings.find(l => l.id === id);
        const next: Listing = {...structuredClone(template), id, companyId: shipment.companyId, name: `${shipment.reference} — DEMO voortransport`,
            origin: shipment.port, destination: shipment.destination, quantity: Number(shipment.fields.weightKg ?? 0) / 1000,
            volume: Number(shipment.fields.volumeM3 ?? 0), availableFrom: shipment.eta, availableUntil: new Date(Date.parse(shipment.eta) + 4 * 86400000).toISOString(),
            technical: {...template.technical, ...(mode === "RAIL" ? {wagonCount: 1} : {}), ...(mode === "ROAD" ? {loadingMetres: 8, pallets: 24} : {})},
            status: "ACTIVE", visibility: "OPEN_NETWORK"};
        if (!previous) state.listings.push(next);
        else if (["quantity", "volume", "origin", "destination", "availableFrom", "availableUntil"].some(k => previous[k as keyof Listing] !== next[k as keyof Listing])) {
          Object.assign(previous, next); invalidateListing(state, previous.id);
        }
        ids.push(id);
      }
      refreshMatches(state); return ids;
    },
    isConnectedEligible(shipment, matchId) {
      const match = state.matches.find(m => m.id === matchId && shipment.delivery.listingIds.includes(m.cargoId));
      if (!match || match.status !== "CONNECTED" || !match.leftConsent || !match.rightConsent) return false;
      const {cargo, capacity} = sides(state, match);
      return !!cargo && !!capacity && cargo.companyId === shipment.companyId && eligible(state, cargo, capacity);
    },
  };
}
export function applyAction(sandbox: Sandbox, input: unknown, options?: ImportActionOptions): void {
  const action = record(input); const type = text(action.type, 40);
  const actor = getPersona(sandbox.personaId); if (!actor) return denied();
  const state = sandbox.state;
  refreshMatches(state);
  if (type === "IMPORT_CONTROL") {
    if (!state.importControl || process.env.DEMO_IMPORT_ENABLED === "false") return denied();
    applyImportAction(state.importControl, actor, action, demoImportIntegration(state), options);
  } else if (["INTEREST", "ACCEPT", "DECLINE", "MESSAGE", "SEND_TO_PLANNER"].includes(type)) {
    const match = state.matches.find(m => m.id === action.matchId);
    if (!match || !canSeeMatch(state, actor, match)) return denied();
    const commercialPermission = type === "INTEREST" ? "SHOW_INTEREST" : type === "ACCEPT" ? "ACCEPT_CONNECTION" : type === "DECLINE" ? "DECLINE_CONNECTION" : null;
    if (commercialPermission && !has(actor, commercialPermission)) return denied();
    const {cargo, capacity} = sides(state, match);
    if (!eligible(state, cargo, capacity)) return conflict("Deze match is niet meer passend. Vernieuw het overzicht.");
    if (type === "SEND_TO_PLANNER") {
      if (!has(actor, "SEND_TO_PLANNER") || !actor.assignedAssetIds.includes(capacity.assetId ?? "")) return denied();
      const plannerId = actor.id === "mark" ? "eva" : actor.id === "jan" ? "thomas" : denied();
      const note = action.note === undefined ? "" : text(action.note, 1000);
      state.referrals.push({id: randomUUID(), fromUserId: actor.id, toUserId: plannerId, opportunityId: match.id, note, status: "SENT", createdAt: nowText(), demo: true});
      notify(state, plannerId, "Een operationele collega stuurde een ladingkans ter beoordeling.");
    } else if (type === "MESSAGE") {
      if (!has(actor, "MESSAGE_CONNECTED") || !connected(state, actor, match)) return denied();
      state.messages.push({id: randomUUID(), matchId: match.id, senderName: actor.name, body: text(action.body, 2000), createdAt: nowText(), demo: true});
      for (const p of PERSONAS.filter(p => p.companyId === (actor.companyId === cargo.companyId ? capacity.companyId : cargo.companyId) && has(p, "MESSAGE_CONNECTED"))) notify(state, p.id, "Nieuw bericht in een verbonden demogesprek.");
    } else {
      const left = actor.companyId === cargo.companyId;
      const ownConsent = left ? match.leftConsent : match.rightConsent;
      const otherConsent = left ? match.rightConsent : match.leftConsent;
      if (type === "INTEREST") {
        if (match.status !== "NEW" || ownConsent || otherConsent) return conflict("Interesse tonen kan alleen bij een nieuwe introductie zonder eerdere toestemming.");
        if (left) match.leftConsent = true; else match.rightConsent = true;
        match.status = "INTEREST_SENT";
      } else {
        // Declining is a recipient response, never cancellation by the sender
        // or revocation of an already connected conversation. ACCEPT follows
        // the same incoming-interest precondition, with its own permission.
        if (match.status !== "INTEREST_SENT" || ownConsent || !otherConsent) return conflict("Accepteren of afwijzen kan alleen bij openstaande interesse van de tegenpartij.");
        if (type === "DECLINE") {
          match.status = "DECLINED"; match.leftConsent = false; match.rightConsent = false;
        } else {
          if (left) match.leftConsent = true; else match.rightConsent = true;
          match.status = "CONNECTED";
        }
      }
      for (const p of PERSONAS.filter(p => [cargo.companyId, capacity.companyId].includes(p.companyId) && has(p, "ACCEPT_CONNECTION"))) notify(state, p.id, match.status === "CONNECTED" ? "Wederzijdse toestemming: demo verbonden, geen boeking." : "De status van een demo-introductie is gewijzigd.");
    }
  } else if (type === "CONFIRM_AVAILABILITY") {
    const asset = state.assets.find(a => a.id === action.assetId && a.companyId === actor.companyId);
    if (!asset || !(has(actor, "MANAGE_CAPACITY") || (has(actor, "MANAGE_ASSIGNED_ASSET_AVAILABILITY") && actor.assignedAssetIds.includes(asset.id)))) return denied();
    state.evidence.push({assetId: asset.id, actorId: actor.id, availableAt: date(action.availableAt), createdAt: nowText(), demo: true});
    for (const p of PERSONAS.filter(p => p.companyId === actor.companyId && has(p, "MANAGE_CAPACITY"))) notify(state, p.id, "Nieuwe operationele beschikbaarheidsbevestiging; commerciële capaciteit is niet aangepast.");
  } else if (type === "REVIEW_REFERRAL") {
    const referral = state.referrals.find(r => r.id === action.referralId && r.toUserId === actor.id);
    if (!referral || !has(actor, "REVIEW_REFERRAL")) return denied();
    referral.status = "REVIEWED";
  } else if (type === "SAVE_ASSET") {
    if (!has(actor, "MANAGE_ASSETS")) return denied();
    const old = action.assetId === undefined ? undefined : state.assets.find(a => a.id === action.assetId && a.companyId === actor.companyId);
    if (action.assetId !== undefined && !old) return denied();
    const input: Record<string, unknown> = {...old, ...action};
    const m = mode(input.mode); if (!permittedMode(state, actor, m) || (old && old.mode !== m)) return denied();
    const asset: Asset = {id: old?.id ?? `asset-${randomUUID()}`, companyId: actor.companyId, mode: m, name: text(input.name), type: text(input.assetType ?? old?.type), capacity: number(input.capacity), equipment: strings(input.equipment), location: location(input.location), availableAt: date(input.availableAt), technical: technical(input.technical), demo: true};
    if (input.volume !== undefined) asset.volume = number(input.volume);
    if (m === "RAIL" && (!asset.technical?.wagonCount || !asset.technical.wagonType)) return invalid("Spoorassets vereisen wagonspecificaties.");
    if (m === "AIR" && asset.volume === undefined) return invalid("Vluchtcapaciteit vereist een volume.");
    const index = old ? state.assets.indexOf(old) : -1;
    if (index >= 0) state.assets[index] = asset; else state.assets.push(asset);
    for (const listing of state.listings.filter(l => l.assetId === asset.id)) { validateListingLimits(state, listing); invalidateListing(state, listing.id); }
  } else if (type === "SAVE_LISTING") {
    const data = record(action.listing);
    const old = action.listingId === undefined ? undefined : state.listings.find(l => l.id === action.listingId);
    if (action.listingId !== undefined && (!old || !authorizedListing(state, actor, old))) return denied();
    const m = mode(data.mode), kind = data.kind;
    if ((kind !== "CARGO" && kind !== "CAPACITY") || !permittedMode(state, actor, m) ||
      !has(actor, kind === "CARGO" ? "CREATE_CARGO" : "MANAGE_CAPACITY") || (old && (old.kind !== kind || old.mode !== m))) return denied();
    if (data.visibility !== "OPEN_NETWORK" && data.visibility !== "PRIVATE") return invalid();
    const listing: Listing = {id: old?.id ?? `listing-${randomUUID()}`, companyId: actor.companyId, mode: m, kind, name: text(data.name), origin: location(data.origin), destination: location(data.destination), quantity: number(data.quantity), equipment: strings(data.equipment), availableFrom: date(data.availableFrom), availableUntil: date(data.availableUntil), visibility: data.visibility, status: old?.status ?? "DRAFT", technical: technical(data.technical), demo: true};
    if (kind === "CAPACITY") listing.assetId = text(data.assetId);
    if (data.volume !== undefined) listing.volume = number(data.volume);
    validateListingLimits(state, listing);
    if (old) { state.listings[state.listings.indexOf(old)] = listing; invalidateListing(state, old.id); }
    else state.listings.push(listing);
  } else if (type === "PUBLISH_LISTING" || type === "WITHDRAW_LISTING") {
    const listing = state.listings.find(l => l.id === action.listingId);
    if (!listing || !authorizedListing(state, actor, listing)) return denied();
    validateListingLimits(state, listing); invalidateListing(state, listing.id);
    listing.status = type === "PUBLISH_LISTING" ? "ACTIVE" : "WITHDRAWN";
  } else if (type === "IMPORT_STEP") {
    if (!has(actor, "MANAGE_IMPORT") || process.env.DEMO_IMPORT_ENABLED === "false") return denied();
     const shipment = state.imports.find(i => i.id === action.shipmentId && i.id === "import-lcl" && actor.companyId === "globalline"); if (!shipment) return denied();
    const step = text(action.step);
    if (step === "ARRIVED" && shipment.status === "IN_TRANSIT") shipment.status = "ARRIVED";
    else if (step === "DOCUMENTS_READY" && shipment.status === "ARRIVED") shipment.documents.forEach(d => d.status = "READY");
    else if (step === "PAYMENT_SIMULATED" && shipment.documents.every(d => d.status === "READY")) shipment.paymentStatus = "SIMULATED_PAID";
    else if (step === "RELEASED" && shipment.paymentStatus === "SIMULATED_PAID") shipment.releaseStatus = "SIMULATED_RELEASED";
    else if (step === "PICKUP_READY" && shipment.releaseStatus === "SIMULATED_RELEASED") shipment.pickupStatus = "SIMULATED_READY";
    else return conflict("Voer eerst de eerdere stappen van de fictieve Import-keten uit.");
    notify(state, "laura", "De fictieve LCL-zending is bijgewerkt. Geen echte betaling of vrijgave.");
  } else if (type === "READ_NOTIFICATION") {
    const notification = state.notifications.find(n => n.id === action.notificationId && n.userId === actor.id);
    if (!notification) return denied(); notification.read = true;
  } else if (type === "RESET") {
    if (!has(actor, "RESET_DEMO")) return denied();
    if (action.confirmation !== "RESET DEMO") return invalid("Bevestig met RESET DEMO.");
    sandbox.state = seedDemo(); sandbox.revision += 1;
  } else return invalid("Onbekende demoactie.");
  sandbox.state.audit.push({id: randomUUID(), actorId: actor.id, action: type, createdAt: nowText(), demo: true});
  refreshMatches(sandbox.state);
}