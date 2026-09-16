import { useListMyMatches, useListMyNotifications } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, Button } from "@/components/ui/primitives";
import { Handshake, Bell, Box, Anchor } from "lucide-react";
import { useLocation } from "wouter";
import { t } from "@/lib/i18n";

export default function Overview() {
  const [, setLocation] = useLocation();
  const { data: matchesData, isLoading: matchesLoading } = useListMyMatches({ pageSize: 5 });
  const { data: notifsData, isLoading: notifsLoading } = useListMyNotifications({ pageSize: 5, unreadOnly: true });

  const activeMatchesCount = matchesData?.total || 0;
  const unreadNotifsCount = notifsData?.unreadCount || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("overview.title")}</h1>
        <p className="text-muted-foreground">{t("overview.subtitle")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard 
          title={t("overview.active_matches")}
          value={matchesLoading ? "-" : activeMatchesCount.toString()} 
          icon={<Handshake className="h-4 w-4 text-muted-foreground" />} 
          href="/matches"
        />
        <StatsCard 
          title={t("overview.unread_alerts")}
          value={notifsLoading ? "-" : unreadNotifsCount.toString()} 
          icon={<Bell className="h-4 w-4 text-muted-foreground" />} 
          href="/notifications"
        />
        <StatsCard 
          title={t("overview.marketplace_cargo")}
          value={t("overview.view")}
          icon={<Box className="h-4 w-4 text-muted-foreground" />} 
          href="/marketplace"
        />
        <StatsCard 
          title={t("overview.marketplace_capacity")}
          value={t("overview.view")}
          icon={<Anchor className="h-4 w-4 text-muted-foreground" />} 
          href="/marketplace"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("overview.recent_matches")}</CardTitle>
          </CardHeader>
          <CardContent>
            {matchesLoading ? (
              <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
            ) : matchesData?.items.length ? (
              <div className="space-y-4">
                {matchesData.items.slice(0, 5).map(match => (
                  <div key={match.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0 last:pb-0">
                    <div>
                      <div className="font-medium">{t(`status.${match.status.toLowerCase()}`)} {t("matches.title")}</div>
                      <div className="text-muted-foreground">{t("overview.score")}: {match.score.totalScore}</div>
                    </div>
                    <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80" onClick={() => setLocation(`/matches/${match.id}`)}>{t("action.view")}</Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-6">{t("overview.no_recent_matches")}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("overview.recent_notifications")}</CardTitle>
          </CardHeader>
          <CardContent>
            {notifsLoading ? (
              <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
            ) : notifsData?.items.length ? (
              <div className="space-y-4">
                {notifsData.items.slice(0, 5).map(notif => (
                  <div key={notif.id} className="text-sm border-b pb-2 last:border-0 last:pb-0">
                    <div className="font-medium">{notif.title}</div>
                    <div className="text-muted-foreground truncate">{notif.message}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-6">{t("overview.no_new_notifications")}</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatsCard({ title, value, icon, href }: { title: string, value: string, icon: React.ReactNode, href: string }) {
  const [, setLocation] = useLocation();
  return (
    <Card>
      <div onClick={() => setLocation(href)} className="block hover:bg-muted/50 transition-colors rounded-lg cursor-pointer">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {icon}
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{value}</div>
        </CardContent>
      </div>
    </Card>
  );
}
