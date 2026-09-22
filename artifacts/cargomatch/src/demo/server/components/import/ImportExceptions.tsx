import React, { useState } from "react";
import { ImportWorkspaceProps } from "./ImportWorkspace";
import { Button, Badge, Card, CardHeader, CardTitle, CardContent, Select, Input, Textarea } from "@/components/ui/primitives";
import { ImportAction, ImportException } from "../../import-contract";
import { localDate } from "../demo-display";
import { exceptionAction } from "./import-action-builders";

export function ImportExceptions({ control, entityId, run, busy, manager, personas, permissions }: ImportWorkspaceProps & { run: (a: ImportAction) => Promise<void> }) {
  const [selectedShipment, setSelectedShipment] = useState<string>(entityId || "");
  const [actionNote, setActionNote] = useState("");
  const [commentText, setCommentText] = useState("");
  const [activeException, setActiveException] = useState<string | null>(null);

  const shipment = control.shipments.find(s => s.id === selectedShipment);
  const shipments = control.shipments;

  const resolveEx = async (sId: string, exId: string) => {
    await run(exceptionAction(sId, exId, "RESOLVE", actionNote));
  };
  
  const snoozeEx = async (sId: string, exId: string) => {
    // Snooze for 24h
    const until = new Date(Date.now() + 86400000).toISOString();
    await run(exceptionAction(sId, exId, "SNOOZE", actionNote, {until}));
  };
  
  const escalateEx = async (sId: string, exId: string) => {
    await run(exceptionAction(sId, exId, "ESCALATE", actionNote));
  };
  
  const assignEx = async (sId: string, exId: string, userId: string) => {
    await run(exceptionAction(sId, exId, "ASSIGN", actionNote, {userId}));
  };
  
  const commentEx = async (sId: string, exId: string) => {
    if (!commentText.trim()) return;
    await run(exceptionAction(sId, exId, "COMMENT", commentText));
    setCommentText("");
    setActiveException(null);
  };

  const getExceptions = () => {
    if (selectedShipment) return shipment ? shipment.exceptions.map(e => ({...e, shipmentId: shipment.id, sName: shipment.reference})) : [];
    return shipments.flatMap(s => s.exceptions.map(e => ({...e, shipmentId: s.id, sName: s.reference})));
  };

  const exceptions = getExceptions().sort((a, b) => {
    if (a.status !== b.status) return a.status === "OPEN" ? -1 : 1;
    if (a.priority !== b.priority) return a.priority === "HIGH" ? -1 : 1;
    return 0;
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Uitzonderingen (Exceptions)</h2>
        <div className="flex gap-2">
          <Select value={selectedShipment} onChange={e => setSelectedShipment(e.target.value)}>
            <option value="">Alle zendingen</option>
            {shipments.map(s => <option key={s.id} value={s.id}>{s.reference} - {s.name}</option>)}
          </Select>
        </div>
      </div>

      <div className="space-y-2 rounded border p-3">
        <p className="text-sm text-slate-600">Uitzonderingen ontstaan uit de controles op de zending. Licht toewijzen, uitstellen, escaleren of oplossen hieronder toe.</p>
        <label htmlFor="exception-action-note" className="text-sm font-medium">Toelichting uitzonderingsactie</label>
        <Textarea id="exception-action-note" value={actionNote} onChange={e => setActionNote(e.target.value)} placeholder="Wat is gecontroleerd en waarom is deze actie nodig?" />
      </div>

      <div className="space-y-4">
        {exceptions.map(ex => (
          <Card key={ex.id} className={
            ex.status === "OPEN" ? (ex.priority === "HIGH" ? "border-red-300" : "border-amber-200") : "opacity-75"
          }>
            <CardHeader className="py-3 bg-slate-50">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={ex.status === "OPEN" ? (ex.priority === "HIGH" ? "destructive" : "default") : "secondary"}>
                      {ex.status}
                    </Badge>
                    <Badge variant="outline">{ex.module}</Badge>
                    {!selectedShipment && <span className="text-xs font-medium text-slate-600">[{ex.sName}]</span>}
                  </div>
                  <CardTitle className="text-base">{ex.title}</CardTitle>
                </div>
                <div className="text-right text-sm">
                  {ex.assigneeId ? (
                    <span className="text-slate-600">
                      Behandelaar: <strong>{personas.find(p => p.id === ex.assigneeId)?.name || ex.assigneeId}</strong>
                    </span>
                  ) : (
                    <span className="text-amber-600 italic">Niet toegewezen</span>
                  )}
                  {ex.until && <div className="text-xs text-slate-500 mt-1">Snoozed tot: {localDate(ex.until)}</div>}
                </div>
              </div>
            </CardHeader>
            <CardContent className="py-4 space-y-4 text-sm">
              <p className="text-slate-700 whitespace-pre-wrap">{ex.reason}</p>
              
              {ex.comments.length > 0 && (
                <div className="bg-slate-50 p-3 rounded space-y-2 border">
                  {ex.comments.map((c, i) => (
                    <div key={i} className="text-xs border-b pb-1 last:border-0 last:pb-0 text-slate-600">
                      {c}
                    </div>
                  ))}
                </div>
              )}
              
              {permissions.includes("IMPORT_EXCEPTIONS") && ex.status !== "RESOLVED" && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  <Select disabled={busy || !actionNote.trim()} className="w-40 h-8 text-xs" value={ex.assigneeId || ""} onChange={e => { if(e.target.value) void assignEx(ex.shipmentId, ex.id, e.target.value); }}>
                    <option value="">Toewijzen aan...</option>
                    {personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                  
                  {activeException === ex.id ? (
                    <div className="flex flex-1 items-center gap-2">
                      <Input className="h-8 text-xs flex-1" placeholder="Opmerking..." value={commentText} onChange={e => setCommentText(e.target.value)} />
                      <Button size="sm" className="h-8" onClick={() => commentEx(ex.shipmentId, ex.id)} disabled={busy || !commentText.trim()}>OK</Button>
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => setActiveException(null)}>X</Button>
                    </div>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setActiveException(ex.id)}>Opmerking</Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs text-amber-600 border-amber-200" onClick={() => escalateEx(ex.shipmentId, ex.id)} disabled={busy || !actionNote.trim() || ex.priority === "HIGH"}>Escaleren</Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => snoozeEx(ex.shipmentId, ex.id)} disabled={busy || !actionNote.trim()}>Snooze (24u)</Button>
                      <Button size="sm" className="h-8 text-xs bg-green-600 hover:bg-green-700" onClick={() => resolveEx(ex.shipmentId, ex.id)} disabled={busy || !actionNote.trim()}>Oplossen</Button>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {exceptions.length === 0 && <p className="text-slate-500">Geen uitzonderingen in huidig overzicht.</p>}
      </div>
    </div>
  );
}