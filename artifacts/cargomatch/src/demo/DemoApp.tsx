import React, { useState, useEffect } from "react";
import { 
  Button, Card, CardHeader, CardTitle, CardContent, Badge 
} from "@/components/ui/primitives";
import { AlertTriangle, LogOut, RefreshCcw, MapPin } from "lucide-react";
import { 
  getInitialDemoState, loadDemoState, saveDemoState, clearDemoState, evaluateDemo,
  type DemoCargo, type DemoState 
} from "./model";

import { DemoOverview } from "./components/DemoOverview";
import { DemoCargoForm } from "./components/DemoCargoForm";
import { DemoMatchDetail } from "./components/DemoMatchDetail";

interface DemoAppProps {
  onExit: () => void;
}

class DemoErrorBoundary extends React.Component<{ onReset: () => void, onExit: () => void, children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { onReset: () => void, onExit: () => void, children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 max-w-md mx-auto text-center space-y-4 h-screen flex flex-col justify-center">
          <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold">Demo status gecorrumpeerd</h2>
          <p className="text-muted-foreground text-sm">
            Er is een fout opgetreden bij het lezen of schrijven van de lokale demo data (bijv. quota bereikt of onverwachte datastructuur).
          </p>
          <div className="flex gap-4 justify-center">
            <Button onClick={() => {
              this.setState({ hasError: false });
              this.props.onReset();
            }} variant="outline">Reset Demo</Button>
            <Button onClick={this.props.onExit}>Demo afsluiten</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function DemoApp({ onExit }: DemoAppProps) {
  const [state, setState] = useState<DemoState | null>(null);
  const [view, setView] = useState<"overview" | "cargo_form" | "match_detail">("overview");
  const [selectedCargo, setSelectedCargo] = useState<DemoCargo | null>(null);
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [now, setNow] = useState(new Date());

  // Clock for periodic re-evaluations
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Load state from local storage or init
  useEffect(() => {
    try {
      const saved = loadDemoState();
      if (saved) {
        setState(saved);
      } else {
        const fresh = getInitialDemoState();
        saveDemoState(fresh);
        setState(fresh);
      }
    } catch (err) {
      setStorageError(true);
    }
  }, []);

  const hasExpiredData = state?.cargos.some(c => c.loadingUntil && new Date(c.loadingUntil) < now) || 
                         state?.capacityOffers.some(o => o.availableUntil && new Date(o.availableUntil) < now);

  const handleReset = () => {
    try {
      const fresh = getInitialDemoState();
      saveDemoState(fresh);
      setState(fresh);
      setView("overview");
      setSelectedCargo(null);
      setSelectedShipId(null);
      setStorageError(false);
    } catch (err) {
      setStorageError(true);
    }
  };

  const updateState = (newState: DemoState) => {
    try {
      saveDemoState(newState);
      setState(newState);
    } catch (err) {
      setStorageError(true);
    }
  };

  const handleSaveCargo = (cargo: DemoCargo) => {
    if (!state) return;
    const isNew = !state.cargos.find(c => c.id === cargo.id);
    const newCargos = isNew 
      ? [...state.cargos, cargo]
      : state.cargos.map(c => c.id === cargo.id ? cargo : c);
    
    // Clear matches for this cargo so they are recomputed
    const newMatches = { ...state.matches };
    delete newMatches[cargo.id];

    updateState({ ...state, cargos: newCargos, matches: newMatches });
    setView("overview");
  };

  const handleSendInterest = (cargoId: string, shipId: string) => {
    if (!state) return;
    const ship = state.ships.find(s => s.id === shipId);
    if (!ship) return;

    // Check idempotency
    if (state.interests.some(i => i.cargoId === cargoId && i.capacityOfferId === ship.capacityOfferId)) {
      return;
    }

    // Re-evaluate eligibility
    const report = evaluateDemo(state, cargoId);
    if (!report.matches.some(m => m.shipId === shipId)) {
      return; // Not eligible
    }
    
    const newInterest = {
      id: `int-${Date.now()}`,
      cargoId,
      capacityOfferId: ship.capacityOfferId,
      status: "PENDING" as const,
      createdAt: now.toISOString(),
    };

    updateState({ ...state, interests: [...state.interests, newInterest] });
  };

  const handleSimulateConsent = (cargoId: string, shipId: string) => {
    if (!state) return;
    const ship = state.ships.find(s => s.id === shipId);
    if (!ship) return;
    
    // Validate prerequisites
    const interest = state.interests.find(i => i.cargoId === cargoId && i.capacityOfferId === ship.capacityOfferId);
    if (!interest || interest.status !== "PENDING") return;

    if (state.connections.some(c => c.cargoId === cargoId && c.capacityOfferId === ship.capacityOfferId)) {
      return; // Already connected
    }

    // Re-evaluate eligibility
    const report = evaluateDemo(state, cargoId);
    if (!report.matches.some(m => m.shipId === shipId)) {
      return; // Not eligible anymore
    }

    const newConnection = {
      id: `conn-${Date.now()}`,
      cargoId,
      capacityOfferId: ship.capacityOfferId,
      status: "CONNECTED" as const,
      createdAt: now.toISOString(),
      connectedAt: now.toISOString(),
    };

    // Auto-generate acceptance message
    const autoMessage = {
      id: `msg-${Date.now()}`,
      connectionId: newConnection.id,
      cargoId,
      capacityOfferId: ship.capacityOfferId,
      sender: "carrier" as const,
      body: `(Gesimuleerd) Akkoord, wij hebben ruimte beschikbaar op de ${ship.realName}. Laten we de details bespreken.`,
      createdAt: now.toISOString(),
    };

    updateState({
      ...state,
      interests: state.interests.map(item => item.id === interest.id ? { ...item, status: "ACCEPTED" as const } : item),
      connections: [...state.connections, newConnection],
      messages: [...state.messages, autoMessage]
    });
  };

  const handleSendMessage = (cargoId: string, shipId: string, text: string) => {
    if (!state) return;
    if (!text.trim()) return;

    const ship = state.ships.find(s => s.id === shipId);
    if (!ship) return;
    const connection = state.connections.find(c => c.cargoId === cargoId && c.capacityOfferId === ship.capacityOfferId);
    if (!connection) return; // Must have connection
    
    const newMessage = {
      id: `msg-${Date.now()}`,
      connectionId: connection.id,
      cargoId,
      capacityOfferId: ship.capacityOfferId,
      sender: "andy" as const,
      body: text.trim(),
      createdAt: now.toISOString(),
    };

    updateState({ ...state, messages: [...state.messages, newMessage] });
  };

  const handleExit = () => {
    try {
      clearDemoState();
    } catch {
      // Storage may have become unavailable; never trap someone in demo mode.
    } finally {
      onExit();
    }
  };

  if (storageError) {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-4 h-screen flex flex-col justify-center">
        <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
        <h2 className="text-xl font-bold">Lokale Opslag Fout</h2>
        <p className="text-muted-foreground text-sm">
          Er kon niet naar de lokale opslag geschreven worden (quota overschreden of privacy instellingen).
        </p>
        <div className="flex gap-4 justify-center">
          <Button onClick={handleReset} variant="outline">Forceer Reset</Button>
          <Button onClick={handleExit}>Demo afsluiten</Button>
        </div>
      </div>
    );
  }

  if (!state) return <div className="p-8 text-center">Laden...</div>;

  return (
    <DemoErrorBoundary onReset={handleReset} onExit={handleExit}>
      <div className="min-h-[100dvh] bg-muted/20 flex flex-col font-sans text-foreground">
        {/* Demo Banner */}
        <div className="bg-amber-100 dark:bg-amber-900/40 border-b border-amber-200 dark:border-amber-800 p-3 flex flex-col sm:flex-row items-center justify-between gap-4 sticky top-0 z-50">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 text-amber-900 dark:text-amber-200 text-sm font-medium">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span>Demonstratie — fictieve gegevens. Deze data is lokaal.</span>
            </div>
            {hasExpiredData && (
              <span className="text-destructive font-bold ml-0 sm:ml-4 flex items-center gap-1">
                Data verouderd! <button className="p-0 h-auto text-destructive underline hover:text-destructive/80 hover:bg-transparent" onClick={handleReset}>Reset demo</button>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button variant="outline" size="sm" onClick={handleReset} className="flex-1 sm:flex-none border-amber-300 dark:border-amber-700 bg-transparent hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-900 dark:text-amber-200">
              <RefreshCcw className="w-4 h-4 mr-2" />
              Demo opnieuw beginnen
            </Button>
            <Button variant="outline" size="sm" onClick={handleExit} className="flex-1 sm:flex-none border-amber-300 dark:border-amber-700 bg-transparent hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-900 dark:text-amber-200">
              <LogOut className="w-4 h-4 mr-2" />
              Demo afsluiten
            </Button>
          </div>
        </div>

        <div className="flex-1 max-w-6xl mx-auto w-full p-4 md:p-6 grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Sidebar Profile */}
          <div className="md:col-span-1 space-y-6">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                    AK
                  </div>
                  Andy Kers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs mb-1">Rol</div>
                  <div className="font-medium">Transportorganisator / charteraar</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs mb-1">Bedrijf</div>
                  <div className="font-medium">Demo Transportplanning</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs mb-1">Activiteit</div>
                  <Badge variant="secondary">CHARTERER</Badge>
                </div>
              </CardContent>
            </Card>

            {/* Navigation for mobile/desktop */}
            <Card>
              <CardContent className="p-2">
                <Button 
                  variant={view === "overview" ? "default" : "ghost"} 
                  className="w-full justify-start"
                  onClick={() => { setView("overview"); setSelectedCargo(null); }}
                >
                  <MapPin className="w-4 h-4 mr-2" />
                  Mijn Ladingen
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <div className="md:col-span-3 space-y-6">
            {view === "overview" && (
              <DemoOverview 
                state={state}
                onCreate={() => {
                  setSelectedCargo(null);
                  setView("cargo_form");
                }}
                onEdit={(cargo) => {
                  setSelectedCargo(cargo);
                  setView("cargo_form");
                }}
                onViewMatches={(cargo) => {
                  setSelectedCargo(cargo);
                  setSelectedShipId(null);
                  setView("match_detail");
                }}
              />
            )}

            {view === "cargo_form" && (
              <DemoCargoForm 
                initialData={selectedCargo || undefined}
                state={state}
                onSave={handleSaveCargo}
                onCancel={() => setView("overview")}
              />
            )}

            {view === "match_detail" && selectedCargo && (
              <DemoMatchDetail 
                cargo={selectedCargo}
                state={state}
                selectedShipId={selectedShipId}
                onSelectShip={setSelectedShipId}
                onBack={() => setView("overview")}
                onSendInterest={(shipId) => handleSendInterest(selectedCargo.id, shipId)}
                onSimulateConsent={(shipId) => handleSimulateConsent(selectedCargo.id, shipId)}
                onSendMessage={(shipId, text) => handleSendMessage(selectedCargo.id, shipId, text)}
              />
            )}
          </div>
        </div>
      </div>
    </DemoErrorBoundary>
  );
}
