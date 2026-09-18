import React, { useState } from "react";
import { useDemo } from "../DemoContext";
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, Input } from "@/components/ui/primitives";
import { ArrowLeft, Send, CalendarClock } from "lucide-react";
import { consentControls } from "../consent-controls";
import { DemoConsentButtons } from "./DemoConsentButtons";

export function DemoMatchDetail({ matchId, onBack }: { matchId: string, onBack: () => void }) {
  const { session, executeAction, busy } = useDemo();
  const { workspace, context } = session!;
  const [msg, setMsg] = useState("");
  const [feedback, setFeedback] = useState("");

  const match = workspace.matches.find(m => m.id === matchId) || workspace.opportunities.find(m => m.id === matchId);

  if (!match) {
    return <div className="p-8 text-center text-slate-500">Match niet gevonden. <Button onClick={onBack}>Terug</Button></div>;
  }

  // Safe consent checking logic per requirement
  const fullMatch = workspace.matches.find(m => m.id === matchId);
  const isConnected = match.status === "CONNECTED";
  const isPending = match.status === "INTEREST_SENT";
  const permissions = context.permissions;
  const controls = consentControls(fullMatch || match, permissions);
  const commercial = controls.interest || controls.accept || controls.decline || controls.waiting;
  const active = !["STALE", "DECLINED"].includes(match.status);
  
  const handleConsent = async (type: "ACCEPT" | "DECLINE" | "INTEREST") => {
    try {
      await executeAction({ type, matchId });
    } catch (err: any) {
      setFeedback(err.message);
    }
  };

  const handleSendToPlanner = async () => {
    try {
      await executeAction({ type: "SEND_TO_PLANNER", matchId, note: "Graag inplannen" });
      setFeedback("Verzoek naar de planner verstuurd. Alleen de planner kan commercieel reageren.");
    } catch (err: any) {
      setFeedback(err.message);
    }
  };

  const handleSend = async () => {
    if (!msg.trim()) return;
    try {
      await executeAction({ type: "MESSAGE", matchId, body: msg });
      setMsg("");
    } catch (err: any) {
      setFeedback(err.message);
    }
  };

  const messages = workspace.messages.filter(m => m.matchId === matchId);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Button variant="ghost" onClick={onBack} className="-ml-4 mb-2">
        <ArrowLeft className="w-4 h-4 mr-2" /> Terug naar overzicht
      </Button>
      {feedback && <p role="status" className="rounded-md border bg-white p-3 text-sm">{feedback}</p>}
      <p className="text-sm text-slate-600">Fictieve, handmatig geschatte kans. Geen live positie of geverifieerde route. CONNECTED is geen boeking of reservering.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="pb-4 bg-slate-50 border-b">
              <div className="flex justify-between items-start">
                <CardTitle>Match Details</CardTitle>
                <Badge variant={isConnected ? "default" : isPending ? "secondary" : "outline"} className={isConnected ? "bg-green-600" : ""}>
                  {match.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="grid grid-cols-2 gap-6 text-sm">
                <div>
                  <div className="text-slate-500 mb-1">Route</div>
                  <div className="font-medium text-base">{match.origin} → {match.destination}</div>
                </div>
                <div>
                  <div className="text-slate-500 mb-1">Modus</div>
                  <div className="font-medium text-base">{match.mode}</div>
                </div>
                <div>
                  <div className="text-slate-500 mb-1">Volume / Gewicht</div>
                  <div className="font-medium text-base">{match.quantity.toLocaleString("nl-NL")} {match.mode === "AIR" ? "kg" : "ton"}</div>
                </div>
                <div>
                  <div className="text-slate-500 mb-1">Match Score</div>
                  <div className="font-medium text-blue-600 text-lg">{Math.round(match.score)}%</div>
                </div>
              </div>

              {!isConnected && active && commercial && (
                <div className="mt-6 pt-6 border-t border-slate-100">
                  <h4 className="font-medium mb-3 text-slate-800">Jouw Reactie</h4>
                  <div className="flex gap-3">
                    <DemoConsentButtons controls={controls} busy={busy} onAction={type => { void handleConsent(type); }} />
                  </div>
                </div>
              )}

              {active && permissions.includes("SEND_TO_PLANNER") && (
                 <div className="mt-6 pt-6 border-t border-slate-100">
                   <h4 className="font-medium mb-3 text-slate-800">Operationele Actie</h4>
                   <p className="text-sm text-slate-600 mb-3">Je deelt deze kans intern met je planner. Dit publiceert geen capaciteit en geeft geen commerciële toestemming.</p>
                   <Button disabled={busy} onClick={() => { void handleSendToPlanner(); }} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                     <CalendarClock className="w-4 h-4 mr-2" /> Naar Planner Sturen
                   </Button>
                 </div>
              )}
            </CardContent>
          </Card>

           {isConnected && permissions.includes("MESSAGE_CONNECTED") && (
            <Card className="shadow-sm">
              <CardHeader className="bg-slate-50 border-b">
                <CardTitle>Gesprek</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="space-y-3 max-h-[300px] overflow-y-auto p-2">
                  {messages.length === 0 && <p className="text-sm text-slate-500 text-center py-4">Nog geen berichten gestuurd.</p>}
                  {messages.map(m => (
                    <div key={m.id} className={`p-3 rounded-lg text-sm max-w-[80%] shadow-sm ${m.senderName === context.user.name ? "bg-blue-100 ml-auto" : "bg-slate-100"}`}>
                      <div className="font-bold text-xs mb-1 text-slate-600">{m.senderName}</div>
                      <div>{m.body}</div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-2 border-t border-slate-100 mt-2">
                  <Input aria-label="Bericht" maxLength={2000} value={msg} onChange={e => setMsg(e.target.value)} placeholder="Typ een bericht..." onKeyDown={e => { if (e.key === "Enter" && !busy) void handleSend(); }} className="bg-slate-50" />
                  <Button aria-label="Bericht versturen" disabled={busy || !msg.trim()} onClick={() => { void handleSend(); }} className="bg-blue-600 hover:bg-blue-700 text-white"><Send className="w-4 h-4" /></Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="md:col-span-1 space-y-6">
           <Card className="shadow-sm">
            <CardHeader className="bg-slate-50 border-b">
              <CardTitle>Tegenpartij</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {isConnected ? (
                <div className="space-y-4 text-sm">
                  <div>
                    <div className="text-slate-500 mb-1">Bedrijf</div>
                    <div className="font-medium text-base">{match.counterpartyName || "Onbekend"}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 mb-1">Contact</div>
                    <div className="font-medium text-base">{match.contact || "Niet opgegeven"}</div>
                  </div>
                  {match.assetName && (
                    <div>
                      <div className="text-slate-500 mb-1">Asset</div>
                      <div className="font-medium text-base">{match.assetName}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-slate-500 italic bg-amber-50 p-4 rounded-md border border-amber-100 flex flex-col gap-2">
                  <span className="font-semibold text-amber-800">Identiteit verborgen</span>
                  Toon eerst wederzijdse interesse om contactgegevens vrij te geven.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
