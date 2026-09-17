import { useListMyMatches, getListMyMatchesQueryKey, MatchStatus, TransportMode } from "@workspace/api-client-react";
import { Card, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge, Button } from "@/components/ui/primitives";
import { useLocation } from "wouter";
import { formatDate } from "@/lib/utils";
import { t } from "@/lib/i18n";

const STATUS_LABEL_KEYS: Record<string, string> = {
  UNKNOWN: "deepsea.matches.status.unknown",
  USER_ESTIMATED: "deepsea.matches.status.user_estimated",
  WITHIN_WINDOW: "deepsea.matches.status.within_window",
  UNCERTAIN: "deepsea.matches.status.uncertain",
  TOO_LATE: "deepsea.matches.status.too_late",
  NOT_CONFIGURED: "deepsea.matches.status.not_configured",
  USER_SELECTED: "deepsea.matches.status.user_selected",
  NOT_VERIFIED: "deepsea.matches.status.not_verified",
};

function statusLabel(value: string): string {
  return STATUS_LABEL_KEYS[value] ? t(STATUS_LABEL_KEYS[value]) : value.replace(/_/g, " ");
}

export default function DeepseaMatches() {
  const [, setLocation] = useLocation();
  const filters = { pageSize: 50, transportMode: TransportMode.DEEPSEA_BULK };
  const { data, isLoading, error } = useListMyMatches(filters, { query: { queryKey: getListMyMatchesQueryKey(filters), refetchInterval: 15000 } });

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
        <h1 className="text-2xl font-bold tracking-tight">{t("deepsea.matches.title")}</h1>
        <p className="text-muted-foreground">{t("deepsea.matches.subtitle")}</p>
      </div>
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {t("deepsea.matches.route_notice")}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("matches.status")}</TableHead>
              <TableHead>{t("matches.score")}</TableHead>
              <TableHead>{t("matches.my_listing")}</TableHead>
              <TableHead>{t("deepsea.matches.context")}</TableHead>
              <TableHead>{t("matches.generated_on")}</TableHead>
              <TableHead className="text-right">{t("matches.action")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center">{t("common.loading")}</TableCell></TableRow>
            ) : error ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-destructive">{t("error.load_matches")}</TableCell></TableRow>
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
                    {t("deepsea.marketplace.class")}: {m.deepseaMatch?.vesselClass || t("deepsea.marketplace.unknown")}<br/>
                    {t("deepsea.marketplace.dwt")}: {m.deepseaMatch?.dwtBand || t("deepsea.marketplace.unknown")}<br/>
                    {t("deepsea.marketplace.conf")}: {m.deepseaMatch?.availabilityConfidence || t("deepsea.marketplace.unknown")}
                      <span className="block mt-1">{t("deepsea.matches.laycan")}: {statusLabel(m.score.evaluationInputs.laycanAssessment || "UNKNOWN")}</span>
                     <span className="block">{t("deepsea.matches.manual_status")}: {m.deepseaMatch?.provisional ? t("deepsea.matches.manual_provisional") : t("deepsea.matches.manual_status_unknown")}</span>
                     {m.deepseaMatch?.provisional && <span className="text-amber-700 block">{t("deepsea.matches.provisional_route")}</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(m.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => setLocation(`/deepsea/matches/${m.id}`)}>{t("action.view_details")}</Button>
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
