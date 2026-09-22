import React from "react";
import { ImportWorkspaceProps } from "./ImportWorkspace";
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from "@/components/ui/primitives";

export function ImportDashboard({ control, onNavigate, run, manager, isReceiver, busy }: ImportWorkspaceProps & { run: any }) {
  const shipments = control.shipments;
  
  const confirmCompany = async (sId: string) => {
    await run({ type: "IMPORT_CONTROL", operation: "CONFIRM_COMPANY", shipmentId: sId });
  };

  const confirmRep = async (sId: string) => {
    await run({ type: "IMPORT_CONTROL", operation: "CONFIRM_REPRESENTATION", shipmentId: sId });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">CargoMatch Import Control</h1>
        <p className="text-slate-600 mt-1">{control.disclaimer}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {control.modules.includes("SHIPMENTS") && (
          <Card className="bg-slate-50 border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => onNavigate("import_shipments", null)}>
            <CardContent className="p-4">
              <div className="text-sm font-semibold text-slate-700">Zendingen</div>
              <div className="text-2xl font-bold mt-1">{shipments.length}</div>
            </CardContent>
          </Card>
        )}
        {control.modules.includes("EXCEPTIONS") && (
          <Card className="bg-red-50 border-red-100 cursor-pointer hover:bg-red-100 transition-colors" onClick={() => onNavigate("import_exceptions", null)}>
            <CardContent className="p-4">
              <div className="text-sm font-semibold text-red-700">Open Uitzonderingen</div>
              <div className="text-2xl font-bold text-red-900 mt-1">
                {shipments.reduce((acc, s) => acc + s.exceptions.filter(e => e.status === "OPEN").length, 0)}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {!manager && isReceiver && shipments.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Mijn LCL Zendingen (Ontvangersportaal)</h2>
          {shipments.filter(s => s.kind === "LCL").map(s => (
             <Card key={s.id} className="border-blue-200">
               <CardHeader className="py-3 bg-blue-50/50">
                 <CardTitle className="text-base flex justify-between items-center">
                   <span>{s.reference} <span className="text-sm font-normal text-muted-foreground ml-2">({s.name})</span></span>
                   <Badge>{s.status}</Badge>
                 </CardTitle>
               </CardHeader>
               <CardContent className="pt-4 space-y-4 text-sm">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="bg-slate-50 p-4 rounded border space-y-3">
                      <h4 className="font-semibold text-slate-900">Mijn Bedrijfsgegevens</h4>
                      <div className="flex justify-between items-center">
                        <span>Gegevens bevestigd</span>
                        {s.companyConfirmed ? (
                          <Badge variant="outline" className="text-green-600">Ja</Badge>
                        ) : (
                          <Button size="sm" onClick={() => confirmCompany(s.id)} disabled={busy}>Bevestig nu</Button>
                        )}
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Douanevertegenwoordiging</span>
                        {s.representationReviewed ? (
                          <Badge variant="outline" className="text-green-600">Akkoord</Badge>
                        ) : (
                          <Button size="sm" onClick={() => confirmRep(s.id)} disabled={busy}>Geef akkoord</Button>
                        )}
                      </div>
                    </div>
                    
                    <div className="bg-slate-50 p-4 rounded border flex flex-col justify-center space-y-3">
                      <Button variant="outline" onClick={() => onNavigate("import_documents", s.id)} className="w-full">Documenten Uploaden / Inzien</Button>
                      <Button variant="outline" onClick={() => onNavigate("import_charges", s.id)} className="w-full">Facturen & Betalingen</Button>
                      <Button variant="outline" onClick={() => onNavigate("import_delivery", s.id)} className="w-full">Achterland & Aflevervoorkeur</Button>
                    </div>
                  </div>
               </CardContent>
             </Card>
          ))}
        </div>
      )}
    </div>
  );
}