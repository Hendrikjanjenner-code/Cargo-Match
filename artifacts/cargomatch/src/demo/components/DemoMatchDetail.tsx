import React, { useState } from "react";
import { format, parseISO } from "date-fns";
import { 
  Button, Card, CardHeader, CardTitle, CardContent, 
  Badge, Input 
} from "@/components/ui/primitives";
import { 
  Ship, Info, MapPin, Scale, MessageSquare, Check, X 
} from "lucide-react";
import { evaluateDemo, type DemoCargo, type DemoState, type DemoEvaluation, type DemoExclusion, type DemoMatch } from "../model";

function getDistanceBand(distanceKm?: number): string {
  if (distanceKm === undefined) return "Onbekend";
  if (distanceKm <= 25) return "0–25 km";
  if (distanceKm <= 75) return "25–75 km";
  if (distanceKm <= 150) return "75–150 km";
  return "> 150 km";
}

export function DemoMatchDetail({ 
  cargo, state, selectedShipId, onSelectShip, onBack, 
  onSendInterest, onSimulateConsent, onSendMessage
}: { 
  cargo: DemoCargo, state: DemoState, selectedShipId: string | null,
  onSelectShip: (id: string | null) => void,
  onBack: () => void, 
  onSendInterest: (shipId: string) => void,
  onSimulateConsent: (shipId: string) => void,
  onSendMessage: (shipId: string, text: string) => void
}) {
  const report = evaluateDemo(state, cargo.id);
  const [activeTab, setActiveTab] = useState<"suitable" | "explanation">("suitable");
  const [messageInput, setMessageInput] = useState("");

  if (!report) return null;

  if (selectedShipId) {
    const ship = state.ships.find(s => s.id === selectedShipId);
    if (!ship) return null;
    
    // Check if interest sent
    const interest = state.interests.find(i => i.cargoId === cargo.id && i.capacityOfferId === ship.capacityOfferId);
    // Check if consent granted via connections
    const connection = state.connections.find(c => c.cargoId === cargo.id && c.capacityOfferId === ship.capacityOfferId);
    const hasConsent = !!connection;

    // Messages
    const messages = state.messages.filter(m => m.cargoId === cargo.id && m.capacityOfferId === ship.capacityOfferId);

    // Derived match data for distance/score (only if suitable)
    const matchItem = report.matches.find(m => m.shipId === ship.id);

    return (
      <Card>
        <CardHeader className="flex flex-row items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => onSelectShip(null)}>
            ← Terug
          </Button>
          <CardTitle className="m-0 flex-1">
            {hasConsent ? ship.realName : "Anonieme Vervoerder"}
          </CardTitle>
          {hasConsent && (
            <Badge className="bg-green-500 text-white">Gesimuleerd akkoord</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Locatie</div>
              <div className="font-medium">
                {hasConsent ? `${ship.location} (${getDistanceBand(matchItem?.score.distanceKm)})` : `Regio ${ship.homeRegion} (${getDistanceBand(matchItem?.score.distanceKm)})`}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Type</div>
              <div className="font-medium">{ship.shipType || ship.vesselType}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Capaciteit</div>
              <div className="font-medium">
                {hasConsent ? `${ship.availableCapacity || ship.totalCapacityTonnes}t vrij` : "Geschikt"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Status</div>
              <div className="font-medium">
                {hasConsent ? (ship.status || ship.loadStage) : "Beschikbaar"}
              </div>
            </div>
          </div>

          {!hasConsent ? (
            <div className="bg-muted p-6 rounded-lg text-center space-y-4">
              <Ship className="w-12 h-12 text-muted-foreground mx-auto" />
              <div>
                <h3 className="font-semibold mb-2">Interesse tonen</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
                  Stuur een interessebericht naar deze vervoerder. Identiteiten blijven anoniem tot er wederzijds akkoord is.
                </p>
                <div className="flex justify-center gap-3">
                  <Button 
                    variant={interest ? "outline" : "default"} 
                    onClick={() => !interest && onSendInterest(ship.id)}
                    disabled={!!interest || !matchItem}
                  >
                    {interest ? "Interesse verstuurd" : "Verstuur interesse"}
                  </Button>
                  
                  {interest?.status === "PENDING" && !hasConsent && matchItem && (
                    <Button onClick={() => onSimulateConsent(ship.id)} className="bg-blue-600 hover:bg-blue-700 text-white">
                      Simuleer akkoord vervoerder
                    </Button>
                  )}
                </div>
                {!matchItem && <p role="alert" className="text-sm text-destructive mt-3">Deze optie is niet meer geschikt. Ga terug naar de matches of begin de demo opnieuw.</p>}
                {interest && !hasConsent && (
                  <p className="text-xs text-muted-foreground mt-4">
                    (In deze demo resulteert 'Gesimuleerd akkoord' direct in fictieve goedkeuring. Geen echt bericht wordt verstuurd.)
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Berichten
              </h3>
              <div className="bg-muted p-4 rounded-lg space-y-4 h-64 overflow-y-auto">
                {messages.map(m => (
                  <div key={m.id} className={`flex flex-col gap-1 ${m.sender === "andy" ? "items-start" : "items-end"}`}>
                    <div className={`${m.sender === "andy" ? "bg-background border" : "bg-primary text-primary-foreground"} rounded-lg px-3 py-2 text-sm max-w-[80%]`}>
                      {m.body}
                    </div>
                    <span className="text-xs text-muted-foreground mx-1">
                      {m.sender === "andy" ? "U" : ship.realName} - {new Date(m.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input 
                  placeholder="Typ een bericht..." 
                  value={messageInput}
                  onChange={e => setMessageInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && messageInput.trim()) {
                      onSendMessage(ship.id, messageInput.trim());
                      setMessageInput("");
                    }
                  }}
                />
                <Button onClick={() => {
                  if (messageInput.trim()) {
                    onSendMessage(ship.id, messageInput.trim());
                    setMessageInput("");
                  }
                }}>Verstuur</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>← Terug</Button>
          <h2 className="text-2xl font-semibold tracking-tight">Matches voor {cargo.origin}-{cargo.destination}</h2>
        </div>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 text-xs p-3 rounded-md mb-6 border border-blue-100 dark:border-blue-800 flex gap-2 items-start">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <p>Disclaimer: Deze weergave toont indicatieve afstandsbanden, geen live scheepsposities, actuele beschikbaarheid of bewezen vaartijd/afstand. Dit is uitsluitend een gesimuleerde demonstratie.</p>
      </div>

      <div className="flex border-b border-border mb-4">
        <button 
          className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === "suitable" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
          onClick={() => setActiveTab("suitable")}
        >
          Geschikte Schepen ({report.matches.length})
        </button>
        <button 
          className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === "explanation" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
          onClick={() => setActiveTab("explanation")}
        >
          Demo Uitlegpaneel
        </button>
      </div>

      {activeTab === "suitable" && (
        <div className="grid gap-4">
          {report.matches.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                Geen geschikte schepen gevonden voor deze criteria.
              </CardContent>
            </Card>
          ) : (
            report.matches.map(match => {
              const ship = state.ships.find(s => s.id === match.shipId);
              if (!ship) return null;
              
              const connection = state.connections.find(c => c.cargoId === cargo.id && c.capacityOfferId === ship.capacityOfferId);
              const hasConsent = !!connection;
              const interest = state.interests.find(i => i.cargoId === cargo.id && i.capacityOfferId === ship.capacityOfferId);
              
              return (
                <Card key={ship.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => onSelectShip(ship.id)}>
                  <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <div className="font-semibold text-lg flex items-center gap-2">
                        {hasConsent ? ship.realName : "Anonieme Vervoerder"}
                        {hasConsent && <Badge className="bg-green-500 text-white h-5">Gesimuleerd akkoord</Badge>}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1 items-center">
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3"/> {hasConsent ? `${ship.location} (${getDistanceBand(match.score.distanceKm)})` : `Regio ${ship.homeRegion} (${getDistanceBand(match.score.distanceKm)})`}</span>
                        <span className="flex items-center gap-1"><Scale className="w-3 h-3"/> {hasConsent ? `${ship.availableCapacity}t vrij` : "Capaciteit geschikt"}</span>
                        <span>Score: {Math.round(match.totalScore)}</span>
                      </div>
                    </div>
                    <Button variant="outline" size="sm">
                      {hasConsent ? "Bekijk details" : (interest ? "Interesse getoond" : "Toon interesse")}
                    </Button>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {activeTab === "explanation" && (
        <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-900/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-blue-800 dark:text-blue-300">
              <Info className="w-5 h-5" />
              Fictief Uitlegpaneel (Alleen zichtbaar in deze demo)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-6">
              Dit paneel toont hoe het matchingalgoritme de 6 test-schepen beoordeelt ten opzichte van de gevraagde vracht van {cargo.weightTonnes || cargo.weight} ton. In de echte applicatie ziet de gebruiker alleen de uiteindelijke geschikte matches en geen namen of afwijzingsredenen van ongeschikte schepen.
            </p>
            <div className="space-y-4">
              {report.results.map(item => {
                const ship = state.ships.find(s => s.id === item.shipId);
                const offer = state.capacityOffers.find(o => o.vesselId === ship?.id);
                if (!ship || !offer) return null;
                const isSuitable = item.eligible;
                
                return (
                  <div key={ship.id} className="flex flex-col sm:flex-row justify-between gap-4 p-4 border rounded-lg bg-background">
                    <div className="space-y-1 flex-1">
                      <div className="font-medium">{ship.realName} <span className="text-muted-foreground font-normal">({ship.location})</span></div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        <div>{ship.totalCapacityTonnes || ship.totalCapacity}t totaal, {ship.availableCapacity}t vrij • {ship.shipType || ship.vesselType} • {ship.status || ship.loadStage}</div>
                        <div className="text-xs">Regio: {ship.homeRegion} • Max pos: {offer.maximumPositioningDistanceKm} km</div>
                        <div className="text-xs">Beschikbaar: {format(parseISO(offer.availableFrom), "dd-MM-yyyy")} - {format(parseISO(offer.availableUntil), "dd-MM-yyyy")}</div>
                        <div className="text-xs">Geschikt voor: {offer.cargoCompatibility.join(", ")}</div>
                      </div>
                    </div>
                    <div className="flex-1">
                      {isSuitable ? (
                        <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-medium text-sm">
                          <Check className="w-4 h-4" /> Geschikt ({getDistanceBand((item as DemoMatch).score.distanceKm)}, score {Math.round((item as DemoMatch).totalScore)})
                        </div>
                      ) : (
                        <div className="flex items-start gap-2 text-destructive font-medium text-sm">
                          <X className="w-4 h-4 mt-0.5" /> 
                          <div>
                            Ongeschikt
                            <div className="text-xs text-destructive/80 font-normal mt-0.5">{(item as DemoExclusion).reason}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
