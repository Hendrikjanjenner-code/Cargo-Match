import { useDemo } from "../DemoContext";
import type { Mode } from "../api";
import { useDemoRouting } from "./useDemoRouting";
import { Card, CardHeader, CardTitle, CardContent, Button } from "@/components/ui/primitives";
import { quantity, modeLabels } from "./demo-display";
export function DemoMap() {
  const { session } = useDemo();
  const { mode, navigate } = useDemoRouting();
  if (!session) return null;
  const activeMode = (mode || session.context.user.primaryMode) as Mode;
  const opportunities = session.workspace.opportunities.filter(m => m.mode === activeMode);
  const assets = session.workspace.assets.filter(a => a.mode === activeMode);
  return <div className="space-y-5"><header><h1 className="text-2xl font-semibold">Regiokaart · {modeLabels[activeMode]}</h1><p className="text-muted-foreground mt-2">Schematisch regio-overzicht, niet op schaal. Geen geverifieerde routes, live posities of exacte locaties van andere bedrijven.</p></header><div role="status" className="bg-amber-50 border border-amber-200 p-4 rounded text-sm">Live AIS/GPS en routeprovider: niet verbonden. Alle gegevens zijn fictief en handmatig opgegeven.</div>
    <Card><CardHeader><CardTitle>{session.context.permissions.includes("VIEW_ASSIGNED_ASSET") ? "Mijn toegewezen asset" : "Eigen assets"}</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-3">{assets.map(a => <div key={a.id} className="border rounded p-3 bg-blue-50"><strong>{a.name}</strong><p className="text-sm">{a.location} · {quantity(a.capacity, a.mode)}</p></div>)}</div>{assets.length === 0 && <p className="text-muted-foreground">Geen eigen assets in deze modus; bekijk de beschikbare regiokansen hieronder.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Regio’s van passende kansen</CardTitle></CardHeader><CardContent className="space-y-4">{opportunities.map(m => <section key={m.id} className="border rounded p-4"><div className="flex flex-wrap items-center gap-2 text-sm"><span className="rounded-full border bg-slate-50 py-2 px-3">{m.origin}</span><span aria-label="naar" className="flex-1 min-w-8 border-t-2 border-dashed border-blue-300" /><span className="rounded-full border bg-slate-50 py-2 px-3">{m.destination}</span></div><div className="flex justify-between gap-3 items-center mt-3"><p className="text-xs text-muted-foreground">{quantity(m.quantity, m.mode)} · {m.status} · {m.counterpartyName || "tegenpartij anoniem"}</p><Button size="sm" variant="outline" onClick={() => navigate({ demoView: "match_detail", entityId: m.id })}>Bekijk kans</Button></div></section>)}{opportunities.length === 0 && <p className="text-muted-foreground">Geen passende regiokansen voor deze modus en jouw huidige bevoegdheden.</p>}</CardContent></Card>
  </div>;
}