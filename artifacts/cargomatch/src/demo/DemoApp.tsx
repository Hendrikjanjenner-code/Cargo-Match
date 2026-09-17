import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button, Card, CardHeader, CardTitle, CardContent, Badge, Select } from "@/components/ui/primitives";
import { AlertTriangle, LogOut, RefreshCcw, MapPin, Plus, Building, User, LogIn } from "lucide-react";
import { 
  WORLD_PERSONAS, type WorldPersonaId, type WorldState,
  loadWorldState, saveWorldState, resetWorldStorage,
   startDemo as createDemo,
  worldPermissions, buildWorldMatches
} from "./world";

import { DemoOverview } from "./components/DemoOverview";
import { DemoCargoForm } from "./components/DemoCargoForm";
import { DemoMatchDetail } from "./components/DemoMatchDetail";

interface DemoAppProps {
  onExit: () => void;
  initialPersonaId?: string;
  onLoginReal?: () => void;
}

class DemoErrorBoundary extends React.Component<{ onReset: () => void, onExit: () => void, children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { onReset: () => void, onExit: () => void, children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 max-w-md mx-auto text-center space-y-4 h-screen flex flex-col justify-center">
          <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold">Demo status gecorrumpeerd</h2>
          <p className="text-muted-foreground text-sm">
            Er is een fout opgetreden bij het lezen of schrijven van de lokale demo data.
          </p>
          <div className="flex gap-4 justify-center">
            <Button onClick={() => { this.setState({ hasError: false }); this.props.onReset(); }} variant="outline">Reset Demo</Button>
            <Button onClick={this.props.onExit}>Demo afsluiten</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function DemoApp({ onExit, initialPersonaId, onLoginReal }: DemoAppProps) {
  const [state, setState] = useState<WorldState | null>(null);

  const [personaId, setPersonaId] = useState<string>(initialPersonaId || WORLD_PERSONAS.andy);

  const [view, setView] = useState<"overview" | "cargo_form" | "match_detail" | "asset_form">("overview");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null); // entity id or "new_..."

  const [storageStatus, setStorageStatus] = useState<"LOADING" | "ERROR" | "READY" | "LEGACY" | "CORRUPT">("LOADING");
  const [storageErrorMsg, setStorageErrorMsg] = useState("");
  const isVolatileRef = useRef(false);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = new Date();
      setNow(current);
      setState(previous => {
        if (!previous) return previous;
        const next = structuredClone(previous);
        buildWorldMatches(next, current);
        return next;
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const loaded = loadWorldState();
    if (loaded.status === "UNAVAILABLE") {
      setStorageStatus("ERROR");
      setStorageErrorMsg(loaded.error);
      isVolatileRef.current = true;
    } else if (loaded.status === "LEGACY" || loaded.status === "CORRUPT") {
      setStorageStatus(loaded.status);
      setStorageErrorMsg(loaded.status === "CORRUPT" ? loaded.error : "Verouderde opslag");
    } else if (loaded.status === "EMPTY") {
      const fresh = createDemo(personaId as WorldPersonaId);
      buildWorldMatches(fresh, new Date());
      const s = saveWorldState(fresh);
      if (!s.ok) isVolatileRef.current = true;
      setState(fresh);
      setStorageStatus("READY");
    } else if (loaded.status === "LOADED") {
      // One time matches rebuild on load
      const st = loaded.state;
      const chosen = initialPersonaId || st.activePersonaId || WORLD_PERSONAS.andy;
      const validPersona = st.users.some(user => user.id === chosen) ? chosen : WORLD_PERSONAS.andy;
      st.activePersonaId = validPersona;
      setPersonaId(validPersona);
      buildWorldMatches(st, now);
      const saved = saveWorldState(st);
      if (!saved.ok) isVolatileRef.current = true;
      setState(st);
      setStorageStatus("READY");
    }
  }, [personaId, now]);

  const updateState = useCallback((newState: WorldState) => {
    // Fresh matching recomputed after every mutation
    buildWorldMatches(newState, new Date());
    
    if (!isVolatileRef.current) {
      const res = saveWorldState(newState);
      if (!res.ok) {
        isVolatileRef.current = true;
        setStorageErrorMsg("Opslaan is mislukt. Je wijzigingen blijven tijdelijk in dit tabblad, maar gaan verloren bij vernieuwen.");
      }
    }
    setState({ ...newState }); // clone reference
  }, []);

  const handleResetStorage = (choice: "RESET_LEGACY" | "RESET_CORRUPT") => {
    if (window.confirm("Weet je zeker dat je alle lokale demo data wilt verwijderen en opnieuw wilt beginnen?")) {
      const reset = resetWorldStorage(choice);
      if (!reset.ok) {
        setStorageErrorMsg("De oude opslag kon niet worden gewist. Sluit de demo of sta browseropslag toe en probeer opnieuw.");
        return;
      }
      const fresh = createDemo(personaId as WorldPersonaId);
      isVolatileRef.current = false;
      updateState(fresh);
      setView("overview");
      setSelectedEntityId(null);
      setStorageStatus("READY");
    }
  };

  const handleResetDemo = () => {
    if (window.confirm("Weet je zeker dat je de demo wilt resetten? Alle huidige fictieve data gaat verloren.")) {
      const fresh = createDemo(personaId as WorldPersonaId);
      updateState(fresh);
      setView("overview");
      setSelectedEntityId(null);
    }
  };

  const handlePersonaSwitch = (newPersonaId: string) => {
    if (!state?.users.some(user => user.id === newPersonaId)) return;
    setPersonaId(newPersonaId);
    updateState({ ...structuredClone(state), activePersonaId: newPersonaId });
    // clear details on switch
    setView("overview");
    setSelectedEntityId(null);
  };

  if (storageStatus === "LOADING") return <div className="p-8 text-center">Laden...</div>;

  if (storageStatus === "ERROR") {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-4 h-screen flex flex-col justify-center">
        <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
        <h2 className="text-xl font-bold">Lokale Opslag Fout</h2>
        <p className="text-muted-foreground text-sm">
          {storageErrorMsg || "Er kon niet naar de lokale opslag geschreven worden."}
        </p>
        <p className="text-xs text-muted-foreground">Je bevindt je in een omgeving zonder permanente opslag (bijv. incognito). Data wordt niet bewaard na herladen.</p>
        <div className="flex gap-4 justify-center mt-4">
          <Button onClick={() => {
            const fresh = createDemo(personaId as WorldPersonaId);
             buildWorldMatches(fresh, new Date());
            setState(fresh);
            setStorageStatus("READY");
          }}>Doorgaan zonder opslag</Button>
          <Button onClick={onExit} variant="outline">Demo afsluiten</Button>
        </div>
      </div>
    );
  }

  if (storageStatus === "LEGACY" || storageStatus === "CORRUPT") {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-4 h-screen flex flex-col justify-center">
        <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
        <h2 className="text-xl font-bold">Opslag conflict</h2>
        <p className="text-muted-foreground text-sm">
          {storageStatus === "LEGACY" ? "Er is een oudere Andy-demo gevonden. Deze gegevens worden niet automatisch overgenomen." : "De opgeslagen demo is beschadigd of onvolledig."} Alleen na jouw bevestiging worden deze fictieve oefengegevens vervangen.
          {storageErrorMsg && <span className="block mt-2">{storageErrorMsg}</span>}
        </p>
        <div className="flex gap-4 justify-center">
          <Button onClick={() => handleResetStorage(storageStatus === "LEGACY" ? "RESET_LEGACY" : "RESET_CORRUPT")} variant="destructive">Reset Opslag</Button>
          <Button onClick={onExit} variant="outline">Annuleren</Button>
        </div>
      </div>
    );
  }

  if (!state) return null;

  const activeUser = state.users.find(u => u.id === personaId);
  const activeCompany = activeUser ? state.companies.find(c => c.id === activeUser.companyId) : null;
  const permissions = worldPermissions(state, personaId);

  return (
    <DemoErrorBoundary onReset={handleResetDemo} onExit={onExit}>
      <div className="min-h-[100dvh] bg-muted/20 flex flex-col font-sans text-foreground">
        {/* Banner exact match required */}
        <div className="bg-amber-100 dark:bg-amber-900/40 border-b border-amber-200 dark:border-amber-800 p-3 flex flex-col md:flex-row items-center justify-between gap-4 sticky top-0 z-50">
          <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 text-sm font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Demo — alleen fictieve gegevens in deze browser</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <div className="flex items-center gap-2 mr-4 bg-background/50 rounded-md px-2 py-1">
              <span className="text-xs text-amber-900/70 dark:text-amber-200/70">Rol:</span>
              <Select aria-label="Wissel demoprofiel" value={personaId} onChange={(e) => handlePersonaSwitch(e.target.value)} className="h-7 text-xs border-none bg-transparent focus:ring-0 max-w-[300px]">
                {state.users.map(u => (
                  <option key={u.id} value={u.id}>{u.name} — {state.companies.find(c => c.id === u.companyId)?.name}</option>
                ))}
              </Select>
            </div>
            {onLoginReal && (
               <Button variant="outline" size="sm" onClick={onLoginReal} className="flex-1 md:flex-none">
                 <LogIn className="w-4 h-4 mr-2" /> Echte app
               </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleResetDemo} className="flex-1 md:flex-none border-amber-300 dark:border-amber-700 bg-transparent hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-900 dark:text-amber-200">
              <RefreshCcw className="w-4 h-4 mr-2" />
              Demo opnieuw beginnen
            </Button>
            <Button variant="outline" size="sm" onClick={onExit} className="flex-1 md:flex-none border-amber-300 dark:border-amber-700 bg-transparent hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-900 dark:text-amber-200">
              <LogOut className="w-4 h-4 mr-2" />
              Afsluiten
            </Button>
          </div>
        </div>
        {isVolatileRef.current && <div role="alert" className="bg-amber-50 border-b p-3 text-sm text-amber-950">Tijdelijke demo zonder opslag. {storageErrorMsg || "Wijzigingen blijven tijdens profielwissels bewaard, maar gaan verloren bij vernieuwen of afsluiten."}</div>}
        <p className="max-w-7xl w-full mx-auto px-6 pt-4 text-sm text-muted-foreground">Fictieve rechtenoefening, geen beveiligingsgrens voor gevoelige gegevens. Afstanden en tijden zijn schattingen, zonder live AIS/GPS. Verbonden zijn is geen boeking of reservering.</p>

        <div className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                    <User className="w-4 h-4" />
                  </div>
                  {activeUser?.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs mb-1 flex items-center gap-1"><Building className="w-3 h-3"/> Bedrijf</div>
                  <div className="font-medium">{activeCompany?.name}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs mb-1">Rol</div>
                  <div className="font-medium">{activeUser?.role}</div>
                </div>
                <div className="pt-2 flex flex-wrap gap-2">
                  {activeCompany?.activities.map(act => (
                    <Badge key={act} variant="secondary" className="text-[10px]">{act}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-2 space-y-1">
                <Button 
                  variant={view === "overview" ? "default" : "ghost"} 
                  className="w-full justify-start"
                  onClick={() => { setView("overview"); setSelectedEntityId(null); }}
                >
                  <MapPin className="w-4 h-4 mr-2" />
                  Mijn Overzicht
                </Button>

                <div className="pt-2 border-t mt-2"></div>

                {permissions.canCreateCargo && (
                  <Button variant="ghost" className="w-full justify-start" onClick={() => { setView("cargo_form"); setSelectedEntityId("new_cargo"); }}>
                    <Plus className="w-4 h-4 mr-2" /> Nieuwe Lading
                  </Button>
                )}
                {permissions.canCreateAsset && (
                  <Button variant="ghost" className="w-full justify-start" onClick={() => { setView("asset_form"); setSelectedEntityId("new_asset"); }}>
                    <Plus className="w-4 h-4 mr-2" /> {activeCompany?.mode === "ROAD" ? "Nieuw voertuig" : "Nieuw schip"}
                  </Button>
                )}
                {permissions.canCreateOffer && (
                  <Button variant="ghost" className="w-full justify-start" onClick={() => { setView("cargo_form"); setSelectedEntityId("new_offer"); }}>
                    <Plus className="w-4 h-4 mr-2" /> Nieuwe Capaciteit
                  </Button>
                )}
                {/* Specifically LINER planner */}
                {activeCompany?.activities.includes("LINER") && permissions.canPublish && (
                  <Button variant="ghost" className="w-full justify-start" onClick={() => { setView("cargo_form"); setSelectedEntityId("new_departure"); }}>
                    <Plus className="w-4 h-4 mr-2" /> Nieuwe Afvaart
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>

          <div key={personaId} className="lg:col-span-3 space-y-6">
            {view === "overview" && (
              <DemoOverview 
                state={state}
                activeUserId={personaId}
                updateState={updateState}
                now={now}
                onEdit={(id, type) => {
                  setSelectedEntityId(id);
                  setView(type === "ASSET" ? "asset_form" : "cargo_form");
                }}
                onViewMatches={(id) => {
                  setSelectedEntityId(id);
                  setView("match_detail");
                }}
              />
            )}

            {view === "cargo_form" && (
              <DemoCargoForm 
                key={selectedEntityId}
                state={state}
                actorId={personaId}
                entityId={selectedEntityId || undefined}
                updateState={updateState}
                onCancel={() => setView("overview")}
                now={now}
              />
            )}

            {view === "asset_form" && (
              <DemoCargoForm
                key={selectedEntityId}
                state={state}
                actorId={personaId}
                entityId={selectedEntityId || undefined}
                forceType="ASSET"
                updateState={updateState}
                onCancel={() => setView("overview")}
                now={now}
              />
            )}

            {view === "match_detail" && selectedEntityId && (
              <DemoMatchDetail 
                state={state}
                actorId={personaId}
                entityId={selectedEntityId}
                updateState={updateState}
                onBack={() => setView("overview")}
                now={now}
              />
            )}
          </div>
        </div>
      </div>
    </DemoErrorBoundary>
  );
}
