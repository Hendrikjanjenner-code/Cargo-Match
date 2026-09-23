import type { Persona, DemoCompany, DemoState, Mode, Asset, Listing, Technical } from "./types";
import { seedImports, IMPORT_MANAGER_PERMISSIONS } from "../imports/seed";
import { IMPORT_MODULES } from "../imports/types";

const commercial = ["VIEW_MATCHES", "SHOW_INTEREST", "ACCEPT_CONNECTION", "DECLINE_CONNECTION", "MESSAGE_CONNECTED"];
const persona = (id: string, name: string, companyId: string, operationalProfile: string, primaryMode: Mode,
  permissions: string[], assignedAssetIds: string[] = [], membershipRole: Persona["membershipRole"] = "MEMBER"): Persona =>
  ({ id, name, companyId, membershipRole, operationalProfile, primaryMode, permissions, assignedAssetIds, platformRole: id === "emma" ? "DEMO_ADMIN" : "USER" });
export const PERSONAS: Persona[] = [
  persona("andy", "Andy Kers", "northsea", "CHARTERER", "DEEPSEA", [...commercial, "CREATE_CARGO", "EDIT_OWN_CARGO"], [], "OWNER"),
  persona("sophie", "Sophie van Dijk", "oceanbridge", "OWNER_REPRESENTATIVE", "DEEPSEA", [...commercial, "MANAGE_ASSETS", "MANAGE_CAPACITY"], [], "ADMIN"),
  persona("mark", "Mark de Jong", "rhineflow", "SKIPPER", "INLAND", ["VIEW_ASSIGNED_ASSET", "MANAGE_ASSIGNED_ASSET_AVAILABILITY", "SEND_TO_PLANNER", "VIEW_MATCHES"], ["asset-inland"]),
  persona("eva", "Eva Jansen", "rhineflow", "PLANNER", "INLAND", [...commercial, "MANAGE_ASSETS", "MANAGE_CAPACITY", "REVIEW_REFERRAL"]),
   persona("laura", "Laura Peters", "eurocommodities", "SHIPPER", "INLAND", [...commercial, "CREATE_CARGO", "EDIT_OWN_CARGO", "VIEW_IMPORT_RECEIVER", ...["SHIPMENTS", "DOCUMENTS", "CHARGES", "RELEASE", "DELIVERY", "CONTROL", "IMPORT"].map(m => `IMPORT_${m}`)], [], "OWNER"),
  persona("thomas", "Thomas Becker", "transroute", "PLANNER", "ROAD", [...commercial, "MANAGE_ASSETS", "MANAGE_CAPACITY", "REVIEW_REFERRAL"]),
  persona("jan", "Jan Müller", "transroute", "DRIVER", "ROAD", ["VIEW_ASSIGNED_ASSET", "MANAGE_ASSIGNED_ASSET_AVAILABILITY", "SEND_TO_PLANNER", "VIEW_MATCHES"], ["asset-road"]),
  persona("anna", "Anna Schmidt", "eurorail", "RAIL_OPERATOR", "RAIL", [...commercial, "MANAGE_ASSETS", "MANAGE_CAPACITY"]),
  persona("sarah", "Sarah Williams", "skyfreight", "AIR_CARGO_OPERATOR", "AIR", [...commercial, "MANAGE_ASSETS", "MANAGE_CAPACITY"]),
   persona("david", "David Chen", "globalline", "FORWARDER", "LINER", [...commercial, "CREATE_CARGO", "EDIT_OWN_CARGO", "MANAGE_ASSETS", "MANAGE_CAPACITY", "MANAGE_IMPORT", ...IMPORT_MODULES.filter(m => m !== "CUSTOMS").map(m => `IMPORT_${m}`)]),
   persona("michael", "Michael van der Meer", "globaltrade", "IMPORT_MANAGER", "IMPORT", [...commercial, ...IMPORT_MANAGER_PERMISSIONS, "CREATE_CARGO", "EDIT_OWN_CARGO"], [], "OWNER"),
   persona("customs-specialist", "Noor Bakker (DEMO)", "customs-demo", "CUSTOMS_SPECIALIST", "IMPORT", [...["SHIPMENTS", "DOCUMENTS", "IMPORT", "CUSTOMS", "CONTROL", "EXCEPTIONS"].map(m => `IMPORT_${m}`), "IMPORT_CUSTOMS_APPROVE"]),
    persona("natalie", "Natalie Smit", "cargoclear", "CUSTOMS_SPECIALIST", "IMPORT", [...["SHIPMENTS", "DOCUMENTS", "IMPORT", "CUSTOMS", "CONTROL", "EXCEPTIONS"].map(m => `IMPORT_${m}`), "IMPORT_CUSTOMS_APPROVE"]),
    persona("consignee-c", "Lucas de Wit (DEMO)", "receiver-c", "CONSIGNEE", "IMPORT", ["SHIPMENTS", "DOCUMENTS", "CHARGES", "RELEASE", "DELIVERY", "CONTROL", "IMPORT"].map(m => `IMPORT_${m}`)),
   persona("finance", "Sanne Visser (DEMO)", "globaltrade", "FINANCE", "IMPORT", ["SHIPMENTS", "CHARGES", "CONTROL", "EXCEPTIONS"].map(m => `IMPORT_${m}`)),
   persona("consignee", "Priya de Vries (DEMO)", "textile-demo", "CONSIGNEE", "IMPORT", ["SHIPMENTS", "DOCUMENTS", "CHARGES", "RELEASE", "DELIVERY", "CONTROL", "IMPORT"].map(m => `IMPORT_${m}`)),
  persona("emma", "Emma de Vries", "cargomatch-demo", "COMPANY_MANAGER", "DEEPSEA", ["VIEW_ADMIN", "RESET_DEMO"], [], "ADMIN"),
];
export const getPersona = (id: string) => PERSONAS.find(p => p.id === id);
const company = (id: string, name: string, modes: Mode[], activities: string[]): DemoCompany => ({ id, name, modes, activities, demo: true });
export const COMPANIES: DemoCompany[] = [
   company("globaltrade", "GLOBALTRADE IMPORTS DEMO BV", ["IMPORT", "ROAD", "INLAND", "RAIL"], ["IMPORTER"]),
   company("customs-demo", "Customs Specialist DEMO BV", ["IMPORT"], ["CUSTOMS"]),
    company("cargoclear", "CargoClear Customs Demo", ["IMPORT"], ["CUSTOMS"]),
    company("receiver-c", "Third Receiver Demo", ["IMPORT"], ["RECEIVER"]),
   company("textile-demo", "Textile Consignee DEMO BV", ["IMPORT"], ["RECEIVER"]),
  company("northsea", "NorthSea Chartering Demo", ["DEEPSEA"], ["CHARTERER"]),
  company("oceanbridge", "OceanBridge Bulk Demo", ["DEEPSEA"], ["CARRIER"]),
  company("rhineflow", "RhineFlow Shipping Demo", ["INLAND"], ["CARRIER"]),
  company("eurocommodities", "EuroCommodities Demo", ["INLAND", "DEEPSEA", "ROAD", "RAIL", "AIR", "LINER", "IMPORT"], ["SHIPPER", "RECEIVER"]),
  company("transroute", "TransRoute Logistics Demo", ["ROAD"], ["CARRIER"]),
  company("eurorail", "EuroRail Cargo Demo", ["RAIL"], ["CARRIER"]),
  company("skyfreight", "SkyFreight Demo", ["AIR"], ["CARRIER"]),
  company("globalline", "GlobalLine Logistics Demo", ["LINER", "AIR", "IMPORT"], ["FORWARDER", "CARRIER", "IMPORT_CONSOLIDATOR"]),
  company("cargomatch-demo", "CargoMatch demo-beheer", [], ["DEMO_PLATFORM"]),
];
export function seedDemo(now = new Date()): DemoState {
  const at = (days: number, hour = 12, minute = 0) => {
    const d = new Date(now); d.setUTCDate(d.getUTCDate() + days); d.setUTCHours(hour, minute, 0, 0); return d.toISOString();
  };
  const state: DemoState = { version: 1, seededAt: now.toISOString(), companies: structuredClone(COMPANIES), assets: [], listings: [], matches: [], messages: [], notifications: [], referrals: [], imports: [], audit: [], evidence: [] };
  const asset = (mode: Mode, owner: string, name: string, type: string, capacity: number, location: string, technical: Technical = {}, volume?: number, suffix = mode.toLowerCase()): Asset => {
    if (state.assets.some(a => a.id === `asset-${suffix}`)) suffix = `${suffix}-${state.assets.length}`;
    const a: Asset = {id: `asset-${suffix}`, companyId: owner, mode, name, type, capacity, location, availableAt: at(1, mode === "ROAD" ? 14 : 6), equipment: ["standard"], technical: {...(mode === "INLAND" || mode === "DEEPSEA" ? {vesselType: "DRY_CARGO"} : {}), ...technical}, ...(volume == null ? {} : {volume}), demo: true};
    state.assets.push(a); return a;
  };
  const pair = (a: Asset, cargoOwner: string, origin: string, destination: string, quantity: number, volume?: number, technical: Technical = {}) => {
    const suffix = a.id.replace("asset-", "");
    const base = {mode: a.mode, origin, destination, equipment: ["standard"], availableFrom: at(1, 15), availableUntil: at(4), status: "ACTIVE" as const, visibility: "OPEN_NETWORK" as const, demo: true as const};
    const cargo: Listing = {...base, id: `cargo-${suffix}`, companyId: cargoOwner, kind: "CARGO", name: `${a.mode} fictieve lading`, quantity, technical: {cargoType: "general cargo", ...(a.mode === "INLAND" || a.mode === "DEEPSEA" ? {requiredVesselType: "DRY_CARGO"} : {}), ...technical}, ...(volume == null ? {} : {volume})};
    const capacity: Listing = {...base, id: `capacity-${suffix}`, companyId: a.companyId, kind: "CAPACITY", name: `${a.name} aanbod`, assetId: a.id, quantity: a.capacity, technical: {cargoType: "general cargo", maximumPositioningDistanceKm: 250, ...structuredClone(a.technical), ...(a.mode === "ROAD" ? {currentDeliveryExpectedAt: at(1, 13, 30), expectedAvailabilityAt: at(1, 14), availabilityUncertaintyMinutes: 15, preferredDirection: destination} : {})}, ...(a.volume == null ? {} : {volume: a.volume}), availableFrom: a.availableAt};
    state.listings.push(cargo, capacity);
    state.matches.push({id: `match-${suffix}`, cargoId: cargo.id, capacityId: capacity.id, leftConsent: false, rightConsent: false, status: "NEW"});
    // Incompatible published and non-discoverable negative examples.
    state.listings.push({...structuredClone(cargo), id: `cargo-${suffix}-incompatible`, name: `${a.mode} te zware oefenlading`, quantity: a.capacity * 2});
    state.listings.push({...structuredClone(capacity), id: `capacity-${suffix}-private`, name: "Privé oefenaanbod", visibility: "PRIVATE"});
    return {cargo, capacity};
  };
  const deepsea = asset("DEEPSEA", "oceanbridge", "MV OceanBridge Atlas", "KAMSARMAX", 82000, "Malaysia", {vesselClass: "KAMSARMAX", draft: 14, manualPositioningDays: 1, positioningBufferDays: 0, uncertaintyDays: 1, cargoType: "dry bulk"});
  const ds = pair(deepsea, "northsea", "Indonesia", "China", 75000, undefined, {cargoType: "dry bulk", maxDraft: 16});
  ds.cargo.name = "75.000 mt coal Indonesia–China";
  ds.capacity.origin = "Malaysia";
  ds.cargo.availableFrom = at(3); ds.cargo.availableUntil = at(6); ds.capacity.availableUntil = at(7);
  asset("DEEPSEA", "oceanbridge", "MV OceanBridge Pacific", "PANAMAX", 74000, "Singapore");
  asset("DEEPSEA", "oceanbridge", "MV OceanBridge Pearl", "SUPRAMAX", 56000, "Malaysia");
  asset("DEEPSEA", "oceanbridge", "MV OceanBridge Cape", "CAPESIZE", 180000, "South Africa");
  asset("DEEPSEA", "oceanbridge", "MV OceanBridge Mini", "HANDYSIZE", 35000, "Rotterdam");
  pair(asset("INLAND", "rhineflow", "MS RhineFlow One", "DRY_CARGO", 1800, "Rotterdam"), "eurocommodities", "Rotterdam", "Duisburg", 1200);
  asset("INLAND", "rhineflow", "MS RhineFlow Two", "DRY_CARGO", 2400, "Antwerp", {}, undefined, "inland-two");
   const road = pair(asset("ROAD", "transroute", "Truck 42", "CURTAINSIDER", 24, "Eindhoven", {loadingMetres: 13.6, pallets: 33}, 90), "eurocommodities", "Eindhoven North", "Utrecht", 18, 45, {loadingMetres: 8, pallets: 20});
   road.capacity.origin = "Eindhoven";
  asset("ROAD", "transroute", "Truck 43 + reefer", "REEFER", 22, "Cologne", {temperatureMin: -20, temperatureMax: 10}, 70, "road-two");
  asset("ROAD", "transroute", "Truck 44 + box trailer", "BOX", 24, "Duisburg", {}, 80, "road-three");
  const rail = pair(asset("RAIL", "eurorail", "Duisburg wagon group", "WAGON_GROUP", 720, "Duisburg", {wagonCount: 12, wagonType: "FLAT"}, 800), "eurocommodities", "Duisburg", "Rotterdam", 480, 400, {wagonCount: 8, wagonType: "FLAT"});
  rail.cargo.name = "Steel · 8 flat wagons"; rail.capacity.name = "12 wagons · Duisburg–Rotterdam service";
  const air = pair(asset("AIR", "skyfreight", "AMS–DXB · B777F", "FREIGHTER", 4800, "AMS", {cutoffAt: at(1, 18)}, 28), "globalline", "AMS", "DXB", 3600, 20);
  air.capacity.availableFrom = at(1, 21, 30); air.capacity.availableUntil = at(2, 6);
  air.cargo.availableUntil = at(2, 12); air.cargo.name = "3.600 kg air shipment · AMS–DXB";
  asset("AIR", "skyfreight", "AMS–DXB belly capacity", "BELLY", 1500, "AMS", {cutoffAt: at(1, 16)}, 8, "air-belly");
  const liner = pair(asset("LINER", "globalline", "GlobalLine East–West", "BREAKBULK", 4000, "Shanghai", {maxPieceWeight: 120, maxPieceLength: 20, maxPieceWidth: 5, maxPieceHeight: 6, liftingCapacity: 120, stowage: "EITHER", cutoffAt: at(2), cargoType: "BREAKBULK"}, 5000), "eurocommodities", "Shanghai", "Hamburg", 800, 1000, {pieceWeight: 80, pieceCount: 10, pieceLength: 10, pieceWidth: 2, pieceHeight: 2, requiredLifting: 80, stowage: "HOLD", cargoType: "BREAKBULK"});
  liner.capacity.availableFrom = at(3);
  // Existing conversation is separate from the unconnected primary chain.
  const inlandCargo = state.listings.find(l => l.id === "cargo-inland")!;
  const oldCargo = {...structuredClone(inlandCargo), id: "cargo-inland-existing", name: "Grain follow-up exercise", quantity: 500};
  state.listings.push(oldCargo);
  state.matches.push({id: "match-inland-existing", cargoId: oldCargo.id, capacityId: "capacity-inland", leftConsent: true, rightConsent: true, status: "CONNECTED"});
  state.messages.push({id: "message-seed", matchId: "match-inland-existing", senderName: "Eva Jansen", body: "Fictief eerder gesprek over de graanlading. Een verbinding is geen boeking.", createdAt: now.toISOString(), demo: true});
  // Explicit weaker positive examples use real scoring inputs, not a painted
  // "weak" badge. Negative overweight/private examples above never match.
  for (const mode of ["inland", "road", "deepsea"]) {
    const base = state.listings.find(l => l.id === `capacity-${mode}`)!;
    const weak = {...structuredClone(base), id: `capacity-${mode}-weak`, name: `${base.name} · ruimer alternatief`};
    if (mode === "inland") weak.origin = "Duisburg";
    if (mode === "road") weak.origin = "Utrecht";
    if (mode === "deepsea") weak.technical = {...weak.technical, manualPositioningDays: 2, uncertaintyDays: 3};
    state.listings.push(weak);
  }
  for (const mode of ["rail", "air"]) {
    const base = state.listings.find(l => l.id === `cargo-${mode}`)!;
    state.listings.push({...structuredClone(base), id: `cargo-${mode}-weak`, name: `${base.name} · kleinere benutting`, quantity: base.quantity / 2, volume: base.volume! / 2});
  }
  state.imports.push({id: "import-lcl", name: "Demo LCL Shanghai–Rotterdam", receiverCompanyId: "eurocommodities", status: "IN_TRANSIT", arrivalAt: at(2), documents: [{id: "doc-packing", name: "Fictieve paklijst", status: "PENDING"}, {id: "doc-arrival", name: "Fictief aankomstbericht", status: "PENDING"}], charges: [{id: "charge-handling", label: "Gesimuleerde handling", amount: 125, currency: "EUR"}, {id: "charge-terminal", label: "Gesimuleerde terminalkosten", amount: 85, currency: "EUR"}], paymentStatus: "UNPAID", releaseStatus: "HELD", pickupStatus: "NOT_READY", demo: true});
   for (const p of PERSONAS) state.notifications.push({id: `welcome-${p.id}`, userId: p.id, title: "Gedeelde demo: alle persona’s werken samen. Alle gegevens zijn fictief.", read: false, createdAt: now.toISOString(), demo: true});
   state.importControl = seedImports(now);
   // Shipment-derived cargo uses the existing physical and timing matcher.
    const containerTruck = asset("ROAD", "transroute", "Truck 45 · container chassis", "CONTAINER_CHASSIS", 28, "Rotterdam", {loadingMetres: 13.6, pallets: 33}, 80, "import-road");
    const barge = asset("INLAND", "rhineflow", "MS RhineFlow Container", "CONTAINER", 1800, "Rotterdam", {vesselType: "CONTAINER", cargoType: "container"}, 2500, "import-inland");
    const railImport = asset("RAIL", "eurorail", "Rotterdam–Duisburg container service", "WAGON_GROUP", 720, "Rotterdam", {wagonCount: 12, wagonType: "FLAT", cargoType: "container"}, 800, "import-rail");
    for (const a of [containerTruck, barge, railImport]) {
      const shipment = state.importControl!.shipments.find(s => s.delivery.transport?.mode === a.mode)!;
      const available = new Date(shipment.eta);
      if (a.mode === "INLAND") available.setUTCHours(11, 0, 0, 0);
      a.availableAt = available.toISOString(); a.equipment = ["container"];
      state.listings.push({id: `capacity-import-${a.mode.toLowerCase()}`, companyId: a.companyId, mode: a.mode, kind: "CAPACITY", name: `${a.name} · expliciete democapaciteit`,
        assetId: a.id, origin: "Rotterdam", destination: shipment.destination, quantity: a.capacity, volume: a.volume, equipment: ["container"], availableFrom: a.availableAt,
        availableUntil: new Date(available.getTime()+4*86400000).toISOString(), status: "ACTIVE", visibility: "OPEN_NETWORK", demo: true,
        technical: {...a.technical, cargoType: "container", maximumPositioningDistanceKm: 150, ...(a.mode === "ROAD" ? {
          expectedAvailabilityAt: a.availableAt, currentDeliveryExpectedAt: new Date(available.getTime()-3600000).toISOString(), availabilityUncertaintyMinutes: 15, preferredDirection: shipment.destination,
        } : {})}});
    }
    state.importFixtureRevision = 1;
   return state;
}