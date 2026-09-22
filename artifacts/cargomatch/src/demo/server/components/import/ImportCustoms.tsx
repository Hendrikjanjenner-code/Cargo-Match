import React, { useState } from "react";
import { ImportWorkspaceProps } from "./ImportWorkspace";
import { Button, Badge, Card, CardHeader, CardTitle, CardContent, Input, Label, Select } from "@/components/ui/primitives";
import { ImportAction, ImportShipmentView } from "../../import-contract";
import { localDate } from "../demo-display";

export function ImportCustoms({ control, entityId, run, busy, manager, permissions, isCustoms }: ImportWorkspaceProps & { run: (a: ImportAction) => Promise<void> }) {
  const [selectedShipment, setSelectedShipment] = useState<string>(entityId || "");
  const [editingGoods, setEditingGoods] = useState<Record<string, string | number> | null>(null);

  const shipment = control.shipments.find(s => s.id === selectedShipment);
  const shipments = control.shipments.filter(s => s.customs);

  const canApprove = permissions.includes("IMPORT_CUSTOMS_APPROVE");

  const saveGoods = async (k: string, v: string) => {
    if (!selectedShipment) return;
    await run({ type: "IMPORT_CONTROL", operation: "CUSTOMS_EDIT", shipmentId: selectedShipment, field: k, value: v });
  };
  
  const approve = async (sId: string) => {
    await run({ type: "IMPORT_CONTROL", operation: "CUSTOMS_APPROVE", shipmentId: sId });
  };
  
  const submit = async (sId: string) => {
    await run({ type: "IMPORT_CONTROL", operation: "CUSTOMS_SUBMIT", shipmentId: sId });
  };
  
  const simEvent = async (sId: string, status: string) => {
    await run({ type: "IMPORT_CONTROL", operation: "CUSTOMS_EVENT", shipmentId: sId, status });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Douane</h2>
        <div className="flex gap-2">
          <Select value={selectedShipment} onChange={e => setSelectedShipment(e.target.value)}>
            <option value="">Alle douanezaken</option>
            {shipments.map(s => <option key={s.id} value={s.id}>{s.reference} - {s.name}</option>)}
          </Select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(selectedShipment ? [shipment] : shipments).filter(Boolean).map(s => {
          const c = s!.customs!;
          return (
            <Card key={s!.id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-base">{s!.reference}</CardTitle>
                    <p className="text-sm text-muted-foreground">{s!.name}</p>
                  </div>
                  <Badge variant={c.status === "RELEASED" ? "default" : c.status === "REJECTED" ? "destructive" : "secondary"}>
                    {c.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="bg-slate-50 p-3 rounded text-xs space-y-1">
                  <p><strong>Versie:</strong> {c.version}</p>
                  <p><strong>Goedgekeurde versie:</strong> {c.approvedVersion || "-"}</p>
                  <p><strong>Goedgekeurd door:</strong> {c.approvedBy || "-"}</p>
                  <p className="text-slate-500 italic mt-2">{c.disclaimer}</p>
                </div>
                
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-semibold">Goederen & Classificatie</h4>
                    {isCustoms && c.status === "DRAFT" && !editingGoods && (
                      <Button size="sm" variant="ghost" onClick={() => {
                        setSelectedShipment(s!.id);
                        setEditingGoods({hsCode: "", origin: "", goodsDescription: "", classificationConfirmed: "", valuationConfirmed: "", ...c.goods});
                      }}>Bewerken</Button>
                    )}
                  </div>
                  
                  {editingGoods && s!.id === selectedShipment ? (
                    <div className="space-y-2 border p-3 rounded">
                      {Object.entries(editingGoods).map(([k, v]) => (
                        <div key={k} className="flex gap-2 items-center">
                          <Label className="w-1/3">{k}</Label>
                          <div className="flex w-2/3 gap-2">
                              {k.endsWith("Confirmed") ? <Select aria-label={k} value={v.toString()} onChange={e => setEditingGoods({...editingGoods, [k]: e.target.value})}><option value="">Menselijke review vereist</option><option value="yes">Ja, handmatig gecontroleerd</option><option value="no">Nog niet bevestigd</option></Select> : <Input aria-label={k} value={v.toString()} onChange={e => setEditingGoods({...editingGoods, [k]: e.target.value})} />}
                             <Button size="sm" onClick={() => saveGoods(k, v.toString())} disabled={busy || v === c.goods[k]}>Save</Button>
                          </div>
                        </div>
                      ))}
                      <div className="flex gap-2 mt-2">
                        <Button size="sm" variant="outline" onClick={() => setEditingGoods(null)}>Klaar met bewerken</Button>
                      </div>
                    </div>
                  ) : (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-2">
                      {Object.entries(c.goods).map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-slate-500 text-xs">{k}</dt>
                          <dd className="font-medium">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t">
                  {canApprove && c.status === "DRAFT" && c.version !== c.approvedVersion && (
                    <Button size="sm" onClick={() => approve(s!.id)} disabled={busy}>Review & Goedkeuren (v{c.version})</Button>
                  )}
                  {control.demo && isCustoms && c.status === "APPROVED" && c.version === c.approvedVersion && (
                    <Button size="sm" onClick={() => submit(s!.id)} disabled={busy}>Indienen bij Mock Provider</Button>
                  )}
                  {control.demo && isCustoms && ["SUBMITTED", "RELEASED", "HELD"].includes(c.status) && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => simEvent(s!.id, "HELD")} disabled={busy}>Simuleer blokkade</Button>
                      <Button size="sm" onClick={() => simEvent(s!.id, "RELEASED")} disabled={busy}>Simuleer Vrijgave</Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {shipments.length === 0 && <p className="text-slate-500 col-span-full">Geen douanezaken beschikbaar.</p>}
      </div>
    </div>
  );
}