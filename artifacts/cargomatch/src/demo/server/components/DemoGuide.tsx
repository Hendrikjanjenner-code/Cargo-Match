import { useDemo } from "../DemoContext";
import type { Mode } from "../api";
import { Button } from "@/components/ui/primitives";
import { useDemoRouting } from "./useDemoRouting";
export function DemoGuide({ activeMode }: { activeMode: Mode }) {
  const { session, switchPersona, busy } = useDemo();
  const { navigate } = useDemoRouting();
  if (!session || !["ACTIVE", "PILOT"].includes(session.context.modules.GUIDED_DEMO) || activeMode !== "DEEPSEA" || !["andy", "sophie"].includes(session.context.user.id)) return null;
  const match = session.workspace.matches.find(m => m.id === "match-deepsea");
  const connected = match?.status === "CONNECTED";
  const messages = session.workspace.messages.filter(m => m.matchId === "match-deepsea");
  const stages = [
    ["Andy toont interesse", !!match?.leftConsent],
    ["Sophie accepteert", connected],
    ["Gedeeld gesprek bevat een bericht", connected && messages.length > 0],
  ] as const;
  return <details className="border rounded-lg bg-white p-4"><summary className="cursor-pointer font-semibold">Begeleide demo: Andy ↔ Sophie</summary><div className="space-y-4 mt-4"><p className="text-sm text-muted-foreground">75.000 ton Indonesia–China en een passende Kamsarmax. Deze stappen volgen alleen echte opgeslagen demohandelingen; wisselen geeft nooit automatisch toestemming.</p><ol className="space-y-2">{stages.map(([label, done], index) => <li key={label} className="flex gap-3 text-sm"><span className={done ? "text-green-700 font-semibold" : "text-muted-foreground"}>{index + 1}. {done ? "Voltooid" : "Nog uit te voeren"}</span><span>{label}</span></li>)}</ol><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => navigate({ demoView: "match_detail", entityId: "match-deepsea" })}>Open de primaire match</Button><Button disabled={busy} variant="outline" onClick={() => void switchPersona(session.context.user.id === "andy" ? "sophie" : "andy")}>Wissel naar {session.context.user.id === "andy" ? "Sophie" : "Andy"}</Button></div><p className="text-xs text-muted-foreground">Een CONNECTED-match is geen boeking. Identiteiten blijven vóór wederzijdse toestemming beschermd.</p></div></details>;
}