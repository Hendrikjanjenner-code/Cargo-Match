import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from "@/components/ui/primitives";
import { useDemo } from "../DemoContext";
import type { Mode } from "../api";
import { useDemoRouting } from "./useDemoRouting";
import { roleHeadings, quantity, localDate } from "./demo-display";
import { DemoAdmin } from "./DemoAdmin";

export function DemoOverview() {
  const { session, executeAction, busy } = useDemo();
  const { mode, navigate } = useDemoRouting();
  const [feedback, setFeedback] = useState("");
  if (!session) return null;
  const { context, workspace } = session;
  if (context.permissions.includes("VIEW_ADMIN")) return <DemoAdmin />;
  const activeMode = (mode || context.user.primaryMode) as Mode;
  const [heading, description] = roleHeadings[context.user.id] || ["Mijn overzicht", "Jouw geautoriseerde demo-context."];
  const assets = workspace.assets.filter(a => a.mode === activeMode);
  const opportunities = workspace.opportunities.filter(m => m.mode === activeMode);
  const matches = workspace.matches.filter(m => m.mode === activeMode);
  const listings = [...workspace.cargos, ...workspace.capacity].filter(l => l.mode === activeMode);
  const operational = context.permissions.includes("VIEW_ASSIGNED_ASSET");
  const run = async (action: Parameters<typeof executeAction>[0], success: string) => { try { await executeAction(action); setFeedback(success); } catch (e) { setFeedback(e instanceof Error ? e.message : "Actie mislukt."); } };
  return <div className="space-y-6">
    <header><p className="text-sm text-muted-foreground">{context.user.name} · {context.company.name}</p><h1 className="text-2xl font-semibold mt-1">{heading}</h1><p className="text-muted-foreground mt-2">{description}</p></header>
    {feedback && <p role="status" className="bg-blue-50 p-3 rounded">{feedback}</p>}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[["Eigen assets", assets.length], ["Eigen aanbiedingen", listings.length], ["Passende kansen", opportunities.length], ["Verbonden", matches.filter(m => m.status === "CONNECTED").length]].map(([label, value]) => <Card key={String(label)}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><strong className="text-2xl">{value}</strong></CardContent></Card>)}</div>
    {(operational || assets.length > 0) && <Card><CardHeader><CardTitle>{operational ? "Mijn toegewezen asset" : "Beschikbaarheid vloot"}</CardTitle></CardHeader><CardContent className="space-y-3">{assets.map(asset => <div key={asset.id} className="border rounded p-4 flex flex-wrap justify-between gap-3"><div><strong>{asset.name}</strong><p className="text-sm text-muted-foreground">{asset.location} · {quantity(asset.capacity, asset.mode)}</p><p className="text-sm">Verwacht beschikbaar: {localDate(asset.availableAt)}</p>{asset.technical?.currentDeliveryExpectedAt && <p className="text-sm">Huidige levering verwacht: {localDate(asset.technical.currentDeliveryExpectedAt)}</p>}</div><div className="flex gap-2 items-center">{(operational || context.permissions.includes("MANAGE_CAPACITY")) && <Button disabled={busy} variant="outline" onClick={() => void run({ type: "CONFIRM_AVAILABILITY", assetId: asset.id, availableAt: asset.availableAt }, "Operationele bevestiging verzonden. Er is geen capaciteit gepubliceerd en geen commerciële toestemming gegeven.")}>Beschikbaarheid bevestigen</Button>}{context.permissions.includes("MANAGE_ASSETS") && <Button variant="outline" onClick={() => navigate({ demoView: "form_asset", entityId: asset.id })}>Bewerken</Button>}</div></div>)}{assets.length === 0 && <p>Geen toegewezen assets in deze modus.</p>}<p className="text-xs text-muted-foreground">Fictieve, handmatige status. Geen live AIS/GPS of geverifieerde rij-/vaarroute.</p></CardContent></Card>}
    {workspace.referrals.length > 0 && <Card><CardHeader><CardTitle>{context.permissions.includes("REVIEW_REFERRAL") ? "Van jouw schipper / chauffeur" : "Doorgestuurd naar planner"}</CardTitle></CardHeader><CardContent className="space-y-3">{workspace.referrals.map(referral => <div key={referral.id} className="border p-3 rounded"><div className="flex justify-between gap-2"><span>{referral.note || "Passende kans ter beoordeling"}</span><Badge>{referral.status}</Badge></div><div className="flex gap-2 mt-3">{referral.toUserId === context.user.id && context.permissions.includes("REVIEW_REFERRAL") && referral.status === "SENT" && <Button disabled={busy} onClick={() => void run({ type: "REVIEW_REFERRAL", referralId: referral.id }, "Kans beoordeeld. Commerciële interesse vraagt nog jouw afzonderlijke actie.")}>Markeer als beoordeeld</Button>}<Button variant="outline" onClick={() => navigate({ demoView: "match_detail", entityId: referral.opportunityId })}>Bekijk kans</Button></div></div>)}</CardContent></Card>}
    <Card><CardHeader><CardTitle>{operational ? "Kansen om naar de planner te sturen" : "Matches & inkomende interesse"}</CardTitle></CardHeader><CardContent className="space-y-3">{opportunities.slice(0, 6).map(match => <button key={match.id} className="border rounded p-4 w-full text-left hover:bg-slate-50 flex justify-between gap-3" onClick={() => navigate({ demoView: "match_detail", entityId: match.id })}><span><strong>{match.origin} → {match.destination}</strong><span className="block text-sm text-muted-foreground">{quantity(match.quantity, match.mode)} · score {Math.round(match.score)} · voorlopig</span></span><Badge>{match.status}</Badge></button>)}{opportunities.length === 0 && <p className="text-muted-foreground">Geen geschikte kansen binnen deze modus en bevoegdheden. Controleer eigen technische eisen en tijdvensters.</p>}<Button variant="outline" onClick={() => navigate({ demoView: "matches", entityId: null })}>Alle matches bekijken</Button></CardContent></Card>
    {workspace.referrals.filter(r => r.toUserId === context.user.id && ["SENT", "REVIEWED"].includes(r.status)).map(r => <Button key={r.id} variant="outline" disabled={busy} onClick={() => void run({type: "DISMISS_REFERRAL", referralId: r.id}, "Kans afgewezen; de operationele collega ontvangt een melding.")}>Wijs doorgestuurde kans af · {r.opportunityId}</Button>)}
    <p className="text-xs text-muted-foreground">Alle gegevens zijn fictief en gedeeld tussen bevoegde demoaccounts. Wederzijdse verbinding is geen boeking of reservering.</p>
  </div>;
}