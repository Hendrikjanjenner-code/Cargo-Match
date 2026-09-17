import React, { useState } from "react";
import { Globe, Package, Ship, ArrowRight, Activity, Handshake } from "lucide-react";
import { Link } from "wouter";
import { Button, Card, CardHeader, CardContent, Badge } from "@/components/ui/primitives";
import { useListLinerMarketplace, getListLinerMarketplaceQueryKey, LinerMarketplaceListingType } from "@workspace/api-client-react";

export default function LinerMarketplace() {
  const [filter, setFilter] = useState<LinerMarketplaceListingType | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const pageSize = 100;

  const { data, isLoading, error } = useListLinerMarketplace({ 
    pageSize, 
    page,
    listingType: filter === "ALL" ? undefined : filter
  }, { query: {
    queryKey: getListLinerMarketplaceQueryKey({ pageSize, page, listingType: filter === "ALL" ? undefined : filter }),
    refetchInterval: 15000,
  } });

  const listings = data?.items || [];
  const total = data?.total || 0;
  const hasMore = (page * pageSize) < total;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Globe className="h-8 w-8 text-primary" />
          Liner Marketplace
        </h1>
        <div className="flex space-x-2 bg-muted p-1 rounded-md">
          <button 
            className={`px-4 py-2 text-sm font-medium rounded-sm transition-colors ${filter === 'ALL' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:bg-background/50'}`}
            onClick={() => { setFilter("ALL"); setPage(1); }}
          >
            All Opportunities
          </button>
          <button 
            className={`px-4 py-2 text-sm font-medium rounded-sm transition-colors ${filter === LinerMarketplaceListingType.CARGO ? 'bg-background shadow-sm' : 'text-muted-foreground hover:bg-background/50'}`}
            onClick={() => { setFilter(LinerMarketplaceListingType.CARGO); setPage(1); }}
          >
            Cargo
          </button>
          <button 
            className={`px-4 py-2 text-sm font-medium rounded-sm transition-colors ${filter === LinerMarketplaceListingType.SAILING ? 'bg-background shadow-sm' : 'text-muted-foreground hover:bg-background/50'}`}
            onClick={() => { setFilter(LinerMarketplaceListingType.SAILING); setPage(1); }}
          >
            Sailings
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground">Loading market data...</div>
      ) : error ? (
        <div className="p-12 text-center text-destructive">Error loading marketplace data: {(error as any)?.response?.data?.message || "Unknown error"}</div>
      ) : listings.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
            <Activity className="h-12 w-12 mb-4 text-muted" />
            <h3 className="text-lg font-medium text-foreground mb-1">No opportunities found</h3>
            <p>The market is quiet right now. Check back later.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {listings.map(listing => {
            if (listing.listingType === LinerMarketplaceListingType.CARGO) {
              const cargo = listing as any; // AnonymousLinerCargo
              return (
                <Card key={cargo.id} className="overflow-hidden hover:shadow-md transition-shadow border-l-4 border-l-orange-500">
                  <CardHeader className="bg-muted/10 pb-3 border-b">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2 text-orange-600 font-semibold">
                        <Package className="h-5 w-5" /> Cargo
                      </div>
                      <Badge variant="outline">{cargo.cargoType.replace(/_/g, ' ')}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-medium bg-muted/30 p-2 rounded">
                      <span className="truncate">{cargo.originRegion}</span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{cargo.destinationRegion}</span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm">
                      <div><span className="text-muted-foreground block text-xs">Total Weight</span><span className="font-medium">{cargo.totalWeightBand}</span></div>
                      <div><span className="text-muted-foreground block text-xs">Dimensions</span><span className="font-medium">{cargo.pieceDimensionBand}</span></div>
                      <div><span className="text-muted-foreground block text-xs">Ready</span><span className="font-medium">{cargo.readyBand}</span></div>
                      <div><span className="text-muted-foreground block text-xs">Stowage</span><span className="font-medium">{cargo.stowage}</span></div>
                      <div><span className="text-muted-foreground block text-xs">Lifting</span><span className="font-medium">{cargo.liftingBand}</span></div>
                    </div>
                  </CardContent>
                </Card>
              );
            } else {
              const sailing = listing as any; // AnonymousLinerSailing
              return (
                <Card key={sailing.id} className="overflow-hidden hover:shadow-md transition-shadow border-l-4 border-l-blue-500">
                  <CardHeader className="bg-muted/10 pb-3 border-b">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2 text-blue-600 font-semibold">
                        <Ship className="h-5 w-5" /> Sailing
                      </div>
                      <Badge variant="outline" className="truncate max-w-[150px]">{sailing.tradeLaneBand}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm">
                      <div><span className="text-muted-foreground block text-xs">Departure</span><span className="font-medium">{sailing.departureBand}</span></div>
                      <div><span className="text-muted-foreground block text-xs">Cut-off</span><span className="font-medium">{sailing.cutoffBand}</span></div>
                      <div><span className="text-muted-foreground block text-xs">Capacity</span><span className="font-medium">{sailing.capacityBand}</span></div>
                      <div><span className="text-muted-foreground block text-xs">Stowage</span><span className="font-medium">{sailing.stowage}</span></div>
                      <div className="col-span-2"><span className="text-muted-foreground block text-xs">Accepts</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {sailing.cargoTypes.map((t: string) => (
                            <Badge key={t} variant="secondary" className="text-[10px] py-0">{t.replace(/_/g, ' ')}</Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            }
          })}
        </div>
      )}

      {listings.length > 0 && (
        <div className="flex justify-between items-center mt-4">
          <Button variant="outline" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button variant="outline" disabled={!hasMore} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
      
      {!isLoading && !error && listings.length > 0 && (
        <div className="bg-muted/30 border rounded-lg p-4 flex items-center justify-between mt-8">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-full"><Handshake className="h-5 w-5 text-primary" /></div>
            <div>
              <h4 className="font-medium">Want to connect?</h4>
              <p className="text-sm text-muted-foreground">Matches are generated automatically based on your active listings.</p>
            </div>
          </div>
          <Link href="/liner/matches" className="btn inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2">
            View My Matches
          </Link>
        </div>
      )}
    </div>
  );
}