import { useState } from "react";
import { useListMarketplace, getListMarketplaceQueryKey, MarketplaceListingType } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, Badge, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Button } from "@/components/ui/primitives";
import { Search, Info } from "lucide-react";

export default function Marketplace() {
  const [filterType, setFilterType] = useState<MarketplaceListingType | undefined>(undefined);
  const filters = { listingType: filterType, pageSize: 50 };
  const { data, isLoading } = useListMarketplace(filters, { query: { queryKey: getListMarketplaceQueryKey(filters), refetchInterval: 15000 } });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Open Marketplace</h1>
          <p className="text-muted-foreground">Discover anonymized active listings across the network.</p>
        </div>
        <div className="flex bg-muted p-1 rounded-md">
          <button 
            className={`px-3 py-1 text-sm rounded-sm transition-colors ${!filterType ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setFilterType(undefined)}
          >
            All
          </button>
          <button 
            className={`px-3 py-1 text-sm rounded-sm transition-colors ${filterType === MarketplaceListingType.CARGO ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setFilterType(MarketplaceListingType.CARGO)}
          >
            Cargo
          </button>
          <button 
            className={`px-3 py-1 text-sm rounded-sm transition-colors ${filterType === MarketplaceListingType.CAPACITY ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setFilterType(MarketplaceListingType.CAPACITY)}
          >
            Capacity
          </button>
        </div>
      </div>

      <div className="bg-accent/10 border border-accent/20 rounded-lg p-4 flex gap-3 text-sm text-accent-foreground/80">
        <Info className="h-5 w-5 shrink-0 text-accent" />
        <p>Marketplace listings are strictly anonymized using data bands. Exact tonnages, times, and coordinates are never exposed until a direct match connection is formed.</p>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Region / Route</TableHead>
              <TableHead>Window</TableHead>
              <TableHead>Tonnage Band</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center">Loading network listings...</TableCell></TableRow>
            ) : data?.items.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                <Search className="h-8 w-8 mx-auto mb-3 opacity-20" />
                No active listings match the current filters.
              </TableCell></TableRow>
            ) : (
              data?.items.map(item => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Badge variant={item.listingType === 'CARGO' ? 'default' : 'secondary'}>
                      {item.listingType}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium text-sm">
                    {item.listingType === 'CARGO' ? (
                      `${item.loadingRegion} → ${item.destinationRegion}`
                    ) : (
                      `${item.availabilityRegion} (${item.directionBand})`
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {item.timeBand}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {item.tonnageBand}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.listingType === 'CARGO' ? (
                      <>Req: {item.requiredVesselType}<br/>Type: {item.cargoTypeBand}</>
                    ) : (
                      <>Vessel: {item.vesselType}<br/>Cargo: {item.cargoCompatibilityBand}</>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
