import { useListMyMatches, useListMyNotifications } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, Button } from "@/components/ui/primitives";
import { Handshake, Bell, Box, Anchor } from "lucide-react";
import { useLocation } from "wouter";

export default function Overview() {
  const [, setLocation] = useLocation();
  const { data: matchesData, isLoading: matchesLoading } = useListMyMatches({ pageSize: 5 });
  const { data: notifsData, isLoading: notifsLoading } = useListMyNotifications({ pageSize: 5, unreadOnly: true });

  const activeMatchesCount = matchesData?.total || 0;
  const unreadNotifsCount = notifsData?.unreadCount || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Operational Overview</h1>
        <p className="text-muted-foreground">Welcome back. Here is your current network status.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard 
          title="Active Matches" 
          value={matchesLoading ? "-" : activeMatchesCount.toString()} 
          icon={<Handshake className="h-4 w-4 text-muted-foreground" />} 
          href="/matches"
        />
        <StatsCard 
          title="Unread Alerts" 
          value={notifsLoading ? "-" : unreadNotifsCount.toString()} 
          icon={<Bell className="h-4 w-4 text-muted-foreground" />} 
          href="/notifications"
        />
        <StatsCard 
          title="Marketplace Cargo" 
          value="View" 
          icon={<Box className="h-4 w-4 text-muted-foreground" />} 
          href="/marketplace"
        />
        <StatsCard 
          title="Marketplace Capacity" 
          value="View" 
          icon={<Anchor className="h-4 w-4 text-muted-foreground" />} 
          href="/marketplace"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Matches</CardTitle>
          </CardHeader>
          <CardContent>
            {matchesLoading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : matchesData?.items.length ? (
              <div className="space-y-4">
                {matchesData.items.slice(0, 5).map(match => (
                  <div key={match.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0 last:pb-0">
                    <div>
                      <div className="font-medium">{match.status} Match</div>
                      <div className="text-muted-foreground">Score: {match.score.totalScore}</div>
                    </div>
                    <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80" onClick={() => setLocation(`/matches/${match.id}`)}>View</Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-6">No recent matches found.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Notifications</CardTitle>
          </CardHeader>
          <CardContent>
            {notifsLoading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
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
              <div className="text-sm text-muted-foreground text-center py-6">All caught up! No new notifications.</div>
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
