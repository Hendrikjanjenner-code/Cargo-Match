import { useState } from "react";
import { useDemo } from "../DemoContext";
import type { DemoTechnical, Mode, DemoListing } from "../api";
import { Button, Input, Label, Select, Card, CardHeader, CardTitle, CardContent } from "@/components/ui/primitives";
import { useDemoRouting } from "./useDemoRouting";
import { modeLabels, toLocalInput } from "./demo-display";

type Field = [keyof DemoTechnical, string, "number" | "text" | "datetime-local" | "list"];
const technicalFields: Record<string, Field[]> = {
  INLAND: [["cargoType", "Ladingtype", "text"], ["vesselType", "Scheepstype", "text"], ["requiredVesselType", "Vereist scheepstype", "text"], ["maximumPositioningDistanceKm", "Maximale positionering (km)", "number"]],
  DEEPSEA: [["cargoType", "Ladingtype", "text"], ["vesselType", "Scheepstype", "text"], ["requiredVesselType", "Vereist scheepstype", "text"], ["vesselClass", "Vessel class", "text"], ["draft", "Diepgang (m)", "number"], ["maxDraft", "Maximale diepgang (m)", "number"], ["gear", "Laad-/losuitrusting", "text"], ["minimumDwt", "Minimum DWT", "number"], ["maximumDwt", "Maximum DWT", "number"], ["quantityTolerancePercent", "Hoeveelheidstolerantie (%)", "number"], ["maximumPositioningDistanceKm", "Maximale positionering (km)", "number"], ["manualPositioningDays", "Handmatige positionering (dagen)", "number"], ["positioningBufferDays", "Buffer (dagen)", "number"], ["uncertaintyDays", "Onzekerheid (dagen)", "number"]],
  ROAD: [["cargoType", "Ladingtype", "text"], ["requiredTrailerType", "Trailertype", "text"], ["loadingMetres", "Laadmeters", "number"], ["pallets", "Palletplaatsen", "number"], ["adrClasses", "ADR-klassen (kommagescheiden)", "list"], ["temperatureMin", "Minimum temperatuur °C", "number"], ["temperatureMax", "Maximum temperatuur °C", "number"], ["currentDeliveryExpectedAt", "Verwachte huidige levering", "datetime-local"], ["expectedAvailabilityAt", "Verwachte beschikbaarheid", "datetime-local"], ["availabilityUncertaintyMinutes", "Onzekerheid (minuten)", "number"], ["maximumPositioningDistanceKm", "Maximale positionering (km)", "number"], ["preferredDirection", "Voorkeursrichting", "text"]],
  RAIL: [["wagonCount", "Aantal wagons", "number"], ["wagonType", "Wagontype", "text"], ["cargoType", "Ladingtype", "text"]],
  AIR: [["cargoType", "Ladingtype", "text"], ["cutoffAt", "Cargo cutoff", "datetime-local"], ["temperatureMin", "Minimum temperatuur °C", "number"], ["temperatureMax", "Maximum temperatuur °C", "number"]],
  LINER: [["cargoType", "Ladingtype (bijv. BREAKBULK)", "text"], ["cutoffAt", "Cargo cutoff", "datetime-local"], ["pieceCount", "Aantal stukken", "number"], ["pieceWeight", "Gewicht per stuk (ton)", "number"], ["pieceLength", "Lengte stuk (m)", "number"], ["pieceWidth", "Breedte stuk (m)", "number"], ["pieceHeight", "Hoogte stuk (m)", "number"], ["maxPieceWeight", "Max. stukgewicht (ton)", "number"], ["maxPieceLength", "Max. stuklengte (m)", "number"], ["maxPieceWidth", "Max. stukbreedte (m)", "number"], ["maxPieceHeight", "Max. stukhoogte (m)", "number"], ["liftingCapacity", "Hijscapaciteit (ton)", "number"], ["requiredLifting", "Vereiste hijscapaciteit (ton)", "number"], ["stowage", "Stuwage HOLD / DECK / EITHER", "text"]],
};
const split = (value: string) => value.split(",").map(v => v.trim()).filter(Boolean);
export function DemoForms({ type, entityId, onCancel }: { type: "form_cargo" | "form_capacity" | "form_asset" | "form_departure"; entityId: string | null; onCancel: () => void }) {
  const { session, executeAction, busy } = useDemo();
  const { mode } = useDemoRouting();
  const context = session!.context;
  const workspace = session!.workspace;
  const locations = session!.catalogue.locations;
  const assetForm = type === "form_asset";
  const isNew = !entityId || entityId === "new";
  const oldAsset = assetForm ? workspace.assets.find(a => a.id === entityId) : undefined;
  const oldListing = !assetForm ? [...workspace.cargos, ...workspace.capacity].find(l => l.id === entityId) : undefined;
  const previous = oldAsset || oldListing;
  const activeMode = previous?.mode || (mode || context.user.primaryMode) as Mode;
  const kind = type === "form_cargo" ? "CARGO" : "CAPACITY";
  const [name, setName] = useState(previous?.name || "");
  const [origin, setOrigin] = useState(oldListing?.origin || oldAsset?.location || "");
  const [destination, setDestination] = useState(oldListing?.destination || "");
  const [amount, setAmount] = useState(String(oldAsset?.capacity ?? oldListing?.quantity ?? ""));
  const [volume, setVolume] = useState(String(previous?.volume ?? ""));
  const [equipment, setEquipment] = useState(previous?.equipment.join(", ") || "");
  const [assetId, setAssetId] = useState(oldListing?.assetId || "");
  const [assetType, setAssetType] = useState(oldAsset?.type || "");
  const [from, setFrom] = useState(previous ? toLocalInput(oldAsset?.availableAt || oldListing!.availableFrom) : "");
  const [until, setUntil] = useState(oldListing ? toLocalInput(oldListing.availableUntil) : "");
  const [visibility, setVisibility] = useState<"OPEN_NETWORK" | "PRIVATE">(oldListing?.visibility || "OPEN_NETWORK");
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(previous?.technical || {}).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : ["cutoffAt", "currentDeliveryExpectedAt", "expectedAvailabilityAt"].includes(key) ? toLocalInput(String(value)) : String(value)])));
  const [error, setError] = useState("");
  const allowed = context.permissions.includes(assetForm ? "MANAGE_ASSETS" : kind === "CARGO" ? "CREATE_CARGO" : "MANAGE_CAPACITY");
  if (!allowed || (!isNew && !previous) || activeMode === "IMPORT") return <p role="alert">Dit record is niet beschikbaar of bewerkbaar binnen jouw bevoegdheden.</p>;
  const fields = technicalFields[activeMode] || [];
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    try {
      const parsed: Record<string, unknown> = { ...previous?.technical };
      for (const [key, , inputType] of fields) {
        const value = values[key]?.trim();
        if (!value) { delete parsed[key]; continue; }
        parsed[key] = inputType === "number" ? Number(value) : inputType === "datetime-local" ? new Date(`${value}Z`).toISOString() : inputType === "list" ? split(value) : value;
      }
      const technical = parsed as DemoTechnical;
      if (assetForm) await executeAction({ type: "SAVE_ASSET", ...(isNew ? {} : { assetId: entityId! }), mode: activeMode, assetType, name, location: origin, capacity: Number(amount), ...(volume ? { volume: Number(volume) } : {}), equipment: split(equipment), availableAt: new Date(`${from}Z`).toISOString(), technical });
      else {
        const listing: Partial<DemoListing> = { mode: activeMode, kind, name, origin, destination, quantity: Number(amount), ...(volume ? { volume: Number(volume) } : {}), equipment: split(equipment), availableFrom: new Date(`${from}Z`).toISOString(), availableUntil: new Date(`${until}Z`).toISOString(), visibility, technical, ...(kind === "CAPACITY" ? { assetId } : {}) };
        await executeAction({ type: "SAVE_LISTING", ...(isNew ? {} : { listingId: entityId! }), listing });
      }
      onCancel();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Opslaan mislukt."); }
  };
  const place = (id: string, label: string, value: string, update: (value: string) => void) => <div><Label htmlFor={id}>{label}</Label><Select id={id} required value={value} onChange={e => update(e.target.value)}><option value="">Kies een locatie</option>{locations.map(p => <option key={p}>{p}</option>)}</Select></div>;
  return <Card><CardHeader><CardTitle>{isNew ? "Nieuw" : "Bewerk"} {assetForm ? "asset" : kind === "CARGO" ? "lading" : "capaciteitsaanbod"}</CardTitle><p className="text-sm text-muted-foreground">{modeLabels[activeMode]} · handmatige, fictieve gegevens. Nieuwe aanbiedingen worden als concept bewaard.</p></CardHeader><CardContent>
    <form onSubmit={save} className="space-y-5">
      <p className="text-sm text-muted-foreground">Alle datum-/tijdvelden in dit formulier gebruiken UTC.</p>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div><Label htmlFor="record-name">Naam</Label><Input id="record-name" required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></div>
      {assetForm && <div><Label htmlFor="asset-type">Assettype</Label><Input id="asset-type" required value={assetType} onChange={e => setAssetType(e.target.value)} placeholder={activeMode === "ROAD" ? "TRUCK / TRAILER" : activeMode === "AIR" ? "FREIGHTER" : activeMode === "RAIL" ? "WAGON_GROUP" : "KAMSARMAX / DRY_CARGO"} /></div>}
      {!assetForm && kind === "CAPACITY" && <div><Label htmlFor="listing-asset">Eigen asset</Label><Select id="listing-asset" required value={assetId} onChange={e => setAssetId(e.target.value)}><option value="">Kies een asset</option>{workspace.assets.filter(a => a.mode === activeMode).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></div>}
      <div className="grid sm:grid-cols-2 gap-4">{place("origin", assetForm ? "Locatie" : "Herkomst", origin, setOrigin)}{!assetForm && place("destination", "Bestemming", destination, setDestination)}</div>
      <div className="grid sm:grid-cols-2 gap-4"><div><Label htmlFor="quantity">Gewicht / capaciteit ({activeMode === "AIR" ? "kg" : "ton"})</Label><Input id="quantity" type="number" min="0.001" step="any" required value={amount} onChange={e => setAmount(e.target.value)} /></div><div><Label htmlFor="volume">Volume (m³){activeMode === "AIR" || oldAsset?.volume !== undefined ? " · verplicht" : " · optioneel"}</Label><Input id="volume" type="number" min="0.001" step="any" required={activeMode === "AIR" || oldAsset?.volume !== undefined} value={volume} onChange={e => setVolume(e.target.value)} /></div></div>
      <div><Label htmlFor="equipment">Uitrusting / behandeling (kommagescheiden)</Label><Input id="equipment" value={equipment} onChange={e => setEquipment(e.target.value)} /></div>
      <div className="grid sm:grid-cols-2 gap-4"><div><Label htmlFor="available-from">{assetForm ? "Verwacht beschikbaar" : "Gereed / beschikbaar vanaf"}</Label><Input id="available-from" type="datetime-local" required value={from} onChange={e => setFrom(e.target.value)} /></div>{!assetForm && <div><Label htmlFor="available-until">Venster tot</Label><Input id="available-until" type="datetime-local" required min={from} value={until} onChange={e => setUntil(e.target.value)} /></div>}</div>
      {!assetForm && <div><Label htmlFor="visibility">Zichtbaarheid</Label><Select id="visibility" value={visibility} onChange={e => setVisibility(e.target.value as "OPEN_NETWORK" | "PRIVATE")}><option value="OPEN_NETWORK">Open netwerk (na publiceren)</option><option value="PRIVATE">Privé</option></Select></div>}
      <fieldset className="border rounded-lg p-4"><legend className="px-2 font-semibold">Technische voorwaarden</legend><p className="text-sm text-muted-foreground mb-4">Vul de relevante eisen of beschikbare limieten in. Ontbrekende vereiste specificaties leveren geen gegarandeerde match op.</p><div className="grid sm:grid-cols-2 gap-4">{fields.map(([key, label, inputType]) => <div key={key}><Label htmlFor={`tech-${key}`}>{label}</Label><Input id={`tech-${key}`} type={inputType === "list" ? "text" : inputType} step={inputType === "number" ? "any" : undefined} value={values[key] || ""} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} /></div>)}</div></fieldset>
      <div className="flex gap-3"><Button disabled={busy} type="submit">{busy ? "Opslaan…" : "Opslaan"}</Button><Button type="button" variant="outline" onClick={onCancel}>Annuleren</Button></div>
    </form>
  </CardContent></Card>;
}