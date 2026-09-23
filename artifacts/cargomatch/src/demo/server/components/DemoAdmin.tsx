import { useState } from "react";
import { useDemo } from "../DemoContext";
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Label } from "@/components/ui/primitives";
import { localDate } from "./demo-display";
export function DemoAdmin() {
  const { session, executeAction, busy } = useDemo();
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  if (!session || !session.context.permissions.includes("VIEW_ADMIN")) return <p role="alert">Geen toegang tot demo-beheer.</p>;
  const reset = async () => {
    if (confirmation !== "RESET ALL DEMO DATA?" || !window.confirm("ALLE demoaccounts worden gereset. Ook andere bezoekers verliezen hun oefenacties. Doorgaan?")) return;
    try { await executeAction({type: "RESET", confirmation: "RESET ALL DEMO DATA?"}); setConfirmation(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Reset mislukt."); }
  };
  return <div className="space-y-5">
    <header><h1 className="text-2xl font-semibold">Beheer gedeeld demo-ecosysteem</h1><p className="mt-2 text-muted-foreground">Emma beheert de gedeelde fictieve omgeving. Geen echte accounts, gegevens of providercredentials.</p></header>
    <Card><CardHeader><CardTitle>Alle demogegevens herstellen</CardTitle></CardHeader><CardContent className="space-y-3">
      <p>Dit wist interesses, verbindingen, berichten en operationele voortgang voor ALLE persona’s en bezoekers. Basisidentiteiten en rechten blijven behouden. Scenariodatums worden vernieuwd; andere sessies moeten herladen.</p>
      <Label htmlFor="reset-confirm">Typ RESET ALL DEMO DATA?</Label><Input id="reset-confirm" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off"/>
      {error && <p role="alert">{error}</p>}<Button variant="destructive" disabled={busy || confirmation !== "RESET ALL DEMO DATA?"} onClick={() => void reset()}>Reset alle demogegevens</Button>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Opgeslagen activiteit</CardTitle></CardHeader><CardContent>{session.workspace.audit.slice().reverse().map(e => <p key={e.id} className="text-sm py-1">{localDate(e.createdAt)} · {e.actorId} · {e.action}</p>)}</CardContent></Card>
  </div>;
}