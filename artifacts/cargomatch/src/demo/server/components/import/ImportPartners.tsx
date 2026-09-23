import React, { useState } from "react";
import { ImportWorkspaceProps } from "./ImportWorkspace";
import { Button, Badge, Card, CardHeader, CardTitle, CardContent, Select } from "@/components/ui/primitives";
import { ImportAction, ImportModule } from "../../import-contract";
import { partnerAction } from "./import-action-builders";

export function ImportPartners({ control, entityId, run, busy, manager, personas, permissions }: ImportWorkspaceProps & { run: (a: ImportAction) => Promise<void> }) {
  const [selectedShipment, setSelectedShipment] = useState<string>(entityId || "");
  const [assignUserId, setAssignUserId] = useState("");
  const [assignedModules, setAssignedModules] = useState<ImportModule[]>([]);
  
  const shipment = control.shipments.find(s => s.id === selectedShipment);
  const shipments = control.shipments;

  const assignPartner = async (sId: string) => {
    if (!assignUserId || !assignedModules.length) return;
    await run(partnerAction(sId, assignUserId, assignedModules));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Partners & Betrokkenen</h2>
        <div className="flex gap-2">
          <Select value={selectedShipment} onChange={e => setSelectedShipment(e.target.value)}>
            <option value="">Alle zendingen</option>
            {shipments.map(s => <option key={s.id} value={s.id}>{s.reference} - {s.name}</option>)}
          </Select>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {(selectedShipment ? [shipment] : shipments).filter(Boolean).map(s => (
          <Card key={s!.id}>
            <CardHeader className="py-3">
              <CardTitle className="text-base">{s!.reference} <span className="text-sm font-normal text-muted-foreground ml-2">({s!.kind})</span></CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {control.demo && manager && personas.some(p => p.id === "natalie") && <div className="space-y-2 border rounded p-3">
                  <h4 className="font-semibold">Classificatiereview · CargoClear</h4>
                  <p className="text-sm">{s!.customsReview ? `${s!.customsReview.assigneeId}: ${s!.customsReview.status}` : "Nog niet toegewezen. Alleen dit dossier wordt gedeeld."}</p>
                  {s!.customsReview?.recommendation && <p className="text-sm">{s!.customsReview.recommendation}</p>}
                  <Button disabled={busy} onClick={() => void run({type: "IMPORT_CONTROL", operation: "ASSIGN_CUSTOMS_REVIEW", shipmentId: s!.id, userId: "natalie"})}>Wijs douanereview toe aan Natalie</Button>
                </div>}
              {manager ? (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Partner Toewijzen</h4>
                  <div className="flex gap-2">
                    <Select aria-label="Partner of collega" value={assignUserId} onChange={e => {setAssignUserId(e.target.value); setAssignedModules([]);}}>
                      <option value="">Kies partner/collega...</option>
                      {personas.map(p => <option key={p.id} value={p.id}>{p.name} ({p.companyId})</option>)}
                    </Select>
                    <Button size="sm" onClick={() => assignPartner(s!.id)} disabled={busy || !assignUserId || !assignedModules.length}>Toewijzen</Button>
                  </div>
                  <fieldset className="flex flex-wrap gap-3">
                    <legend className="text-sm font-medium mb-2">Toegang tot modules voor deze zending</legend>
                    {s!.allowedModules.filter(module => personas.find(p => p.id === assignUserId)?.permissions?.includes(`IMPORT_${module}`)).map(module => (
                      <label key={module} className="flex gap-2 items-center text-sm">
                        <input type="checkbox" checked={assignedModules.includes(module)} onChange={e => setAssignedModules(previous => e.target.checked ? [...previous, module] : previous.filter(value => value !== module))} />
                        {module}
                      </label>
                    ))}
                  </fieldset>
                  <p className="text-xs text-slate-500 mt-2">
                    Alleen de gekozen modules van deze zending worden gedeeld. Deze selectie vervangt een eerdere toewijzing. De server controleert ook de bedrijfsrechten van de ontvanger.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Alleen managers kunnen partners toewijzen.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}