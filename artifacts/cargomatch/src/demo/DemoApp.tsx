import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, LogOut, LogIn } from "lucide-react";
import { Button, Select } from "@/components/ui/primitives";
import { DemoProvider, useDemo } from "./server/DemoContext";
import { DemoShell } from "./server/components/DemoShell";
import { inspectLegacyDemo, keepLegacyDemo, deleteLegacyDemo } from "./server/legacy-transition";

interface DemoAppProps {
  onExit: () => void;
  initialPersonaId?: string;
  onLoginReal?: () => void;
}
function browserStorage(): Storage | null {
  try { return localStorage; }
  catch { return null; } // Server identity and persistence do not require browser storage.
}

function DemoAppInner({ onExit, initialPersonaId, onLoginReal }: DemoAppProps) {
  const { session, status, busy, errorMsg, startDemo, switchPersona, logout, reloadSession } = useDemo();
  const attemptedStart = useRef(false);
  const appliedEntryChoice = useRef(false);
  useEffect(() => {
    if (status === "IDLE" && !attemptedStart.current) {
      attemptedStart.current = true;
      void startDemo(initialPersonaId || "andy");
    }
    if (status === "READY" && session && !appliedEntryChoice.current) {
      appliedEntryChoice.current = true;
      if (initialPersonaId && session.context.user.id !== initialPersonaId) void switchPersona(initialPersonaId);
    }
  }, [status, session, initialPersonaId, startDemo, switchPersona]);

  if (status === "LOADING") return <div role="status" className="min-h-screen flex items-center justify-center p-8">Beveiligde demo laden…</div>;
  if (!session) return <div className="min-h-screen flex items-center justify-center p-6">
    <section className="max-w-md space-y-4 text-center">
      <AlertTriangle className="mx-auto h-10 w-10 text-amber-600" aria-hidden="true" />
      <h1 className="text-xl font-semibold">{status === "STALE" ? "Profielcontext gewijzigd" : status === "IDLE" ? "Demosessie starten" : "Demo niet beschikbaar"}</h1>
      <p role="alert" className="text-muted-foreground">{errorMsg || "Je oefengegevens worden alleen in je eigen, geïsoleerde demo-omgeving opgeslagen."}</p>
      <div className="flex justify-center gap-3">
        <Button onClick={() => { void (status === "IDLE" ? startDemo(initialPersonaId || "andy") : reloadSession()); }}>{status === "IDLE" ? "Start demo" : "Opnieuw laden"}</Button>
        <Button variant="outline" onClick={onExit}>Terug</Button>
      </div>
    </section>
  </div>;

  return <div className="min-h-[100dvh] flex flex-col bg-slate-50 text-foreground">
    <div className="bg-slate-950 border-b border-slate-700 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-white">
      <span className="text-xs font-medium tracking-wide">DEMO MODE · eigen oefenomgeving · fictieve gegevens</span>
      <div className="flex flex-wrap items-center gap-2 max-w-full">
        <label className="sr-only" htmlFor="demo-persona">Wissel demoprofiel</label>
        <Select id="demo-persona" aria-label="Wissel demoprofiel" disabled={busy}
          value={session.context.user.id} onChange={event => { void switchPersona(event.target.value); }}
          className="h-9 max-w-[240px] border-slate-600 bg-slate-900 text-white text-xs">
          {session.personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name} — {persona.operationalProfile}</option>)}
        </Select>
        {onLoginReal && <Button variant="outline" size="sm" onClick={onLoginReal} className="bg-transparent border-slate-600 text-white hover:bg-slate-800 hover:text-white"><LogIn className="h-4 w-4 mr-2" />Standaard inloggen</Button>}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { void logout(); }} className="bg-transparent border-slate-600 text-white hover:bg-slate-800 hover:text-white"><LogOut className="h-4 w-4 mr-2" />Afsluiten</Button>
      </div>
    </div>
    {errorMsg && <div role="alert" className="border-b border-red-200 bg-red-50 text-red-900 p-3 text-sm">{errorMsg} <button className="underline ml-2" onClick={() => { void reloadSession(); }}>Context herladen</button></div>}
    {session.stale && <div role="status" className="border-b border-amber-200 bg-amber-50 p-3 text-sm">
      Deze scenario’s zijn verouderd. Je oefeningen zijn bewaard. Wissel naar Emma om ze na bevestiging te vernieuwen, of bekijk de bestaande gegevens.
    </div>}
    <DemoShell key={`${session.context.user.id}:${session.revision}`} onExit={() => { void logout(); }} />
  </div>;
}

class DemoBoundary extends React.Component<{ children: React.ReactNode; onExit: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div role="alert" className="max-w-lg mx-auto p-8 space-y-4">
      <h1 className="text-xl font-semibold">De demo kon niet worden weergegeven</h1>
      <p>Je opgeslagen oefeningen zijn niet gewist. Herlaad de pagina om je serversessie te herstellen.</p>
      <Button onClick={() => window.location.reload()}>Pagina herladen</Button>
      <Button variant="outline" onClick={this.props.onExit}>Terug</Button>
    </div> : this.props.children;
  }
}

export default function DemoApp(props: DemoAppProps) {
  const [choiceMade, setChoiceMade] = useState(() => !inspectLegacyDemo(browserStorage()).needsChoice);
  const [storageError, setStorageError] = useState("");
  if (!choiceMade) return <div className="min-h-screen flex items-center justify-center p-6">
    <section className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">Overstappen naar de beveiligde demo</h1>
      <p>Er zijn oefeningen van de oude browserdemo gevonden. Deze worden nooit naar de server of echte bedrijfsgegevens geïmporteerd. Kies of je de oude lokale kopie wilt bewaren of verwijderen voordat je de nieuwe demo opent.</p>
      {storageError && <p role="alert">{storageError}</p>}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => { keepLegacyDemo(browserStorage()); setChoiceMade(true); }}>Oude kopie bewaren, serverdemo openen</Button>
        <Button variant="outline" onClick={() => {
          if (!window.confirm("Alleen de oude lokale demooefeningen verwijderen? Dit kan niet ongedaan worden gemaakt.")) return;
          try { const storage = browserStorage(); if (!storage) throw new Error("Unavailable"); deleteLegacyDemo(storage); setChoiceMade(true); }
          catch { setStorageError("De oude kopie kon niet worden verwijderd. Je kunt haar bewaren en de serverdemo openen."); }
        }}>Oude kopie verwijderen</Button>
        <Button variant="outline" onClick={props.onExit}>Annuleren</Button>
      </div>
    </section>
  </div>;
  return <DemoBoundary onExit={props.onExit}><DemoProvider onExit={props.onExit}><DemoAppInner {...props} /></DemoProvider></DemoBoundary>;
}