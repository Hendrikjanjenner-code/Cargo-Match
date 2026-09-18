import { useState } from "react";
import { useDemo } from "../DemoContext";
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, Input, Label } from "@/components/ui/primitives";
import { localDate } from "./demo-display";
export function DemoAdmin() {
  const { session, executeAction, busy } = useDemo();
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  if (!session || !session.context.permissions.includes("VIEW_ADMIN")) return <p role="alert">Geen toegang tot demo-beheer.</p>;
  const reset = async () => {
    if (confirmation !== "RESET DEMO" || !window.confirm("Alleen jouw geïsoleerde demo-omgeving opnieuw beginnen? Huidige oefeningen in deze omgeving worden verwijderd.")) return;
    try { await executeAction({ type: "RESET", confirmation: "RESET DEMO" }); setConfirmation(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Reset mislukt."); }
  };
  return <div className="space-y-5"><header><h1 className="text-2xl font-semibold">Beheer van mijn demo-omgeving</h1><p className="mt-2 text-muted-foreground">Emma beheert alleen deze geïsoleerde bezoekersomgeving. Geen productiedata, providercredentials of echte gebruikers.</p></header>
    <Card><CardHeader><CardTitle>Demo-status & modulevlaggen</CardTitle></CardHeader><CardContent className="space-y-4"><p>Scenario’s aangemaakt: {localDate(session.seededAt)} · {session.stale ? "Verouderd, oefeningen zijn bewaard" : "Actueel"}</p><div className="flex flex-wrap gap-2">{Object.entries(session.context.modules).map(([name, status]) => <Badge key={name} variant="secondary">{name}: {status}</Badge>)}</div><p className="text-sm text-muted-foreground">AIS, GPS, betaal- en routeproviders zijn niet verbonden. Alle commerciële handelingen blijven bij de bevoegde persona’s; dit beheerscherm geeft geen toestemming namens hen.</p></CardContent></Card>
    <Card><CardHeader><CardTitle>Fictieve bedrijven & profielen</CardTitle></CardHeader><CardContent className="grid sm:grid-cols-2 gap-3">{session.workspace.companies.map(c => <section key={c.id} className="border rounded p-3"><h2 className="font-semibold">{c.name}</h2><p className="text-xs text-muted-foreground">{c.activities.join(" · ")}</p>{session.personas.filter(p => p.companyId === c.id).map(p => <p key={p.id} className="text-sm mt-2">{p.name} · {p.operationalProfile} · {p.membershipRole}</p>)}</section>)}</CardContent></Card>
    <Card><CardHeader><CardTitle>Audit van deze omgeving</CardTitle></CardHeader><CardContent className="space-y-2">{session.workspace.audit.slice(-20).reverse().map(log => <p key={log.id} className="text-sm border-b pb-2">{localDate(log.createdAt)} · {session.personas.find(p => p.id === log.actorId)?.name || log.actorId} · {log.action}</p>)}{session.workspace.audit.length === 0 && <p>Er zijn nog geen demohandelingen geregistreerd.</p>}</CardContent></Card>
    {session.context.permissions.includes("RESET_DEMO") && <Card><CardHeader><CardTitle>Oefenomgeving vernieuwen</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm">Reset wist alleen je eigen demohandelingen en maakt nieuwe relatieve scenario’s. Andere bezoekers en echte gegevens blijven onaangeraakt.</p><Label htmlFor="reset-confirm">Typ RESET DEMO ter bevestiging</Label><Input id="reset-confirm" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" />{error && <p role="alert" className="text-red-700">{error}</p>}<Button variant="destructive" disabled={busy || confirmation !== "RESET DEMO"} onClick={() => void reset()}>Reset mijn demo-omgeving</Button></CardContent></Card>}
  </div>;
}