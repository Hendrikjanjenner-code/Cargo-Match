import React, { useMemo, useState } from "react";
import { ImportWorkspaceProps } from "./ImportWorkspace";
import { Button, Badge, Card, CardHeader, CardTitle, CardContent, Input, Label, Select } from "@/components/ui/primitives";
import { localDate } from "../demo-display";
import { ImportAction, ImportModule, ImportShipmentView } from "../../import-contract";
import { ImportVesselMap } from "./ImportVesselMap";

type ShipmentDraft = Partial<ImportShipmentView> & { id: string };
type FieldName = "weightKg" | "packages" | "volumeM3" | "value" | "currency" | "container" | "shipper" | "consignee" | "reference" | "eori" | "commodityCode" | "originCountry" | "customsValue" | "importInstructions";

const numericFields = new Set<FieldName>(["weightKg", "packages", "volumeM3", "value", "customsValue"]);
const confirmFields: {name: FieldName; label: string; numeric?: boolean}[] = [
  {name: "weightKg", label: "Gewicht (kg)", numeric: true},
  {name: "packages", label: "Colli", numeric: true},
  {name: "volumeM3", label: "Volume (m³)", numeric: true},
  {name: "value", label: "Goederenwaarde", numeric: true},
  {name: "currency", label: "Valuta (ISO)"},
  {name: "container", label: "Container"},
  {name: "shipper", label: "Verzender / leverancier"},
  {name: "consignee", label: "Ontvanger"},
  {name: "reference", label: "Veldreferentie"},
  {name: "eori", label: "EORI"},
  {name: "commodityCode", label: "Goederencode"},
  {name: "originCountry", label: "Land van oorsprong"},
  {name: "customsValue", label: "Douanewaarde", numeric: true},
  {name: "importInstructions", label: "Importinstructies"},
];

const moduleLinks: {module: ImportModule; view: string; label: string}[] = [
  {module: "DOCUMENTS", view: "import_documents", label: "Documenten"},
  {module: "CUSTOMS", view: "import_customs", label: "Douane"},
  {module: "CHARGES", view: "import_charges", label: "Kosten"},
  {module: "RELEASE", view: "import_release", label: "Vrijgave"},
  {module: "DELIVERY", view: "import_delivery", label: "Aflevering"},
  {module: "EXCEPTIONS", view: "import_exceptions", label: "Uitzonderingen"},
];

const optionalText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

function shipmentPayload(draft: ShipmentDraft): NonNullable<ImportAction["shipment"]> {
  const parsedEta = Date.parse(draft.eta || "");
  return {
    reference: (draft.reference || "").trim(),
    name: (draft.name || "").trim(),
    kind: (draft.kind || "").trim(),
    origin: (draft.origin || "").trim(),
    destination: (draft.destination || "").trim(),
    port: (draft.port || "").trim(),
    eta: Number.isFinite(parsedEta) ? new Date(parsedEta).toISOString() : draft.eta || "",
    ...(optionalText(draft.incoterm) ? {incoterm: optionalText(draft.incoterm)} : {}),
    ...(optionalText(draft.container) ? {container: optionalText(draft.container)} : {}),
    ...(optionalText(draft.masterReference) ? {masterReference: optionalText(draft.masterReference)} : {}),
    ...(optionalText(draft.houseReference) ? {houseReference: optionalText(draft.houseReference)} : {}),
  };
}

const inputDateTime = (value?: string) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const shown = (value: unknown) => value === undefined || value === null || value === "" ? "—" : String(value);

export function ImportShipments({ control, entityId, onNavigate, run, busy, isReceiver }: ImportWorkspaceProps & { run: (a: ImportAction) => Promise<void> }) {
  const [editing, setEditing] = useState<ShipmentDraft | null>(null);
  const [fieldName, setFieldName] = useState<FieldName>("weightKg");
  const [fieldValue, setFieldValue] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [originFilter, setOriginFilter] = useState("");
  const [destinationFilter, setDestinationFilter] = useState("");
  const [partyFilter, setPartyFilter] = useState("");
  const [etaFilter, setEtaFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [exceptionFilter, setExceptionFilter] = useState("");

  const canEdit = !isReceiver;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || !canEdit) return;
    const shipment = shipmentPayload(editing);
    if (editing.id === "new") {
      await run({type: "IMPORT_CONTROL", operation: "CREATE_SHIPMENT", shipment});
    } else {
      await run({type: "IMPORT_CONTROL", operation: "EDIT_SHIPMENT", shipmentId: editing.id, shipment});
    }
    setEditing(null);
  };

  const confirmField = async (event: React.FormEvent, shipmentId: string) => {
    event.preventDefault();
    if (!canEdit || !fieldValue.trim()) return;
    const numeric = numericFields.has(fieldName);
    const value = numeric ? Number(fieldValue) : fieldName === "currency" ? fieldValue.trim().toUpperCase() : fieldValue.trim();
    if (numeric && (!Number.isFinite(value) || Number(value) < 0)) return;
    await run({type: "IMPORT_CONTROL", operation: "CONFIRM_FIELD", shipmentId, field: fieldName, value});
    setFieldValue("");
  };

  const filtered = useMemo(() => control.shipments.filter(shipment => {
    const partyValues = ["shipper", "consignee", "supplier"]
      .map(key => shipment.fields[key])
      .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
      .join(" ");
    const hasExceptionAccess = shipment.allowedModules.includes("EXCEPTIONS");
    const exceptionValue = hasExceptionAccess ? (shipment.exceptions.some(item => item.status !== "RESOLVED") ? "yes" : "no") : "unknown";
    return (!statusFilter || shipment.status === statusFilter)
      && (!originFilter || shipment.origin.toLowerCase().includes(originFilter.toLowerCase()))
      && (!destinationFilter || shipment.destination.toLowerCase().includes(destinationFilter.toLowerCase()))
      && (!partyFilter || partyValues.toLowerCase().includes(partyFilter.toLowerCase()))
      && (!etaFilter || shipment.eta.slice(0, 10) === etaFilter)
      && (!kindFilter || shipment.kind.toLowerCase().includes(kindFilter.toLowerCase()))
      && (!exceptionFilter || exceptionValue === exceptionFilter);
  }), [control.shipments, statusFilter, originFilter, destinationFilter, partyFilter, etaFilter, kindFilter, exceptionFilter]);

  if (editing) {
    const set = (key: keyof ShipmentDraft, value: string) => setEditing({...editing, [key]: value});
    return (
      <Card>
        <CardHeader><CardTitle>{editing.id === "new" ? "Nieuwe zending" : "Zending bewerken"}</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1"><Label>Referentie</Label><Input value={editing.reference || ""} onChange={e => set("reference", e.target.value)} required /></div>
              <div className="space-y-1"><Label>Naam</Label><Input value={editing.name || ""} onChange={e => set("name", e.target.value)} required /></div>
              <div className="space-y-1"><Label>Modaliteit / soort</Label><Input value={editing.kind || ""} onChange={e => set("kind", e.target.value)} placeholder="FCL, LCL, air, road, rail, multimodal…" required /></div>
              <div className="space-y-1"><Label>Incoterm (optioneel)</Label><Input value={editing.incoterm || ""} onChange={e => set("incoterm", e.target.value)} /></div>
              <div className="space-y-1"><Label>Oorsprong</Label><Input value={editing.origin || ""} onChange={e => set("origin", e.target.value)} required /></div>
              <div className="space-y-1"><Label>Bestemming</Label><Input value={editing.destination || ""} onChange={e => set("destination", e.target.value)} required /></div>
              <div className="space-y-1"><Label>Haven / hub</Label><Input value={editing.port || ""} onChange={e => set("port", e.target.value)} required /></div>
              <div className="space-y-1"><Label>ETA</Label><Input type="datetime-local" value={inputDateTime(editing.eta)} onChange={e => set("eta", e.target.value)} required /></div>
              <div className="space-y-1"><Label>Container (optioneel)</Label><Input value={editing.container || ""} onChange={e => set("container", e.target.value)} /></div>
              <div className="space-y-1"><Label>Masterreferentie (optioneel)</Label><Input value={editing.masterReference || ""} onChange={e => set("masterReference", e.target.value)} /></div>
              <div className="space-y-1"><Label>Housereferentie (optioneel)</Label><Input value={editing.houseReference || ""} onChange={e => set("houseReference", e.target.value)} /></div>
            </div>
            {editing.id !== "new" && <p className="text-xs text-slate-500">Een bewerking vereist menselijke onderbouwing in het gedeelde evidenceveld.</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>Opslaan</Button>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Annuleren</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    );
  }

  if (entityId) {
    const shipment = control.shipments.find(item => item.id === entityId);
    if (!shipment) return <p>Zending niet gevonden of niet toegankelijk.</p>;
    const associatedVessel = shipment.vesselId ? control.vessels.find(vessel => vessel.id === shipment.vesselId) : undefined;
    const requiredGates = shipment.gates.filter(gate => gate.required);
    const completedGates = requiredGates.filter(gate => gate.satisfied).length;
    const progress = requiredGates.length ? Math.round(completedGates / requiredGates.length * 100) : shipment.readiness.status === "READY" ? 100 : 0;
    const timeline = [...shipment.timeline].sort((a, b) => Date.parse(a.eventAt) - Date.parse(b.eventAt));
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row justify-between items-start">
            <div>
              <CardTitle>{shipment.name} · {shipment.reference}</CardTitle>
              <p className="text-sm text-muted-foreground">{shipment.origin} → {shipment.destination}</p>
            </div>
            <div className="flex gap-2">
              {canEdit && <Button size="sm" variant="outline" onClick={() => setEditing({...shipment})}>Bewerken</Button>}
              {control.demo && canEdit && shipment.status === "IN_TRANSIT" && <Button size="sm" disabled={busy} onClick={() => void run({type: "IMPORT_CONTROL", operation: "ARRIVING", shipmentId: shipment.id})}>Registreer naderende aankomst</Button>}
              <Button size="sm" variant="ghost" onClick={() => onNavigate("import_shipments", null)}>Sluiten</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <dl className="grid gap-4 rounded bg-slate-50 p-4 text-sm md:grid-cols-4">
              <div><dt className="text-slate-500">Status</dt><dd><Badge>{shipment.status}</Badge></dd></div>
              <div><dt className="text-slate-500">Readiness</dt><dd><Badge variant={shipment.readiness.status === "READY" ? "default" : "secondary"}>{shipment.readiness.status}</Badge></dd></div>
              <div><dt className="text-slate-500">Modaliteit / soort</dt><dd>{shipment.kind}</dd></div>
              <div><dt className="text-slate-500">ETA</dt><dd>{localDate(shipment.eta)}</dd></div>
              <div><dt className="text-slate-500">Haven / hub</dt><dd>{shipment.port}</dd></div>
              <div><dt className="text-slate-500">Incoterm</dt><dd>{shown(shipment.incoterm)}</dd></div>
              <div><dt className="text-slate-500">Container</dt><dd>{shown(shipment.container)}</dd></div>
              <div><dt className="text-slate-500">Master / house</dt><dd>{shown(shipment.masterReference)} / {shown(shipment.houseReference)}</dd></div>
              <div><dt className="text-slate-500">Verantwoordelijke</dt><dd>Onbekend — niet geprojecteerd</dd></div>
              <div><dt className="text-slate-500">Schip</dt><dd>{associatedVessel ? `${associatedVessel.name} (${associatedVessel.identification})` : shipment.vesselId ? "Niet toegankelijk" : "Niet gekoppeld"}</dd></div>
            </dl>

            <section>
              <div className="mb-1 flex justify-between text-sm"><strong>Vrijgavevoortgang</strong><span>{completedGates}/{requiredGates.length} · {progress}%</span></div>
              <div className="h-2 overflow-hidden rounded bg-slate-200"><div className="h-full bg-blue-700" style={{width: `${progress}%`}} /></div>
              {!shipment.allowedModules.includes("RELEASE") && <p className="mt-1 text-xs text-slate-500">Vrijgavedetails zijn niet geprojecteerd.</p>}
            </section>

            <section>
              <h3 className="mb-2 font-semibold">Readiness-redenen</h3>
              {shipment.readiness.reasons.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm">{shipment.readiness.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
              ) : <p className="text-sm text-slate-500">{shipment.readiness.status === "READY" ? "Geen blokkades." : "Redenen zijn niet geprojecteerd."}</p>}
              <p className="mt-1 text-xs text-slate-500">Readiness en gewichtsverschillen in kg worden door de server berekend.</p>
            </section>

            <section>
              <h3 className="mb-2 font-semibold">Geprojecteerde veldwaarden</h3>
              <dl className="grid gap-2 text-sm md:grid-cols-3">
                {Object.entries(shipment.fields).map(([key, value]) => <div key={key} className="rounded border p-2"><dt className="text-xs text-slate-500">{key}</dt><dd className="break-words">{shown(value)}</dd></div>)}
                {!Object.keys(shipment.fields).length && <p className="text-slate-500">Geen veldwaarden beschikbaar.</p>}
              </dl>
            </section>

            <div className="flex flex-wrap gap-2">
              {moduleLinks.filter(link => shipment.allowedModules.includes(link.module)).map(link => (
                <Button key={link.module} type="button" size="sm" variant="outline" onClick={() => onNavigate(link.view, shipment.id)}>{link.label}</Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {associatedVessel && <Card><CardHeader><CardTitle>Gekoppeld schip</CardTitle></CardHeader><CardContent><ImportVesselMap vessels={[associatedVessel]} /></CardContent></Card>}

        {canEdit && shipment.allowedModules.includes("IMPORT") && (
          <Card>
            <CardHeader><CardTitle>Veld handmatig bevestigen</CardTitle></CardHeader>
            <CardContent>
              <form className="grid gap-3 md:grid-cols-[240px_1fr_auto] md:items-end" onSubmit={event => confirmField(event, shipment.id)}>
                <div className="space-y-1"><Label>Veld</Label><Select value={fieldName} onChange={e => { setFieldName(e.target.value as FieldName); setFieldValue(""); }}>{confirmFields.map(field => <option key={field.name} value={field.name}>{field.label}</option>)}</Select></div>
                <div className="space-y-1"><Label>Waarde</Label><Input type={numericFields.has(fieldName) ? "number" : "text"} min={numericFields.has(fieldName) ? "0" : undefined} step={numericFields.has(fieldName) ? "any" : undefined} value={fieldValue} onChange={e => setFieldValue(e.target.value)} required /></div>
                <Button type="submit" disabled={busy}>Bevestigen</Button>
              </form>
              <p className="mt-2 text-xs text-slate-500">Vul vóór bevestigen menselijke onderbouwing in het gedeelde evidenceveld in. De server weigert ontbrekende onderbouwing.</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Tijdlijn</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {timeline.map(event => (
                <article key={event.id} className="rounded border p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2"><strong>{event.action}</strong><span>{localDate(event.eventAt)}</span></div>
                  <p className="text-xs text-slate-500">Actor: {event.actorId} · bron: {event.source} · event: {event.eventAt} · ontvangen: {event.at}</p>
                  {(event.oldValue !== undefined || event.newValue !== undefined) && (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">Oud: {JSON.stringify(event.oldValue, null, 2)}</pre>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">Nieuw: {JSON.stringify(event.newValue, null, 2)}</pre>
                    </div>
                  )}
                </article>
              ))}
              {!timeline.length && <p className="text-sm text-slate-500">Geen tijdlijngebeurtenissen geprojecteerd.</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statuses = [...new Set(control.shipments.map(shipment => shipment.status))].sort();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Zendingen</h2>
        {canEdit && <Button onClick={() => setEditing({id: "new", kind: "", eta: ""})}>Nieuwe zending</Button>}
      </div>
      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-4">
          <div className="space-y-1"><Label>Status</Label><Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">Alle statussen</option>{statuses.map(status => <option key={status}>{status}</option>)}</Select></div>
          <div className="space-y-1"><Label>Oorsprong</Label><Input value={originFilter} onChange={e => setOriginFilter(e.target.value)} /></div>
          <div className="space-y-1"><Label>Bestemming</Label><Input value={destinationFilter} onChange={e => setDestinationFilter(e.target.value)} /></div>
          <div className="space-y-1"><Label>Partij (zichtbare data)</Label><Input value={partyFilter} onChange={e => setPartyFilter(e.target.value)} /></div>
          <div className="space-y-1"><Label>ETA</Label><Input type="date" value={etaFilter} onChange={e => setEtaFilter(e.target.value)} /></div>
          <div className="space-y-1"><Label>Modaliteit / soort</Label><Input value={kindFilter} onChange={e => setKindFilter(e.target.value)} /></div>
          <div className="space-y-1"><Label>Verantwoordelijke</Label><Input value="Onbekend — niet geprojecteerd" disabled /></div>
          <div className="space-y-1"><Label>Uitzonderingen</Label><Select value={exceptionFilter} onChange={e => setExceptionFilter(e.target.value)}><option value="">Alle</option><option value="yes">Aanwezig</option><option value="no">Geen open</option><option value="unknown">Onbekend / niet geprojecteerd</option></Select></div>
        </CardContent>
      </Card>
      <div className="overflow-hidden rounded border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-slate-50"><tr><th className="px-4 py-3">Referentie</th><th className="px-4 py-3">Soort</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Corridor</th><th className="px-4 py-3">ETA</th><th className="px-4 py-3">Uitzondering</th><th /></tr></thead>
          <tbody className="divide-y">
            {filtered.map(shipment => {
              const exception = shipment.allowedModules.includes("EXCEPTIONS") ? (shipment.exceptions.some(item => item.status !== "RESOLVED") ? "Ja" : "Nee") : "Onbekend";
              return <tr key={shipment.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-medium">{shipment.reference}</td><td className="px-4 py-3">{shipment.kind}</td><td className="px-4 py-3"><Badge variant="outline">{shipment.status}</Badge></td><td className="px-4 py-3">{shipment.origin} → {shipment.destination}</td><td className="px-4 py-3">{localDate(shipment.eta)}</td><td className="px-4 py-3">{exception}</td><td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => onNavigate("import_shipments", shipment.id)}>Details</Button></td></tr>;
            })}
            {!filtered.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Geen zendingen voor deze filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}