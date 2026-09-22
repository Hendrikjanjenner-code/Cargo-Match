import React, { useState } from "react";
import { ImportWorkspaceProps } from "./ImportWorkspace";
import { Button, Badge, Card, CardHeader, CardTitle, CardContent, Select } from "@/components/ui/primitives";
import { ImportAction } from "../../import-contract";
import { localDate } from "../demo-display";

export function ImportDelivery({ control, entityId, run, busy, manager, opportunities, onNavigate }: ImportWorkspaceProps & { run: (a: ImportAction) => Promise<void> }) {
  const [selectedShipment, setSelectedShipment] = useState<string>(entityId || "");
  const shipment = control.shipments.find(s => s.id === selectedShipment);
  const shipments = control.shipments;

  const findDelivery = async (sId: string) => {
    await run({ type: "IMPORT_CONTROL", operation: "FIND_DELIVERY", shipmentId: sId });
  };
  
  const setChoice = async (sId: string, choice: string) => {
    await run({ type: "IMPORT_CONTROL", operation: "DELIVERY_CHOICE", shipmentId: sId, value: choice });
  };
  
  const planDelivery = async (sId: string, matchId: string) => {
    await run({ type: "IMPORT_CONTROL", operation: "PLAN_DELIVERY", shipmentId: sId, matchId });
  };
  
  const markDelivered = async (sId: string) => {
    await run({ type: "IMPORT_CONTROL", operation: "DELIVER", shipmentId: sId });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Achterland Vervoer</h2>
        <div className="flex gap-2">
          <Select value={selectedShipment} onChange={e => setSelectedShipment(e.target.value)}>
            <option value="">Alle zendingen</option>
            {shipments.map(s => <option key={s.id} value={s.id}>{s.reference} - {s.name}</option>)}
          </Select>
        </div>
      </div>

      <div className="space-y-4">
        {!control.demo && <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">Automatische importmatching, planning en aflevering zijn voor reguliere bedrijfszendingen nog niet beschikbaar. De bestaande transportmarktplaats blijft apart beschikbaar; hier worden geen demoverbindingen of afleveringen aangemaakt.</p>}
        {(selectedShipment ? [shipment] : shipments).filter(Boolean).map(s => {
          const d = s!.delivery;
          
          return (
            <Card key={s!.id} className={d.status === "DELIVERED" ? "border-green-200" : ""}>
              <CardHeader className="py-3 flex flex-row justify-between items-center">
                <div>
                  <CardTitle className="text-base">{s!.reference}</CardTitle>
                  <p className="text-xs text-muted-foreground">{s!.origin} &rarr; {s!.destination}</p>
                </div>
                <Badge variant={
                  d.status === "DELIVERED" ? "default" : 
                  d.status === "PLANNED" ? "default" : 
                  "secondary"
                } className={d.status === "DELIVERED" ? "bg-green-600" : ""}>
                  {d.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                
                {control.demo && manager && d.status === "NOT_PLANNED" && (
                  <div className="bg-slate-50 p-4 rounded text-sm flex justify-between items-center">
                    <div>
                      <p className="font-semibold">Vervoerder Zoeken</p>
                      <p className="text-muted-foreground text-xs mt-1">Start de matching-engine om capaciteit te vinden.</p>
                    </div>
                    <Button onClick={() => findDelivery(s!.id)} disabled={busy}>Zoek Capaciteit</Button>
                  </div>
                )}
                
                {d.listingIds.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-sm mb-2">Gevonden Matches</h4>
                    {d.listingIds.length === 0 ? <p className="text-sm text-slate-500">Geen actieve opties of nog in proces.</p> : (
                      <div className="space-y-2">
                        {d.listingIds.map(listingId => {
                          const opp = opportunities.find(o => o.cargoId === listingId || o.capacityId === listingId);
                          return (
                            <div key={listingId} className="border rounded p-3 text-sm flex justify-between items-center bg-slate-50">
                              <div>
                                <p className="font-medium">Vervoersoptie (Listing: {listingId})</p>
                                <p className="text-xs text-slate-500 mt-1">{opp ? `Score: ${opp.score} | Match ID: ${opp.id}` : "Nog geen geschikte capaciteit binnen de huidige route, tijd en technische voorwaarden."}</p>
                              </div>
                              {manager && opp && (
                                <div className="flex gap-2">
                                  <Button size="sm" variant="outline" onClick={() => onNavigate("match_detail", opp.id)}>Details / Consent</Button>
                                  <Button size="sm" onClick={() => planDelivery(s!.id, opp.id)} disabled={busy || opp.status !== "CONNECTED" || s!.status !== "READY_FOR_PICKUP"}>Afzonderlijk inplannen</Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                
                {s!.kind === "LCL" && !manager && d.status !== "DELIVERED" && (
                  <div className="bg-blue-50 p-4 rounded border border-blue-100 mt-4">
                    <h4 className="font-semibold text-sm text-blue-900 mb-2">Jouw Levervoorkeur</h4>
                    <div className="flex gap-2">
                       <Button size="sm" variant={d.choice === "PICKUP" ? "default" : "outline"} onClick={() => setChoice(s!.id, "PICKUP")} disabled={busy}>Zelf ophalen (Pickup)</Button>
                       <Button size="sm" variant={d.choice === "DELIVER" ? "default" : "outline"} onClick={() => setChoice(s!.id, "DELIVER")} disabled={busy}>Laten bezorgen (Deliver)</Button>
                    </div>
                    {d.choice && <p className="text-xs text-blue-800 mt-2">Huidige keuze geregistreerd: {d.choice}</p>}
                  </div>
                )}

                {d.status === "PLANNED" && (
                  <div className="bg-green-50 p-4 rounded text-sm border border-green-100">
                    <p className="font-semibold text-green-900">Vervoer Gepland</p>
                    <p className="text-green-800 text-xs mt-1">Match ID: {d.matchId}</p>
                    
                    {manager && (
                       <Button className="mt-3 bg-green-600 hover:bg-green-700" onClick={() => markDelivered(s!.id)} disabled={busy}>Simuleer Aflevering</Button>
                    )}
                  </div>
                )}

                {d.status === "DELIVERED" && (
                  <div className="bg-slate-50 p-3 rounded text-sm">
                    <p className="font-semibold text-slate-900">Afgeleverd</p>
                    <p className="text-slate-500 text-xs mt-1">Bewijs: {d.evidence || "Geen"}</p>
                  </div>
                )}

              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}