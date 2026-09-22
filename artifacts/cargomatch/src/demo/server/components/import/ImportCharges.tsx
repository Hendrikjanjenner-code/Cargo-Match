import React, { useState } from "react";
import { ImportWorkspaceProps } from "./ImportWorkspace";
import { Button, Badge, Card, CardHeader, CardTitle, CardContent, Input, Label, Select } from "@/components/ui/primitives";
import { ImportAction, ImportCharge } from "../../import-contract";

export function ImportCharges({ control, entityId, run, busy, manager, isReceiver, isFinance }: ImportWorkspaceProps & { run: (a: ImportAction) => Promise<void> }) {
  const [selectedShipment, setSelectedShipment] = useState<string>(entityId || "");
  const [editingCharge, setEditingCharge] = useState<Partial<ImportCharge> & { shipmentId: string } | null>(null);

  const shipment = control.shipments.find(s => s.id === selectedShipment);
  const shipments = control.shipments;

  const saveCharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCharge) return;
    
    if (editingCharge.id === "new") {
      await run({
        type: "IMPORT_CONTROL",
        operation: "ADD_CHARGE",
        shipmentId: editingCharge.shipmentId,
        charge: {
          label: editingCharge.label || "",
          amount: Number(editingCharge.amount) || 0,
          currency: editingCharge.currency || "EUR",
          supplier: editingCharge.supplier || "",
          invoiceReference: editingCharge.invoiceReference || "",
          estimated: !!editingCharge.estimated,
          vat: !!editingCharge.vat
        }
      });
    } else {
      await run({
        type: "IMPORT_CONTROL",
        operation: "EDIT_CHARGE",
        shipmentId: editingCharge.shipmentId,
        chargeId: editingCharge.id,
        charge: {
          label: editingCharge.label || "",
          amount: Number(editingCharge.amount) || 0,
          currency: editingCharge.currency || "EUR",
          supplier: editingCharge.supplier || "",
          invoiceReference: editingCharge.invoiceReference || "",
          estimated: !!editingCharge.estimated,
          vat: !!editingCharge.vat
        }
      });
    }
    setEditingCharge(null);
  };
  
  const pay = async (sId: string, cId: string) => {
    await run({ type: "IMPORT_CONTROL", operation: "PAY_CHARGE", shipmentId: sId, chargeId: cId });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Kosten (Landed Cost)</h2>
        <div className="flex gap-2">
          <Select value={selectedShipment} onChange={e => setSelectedShipment(e.target.value)}>
            <option value="">Alle zendingen</option>
            {shipments.map(s => <option key={s.id} value={s.id}>{s.reference} - {s.name}</option>)}
          </Select>
        </div>
      </div>

      {editingCharge && (
        <Card className="bg-slate-50 border-blue-200">
          <CardHeader className="py-3"><CardTitle className="text-base">{editingCharge.id === "new" ? "Nieuwe Kostenregel" : "Kostenregel Bewerken"}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={saveCharge} className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="space-y-1"><Label>Label</Label><Input value={editingCharge.label || ""} onChange={e => setEditingCharge({...editingCharge, label: e.target.value})} required /></div>
              <div className="space-y-1"><Label>Leverancier</Label><Input value={editingCharge.supplier || ""} onChange={e => setEditingCharge({...editingCharge, supplier: e.target.value})} required /></div>
              <div className="space-y-1"><Label>Factuur Ref.</Label><Input value={editingCharge.invoiceReference || ""} onChange={e => setEditingCharge({...editingCharge, invoiceReference: e.target.value})} /></div>
              <div className="space-y-1"><Label>Bedrag</Label><Input type="number" step="0.01" value={editingCharge.amount || ""} onChange={e => setEditingCharge({...editingCharge, amount: Number(e.target.value)})} required /></div>
              <div className="space-y-1"><Label>Valuta</Label><Input value={editingCharge.currency || "EUR"} onChange={e => setEditingCharge({...editingCharge, currency: e.target.value})} required /></div>
              
              <div className="flex items-center space-x-2 pt-6">
                <input type="checkbox" id="estimated" className="w-4 h-4 rounded border-slate-300" checked={!!editingCharge.estimated} onChange={e => setEditingCharge({...editingCharge, estimated: e.target.checked})} />
                <Label htmlFor="estimated">Geschat</Label>
              </div>
              <div className="flex items-center space-x-2 pt-6">
                <input type="checkbox" id="vat" className="w-4 h-4 rounded border-slate-300" checked={!!editingCharge.vat} onChange={e => setEditingCharge({...editingCharge, vat: e.target.checked})} />
                <Label htmlFor="vat">BTW van toepassing</Label>
              </div>
              <div className="flex items-end gap-2">
                <Button type="submit" disabled={busy}>Opslaan</Button>
                <Button type="button" variant="ghost" onClick={() => setEditingCharge(null)}>Annuleren</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {(selectedShipment ? [shipment] : shipments).filter(Boolean).map(s => (
          <Card key={s!.id}>
            <CardHeader className="py-3 flex flex-row justify-between items-center">
              <div>
                <CardTitle className="text-base">{s!.reference}</CardTitle>
                <p className="text-xs text-muted-foreground">{s!.name}</p>
              </div>
              {manager && (
                <Button size="sm" onClick={() => setEditingCharge({ id: "new", shipmentId: s!.id, currency: "EUR" })}>
                  Kostenregel Toevoegen
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {s!.charges.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="px-3 py-2">Label</th>
                        <th className="px-3 py-2">Leverancier</th>
                        <th className="px-3 py-2">Bedrag</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2 text-right">Acties</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {s!.charges.map(c => (
                        <tr key={c.id}>
                          <td className="px-3 py-2">
                            <div className="font-medium">{c.label}</div>
                            <div className="text-xs text-slate-500">{c.estimated ? "Geschat" : "Werkelijk"}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div>{c.supplier}</div>
                            <div className="text-xs text-slate-500">{c.invoiceReference}</div>
                          </td>
                          <td className="px-3 py-2 font-mono">
                            {c.amount.toFixed(2)} {c.currency}
                            {c.vat && <span className="text-[10px] ml-1 bg-slate-100 px-1 rounded text-slate-500">+BTW</span>}
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant={c.paid ? "outline" : "secondary"} className={c.paid ? "text-green-600 border-green-600" : ""}>
                              {c.paid ? "Betaald" : "Open"}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-right space-x-2">
                            {manager && !c.paid && (
                              <Button size="sm" variant="ghost" onClick={() => setEditingCharge({ ...c, shipmentId: s!.id })}>Edit</Button>
                            )}
                            {(manager || isReceiver || isFinance) && !c.paid && (
                              <Button size="sm" onClick={() => pay(s!.id, c.id)} disabled={busy}>{control.demo ? "Betaal (Sim)" : "Registreer betaling"}</Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 font-semibold border-t">
                      {Object.entries(s!.totals).map(([curr, t]) => (
                        <tr key={curr}>
                          <td colSpan={2} className="px-3 py-2 text-right">Totaal {curr}:</td>
                          <td className="px-3 py-2 font-mono">{t.cost.toFixed(2)}</td>
                          <td colSpan={2} className="px-3 py-2 text-xs text-slate-500">Excl. BTW: {t.vat.toFixed(2)} / Payable: {t.payable.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="text-slate-500 text-sm">Geen kosten geregistreerd.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}