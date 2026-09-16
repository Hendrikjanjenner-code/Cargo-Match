import { useListMyNotifications, useMarkNotificationRead, getListMyNotificationsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/primitives";
import { Bell, CheckCircle2 } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";
import { t } from "@/lib/i18n";

export default function Notifications() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useListMyNotifications({ pageSize: 50 }, { query: { queryKey: getListMyNotificationsQueryKey({ pageSize: 50 }), refetchInterval: 15000 } });
  const markRead = useMarkNotificationRead();

  const handleMarkRead = (id: string) => {
    markRead.mutate({ notificationId: id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMyNotificationsQueryKey() })
    });
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
           <h1 className="text-2xl font-bold tracking-tight">{t("notifications.title")}</h1>
           <p className="text-muted-foreground">{t("notifications.subtitle")}</p>
        </div>
      </div>

      <div className="space-y-3">
        {isLoading ? (
           <div className="text-center p-8 text-muted-foreground">{t("notifications.loading")}</div>
        ) : data?.items.length === 0 ? (
          <Card className="p-12 text-center text-muted-foreground flex flex-col items-center">
            <Bell className="h-12 w-12 mb-4 opacity-20" />
             <p>{t("notifications.empty")}</p>
          </Card>
        ) : (
          data?.items.map(notif => (
            <Card key={notif.id} className={!notif.readAt ? 'bg-primary/5 border-primary/20' : ''}>
              <CardContent className="p-4 flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-sm">{notif.title}</h3>
                    {!notif.readAt && <span className="w-2 h-2 rounded-full bg-primary inline-block" />}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {notif.message}
                  </p>
                  <div className="text-xs text-muted-foreground mt-2">
                    {formatDateTime(notif.createdAt)}
                  </div>
                </div>
                {!notif.readAt && (
                  <Button variant="ghost" size="sm" onClick={() => handleMarkRead(notif.id)} className="text-muted-foreground hover:text-primary shrink-0">
                     <CheckCircle2 className="h-4 w-4 mr-2" /> {t("action.mark_read")}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
