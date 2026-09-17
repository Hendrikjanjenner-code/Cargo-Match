import React, { useState } from "react";
import { Button, Card, CardHeader, CardTitle, CardContent, Badge, Input } from "@/components/ui/primitives";
import { Ship, Info, MapPin, Scale, MessageSquare, Check, X, ArrowRight, User } from "lucide-react";
import { type WorldState, type WorldMatch, consent, sendWorldMessage, listWorldMessages, worldPermissions, projectWorldListing, evaluateWorldOffer, evaluateWorldDeparture } from "../world";

interface Props {
  state: WorldState;
  actorId: string;
  entityId: string;
  updateState: (s: WorldState) => void;
  onBack: () => void;
  now: Date;
}

export function DemoMatchDetail({ state, actorId, entityId, updateState, onBack, now }: Props) {
  const actor = state.users.find(u => u.id === actorId);
  const companyId = actor?.companyId;

  const cargo = state.cargos.find(c => c.id === entityId);
  const offer = state.offers.find(o => o.id === entityId);
  const departure = state.departures.find(d => d.id === entityId);
  const entity = cargo || offer || departure;

  const matches = state.matches.filter(m =>
    (m.cargoId === entityId || m.offerId === entityId || m.departureId === entityId)
    && (m.leftCompanyId === companyId || m.rightCompanyId === companyId)
  ).sort((a,b) => b.score - a.score);

  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [error, setError] = useState("");

  if (!entity || entity.companyId !== companyId || !worldPermissions(state, actorId).canConsent) return <p>Geen toegang tot deze commerciële gegevens.</p>;

  const handleAction = (matchId: string, action: "INTEREST" | "ACCEPT" | "REJECT" | "WITHDRAW") => {
    setError("");
    const next = structuredClone(state);
    const res = consent(next, actorId, matchId, action, new Date());
    if (!res.ok) setError(res.message);
    updateState(next);
  };

  const handleSendMsg = (matchId: string) => {
    setError("");
    if (!messageInput.trim()) return;
    const next = structuredClone(state);
    const res = sendWorldMessage(next, actorId, matchId, messageInput, new Date());
    if (!res.ok) setError(res.message);
    else {
      updateState(next);
      setMessageInput("");
    }
  };

  const getCounterpartyName = (m: WorldMatch) => {
    const isLeft = m.leftCompanyId === companyId;
    const otherCompanyId = isLeft ? m.rightCompanyId : m.leftCompanyId;
    
    // In CargoMatch, you don't know the exact name until CONNECTED
    if (m.status !== "CONNECTED") return "Anonieme Partij";
    const otherCompany = state.companies.find(c => c.id === otherCompanyId);
    return otherCompany?.name || "Anoniem";
  };

  if (selectedMatchId) {
    const m = matches.find(x => x.id === selectedMatchId);
    if (!m) return <Button variant="outline" onClick={() => setSelectedMatchId(null)}>Terug naar matches</Button>;

    const isLeft = m.leftCompanyId === companyId;
    const myConsent = isLeft ? m.leftConsent : m.rightConsent;
    const theirConsent = isLeft ? m.rightConsent : m.leftConsent;

    const msgs = listWorldMessages(state, actorId, m.id).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
    const matchedCargo = state.cargos.find(item => item.id === m.cargoId);
    const matchedOffer = state.offers.find(item => item.id === m.offerId);
    const matchedDeparture = state.departures.find(item => item.id === m.departureId);
    const evaluation = matchedCargo && (matchedOffer ? evaluateWorldOffer(matchedCargo, matchedOffer, state, now) : matchedDeparture ? evaluateWorldDeparture(matchedCargo, matchedDeparture, state, now) : undefined);
    const otherId = isLeft ? (m.offerId || m.departureId) : m.cargoId;
    const projection = otherId ? projectWorldListing(state, isLeft ? (m.offerId ? "OFFER" : "DEPARTURE") : "CARGO", otherId, actorId, now) : undefined;

    return (
      <Card>
        <CardHeader className="flex flex-row items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedMatchId(null); setError(""); }}>
            ← Terug
          </Button>
          <CardTitle className="m-0 flex-1">
            {getCounterpartyName(m)}
          </CardTitle>
          <Badge variant="outline">Match Status: {m.status}</Badge>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md">{error}</div>}
          <p className="text-sm text-muted-foreground">Wederzijds akkoord geeft alleen toestemming voor contact. Er wordt niets geboekt of gereserveerd.</p>
          {projection && <div className="rounded-lg border p-4 text-sm space-y-1">
            <p>{projection.origin} → {projection.destination}</p>
            <p>{projection.timeBand} · {projection.capacityBand}</p>
            <p>{projection.anonymous ? "Anonieme ontdekking — exacte details blijven verborgen." : "Verbonden gegevens — alleen voor deze twee partijen."}</p>
          </div>}
          {m.status === "CONNECTED" && matchedCargo && <div className="rounded-lg bg-muted p-4 text-sm space-y-2">
            <p className="font-semibold">{matchedCargo.name}: {matchedCargo.origin.name} → {matchedCargo.destination.name}</p>
            <p>{matchedCargo.weightTonnes} ton · {matchedCargo.cargoType} · {new Date(matchedCargo.readyFrom).toLocaleString("nl-NL")} – {new Date(matchedCargo.readyUntil).toLocaleString("nl-NL")}</p>
            {matchedOffer && <p>{state.assets.find(a => a.id === matchedOffer.assetId)?.name} · {matchedOffer.capacityTonnes} ton aangeboden bij {matchedOffer.location.name}</p>}
            {matchedDeparture && <p>{matchedDeparture.serviceName} · vertrek {new Date(matchedDeparture.departureAt).toLocaleString("nl-NL")} · cutoff {new Date(matchedDeparture.cargoCutoffAt).toLocaleString("nl-NL")}</p>}
            <p>Fictief contact: {state.users.find(u => u.companyId === (isLeft ? m.rightCompanyId : m.leftCompanyId) && u.role !== "DRIVER")?.id}@example.com</p>
            {!evaluation?.eligible && <p className="text-amber-800">Het aanbod is gewijzigd of niet meer passend. Het gesprek blijft beschikbaar; bespreek de actuele situatie.</p>}
          </div>}
          {m.status !== "CONNECTED" && !evaluation?.eligible && <p role="status" className="text-sm text-destructive">Deze combinatie is niet meer passend. Toestemming is geblokkeerd.</p>}
          {m.status === "STALE" && evaluation?.eligible && <p role="status" className="text-sm text-green-800">Deze combinatie is opnieuw passend. Stuur opnieuw interesse; eerder gegeven toestemming wordt niet hergebruikt.</p>}

          <div className="bg-muted p-4 rounded-lg flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="text-sm space-y-1">
              <div><strong>Mijn intentie:</strong> {myConsent || "Geen"}</div>
              <div><strong>Hun intentie:</strong> {theirConsent || "Geen"}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {(m.status === "NEW" || m.status === "STALE") && evaluation?.eligible && (
                <Button size="sm" onClick={() => handleAction(m.id, "INTEREST")}>Toon Interesse</Button>
              )}
              {m.status === "INTEREST_SENT" && myConsent === "PENDING" && (
                <Button size="sm" variant="outline" onClick={() => handleAction(m.id, "WITHDRAW")}>Interesse Intrekken</Button>
              )}
              {m.status === "INTEREST_SENT" && theirConsent === "PENDING" && !myConsent && (
                <>
                  <Button disabled={!evaluation?.eligible} size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleAction(m.id, "ACCEPT")}>Accepteer</Button>
                  <Button size="sm" variant="destructive" onClick={() => handleAction(m.id, "REJECT")}>Wijs af</Button>
                </>
              )}
            </div>
          </div>

          {m.status === "CONNECTED" && (
            <div className="border rounded-lg flex flex-col h-[400px]">
              <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-muted/20">
                {msgs.length === 0 && (
                  <div className="text-center text-muted-foreground text-sm py-8">
                    Jullie zijn verbonden! Start het gesprek.
                  </div>
                )}
                {msgs.map(msg => {
                  const isMe = msg.senderCompanyId === companyId;
                  const senderUser = state.users.find(u => u.id === msg.senderUserId)?.name || (isMe ? actor?.name : getCounterpartyName(m));
                  return (
                    <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                      <div className="text-[10px] text-muted-foreground mb-1">{senderUser} • {msg.createdAt.slice(11,16)}</div>
                      <div className={`px-4 py-2 rounded-lg max-w-[80%] text-sm ${isMe ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                        {msg.body}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="p-3 border-t bg-background flex gap-2">
                <Input 
                  aria-label="Bericht"
                  value={messageInput}
                  onChange={e => setMessageInput(e.target.value)}
                  placeholder="Typ een bericht..."
                  onKeyDown={e => e.key === "Enter" && handleSendMsg(m.id)}
                />
                <Button onClick={() => handleSendMsg(m.id)}>Zend</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Terug
        </Button>
        <h2 className="text-2xl font-semibold tracking-tight">Matches</h2>
      </div>

      <div className="grid gap-4">
        {matches.map(match => {
          const cName = getCounterpartyName(match);
          return (
            <Card key={match.id} className="hover:border-primary/50 transition-colors cursor-pointer" onClick={() => setSelectedMatchId(match.id)}>
              <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-lg">{cName}</div>
                  <div className="text-sm text-muted-foreground">Score: {Math.round(match.score)} • Status: {match.status}</div>
                </div>
                <div className="flex items-center gap-4">
                  {match.status === "INTEREST_SENT" && match.leftCompanyId !== companyId && match.leftConsent === "PENDING" && <Badge variant="secondary">Heeft interesse</Badge>}
                  {match.status === "INTEREST_SENT" && match.rightCompanyId !== companyId && match.rightConsent === "PENDING" && <Badge variant="secondary">Heeft interesse</Badge>}
                  {match.status === "CONNECTED" && <Badge className="bg-green-500">Verbonden</Badge>}
                  <Button size="sm" variant="outline">Details & Acties</Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {matches.length === 0 && (
          <div className="p-8 text-center text-muted-foreground border rounded-lg bg-card">
            Geen matches gevonden voor dit item.
          </div>
        )}
      </div>
    </div>
  );
}
