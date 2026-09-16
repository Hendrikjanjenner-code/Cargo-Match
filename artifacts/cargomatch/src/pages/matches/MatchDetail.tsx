import { useGetMyMatch, useActOnMatch, useListMyConversations, getListMyConversationsQueryKey, getGetMyMatchQueryKey, getListMyMatchesQueryKey, MatchAction, MatchStatus } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardHeader, CardTitle, CardContent, Badge, Button } from "@/components/ui/primitives";
import { ArrowLeft, CheckCircle2, XCircle, Handshake, AlertCircle, MessageSquare } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { t } from "@/lib/i18n";

export default function MatchDetail() {
  const [, params] = useRoute("/matches/:id");
  const [, setLocation] = useLocation();
  const id = params?.id || "";
  
  const queryClient = useQueryClient();
  const { data: match, isLoading, error } = useGetMyMatch(id, {
    query: { enabled: !!id, queryKey: getGetMyMatchQueryKey(id), refetchInterval: 15000 }
  });

  const { data: convData } = useListMyConversations({ pageSize: 100 }, {
    query: { queryKey: getListMyConversationsQueryKey({ pageSize: 100 }), enabled: match?.status === MatchStatus.CONNECTED }
  });
  
  const relatedConversation = convData?.items.find(c => c.matchId === id);
  
  const actOnMatch = useActOnMatch();

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">{t("common.loading")}</div>;
  if (error || !match) return <div className="p-8 text-center text-destructive">{t("error.load_match")}</div>;

  const handleAction = (action: MatchAction) => {
    actOnMatch.mutate({ matchId: id, data: { action } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyMatchQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListMyMatchesQueryKey() });
      }
    });
  };

  const isConnected = match.status === MatchStatus.CONNECTED;
  const canSendInterest = match.status === MatchStatus.NEW;

  const isInitiator = match.initiatedByMe === true;
  const hasAcceptRights = match.canAccept === true;

  const canRespond = match.status === MatchStatus.INTEREST_SENT && hasAcceptRights;
  const isWaiting = match.status === MatchStatus.INTEREST_SENT && isInitiator;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <button onClick={() => setLocation("/matches")} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-bold tracking-tight">{t("match_detail.title")}</h1>
        <Badge variant={isConnected ? "default" : "secondary"} className={isConnected ? "bg-emerald-600" : ""}>
          {t(`status.${match.status.toLowerCase()}` as any)}
        </Badge>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="py-4 border-b bg-muted/20">
                <CardTitle className="text-base">{t("match.cargo_summary")}</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-2 text-sm">
                {match.connectedCargo ? (
                  <>
                    <div className="font-semibold">{match.connectedCargo.cargoName}</div>
                    <div className="text-muted-foreground">{match.connectedCargo.weightTonnes}t · {match.connectedCargo.cargoType}</div>
                    <div className="text-muted-foreground">Req: {match.connectedCargo.requiredVesselType}</div>
                  </>
                ) : match.ownedCargo ? (
                  <>
                    <div className="font-semibold">{match.ownedCargo.cargoName}</div>
                    <div className="text-muted-foreground">{match.ownedCargo.weightTonnes}t · {match.ownedCargo.cargoType}</div>
                    <div className="text-muted-foreground">Req: {match.ownedCargo.requiredVesselType}</div>
                  </>
                ) : (
                  <>
                    <div className="font-semibold">{match.cargo.loadingRegion} &rarr; {match.cargo.destinationRegion}</div>
                    <div className="text-muted-foreground">{match.cargo.tonnageBand}</div>
                    <div className="text-muted-foreground">Req: {match.cargo.requiredVesselType}</div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-4 border-b bg-muted/20">
                <CardTitle className="text-base">{t("match.capacity_summary")}</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-2 text-sm">
                {match.connectedCapacity ? (
                  <>
                    <div className="font-semibold">Capacity at {match.connectedCapacity.locationId /* Note: ideally resolve location name but ID is available */}</div>
                    <div className="text-muted-foreground">{match.connectedCapacity.availableCapacityTonnes}t</div>
                    <div className="text-muted-foreground">Window: {formatDate(match.connectedCapacity.availableFrom)} - {formatDate(match.connectedCapacity.availableUntil)}</div>
                  </>
                ) : match.ownedCapacity ? (
                  <>
                    <div className="font-semibold">Capacity at {match.ownedCapacity.locationId}</div>
                    <div className="text-muted-foreground">{match.ownedCapacity.availableCapacityTonnes}t</div>
                    <div className="text-muted-foreground">Window: {formatDate(match.ownedCapacity.availableFrom)} - {formatDate(match.ownedCapacity.availableUntil)}</div>
                  </>
                ) : (
                  <>
                    <div className="font-semibold">Capacity in {match.capacity.availabilityRegion}</div>
                    <div className="text-muted-foreground">{match.capacity.tonnageBand}</div>
                    <div className="text-muted-foreground">Vessel: {match.capacity.vesselType}</div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="bg-muted/30 border-b">
              <CardTitle className="flex justify-between items-center">
                <span>Evaluation Score</span>
                <span className="text-3xl text-primary">{match.score.totalScore}/100</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-6">{match.score.explanation}</p>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-6 text-sm">
                <div>
                  <div className="font-semibold flex justify-between pr-4">
                    <span>{t("match.score.distance")}</span>
                    <span className="text-primary font-bold">{Math.round(match.score.components.distanceScore)}</span>
                  </div>
                  <div className="text-muted-foreground text-xs">{match.score.evaluationInputs.distanceBand}</div>
                </div>
                <div>
                  <div className="font-semibold flex justify-between pr-4">
                    <span>{t("match.score.timing")}</span>
                    <span className="text-primary font-bold">{Math.round(match.score.components.timingScore)}</span>
                  </div>
                  <div className="text-muted-foreground text-xs">{match.score.evaluationInputs.timingBand}</div>
                </div>
                <div>
                  <div className="font-semibold flex justify-between pr-4">
                    <span>{t("match.score.capacity")}</span>
                    <span className="text-primary font-bold">{Math.round(match.score.components.capacityScore)}</span>
                  </div>
                  <div className="text-muted-foreground text-xs">{match.score.evaluationInputs.capacityBand}</div>
                </div>
                <div>
                  <div className="font-semibold flex justify-between pr-4">
                    <span>{t("match.score.vessel_type")}</span>
                    <span className="text-primary font-bold">{Math.round(match.score.components.vesselTypeScore)}</span>
                  </div>
                  <div className="text-muted-foreground text-xs">{match.score.evaluationInputs.vesselTypeBand}</div>
                </div>
                <div>
                  <div className="font-semibold flex justify-between pr-4">
                    <span>{t("match.score.direction")}</span>
                    <span className="text-primary font-bold">{Math.round(match.score.components.directionScore)}</span>
                  </div>
                  <div className="text-muted-foreground text-xs">{match.score.evaluationInputs.directionBand}</div>
                </div>
                <div>
                  <div className="font-semibold flex justify-between pr-4">
                    <span>{t("match.score.cargo_compatibility")}</span>
                    <span className="text-primary font-bold">{Math.round(match.score.components.cargoCompatibilityScore)}</span>
                  </div>
                  <div className="text-muted-foreground text-xs">{match.score.evaluationInputs.cargoCompatibilityBand}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {isConnected && match.connectedCompanies && (
            <Card className="border-emerald-200 bg-emerald-50/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-emerald-800 text-lg">
                  <Handshake className="h-5 w-5" /> {t("match.counterparties")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {match.connectedCompanies.map(comp => (
                    <div key={comp.id} className="p-4 bg-white rounded border border-emerald-100 shadow-sm">
                      <div className="font-bold text-lg">{comp.name}</div>
                      <div className="text-sm text-muted-foreground grid grid-cols-2 mt-2 gap-y-2">
                        <div>Contact: {comp.primaryContactName}</div>
                        <div>Phone: {comp.phone}</div>
                        <div>Email: {comp.email}</div>
                        <div>Country: {comp.country}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>{t("common.actions")}</CardTitle></CardHeader>
            <CardContent className="space-y-3 flex flex-col">
              {canSendInterest && (
                <Button onClick={() => handleAction(MatchAction.INTEREST)} disabled={actOnMatch.isPending} className="w-full">
                  <CheckCircle2 className="mr-2 h-4 w-4" /> {t("action.send_interest")}
                </Button>
              )}
              {canRespond && (
                <>
                  <Button onClick={() => handleAction(MatchAction.ACCEPT)} disabled={actOnMatch.isPending} className="w-full bg-emerald-600 hover:bg-emerald-700">
                    <Handshake className="mr-2 h-4 w-4" /> {t("action.accept_connection")}
                  </Button>
                  <Button variant="destructive" onClick={() => handleAction(MatchAction.DECLINE)} disabled={actOnMatch.isPending} className="w-full">
                    <XCircle className="mr-2 h-4 w-4" /> {t("action.decline")}
                  </Button>
                </>
              )}
              {isWaiting && (
                <div className="flex items-center gap-2 text-sm text-primary p-3 bg-primary/10 rounded-md border border-primary/20 leading-tight">
                  <CheckCircle2 className="h-5 w-5 shrink-0" /> {t("match.waiting_counterparty")}
                </div>
              )}
              {isConnected && (
                <>
                  <div className="flex items-center gap-2 text-sm text-emerald-700 p-3 bg-emerald-100/50 rounded-md border border-emerald-200">
                    <CheckCircle2 className="h-5 w-5 shrink-0" /> {t("match.connection_confirmed")}
                  </div>
                  {relatedConversation && (
                    <Button className="w-full mt-2" variant="outline" onClick={() => setLocation(`/messages/${relatedConversation.id}`)}>
                      <MessageSquare className="mr-2 h-4 w-4" /> {t("action.open_conversation")}
                    </Button>
                  )}
                </>
              )}
              {match.status === MatchStatus.DECLINED && (
                <div className="flex items-center gap-2 text-sm text-destructive p-3 bg-destructive/10 rounded-md border border-destructive/20">
                  <AlertCircle className="h-5 w-5 shrink-0" /> {t("match.match_declined")}
                </div>
              )}
              {match.status === MatchStatus.EXPIRED && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 bg-muted rounded-md border">
                  <AlertCircle className="h-5 w-5 shrink-0" /> {t("match.match_expired")}
                </div>
              )}
              
              {actOnMatch.isError && (
                <div className="text-sm text-destructive mt-4 p-2 bg-destructive/10 rounded">
                  {t("error.action")}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
