import type { Mode, DemoSession } from "../api";

export const modeLabels: Record<Mode, string> = { INLAND: "Maritime · Binnenvaart", DEEPSEA: "Maritime · Deepsea bulk", LINER: "Maritime · Liner / breakbulk", ROAD: "Wegtransport", RAIL: "Spoor", AIR: "Luchtvracht", IMPORT: "CargoMatch Import" };
export const assetLabels: Record<Mode, string> = { INLAND: "Schepen", DEEPSEA: "Fleet", LINER: "Services & schepen", ROAD: "Voertuigen & trailers", RAIL: "Wagons & services", AIR: "Vluchten", IMPORT: "Zendingen" };
export const capacityLabels: Record<Mode, string> = { INLAND: "Capaciteit", DEEPSEA: "Open positions", LINER: "Afvaarten", ROAD: "Verwacht beschikbaar", RAIL: "Spoorcapaciteit", AIR: "Vluchtcapaciteit", IMPORT: "Zendingen" };
export const quantity = (value: number, mode: Mode) => `${value.toLocaleString("nl-NL")} ${mode === "AIR" ? "kg" : "ton"}`;
export const localDate = (value: string) => `${new Date(value).toLocaleString("nl-NL", { timeZone: "UTC" })} UTC`;
export const toLocalInput = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16);
};
export const moduleEnabled = (session: DemoSession, mode: Mode) => {
  const flag = session.context.modules[mode] ?? session.context.modules[mode === "AIR" ? "AIR_CARGO" : mode === "IMPORT" ? "CARGOMATCH_IMPORT" : mode];
  return session.context.allowedModes.includes(mode) && (flag === "ACTIVE" || flag === "PILOT");
};
export const roleHeadings: Record<string, [string, string]> = {
  andy: ["Charterdesk", "Beheer cargo orders en zoek passende open positions; identiteit blijft beschermd tot wederzijdse toestemming."],
  sophie: ["Fleet & open positions", "Beheer de OceanBridge-vloot, verwachte beschikbaarheid en inkomende commerciële interesse."],
  mark: ["Mijn schip & volgende lading", "Bevestig de operationele beschikbaarheid van jouw schip. Eva beslist over commerciële verbindingen."],
  eva: ["Binnenvaartplanning", "Beoordeel Marks doorgestuurde kansen en plan passende lading voor de vloot."],
  laura: ["Mijn lading & vervoersopties", "Vergelijk passende capaciteit per vervoersmodus en volg jouw geadresseerde Import-zending."],
  thomas: ["Wegtransportplanning", "Beoordeel Jans meldingen en zoek de volgende lading voor de beschikbare voertuigen."],
  jan: ["Mijn truck & volgende opdracht", "Controleer Truck 42 en stuur een geschikte kans naar Thomas, zonder commerciële toestemming te geven."],
  anna: ["Wagonplanning · demo-pilot", "Beoordeel lading op wagontype, aantallen, route, tonnage en beschikbaarheidsvenster."],
  sarah: ["Vluchtcapaciteit · demo-pilot", "Vergelijk AMS–DXB-lading op kilogrammen, volume, gereedheid, cutoff en benodigde behandeling."],
  david: ["Liner & forwarding", "Beheer services, afvaarten, luchtvrachtlading en toegewezen LCL-consolidaties in de gedeelde demo."],
  emma: ["Beheer gedeelde demo-omgeving", "Gedeelde bedrijven, scenario’s en audit. Een expliciete reset raakt ALLE demoaccounts; nooit productiegegevens."],
};