import React, { useState } from "react";
import { useLocation } from "wouter";
import { Handshake, Inbox, Search, Clock, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { useListMyLinerMatches, MatchStatus, getListMyLinerMatchesQueryKey } from "@workspace/api-client-react";
import { Button, Card, CardContent, Badge } from "@/components/ui/primitives";

export default function LinerMatches() {
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState<MatchStatus | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const pageSize = 100;

  const { data, isLoading, error } = useListMyLinerMatches({ 
    pageSize, 
    page,
    status: filter === "ALL" ? undefined : filter
  }, {
    query: { 
      refetchInterval: 15000,
      queryKey: getListMyLinerMatchesQueryKey({ 
        pageSize, 
        page,
        status: filter === "ALL" ? undefined : filter
      })
    }
  });

  const matches = data?.items || [];
  const total = data?.total || 0;
  const hasMore = (page * pageSize) < total;

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

  const getStatusIcon = (status: MatchStatus) => {
    switch(status) {
      case MatchStatus.NEW: return <Inbox className="h-3 w-3 mr-1" />;
      case MatchStatus.INTEREST_SENT: return <Clock className="h-3 w-3 mr-1" />;
      case MatchStatus.CONNECTED: return <CheckCircle2 className="h-3 w-3 mr-1" />;
      case MatchStatus.DECLINED: return <XCircle className="h-3 w-3 mr-1" />;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Handshake className="h-8 w-8 text-primary" />
          Liner Matches
        </h1>
      </div>

      <div className="flex overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 space-x-2">
        <Button variant={filter === "ALL" ? "default" : "outline"} size="sm" onClick={() => { setFilter("ALL"); setPage(1); }} className="rounded-full">
          All Matches
        </Button>
        <Button variant={filter === MatchStatus.NEW ? "default" : "outline"} size="sm" onClick={() => { setFilter(MatchStatus.NEW); setPage(1); }} className="rounded-full">
          New
        </Button>
        <Button variant={filter === MatchStatus.INTEREST_SENT ? "default" : "outline"} size="sm" onClick={() => { setFilter(MatchStatus.INTEREST_SENT); setPage(1); }} className="rounded-full">
          Pending
        </Button>
        <Button variant={filter === MatchStatus.CONNECTED ? "default" : "outline"} size="sm" onClick={() => { setFilter(MatchStatus.CONNECTED); setPage(1); }} className="rounded-full">
          Connected
        </Button>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground">Finding suitable matches...</div>
      ) : error ? (
        <div className="p-12 text-center text-destructive">Error loading matches: {(error as any)?.response?.data?.message || "Unknown error"}</div>
      ) : matches.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
            <Search className="h-12 w-12 mb-4 text-muted" />
            <h3 className="text-lg font-medium text-foreground mb-1">No matches found</h3>
            <p className="mb-4">We're continuously scanning the network for suitable opportunities.</p>
            <div className="flex gap-4">
              <Button variant="outline" onClick={() => setLocation("/liner/cargo")}>Check Cargo</Button>
              <Button variant="outline" onClick={() => setLocation("/liner/services")}>Check Sailings</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {matches.map(m => (
            <Card key={m.id} className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer" onClick={() => setLocation(`/liner/matches/${m.id}`)}>
              <CardContent className="p-0">
                <div className="flex flex-col md:flex-row">
                  <div className="md:w-[15%] p-4 bg-muted/10 border-b md:border-b-0 md:border-r flex flex-col justify-center items-center text-center">
                    <div className="text-3xl font-bold text-primary mb-1">{m.score.totalScore}%</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">Match Score</div>
                    <Badge className={`mt-3 ${getStatusColor(m.status)}`} variant="outline">
                      <div className="flex items-center">
                        {getStatusIcon(m.status)}
                        {m.status.replace('_', ' ')}
                      </div>
                    </Badge>
                  </div>
                  
                  <div className="md:w-[40%] p-4 border-b md:border-b-0 md:border-r space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary" className="bg-orange-100 text-orange-800 hover:bg-orange-100">CARGO</Badge>
                      <span className="font-semibold">{m.cargo.cargoType.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="truncate">{m.cargo.originRegion}</span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{m.cargo.destinationRegion}</span>
                    </div>
                    <div className="text-sm text-muted-foreground grid grid-cols-2 gap-1">
                      <span>Vol: {m.cargo.totalWeightBand}</span>
                      <span>Stow: {m.cargo.stowage}</span>
                    </div>
                  </div>
                  
                  <div className="md:w-[40%] p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100">SAILING</Badge>
                      <span className="font-semibold truncate">{m.sailing.tradeLaneBand}</span>
                    </div>
                    <div className="text-sm text-muted-foreground grid grid-cols-2 gap-x-2 gap-y-1">
                      <span>Dep: {m.sailing.departureBand}</span>
                      <span>Cut: {m.sailing.cutoffBand}</span>
                      <span className="col-span-2">Cap: {m.sailing.capacityBand}</span>
                    </div>
                  </div>
                  
                  <div className="md:w-[5%] bg-muted/5 flex items-center justify-center p-4">
                    <ArrowRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          
          <div className="flex justify-between items-center mt-4">
            <Button variant="outline" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</Button>
            <span className="text-sm text-muted-foreground">Page {page}</span>
            <Button variant="outline" disabled={!hasMore} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}