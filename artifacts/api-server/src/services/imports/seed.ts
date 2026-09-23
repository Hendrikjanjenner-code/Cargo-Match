import { IMPORT_MODULES, type ImportState, type Shipment, type Document, type Vessel } from "./types";
import { syncImportExceptions } from "./domain";

export const IMPORT_MANAGER_PERMISSIONS = [...IMPORT_MODULES.map(m => `IMPORT_${m}`), "IMPORT_ADMIN"];
export function seedImports(now: Date): ImportState {
  const at = (days: number) => new Date(now.getTime() + days * 86400000).toISOString();
  const documents = (prefix: string, china: boolean): Document[] => [
    ["INVOICE", "Commercial invoice", {value: china ? 84300 : 12500, currency: "EUR", packages: 24}],
    ["PACKING_LIST", "Packing list", {weightKg: china ? 18420 : 3200, packages: 24}],
    ["BILL_OF_LADING", "Bill of lading", {weightKg: china ? 18240 : 3200, packages: 24}],
    ["ORIGIN", "Certificate of origin", {origin: china ? "CN" : "IN"}],
  ].map(([type, name, fields], i) => ({id: `${prefix}-doc-${i}`, type: String(type), name: `DEMO ${name}`, version: 1, status: "PENDING", fixtureId: `${prefix}-${String(type).toLowerCase()}`, fields: fields as Record<string, string | number>, proposals: []}));
  const shipment = (id: string, china: boolean): Shipment => ({
    id, reference: china ? "CM-2026-008421" : `CM-2026-008422-H${id.at(-1)}`,
    name: china ? "DEMO elektrische motoren" : "DEMO textiel", kind: china ? "FCL" : "LCL",
    origin: china ? "Shenzhen / Yantian" : "Mumbai", port: "Rotterdam", destination: china ? "Eindhoven" : "Tilburg",
    eta: at(china ? 2 : 1), status: china ? "IN_TRANSIT" : "ARRIVING", vesselId: china ? "vessel-1" : "vessel-2", container: china ? "TCLU1234567 (FICTIEF)" : "DEMO-LCL-0001",
    masterReference: china ? "DEMO-MBL-CN-8421" : "DEMO-MBL-IN-8422", ...(china ? {incoterm: "FOB"} : {houseReference: id, parentId: "india-master", incoterm: "FOB"}),
    companyId: "globaltrade", consigneeCompanyId: china ? "globaltrade" : id === "india-house-1" ? "eurocommodities" : id === "india-house-2" ? "textile-demo" : "receiver-c",
    responsibleId: "michael",
    assignments: [
      {userId: "michael", companyId: "globaltrade", modules: [...IMPORT_MODULES]},
      {userId: "david", companyId: "globalline", modules: [...IMPORT_MODULES].filter(m => m !== "CUSTOMS")},
      {userId: "customs-specialist", companyId: "customs-demo", modules: ["SHIPMENTS", "DOCUMENTS", "IMPORT", "CUSTOMS", "CONTROL", "EXCEPTIONS"]},
      {userId: "finance", companyId: "globaltrade", modules: ["SHIPMENTS", "CHARGES", "CONTROL", "EXCEPTIONS"]},
       ...(!china ? [{userId: id === "india-house-1" ? "laura" : id === "india-house-2" ? "consignee" : "consignee-c", companyId: id === "india-house-1" ? "eurocommodities" : id === "india-house-2" ? "textile-demo" : "receiver-c", modules: ["SHIPMENTS", "DOCUMENTS", "CHARGES", "RELEASE", "DELIVERY", "CONTROL", "IMPORT"] as typeof IMPORT_MODULES[number][]}] : []),
    ],
    fields: {weightKg: china ? 18420 : 3200, volumeM3: china ? 28 : 14, packages: 24, value: china ? 84300 : 12500, currency: "EUR", goods: china ? "Elektrische motoren" : "Textiel",
      eori: "DEMO-NL-EORI-NOT-VALID", commodityCode: china ? "8501 (DEMO review required)" : "6204 (DEMO review required)", originCountry: china ? "CN" : "IN", customsValue: china ? 84300 : 12500, importInstructions: "DEMO vrij verkeer; classificatie, oorsprong en waardering afzonderlijk menselijk bevestigen."},
    confirmedFields: {}, documents: documents(id, china),
    charges: (china ? [["Goods value", 84300], ["Ocean freight", 4800], ["Origin", 950], ["Destination", 1240], ["Customs duty (estimated 4% of goods)", 3372], ["Customs clearance", 145], ["Inland delivery", 720], ["Other", 180]] : [["Destination handling", 125], ["Terminal", 85]]).map(([label, amount], i) => ({id: `${id}-charge-${i}`, label: String(label), amount: Number(amount), currency: "EUR", supplier: "DEMO supplier", invoiceReference: `DEMO-INV-${id}-${i}`, estimated: true, vat: false, paid: false})),
    customs: {version: 1, status: "DRAFT", goods: {}, disclaimer: "DEMO — geen echte aangifte, vertegenwoordiging of fiscaal advies. Menselijke classificatie-, oorsprong- en waarderingsreview vereist."},
    gates: ["customs", "carrier", "terminal", "payment", "delivery_order"].map(key => ({key, required: true, satisfied: false})),
    delivery: {status: "NOT_PLANNED", listingIds: [], ...(china ? {transport: {mode: "ROAD" as const, equipment: ["container"], technical: {cargoType: "container", requiredTrailerType: "CONTAINER_CHASSIS", loadingMetres: 12.2, pallets: 24}}} : {})}, exceptions: [], timeline: [{id: `${id}-created`, actorId: "system", action: "SYNTHETIC_SEED", at: now.toISOString(), eventAt: now.toISOString(), source: "SYNTHETIC_DEMO"}],
    companyConfirmed: false, representationReviewed: false,
  });
  const vessels: Vessel[] = ["UNDERWAY", "UNDERWAY", "ANCHORED", "IN_PORT", "STALE", "UNKNOWN", "UNDERWAY", "IN_PORT"].map((status, i) => ({
    authorizedCompanyIds: ["globaltrade", "globalline", ...(i < 2 ? ["customs-demo"] : []), ...(i === 1 ? ["eurocommodities", "textile-demo"] : [])],
    id: `vessel-${i + 1}`, name: `DEMO ${["Jade Horizon", "Mumbai Star", "North Anchorage", "Rotterdam Pearl", "Silent Ocean", "Unknown Passage", "Atlantic Cedar", "Harbour Iris"][i]}`,
    identification: `SYNTHETIC-${1001 + i}`, type: i % 2 ? "CONTAINER_SHIP" : "GENERAL_CARGO", status: status as Vessel["status"],
    ...(status === "UNKNOWN" ? {} : {latitude: [36, 24, 51.98, 51.95, 8, 0, 43, 1.27][i], longitude: [-5, 61, 3.8, 4.14, 79, 0, -12, 103.8][i], speedKnots: status === "UNDERWAY" ? 15.4 : 0, course: 320, observedAt: at(status === "STALE" ? -4 : 0)}),
    destination: i === 7 ? "Singapore" : "Rotterdam", eta: at(2 + i), source: "SYNTHETIC_DEMO",
    route: i === 1 ? [[72.88, 18.94], [61, 24], [43, 12], [32, 30], [-5, 36], [4.14, 51.95]] : [[114.27, 22.57], [103.8, 1.27], [43, 12], [32, 30], [-5, 36], [4.14, 51.95]],
  }));
  const shipments = [shipment("china-fcl", true), shipment("india-house-1", false), shipment("india-house-2", false), shipment("india-house-3", false)];
  const master: Shipment = {...structuredClone(shipments[1]), id: "india-master", reference: "CM-2026-008422", name: "DEMO Mumbai textielconsolidatie", kind: "LCL_CONSOLIDATION", parentId: undefined, houseReference: undefined, consigneeCompanyId: undefined, documents: [], charges: [],
    fields: {...shipments[1].fields, weightKg: 9600, volumeM3: 42, packages: 72, value: 37500, customsValue: 37500}, assignments: shipments[1].assignments.filter(a => !["laura", "consignee", "consignee-c"].includes(a.userId)), timeline: []};
  shipments.push(master);
  const wednesday = new Date(now);
  wednesday.setUTCDate(wednesday.getUTCDate() + ((3-wednesday.getUTCDay()+7)%7 || 7));
  wednesday.setUTCHours(8,0,0,0);
  for (const mode of ["INLAND", "RAIL"] as const) {
    const s = shipment(`import-${mode.toLowerCase()}`, true);
    s.reference = `CM-DEMO-${mode}`; s.name = `DEMO container · ${mode} naar Duisburg`; s.destination = "Duisburg"; s.eta = wednesday.toISOString();
    s.container = `DEMO-${mode}-0001`; s.masterReference = `DEMO-MBL-${mode}`;
    // Cargo ready at 08:00 is not the required loading-window start. The
    // shipper explicitly requests collection from noon, after terminal handling.
    s.delivery.transport = {mode, ...(mode === "INLAND" ? {pickupFrom: new Date(wednesday.getTime()+4*3600000).toISOString()} : {}), equipment: ["container"], technical: {cargoType: "container", ...(mode === "INLAND" ? {requiredVesselType: "CONTAINER"} : {wagonCount: 1, wagonType: "FLAT"})}};
    shipments.push(s);
  }
  for (const s of shipments) {
    for (const d of s.documents) d.fields = {...d.fields, container: s.container!, reference: s.reference, shipper: "DEMO Exporter", consignee: s.consigneeCompanyId!, currency: "EUR"};
    syncImportExceptions(s, now);
  }
  return {demo: true, clock: now.toISOString(), entitlements: Object.fromEntries(["globaltrade", "globalline", "customs-demo", "cargoclear", "receiver-c", "eurocommodities", "textile-demo"].map(id => [id, [...IMPORT_MODULES]])), shipments, vessels};
}