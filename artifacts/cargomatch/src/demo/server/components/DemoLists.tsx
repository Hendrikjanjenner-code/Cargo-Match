import { useState } from "react";
import { Button, Badge, Input, Card, CardHeader, CardTitle, CardContent } from "@/components/ui/primitives";
import { useDemo } from "../DemoContext";
import type { Mode } from "../api";
import { useDemoRouting } from "./useDemoRouting";
import { quantity, localDate, assetLabels, capacityLabels } from "./demo-display";

export function DemoLists({ type }: { type: "assets" | "cargos" | "capacity" | "matches" | "messages" | "notifications" }) {
  const { session, executeAction, busy } = useDemo();
  const { mode, navigate } = useDemoRouting();
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState("");
  if (!session) return null;
  const { workspace, context } = session;
  const activeMode = (mode || context.user.primaryMode) as Mode;
  const has = (p: string) => context.permissions.includes(p);
  const find = (...values: (string | number)[]) => values.join(" ").toLowerCase().includes(search.toLowerCase());
  const run = async (action: Parameters<typeof executeAction>[0]) => { try { await executeAction(action); setFeedback("Wijziging opgeslagen."); } catch (e) { setFeedback(e instanceof Error ? e.message : "Actie mislukt."); } };
  const titles = { assets: assetLabels[activeMode], cargos: activeMode === "DEEPSEA" ? "Cargo orders" : "Mijn lading", capacity: capacityLabels[activeMode], matches: "Matches & kansen", messages: "Verbonden gesprekken", notifications: "Mijn notificaties" };
  let count = 0;
  let content: React.ReactNode;
  if (type === "assets") {
    const assets = workspace.assets.filter(a => a.mode === activeMode && find(a.name, a.location, a.type)); count = assets.length;
    content = assets.map(a => <Card key={a.id}><CardContent className="p-4 space-y-3"><div className="flex justify-between gap-3"><strong>{a.name}</strong><Badge>{a.type}</Badge></div><p>{a.location} · {quantity(a.capacity, a.mode)}{a.volume ? ` · ${a.volume} m³` : ""}</p><p className="text-sm">Verwacht beschikbaar: {localDate(a.availableAt)}</p>{a.technical?.currentDeliveryExpectedAt && <p className="text-sm">Huidige levering verwacht: {localDate(a.technical.currentDeliveryExpectedAt)}</p>}<p className="text-sm text-muted-foreground">{a.equipment.join(", ")}</p><div className="flex gap-2 flex-wrap">{has("MANAGE_ASSETS") && <Button variant="outline" onClick={() => navigate({ demoView: "form_asset", entityId: a.id })}>Bewerken</Button>}{(has("MANAGE_CAPACITY") || has("MANAGE_ASSIGNED_ASSET_AVAILABILITY")) && <Button disabled={busy} onClick={() => void run({ type: "CONFIRM_AVAILABILITY", assetId: a.id, availableAt: a.availableAt })}>Beschikbaarheid bevestigen</Button>}</div>{workspace.evidence.filter(e => e.assetId === a.id).slice(-1).map(e => <p key={e.createdAt} className="text-xs text-muted-foreground">Laatst operationeel bevestigd: {localDate(e.availableAt)}. Geen publicatie of commerciële toestemming.</p>)}</CardContent></Card>);
  } else if (type === "cargos" || type === "capacity") {
    const items = (type === "cargos" ? workspace.cargos : workspace.capacity).filter(l => l.mode === activeMode && find(l.name, l.origin, l.destination, l.status)); count = items.length;
    content = items.map(l => <Card key={l.id}><CardContent className="p-4 space-y-3"><div className="flex justify-between gap-3"><strong>{l.name}</strong><Badge>{l.status}</Badge></div><p>{l.origin} → {l.destination} · {quantity(l.quantity, l.mode)}</p><p className="text-sm">{localDate(l.availableFrom)} – {localDate(l.availableUntil)}</p><p className="text-xs text-muted-foreground">{l.visibility}</p><div className="flex gap-2 flex-wrap"><Button variant="outline" onClick={() => navigate({ demoView: type === "cargos" ? "form_cargo" : "form_capacity", entityId: l.id })}>Bewerken</Button>{l.status !== "ACTIVE" && <Button disabled={busy} onClick={() => void run({ type: "PUBLISH_LISTING", listingId: l.id })}>Publiceren</Button>}{l.status === "ACTIVE" && <Button disabled={busy} variant="outline" onClick={() => { if (window.confirm("Dit aanbod intrekken? Bijbehorende eerdere toestemming wordt ongeldig.")) void run({ type: "WITHDRAW_LISTING", listingId: l.id }); }}>Intrekken</Button>}</div></CardContent></Card>);
  } else if (type === "matches") {
    const unique = [...new Map([...workspace.opportunities, ...workspace.matches].map(m => [m.id, m])).values()].filter(m => m.mode === activeMode && find(m.origin, m.destination, m.status, m.counterpartyName || "")); count = unique.length;
    content = unique.map(m => <button key={m.id} className="w-full text-left bg-white border rounded-lg p-4 hover:border-blue-400" onClick={() => navigate({ demoView: "match_detail", entityId: m.id })}><div className="flex justify-between gap-3"><strong>{m.origin} → {m.destination}</strong><Badge>{m.status}</Badge></div><p className="text-sm mt-2">{quantity(m.quantity, m.mode)} · score {Math.round(m.score)} · voorlopig</p><p className="text-xs text-muted-foreground mt-1">{m.counterpartyName || "Identiteit beschermd tot wederzijdse toestemming"}</p></button>);
  } else if (type === "messages") {
    const matches = workspace.matches.filter(m => m.status === "CONNECTED" && m.mode === activeMode && find(m.counterpartyName || "", m.origin, m.destination)); count = matches.length;
    content = matches.map(m => { const messages = workspace.messages.filter(message => message.matchId === m.id); const last = messages.at(-1); return <button key={m.id} className="text-left border bg-white rounded-lg p-4" onClick={() => navigate({ demoView: "match_detail", entityId: m.id })}><strong>{m.counterpartyName}</strong><p className="text-sm">{m.origin} → {m.destination}</p><p className="text-sm text-muted-foreground mt-2">{last ? `${last.senderName}: ${last.body}` : "Verbonden gesprek · nog geen berichten"}</p></button>; });
  } else {
    const notifications = workspace.notifications.filter(n => find(n.title, n.read ? "gelezen" : "ongelezen")); count = notifications.length;
    content = notifications.slice().reverse().map(n => <Card key={n.id}><CardContent className="p-4 flex justify-between gap-4"><div><strong>{n.title}</strong><p className="text-xs text-muted-foreground mt-1">{localDate(n.createdAt)}</p></div>{n.read ? <Badge>Gelezen</Badge> : <Button disabled={busy} variant="outline" onClick={() => void run({ type: "READ_NOTIFICATION", notificationId: n.id })}>Markeer gelezen</Button>}</CardContent></Card>);
  }
  return <div className="space-y-4"><div className="flex flex-wrap gap-3 justify-between"><h1 className="text-2xl font-semibold">{titles[type]}</h1>{type === "assets" && has("MANAGE_ASSETS") && <Button onClick={() => navigate({ demoView: "form_asset", entityId: "new" })}>Nieuwe asset</Button>}{type === "cargos" && has("CREATE_CARGO") && <Button onClick={() => navigate({ demoView: "form_cargo", entityId: "new" })}>Nieuwe lading</Button>}{type === "capacity" && has("MANAGE_CAPACITY") && <Button onClick={() => navigate({ demoView: "form_capacity", entityId: "new" })}>Nieuwe capaciteit</Button>}</div><Input aria-label="Zoeken in deze weergave" value={search} onChange={e => setSearch(e.target.value)} placeholder="Zoek op naam, route of status…" />{feedback && <p role="status" className="bg-blue-50 p-3 rounded">{feedback}</p>}<div className="grid gap-3">{content}</div>{count === 0 && <Card><CardContent className="p-6 text-muted-foreground">Geen resultaten binnen deze modus en jouw bevoegdheden.{search && " Pas je zoekterm aan."}{type === "messages" && " Een gesprek is pas toegankelijk na wederzijdse toestemming."}</CardContent></Card>}</div>;
}