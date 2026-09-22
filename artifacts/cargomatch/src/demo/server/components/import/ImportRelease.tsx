import React, { useState } from "react";
import { ImportWorkspaceProps } from "./ImportWorkspace";
import { Button, Badge, Card, CardHeader, CardTitle, CardContent, Input, Label, Select } from "@/components/ui/primitives";
import { ImportAction } from "../../import-contract";

export function ImportRelease({ control, entityId, run, busy, manager }: ImportWorkspaceProps & { run: (a: ImportAction) => Promise<void> }) {
  const [selectedShipment, setSelectedShipment] = useState<string>(entityId || "");
  const [newGate, setNewGate] = useState("");

  const shipment = control.shipments.find(s => s.id === selectedShipment);
  const shipments = control.shipments;

  const configureGate = async (sId: string, gate: string, required: boolean) => {
    await run({ type: "IMPORT_CONTROL", operation: "CONFIGURE_GATE", shipmentId: sId, gate, required });
  };
  
  const setGate = async (sId: string, gate: string, satisfied: boolean) => {
    await run({ type: "IMPORT_CONTROL", operation: "SET_GATE", shipmentId: sId, gate, satisfied });
  };

  const addGate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShipment || !newGate.trim()) return;
    await configureGate(selectedShipment, newGate.trim(), true);
    setNewGate("");
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Vrijgave (Gates)</h2>
        <div className="flex gap-2">
          <Select value={selectedShipment} onChange={e => setSelectedShipment(e.target.value)}>
            <option value="">Alle zendingen</option>
            {shipments.map(s => <option key={s.id} value={s.id}>{s.reference} - {s.name}</option>)}
          </Select>
        </div>
      </div>

      <div className="space-y-4">
        {(selectedShipment ? [shipment] : shipments).filter(Boolean).map(s => {
          const readiness = s!.readiness;
          return (
            <Card key={s!.id} className={readiness.status === "READY" ? "border-green-200" : ""}>
              <CardHeader className="py-3 flex flex-row justify-between items-center">
                <div>
                  <CardTitle className="text-base">{s!.reference}</CardTitle>
                  <p className="text-xs text-muted-foreground">{s!.name}</p>
                </div>
                <Badge variant={s!.status === "READY_FOR_PICKUP" ? "default" : "secondary"} className={s!.status === "READY_FOR_PICKUP" ? "bg-green-600" : ""}>
                  {s!.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-slate-500">Document-readiness: {readiness.status}. Afhalen kan pas wanneer alle verplichte vrijgavevoorwaarden voldaan zijn.</p>
                {readiness.reasons.length > 0 && (
                  <div className="bg-amber-50 text-amber-900 p-3 rounded text-sm">
                    <strong>Blokkades:</strong>
                    <ul className="list-disc pl-5 mt-1">
                      {readiness.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}

                <div>
                  <h4 className="font-semibold text-sm mb-2">Vrijgavevoorwaarden (Gates)</h4>
                  <div className="space-y-2">
                    {s!.gates.map(g => (
                      <div key={g.key} className="flex justify-between items-center bg-slate-50 p-2 rounded text-sm">
                        <div className="flex items-center gap-2">
                          {manager ? (
                            <input type="checkbox" className="w-4 h-4 rounded border-slate-300" checked={g.required} onChange={(e) => configureGate(s!.id, g.key, e.target.checked)} disabled={busy} />
                          ) : (
                            <span className="text-xs text-slate-500">[{g.required ? "Req" : "Opt"}]</span>
                          )}
                          <span className={!g.required ? "text-slate-400 line-through" : "font-medium"}>{g.key}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <Badge variant={g.satisfied ? "default" : "outline"} className={g.satisfied ? "bg-green-600" : ""}>
                            {g.satisfied ? "Voldaan" : "Open"}
                          </Badge>
                          {manager && (
                            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setGate(s!.id, g.key, !g.satisfied)} disabled={busy}>
                              Toggle
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {manager && s!.id === selectedShipment && (
                    <form onSubmit={addGate} className="flex gap-2 mt-4 max-w-sm">
                      <Input placeholder="Nieuwe gate (bijv. PINCODE)" value={newGate} onChange={e => setNewGate(e.target.value)} />
                      <Button type="submit" size="sm" disabled={busy || !newGate.trim()}>Toevoegen</Button>
                    </form>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}