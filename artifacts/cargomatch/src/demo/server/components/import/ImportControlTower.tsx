import React from "react";
import { ImportWorkspaceProps } from "./ImportWorkspace";
import { Button, Badge, Card, CardHeader, CardTitle, CardContent, Select } from "@/components/ui/primitives";
import { ImportAction, ImportEvent } from "../../import-contract";
import { localDate } from "../demo-display";
import { ImportVesselMap } from "./ImportVesselMap";

export function ImportControlTower({ control, run, busy, manager }: ImportWorkspaceProps & { run: (a: ImportAction) => Promise<void> }) {
  const shipments = control.shipments;
  const vessels = control.vessels;

  const events: (ImportEvent & { sName: string })[] = shipments.flatMap(s => 
    s.timeline.map(e => ({ ...e, sName: s.reference }))
  ).sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime());

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Control Tower</h2>
      </div>

      <ImportVesselMap vessels={vessels} />

      <div className="grid md:grid-cols-2 gap-6">
         <Card>
           <CardHeader>
             <CardTitle className="text-lg">Kritieke Overdrachten</CardTitle>
           </CardHeader>
           <CardContent className="space-y-3">
              {shipments.map(s => {
                 const issues = s.readiness.reasons;
                 const openExceptions = s.exceptions.filter(e => e.status === "OPEN").length;
                 if (issues.length === 0 && openExceptions === 0 && s.readiness.status === "READY") return null;
                 
                 return (
                   <div key={s.id} className="border-b pb-3 last:border-0 p-2 rounded bg-slate-50">
                     <div className="flex justify-between items-start mb-1">
                       <span className="font-semibold">{s.reference}</span>
                       <Badge variant={s.readiness.status === "READY" ? "default" : "secondary"}>{s.readiness.status}</Badge>
                     </div>
                     {issues.length > 0 && (
                       <ul className="text-xs text-red-600 list-disc pl-4 mt-2 space-y-1">
                         {issues.map((r, i) => <li key={i}>{r}</li>)}
                       </ul>
                     )}
                     {openExceptions > 0 && <p className="text-xs text-amber-600 mt-1 font-medium">{openExceptions} open uitzondering(en)</p>}
                   </div>
                 );
              })}
              {shipments.every(s => s.readiness.status === "READY" && s.exceptions.filter(e=>e.status === "OPEN").length === 0) && (
                 <p className="text-sm text-slate-500">Alle gemonitorde zendingen verlopen volgens plan.</p>
              )}
           </CardContent>
         </Card>

         <Card>
           <CardHeader>
             <CardTitle className="text-lg">Tijdlijn (Laatste Gebeurtenissen)</CardTitle>
           </CardHeader>
           <CardContent>
              <div className="space-y-4 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-300 before:to-transparent">
                {events.slice(0, 10).map((e, i) => (
                  <div key={e.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                     <div className="flex items-center justify-center w-5 h-5 rounded-full border border-white bg-blue-500 text-slate-50 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10" />
                     <div className="w-[calc(100%-2.5rem)] md:w-[calc(50%-1.5rem)] p-3 rounded border bg-white shadow-sm">
                       <div className="flex justify-between items-center mb-1">
                          <span className="font-semibold text-sm">{e.sName}</span>
                          <span className="text-[10px] text-slate-400">{localDate(e.eventAt)}</span>
                       </div>
                       <p className="text-xs text-slate-700">{e.action}</p>
                       <p className="text-[10px] text-slate-500 mt-1">Door: {e.actorId} (Bron: {e.source})</p>
                     </div>
                  </div>
                ))}
              </div>
           </CardContent>
         </Card>
      </div>
    </div>
  );
}