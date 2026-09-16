import { useListMyMatches, getListMyMatchesQueryKey, MatchStatus } from "@workspace/api-client-react";
import { Card, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge, Button } from "@/components/ui/primitives";
import { useLocation } from "wouter";
import { formatDate } from "@/lib/utils";

import { t } from "@/lib/i18n";

export default function Matches() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useListMyMatches({ pageSize: 50 }, { query: { queryKey: getListMyMatchesQueryKey({ pageSize: 50 }), refetchInterval: 15000 } });

  const getStatusBadge = (status: MatchStatus) => {
    switch(status) {
      case 'CONNECTED': return <Badge className="bg-emerald-600">{t("status.connected")}</Badge>;
      case 'INTEREST_SENT': return <Badge variant="secondary">{t("status.interest_sent")}</Badge>;
      case 'NEW': return <Badge variant="default">{t("status.new")}</Badge>;
      case 'DECLINED': return <Badge variant="destructive">{t("status.declined")}</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("matches.title")}</h1>
        <p className="text-muted-foreground">{t("matches.subtitle")}</p>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Match Score</TableHead>
              <TableHead>My Listing</TableHead>
              <TableHead>Counterparty Band</TableHead>
              <TableHead>Generated On</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center">{t("common.loading")}</TableCell></TableRow>
            ) : data?.items.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                {t("common.no_data")}
              </TableCell></TableRow>
            ) : (
              data?.items.map(m => (
                <TableRow key={m.id}>
                  <TableCell>{getStatusBadge(m.status)}</TableCell>
                  <TableCell>
                    <div className="font-bold text-lg text-primary">{m.score.totalScore}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="font-medium text-foreground">
                      {m.cargo.loadingRegion} → {m.cargo.destinationRegion}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {m.capacity.availabilityRegion} ({m.capacity.vesselType})
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    Dist: {m.score.evaluationInputs.distanceBand}<br/>
                    Time: {m.score.evaluationInputs.timingBand}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(m.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => setLocation(`/matches/${m.id}`)}>{t("action.view_details")}</Button>
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
