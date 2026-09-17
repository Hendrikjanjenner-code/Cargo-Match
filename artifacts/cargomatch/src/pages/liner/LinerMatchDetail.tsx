import React from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  ArrowLeft, CheckCircle2, XCircle, Clock, Building2, Package, Ship, 
  MapPin, AlertCircle, MessageSquare, Handshake
} from "lucide-react";
import { Button, Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/primitives";
import { 
  useGetMyLinerMatch, useActOnLinerMatch, getGetMyLinerMatchQueryKey,
  MatchStatus, listLocations, LocationType, listMyConversations
} from "@workspace/api-client-react";

export default function LinerMatchDetail() {
  const [, params] = useRoute("/liner/matches/:id");
  const matchId = params?.id;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = React.useState("");

  const { data: match, isLoading, error } = useGetMyLinerMatch(matchId || "", {
    query: { 
      enabled: !!matchId, 
      queryKey: getGetMyLinerMatchQueryKey(matchId || ""),
      refetchInterval: 10000
    }
  });

  const { data: locations = [], error: locationsError } = useQuery({
    queryKey: ["/api/locations", "liner-detail-all"],
    queryFn: async ({ signal }) => {
      const first = await listLocations({ page: 1, pageSize: 100, locationType: LocationType.PORT }, { signal });
      const items = [...first.items];
      for (let page = 2; items.length < first.total; page++) {
        const next = await listLocations({ page, pageSize: 100, locationType: LocationType.PORT }, { signal });
        if (!next.items.length) break;
        items.push(...next.items);
      }
      return items;
    },
  });
  const getLocationName = (id: string) => locations.find(l => l.id === id)?.name || id;

  const { data: connectedConversationId, error: conversationError, isFetching: conversationLoading } = useQuery({
    queryKey: ["/api/conversations", "liner-match", matchId],
    enabled: !!matchId && match?.status === MatchStatus.CONNECTED,
    refetchInterval: 15000,
    queryFn: async ({ signal }) => {
      for (let page = 1; ; page++) {
        const result = await listMyConversations({ page, pageSize: 100 }, { signal });
        const conversation = result.items.find(c => c.matchId === matchId);
        if (conversation) return conversation.id;
        if (!result.items.length || page * result.pageSize >= result.total) {
          throw new Error("The connected conversation could not be found.");
        }
      }
    },
  });

  const actOnMatch = useActOnLinerMatch();

  if (!matchId) return <div className="p-8 text-center">Invalid match ID</div>;
  if (isLoading) return <div className="p-12 text-center text-muted-foreground">Loading match details...</div>;
  if (error || !match) return <div role="alert" className="p-12 text-center text-destructive">This match could not be loaded. It may no longer be eligible.</div>;
  const service = match.ownedService ?? match.connectedService;
  const vessel = match.ownedVessel ?? match.connectedVessel;

  const handleAction = async (action: 'INTEREST' | 'ACCEPT' | 'DECLINE') => {
    setActionError("");
    try {
      await actOnMatch.mutateAsync({
        matchId: match.id,
        data: { action }
      });
      queryClient.invalidateQueries({
        predicate: (query) => 
          (query.queryKey[0] as string)?.startsWith('/api/liner') ||
          (query.queryKey[0] as string)?.startsWith('/api/matches') ||
          (query.queryKey[0] as string)?.startsWith('/api/conversations') ||
          (query.queryKey[0] as string)?.startsWith('/api/notifications')
      });
    } catch (e) {
      const problem = e as { data?: { error?: string }; message?: string };
      setActionError(problem.data?.error || problem.message || "The action could not be completed.");
      void queryClient.invalidateQueries({ queryKey: getGetMyLinerMatchQueryKey(match.id) });
    }
  };

  const getStatusColor = (status: MatchStatus) => {
    switch(status) {
      case MatchStatus.NEW: return "bg-blue-100 text-blue-800 border-blue-200";
      case MatchStatus.INTEREST_SENT: return "bg-amber-100 text-amber-800 border-amber-200";
      case MatchStatus.CONNECTED: return "bg-green-100 text-green-800 border-green-200";
      case MatchStatus.DECLINED: return "bg-red-100 text-red-800 border-red-200";
      case MatchStatus.EXPIRED: return "bg-gray-100 text-gray-800 border-gray-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const scoreColor = 
    match.score.totalScore >= 90 ? "text-green-600" :
    match.score.totalScore >= 75 ? "text-amber-600" : 
    "text-orange-600";

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {actionError && <div role="alert" className="text-destructive">{actionError}</div>}
      {locationsError && <div role="alert" className="text-destructive">Port names could not be loaded.</div>}
      <div className="flex items-center gap-4 border-b pb-4">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/liner/matches")} className="shrink-0 p-0 h-8 w-8 rounded-full">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 flex justify-between items-center">
          <h1 className="text-2xl font-bold tracking-tight">Match Details</h1>
          <Badge className={getStatusColor(match.status)} variant="outline">
            {match.status.replace('_', ' ')}
          </Badge>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN: SCORE & ACTION */}
        <div className="space-y-6">
          <Card className="border-primary/20 shadow-sm">
            <CardContent className="p-6 text-center">
              <div className={`text-6xl font-bold mb-2 ${scoreColor}`}>{match.score.totalScore}%</div>
              <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-6">Compatibility Score</div>
              
              <div className="space-y-3 text-sm text-left">
                <div className="flex justify-between"><span>Dimensions</span> <span className="font-medium">{match.score.dimensionsFit}%</span></div>
                <div className="flex justify-between"><span>Weight</span> <span className="font-medium">{match.score.weightFit}%</span></div>
                <div className="flex justify-between"><span>Lifting</span> <span className="font-medium">{match.score.liftingFit}%</span></div>
                <div className="flex justify-between"><span>Stowage</span> <span className="font-medium">{match.score.stowageFit}%</span></div>
                <div className="flex justify-between"><span>Rotation</span> <span className="font-medium">{match.score.rotationFit}%</span></div>
                <div className="flex justify-between"><span>Timing</span> <span className="font-medium">{match.score.timingFit}%</span></div>
              </div>
              <p className="text-xs text-muted-foreground mt-4 italic text-left">{match.score.explanation}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="bg-muted/20 pb-4">
              <CardTitle className="text-lg">Next Steps</CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {match.status === MatchStatus.NEW && (
                <>
                  <p className="text-sm text-muted-foreground">Send interest to reveal identity if the other party accepts.</p>
                  <Button className="w-full" onClick={() => handleAction('INTEREST')} disabled={actOnMatch.isPending}>Send Interest</Button>
                </>
              )}

              {match.status === MatchStatus.INTEREST_SENT && match.canAccept && !match.initiatedByMe && (
                <>
                  <p className="text-sm text-muted-foreground">The other party is interested. Accept to connect and reveal identities.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="text-destructive border-destructive/30" onClick={() => handleAction('DECLINE')} disabled={actOnMatch.isPending}>Decline</Button>
                    <Button className="bg-green-600 hover:bg-green-700" onClick={() => handleAction('ACCEPT')} disabled={actOnMatch.isPending}>Accept & Connect</Button>
                  </div>
                </>
              )}

              {match.status === MatchStatus.INTEREST_SENT && match.initiatedByMe && (
                <div className="text-center py-4 space-y-3">
                  <Clock className="h-8 w-8 mx-auto text-amber-500" />
                  <p className="text-sm font-medium">Interest Sent</p>
                  <p className="text-xs text-muted-foreground">Waiting for the other party to review your interest.</p>
                </div>
              )}

              {match.status === MatchStatus.CONNECTED && (
                <div className="text-center py-4 space-y-4">
                  <div className="inline-flex items-center justify-center p-3 bg-green-100 rounded-full">
                    <Handshake className="h-8 w-8 text-green-700" />
                  </div>
                  <div>
                    <p className="font-medium text-green-800">You are connected!</p>
                    <p className="text-xs text-muted-foreground mt-1">Full details are now visible.</p>
                  </div>
                  {conversationError && <p role="alert" className="text-sm text-destructive">{conversationError.message}</p>}
                  <Button className="w-full mt-2" variant="outline" disabled={!connectedConversationId || conversationLoading} onClick={() => {
                    if (connectedConversationId) setLocation(`/messages/${connectedConversationId}`);
                  }}>
                    <MessageSquare className="h-4 w-4 mr-2" /> Go to Messages
                  </Button>
                </div>
              )}

              {match.status === MatchStatus.DECLINED && (
                <div className="text-center py-4 space-y-3">
                  <XCircle className="h-8 w-8 mx-auto text-destructive" />
                  <p className="text-sm font-medium text-destructive">Match Declined</p>
                </div>
              )}
              
              {match.status === MatchStatus.EXPIRED && (
                <div className="text-center py-4 space-y-3">
                  <Clock className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm font-medium text-muted-foreground">Match Expired</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN: CARGO & SAILING DATA */}
        <div className="md:col-span-2 space-y-6">
          {service && vessel && (
            <Card>
              <CardHeader><CardTitle>{service.serviceName}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p><span className="text-muted-foreground">Trade lane: </span>{service.tradeLane}</p>
                <p><span className="text-muted-foreground">Vessel: </span>{vessel.vesselName} · IMO {vessel.imoNumber}</p>
                <p>This introduction does not book transport or reserve capacity.</p>
              </CardContent>
            </Card>
          )}
          
          {/* Identity Disclosure Panel */}
          {match.status === MatchStatus.CONNECTED && match.connectedCompanies.length > 0 && (
            <Card className="border-green-200 shadow-sm bg-green-50/30">
              <CardHeader className="pb-2 border-b border-green-100 bg-green-50/50">
                <CardTitle className="text-lg flex items-center gap-2 text-green-800">
                  <Building2 className="h-5 w-5" /> Connected Party
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 grid sm:grid-cols-2 gap-4">
                {match.connectedCompanies.map(c => (
                  <div key={c.id} className="space-y-1">
                    <div className="font-semibold text-lg">{c.name}</div>
                    <div className="text-sm text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3"/> {c.country}</div>
                    <div className="mt-2 text-sm pt-2 border-t border-green-100/50">
                      <div><span className="text-muted-foreground mr-2">Contact:</span>{c.primaryContactName}</div>
                      <div><span className="text-muted-foreground mr-2">Email:</span>{c.email}</div>
                      <div><span className="text-muted-foreground mr-2">Phone:</span>{c.phone}</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="grid sm:grid-cols-2 gap-6">
            {/* CARGO COLUMN */}
            <div className="space-y-4 border rounded-xl overflow-hidden bg-card">
              <div className="bg-orange-500/10 p-3 border-b border-orange-500/20">
                <h3 className="font-semibold flex items-center gap-2 text-orange-800">
                  <Package className="h-5 w-5" /> Cargo Details
                </h3>
              </div>
              <div className="p-4 space-y-4">
                {match.connectedCargo ? (
                  // Exact Cargo
                  <>
                    <div>
                      <div className="text-sm text-muted-foreground">Cargo Name</div>
                      <div className="font-medium">{match.connectedCargo.cargoName}</div>
                      <Badge variant="outline" className="mt-1">{match.connectedCargo.cargoType.replace(/_/g, ' ')}</Badge>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">Route</div>
                      <div className="font-medium">{getLocationName(match.connectedCargo.originLocationId)} &rarr; {getLocationName(match.connectedCargo.destinationLocationId)}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-muted-foreground block text-xs">Total Weight</span><span>{match.connectedCargo.totalWeightTonnes} T</span></div>
                      <div><span className="text-muted-foreground block text-xs">Pieces</span><span>{match.connectedCargo.pieceCount} (max {match.connectedCargo.pieceWeightTonnes} T)</span></div>
                      <div className="col-span-2"><span className="text-muted-foreground block text-xs">Max Dimensions</span><span>{match.connectedCargo.pieceLengthMetres} x {match.connectedCargo.pieceWidthMetres} x {match.connectedCargo.pieceHeightMetres} m</span></div>
                      <div><span className="text-muted-foreground block text-xs">Stowage</span><span>{match.connectedCargo.requiredStowage}</span></div>
                      <div><span className="text-muted-foreground block text-xs">Lifting Req.</span><span>{match.connectedCargo.requiredLiftingTonnes || 'None'}</span></div>
                      <div className="col-span-2"><span className="text-muted-foreground block text-xs">Ready</span><span>{new Date(match.connectedCargo.readyAt).toLocaleString()}</span></div>
                    </div>
                    {match.connectedCargo.notes && (
                      <div className="pt-2 border-t mt-2">
                        <span className="text-muted-foreground block text-xs">Internal Notes</span>
                        <p className="text-sm">{match.connectedCargo.notes}</p>
                      </div>
                    )}
                  </>
                ) : match.ownedCargo ? (
                  // My Cargo
                  <>
                    <div>
                      <Badge variant="secondary" className="mb-2">Your Listing</Badge>
                      <div className="font-medium">{match.ownedCargo.cargoName}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">Route</div>
                      <div className="font-medium text-sm truncate">{getLocationName(match.ownedCargo.originLocationId)} &rarr; {getLocationName(match.ownedCargo.destinationLocationId)}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-muted-foreground block text-xs">Total Weight</span><span>{match.ownedCargo.totalWeightTonnes} T</span></div>
                      <div><span className="text-muted-foreground block text-xs">Max Dimensions</span><span>{match.ownedCargo.pieceLengthMetres}x{match.ownedCargo.pieceWidthMetres}x{match.ownedCargo.pieceHeightMetres}m</span></div>
                    </div>
                  </>
                ) : (
                  // Anonymous Cargo
                  <>
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">Region</div>
                      <div className="font-medium">{match.cargo.originRegion} &rarr; {match.cargo.destinationRegion}</div>
                      <Badge variant="outline" className="mt-1">{match.cargo.cargoType.replace(/_/g, ' ')}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-muted-foreground block text-xs">Total Weight</span><span>{match.cargo.totalWeightBand}</span></div>
                      <div><span className="text-muted-foreground block text-xs">Dimensions</span><span>{match.cargo.pieceDimensionBand}</span></div>
                      <div><span className="text-muted-foreground block text-xs">Stowage</span><span>{match.cargo.stowage}</span></div>
                      <div><span className="text-muted-foreground block text-xs">Lifting Req.</span><span>{match.cargo.liftingBand}</span></div>
                      <div className="col-span-2"><span className="text-muted-foreground block text-xs">Ready</span><span>{match.cargo.readyBand}</span></div>
                    </div>
                    <div className="mt-4 p-3 bg-muted/20 rounded-md flex gap-2 items-start text-xs text-muted-foreground">
                      <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
                      <p>Exact details and party identity are hidden until connection is established.</p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* SAILING COLUMN */}
            <div className="space-y-4 border rounded-xl overflow-hidden bg-card">
              <div className="bg-blue-500/10 p-3 border-b border-blue-500/20">
                <h3 className="font-semibold flex items-center gap-2 text-blue-800">
                  <Ship className="h-5 w-5" /> Sailing Details
                </h3>
              </div>
              <div className="p-4 space-y-4">
                {match.connectedSailing ? (
                  // Exact Sailing
                  <>
                    <div>
                      <div className="text-sm text-muted-foreground">Voyage</div>
                      <div className="font-medium">{match.connectedSailing.voyageReference}</div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground mb-1">Port Rotation</div>
                      <div className="border-l-2 border-primary/20 ml-2 pl-3 space-y-2 text-sm">
                        {[...match.connectedSailing.portRotation].sort((a,b)=>a.sequence - b.sequence).map(p => (
                          <div key={p.sequence} className="relative">
                            <div className="absolute -left-[17px] top-1 h-2 w-2 rounded-full border border-primary bg-background"></div>
                            <div className="font-medium">{getLocationName(p.locationId)}</div>
                            <div className="text-xs text-muted-foreground">ETA: {new Date(p.estimatedArrival).toLocaleString()}</div>
                            <div className="text-xs text-muted-foreground">ETD: {new Date(p.estimatedDeparture).toLocaleString()}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="col-span-2"><span className="text-muted-foreground block text-xs">Departure / Cutoff</span><span>{new Date(match.connectedSailing.departureAt).toLocaleString()} / {new Date(match.connectedSailing.cargoCutoffAt).toLocaleString()}</span></div>
                      <div><span className="text-muted-foreground block text-xs">Avail. Capacity</span><span>{match.connectedSailing.commercialCapacity.availableCommercialTonnes} T</span></div>
                      <div><span className="text-muted-foreground block text-xs">Max Lift</span><span>{match.connectedSailing.commercialCapacity.liftingCapacityTonnes} T</span></div>
                      <div><span className="text-muted-foreground block text-xs">Stowage</span><span>{match.connectedSailing.commercialCapacity.stowage}</span></div>
                    </div>
                    {match.connectedSailing.notes && (
                      <div className="pt-2 border-t mt-2">
                        <span className="text-muted-foreground block text-xs">Internal Notes</span>
                        <p className="text-sm">{match.connectedSailing.notes}</p>
                      </div>
                    )}
                  </>
                ) : match.ownedSailing ? (
                  // My Sailing
                  <>
                    <div>
                      <Badge variant="secondary" className="mb-2">Your Listing</Badge>
                      <div className="font-medium">{match.ownedSailing.voyageReference}</div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground mb-1">Port Rotation</div>
                      <div className="border-l-2 border-primary/20 ml-2 pl-3 space-y-2 text-sm">
                        {[...match.ownedSailing.portRotation].sort((a,b)=>a.sequence - b.sequence).map((p, i) => (
                          <div key={i} className="relative">
                            <div className="absolute -left-[17px] top-1 h-2 w-2 rounded-full border border-primary bg-background"></div>
                            <div className="font-medium truncate max-w-[120px]">{getLocationName(p.locationId)}</div>
                            <div className="text-xs text-muted-foreground">ETA: {new Date(p.estimatedArrival).toLocaleString()}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  // Anonymous Sailing
                  <>
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">Trade Lane</div>
                      <div className="font-medium">{match.sailing.tradeLaneBand}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="col-span-2"><span className="text-muted-foreground block text-xs">Departure Band</span><span>{match.sailing.departureBand}</span></div>
                      <div className="col-span-2"><span className="text-muted-foreground block text-xs">Cut-off Band</span><span>{match.sailing.cutoffBand}</span></div>
                      <div className="col-span-2"><span className="text-muted-foreground block text-xs">Capacity Band</span><span>{match.sailing.capacityBand}</span></div>
                      <div><span className="text-muted-foreground block text-xs">Stowage</span><span>{match.sailing.stowage}</span></div>
                    </div>
                    <div className="mt-4 p-3 bg-muted/20 rounded-md flex gap-2 items-start text-xs text-muted-foreground">
                      <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
                      <p>Exact details and party identity are hidden until connection is established.</p>
                    </div>
                  </>
                )}
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}