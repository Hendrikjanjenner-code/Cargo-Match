import React, { useState, useEffect } from "react";
import { useGetMyVesselAis, getGetMyVesselAisQueryKey } from "@workspace/api-client-react";
import type { VesselAisResponse } from "@workspace/api-client-react";
import { Badge, Button } from "@/components/ui/primitives";
import { t } from "@/lib/i18n";
import { RefreshCcw, CheckCircle2, Clock, AlertTriangle, HelpCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { VesselAisIdentitiesPanel } from "@/components/ais/VesselAisIdentitiesPanel";

export function VesselAisPanel({ vesselId }: { vesselId: string }) {
  const { data, isError, isLoading, refetch, isFetching } = useGetMyVesselAis(vesselId, {
    query: {
      queryKey: getGetMyVesselAisQueryKey(vesselId),
      staleTime: 30000, // 30 seconds
      gcTime: 0, // Exact telemetry is discarded when its private panel closes.
      refetchOnWindowFocus: false,
      refetchOnMount: "always",
      refetchOnReconnect: false,
      retry: false,
    }
  });

  if (isLoading) {
    return (
      <div className="space-y-4 p-2">
        <VesselAisIdentitiesPanel vesselId={vesselId} />
        <div className="text-sm text-muted-foreground p-4">{t("common.loading")}</div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-4 p-2">
        <VesselAisIdentitiesPanel vesselId={vesselId} />
        <div className="space-y-2 p-4" role="alert">
          <div className="text-sm text-destructive font-medium">{t("vessels.ais.error")}</div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCcw className={cn("h-3 w-3 mr-2", isFetching && "animate-spin")} />
            {t("vessels.ais.refresh")}
          </Button>
        </div>
      </div>
    );
  }

  const { status, telemetry, attempts, simulation } = data;

  if (status === "NOT_CONFIGURED") {
    return (
      <div className="space-y-4 p-2">
        <VesselAisIdentitiesPanel vesselId={vesselId} />
        <div className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{t("vessels.ais.status.not_configured")}</Badge>
          <span className="text-sm text-muted-foreground mr-2">{t("vessels.ais.not_configured")}</span>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-7 px-2">
            <RefreshCcw className={cn("h-3 w-3 mr-1", isFetching && "animate-spin")} />
            {t("vessels.ais.refresh")}
          </Button>
        </div>
        </div>
      </div>
    );
  }

  if (status === "UNAVAILABLE" || !telemetry) {
    return (
      <div className="space-y-4 p-2">
        <VesselAisIdentitiesPanel vesselId={vesselId} />
        <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="destructive">{t("vessels.ais.status.unavailable")}</Badge>
          <span className="text-sm text-muted-foreground mr-2">{t("vessels.ais.unavailable")}</span>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-7 px-2">
            <RefreshCcw className={cn("h-3 w-3 mr-1", isFetching && "animate-spin")} />
            {t("vessels.ais.refresh")}
          </Button>
          {simulation && (
            <Badge variant="destructive" className="animate-pulse">{t("vessels.ais.simulated")}</Badge>
          )}
        </div>
        {attempts && attempts.length > 0 && (
          <div className="text-xs text-muted-foreground bg-muted/50 border p-3 rounded-md max-w-xl">
            <strong className="block mb-2">{t("vessels.ais.attempts")}:</strong>
            <ul className="list-disc pl-4 space-y-1">
              {attempts.map((a, i) => (
                <li key={i}><span className="font-medium">{a.provider}</span>: {a.outcome}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="bg-muted/30 p-2.5 rounded-md text-xs text-muted-foreground flex items-start gap-2.5 border">
          <Info className="h-4 w-4 shrink-0 text-muted-foreground/70" />
          <p className="leading-snug">{t("vessels.ais.disclaimer")}</p>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-2">
      <VesselAisIdentitiesPanel vesselId={vesselId} />
      <VesselAisTelemetry data={data} onRefresh={() => refetch()} isFetching={isFetching} />
    </div>
  );
}

function VesselAisTelemetry({ data, onRefresh, isFetching }: { data: VesselAisResponse, onRefresh: () => void, isFetching: boolean }) {
  const { simulation, telemetry, checkedAt, cacheHit, freshForSeconds, staleAfterSeconds } = data;
  const tel = telemetry!;

  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const baseTimeStr = tel.observedAt;
  const baseTimeMs = baseTimeStr ? new Date(baseTimeStr).getTime() : 0;
  const ageSec = baseTimeMs ? Math.floor((now - baseTimeMs) / 1000) : null;

  let freshnessState = "UNKNOWN";
  let freshnessColor = "bg-muted text-muted-foreground border-transparent";

  if (ageSec !== null && !isNaN(ageSec)) {
    if (ageSec < 0) {
      freshnessState = "FUTURE";
      freshnessColor = "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800";
    } else if (ageSec <= freshForSeconds) {
      freshnessState = "FRESH";
      freshnessColor = "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800";
    } else if (ageSec <= staleAfterSeconds) {
      freshnessState = "AGING";
      freshnessColor = "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800";
    } else {
      freshnessState = "STALE";
      freshnessColor = "bg-destructive/10 text-destructive border-destructive/20";
    }
  }

  const formatTime = (ts: string | null) => {
    if (!ts) return "—";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "—";
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  };

  const renderVal = (val: string | number | null | undefined, suffix?: string) => {
    if (val === null || val === undefined || val === "") return <span className="text-muted-foreground italic">{t("common.unknown")}</span>;
    return <span>{val}{suffix ? ` ${suffix}` : ""}</span>;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={freshnessColor}>
            {freshnessState === "FRESH" && <CheckCircle2 className="h-3 w-3 mr-1" />}
            {freshnessState === "AGING" && <Clock className="h-3 w-3 mr-1" />}
            {freshnessState === "STALE" && <AlertTriangle className="h-3 w-3 mr-1" />}
            {freshnessState === "FUTURE" && <AlertTriangle className="h-3 w-3 mr-1" />}
            {freshnessState === "UNKNOWN" && <HelpCircle className="h-3 w-3 mr-1" />}
            {freshnessState === "FUTURE" ? t("vessels.ais.freshness.future") :
             freshnessState === "FRESH" ? t("vessels.ais.freshness.fresh") :
             freshnessState === "AGING" ? t("vessels.ais.freshness.aging") :
             freshnessState === "STALE" ? t("vessels.ais.freshness.stale") :
             t("vessels.ais.freshness.unknown")}
          </Badge>

          {cacheHit ? (
            <Badge variant="secondary" className="text-xs font-medium">{t("vessels.ais.cache_hit")}</Badge>
          ) : (
            <Badge variant="default" className="text-xs font-medium bg-blue-600 hover:bg-blue-600 text-white border-transparent">{t("vessels.ais.live")}</Badge>
          )}

          {simulation && (
            <Badge variant="destructive" className="animate-pulse">{t("vessels.ais.simulated")}</Badge>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground whitespace-nowrap">
            {t("vessels.ais.checked")}: <span className="font-medium text-foreground">{formatTime(checkedAt)}</span>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={isFetching} className="h-7 px-2 text-xs">
            <RefreshCcw className={cn("h-3 w-3 mr-1", isFetching && "animate-spin")} />
            {t("vessels.ais.refresh")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-muted/30 rounded-lg p-4 border border-border/50">
        {/* Coordinates & Movement */}
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("vessels.ais.coords")}</div>
          <div className="text-sm font-medium">
            {tel.latitude !== null && tel.longitude !== null ? (
              <span className="tabular-nums">{tel.latitude.toFixed(5)}, {tel.longitude.toFixed(5)}</span>
            ) : (
              <span className="text-muted-foreground italic">{t("common.unknown")}</span>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-x-2 gap-y-3 text-sm mt-3 border-t pt-3">
            <div>
              <div className="text-[10px] uppercase font-medium text-muted-foreground mb-0.5">{t("vessels.ais.speed")}</div>
              <div className="tabular-nums font-medium">{renderVal(tel.speedKnots, t("vessels.ais.knots"))}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-medium text-muted-foreground mb-0.5">{t("vessels.ais.course")}</div>
              <div className="tabular-nums font-medium">{renderVal(tel.courseDegrees, t("vessels.ais.degrees"))}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-medium text-muted-foreground mb-0.5">{t("vessels.ais.heading")}</div>
              <div className="tabular-nums font-medium">{renderVal(tel.headingDegrees, t("vessels.ais.degrees"))}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-medium text-muted-foreground mb-0.5">{t("vessels.ais.draught")}</div>
              <div className="tabular-nums font-medium">{renderVal(tel.reportedDraughtMeters, t("vessels.ais.meters"))}</div>
            </div>
          </div>
        </div>

        {/* Voyage Info */}
        <div className="space-y-2 lg:border-l border-t lg:border-t-0 border-border/50 lg:pl-4 pt-4 lg:pt-0 mt-2 lg:mt-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("vessels.ais.voyage")}</div>
          <div className="text-sm space-y-3 mt-1 lg:border-t lg:pt-3">
            <div>
              <div className="text-[10px] uppercase font-medium text-muted-foreground mb-0.5">{t("vessels.ais.destination")}</div>
              <div className="font-medium truncate" title={tel.reportedDestination || ""}>{renderVal(tel.reportedDestination)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-medium text-muted-foreground mb-0.5">{t("vessels.ais.eta")}</div>
              <div className="font-medium">{renderVal(tel.reportedEta)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-medium text-muted-foreground mb-0.5">{t("vessels.ais.nav_status")}</div>
              <div className="font-medium">{renderVal(tel.navigationStatus)}</div>
            </div>
          </div>
        </div>

        {/* Identifiers */}
        <div className="space-y-2 lg:border-l border-t lg:border-t-0 border-border/50 lg:pl-4 pt-4 lg:pt-0 mt-2 lg:mt-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("vessels.ais.identifiers")}</div>
          <div className="text-sm space-y-3 mt-1 lg:border-t lg:pt-3">
            <div>
              <div className="text-[10px] uppercase font-medium text-muted-foreground mb-0.5">{t("vessels.ais.mmsi")}</div>
              <div className="tabular-nums font-medium">{renderVal(tel.mmsi)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-medium text-muted-foreground mb-0.5">{t("vessels.ais.imo")}</div>
              <div className="tabular-nums font-medium">{renderVal(tel.imo)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-medium text-muted-foreground mb-0.5">{t("vessels.ais.eni")}</div>
              <div className="tabular-nums font-medium">{renderVal(tel.eni)}</div>
            </div>
          </div>
        </div>

        {/* Provenance */}
        <div className="space-y-2 lg:border-l border-t lg:border-t-0 border-border/50 lg:pl-4 pt-4 lg:pt-0 mt-2 lg:mt-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("vessels.ais.telemetry_provenance")}</div>
          <div className="text-sm space-y-3 mt-1 lg:border-t lg:pt-3">
            <div>
              <div className="text-[10px] uppercase font-medium text-muted-foreground mb-0.5">{t("vessels.ais.provider")}</div>
              <div className="font-medium">
                {tel.provider} {tel.sourceType ? `(${tel.sourceType})` : ""}
                {tel.providerVesselId ? ` - ID: ${tel.providerVesselId}` : ""}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-medium text-muted-foreground mb-0.5">{t("vessels.ais.observed")}</div>
              <div className="tabular-nums font-medium">{formatTime(tel.observedAt)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-medium text-muted-foreground mb-0.5">{t("vessels.ais.received")}</div>
              <div className="tabular-nums font-medium">{formatTime(tel.receivedAt)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-muted/30 p-2.5 rounded-md text-xs text-muted-foreground flex items-start gap-2.5 border">
        <Info className="h-4 w-4 shrink-0 text-muted-foreground/70" />
        <p className="leading-snug">{t("vessels.ais.disclaimer")}</p>
      </div>
    </div>
  );
}