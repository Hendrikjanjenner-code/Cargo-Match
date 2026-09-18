import { useState } from "react";
import { useDemo } from "../DemoContext";
import { Button, Badge, Card, CardHeader, CardTitle, CardContent } from "@/components/ui/primitives";
import { localDate, moduleEnabled } from "./demo-display";
type Step = "ARRIVED" | "DOCUMENTS_READY" | "PAYMENT_SIMULATED" | "RELEASED" | "PICKUP_READY";
export function DemoImport() {
  const { session, executeAction, busy } = useDemo();
  const [feedback, setFeedback] = useState("");
  if (!session || !moduleEnabled(session, "IMPORT")) return <p role="alert">Import is niet beschikbaar voor dit profiel.</p>;
  const manager = session.context.permissions.includes("MANAGE_IMPORT");
  const run = async (shipmentId: string, step: Step) => { try { await executeAction({ type: "IMPORT_STEP", shipmentId, step }); setFeedback("Fictieve status bijgewerkt. Er is niets betaald, verzonden of daadwerkelijk vrijgegeven."); } catch (e) { setFeedback(e instanceof Error ? e.message : "Actie mislukt."); } };
  return <div className="space-y-5"><h1 className="text-2xl font-semibold">CargoMatch Import · LCL demo-pilot</h1><p className="bg-blue-50 p-4 rounded text-sm">Afzonderlijke oefenmodule. Alleen gesimuleerde documenten, kosten, betaling, release en pickup. {manager ? "Je beheert deze fictieve keten." : "Je hebt uitsluitend inzage in de zending die aan jouw bedrijf is geadresseerd."}</p>{feedback && <p role="status">{feedback}</p>}
    {session.workspace.imports.map(shipment => {
      const documentsReady = shipment.documents.every(d => d.status === "READY");
      const next: [Step, string] | null = shipment.status === "IN_TRANSIT" ? ["ARRIVED", "Aankomst bevestigen"] : !documentsReady ? ["DOCUMENTS_READY", "Documenten gereed markeren"] : shipment.paymentStatus !== "SIMULATED_PAID" ? ["PAYMENT_SIMULATED", "Betaling simuleren"] : shipment.releaseStatus !== "SIMULATED_RELEASED" ? ["RELEASED", "Release simuleren"] : shipment.pickupStatus !== "SIMULATED_READY" ? ["PICKUP_READY", "Pickup gereed simuleren"] : null;
      return <Card key={shipment.id}><CardHeader><CardTitle>{shipment.name}</CardTitle><p className="text-sm text-muted-foreground">Gepland aankomstmoment: {localDate(shipment.arrivalAt)}</p></CardHeader><CardContent className="space-y-4"><Badge>{shipment.status}</Badge><section><h2 className="font-semibold">Documenten</h2><ul>{shipment.documents.map(d => <li key={d.id} className="py-2 border-b flex justify-between gap-2"><span>{d.name}</span><Badge>{d.status}</Badge></li>)}</ul><p className="text-xs text-muted-foreground mt-2">Statusoefening; geen echte documenten of downloadbestanden.</p></section><section><h2 className="font-semibold">Toegestane kosten</h2>{shipment.charges.map(c => <p key={c.id} className="py-2 flex justify-between gap-2"><span>{c.label}</span><span>{new Intl.NumberFormat("nl-NL", { style: "currency", currency: c.currency }).format(c.amount)}</span></p>)}</section><dl className="grid sm:grid-cols-3 gap-3 text-sm">{[["Betaling", shipment.paymentStatus], ["Release", shipment.releaseStatus], ["Pickup", shipment.pickupStatus]].map(([key, value]) => <div key={key} className="bg-slate-50 p-3 rounded"><dt className="text-muted-foreground">{key}</dt><dd className="font-medium mt-1">{value}</dd></div>)}</dl>{manager && next && <Button disabled={busy} onClick={() => void run(shipment.id, next[0])}>{next[1]}</Button>}{!next && <p role="status">De fictieve Import-keten is voltooid.</p>}</CardContent></Card>;
    })}
    {session.workspace.imports.length === 0 && <p className="text-muted-foreground">Geen geautoriseerde zendingen gevonden.</p>}
  </div>;
}