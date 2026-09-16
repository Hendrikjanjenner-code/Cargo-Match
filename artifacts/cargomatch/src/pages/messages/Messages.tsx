import { useListMyConversations } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/primitives";
import { AlertCircle, MessageSquare } from "lucide-react";
import { useLocation } from "wouter";
import { formatDate } from "@/lib/utils";
import { t } from "@/lib/i18n";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export default function Messages() {
  const [, setLocation] = useLocation();
  const { data, isLoading, error } = useListMyConversations();

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("messages.title")}</h1>
        <p className="text-muted-foreground">{t("messages.subtitle")}</p>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="text-center p-8 text-muted-foreground">{t("common.loading")}</div>
        ) : error ? (
          <div role="alert" className="flex items-start justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-8 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage(error, t("error.load_conversations"))}</span>
          </div>
        ) : data?.items.length === 0 ? (
          <Card className="p-12 text-center text-muted-foreground flex flex-col items-center">
            <MessageSquare className="h-12 w-12 mb-4 opacity-20" />
            <p>{t("messages.no_conversations")}</p>
            <p className="text-sm mt-2">{t("messages.no_conversations_sub")}</p>
          </Card>
        ) : (
          data?.items.map(conv => (
            <div key={conv.id} onClick={() => setLocation(`/messages/${conv.id}`)}>
              <Card className={`hover:border-primary transition-colors cursor-pointer ${conv.unreadCount > 0 ? 'bg-primary/5' : ''}`}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      {conv.participantCompanies.map(c => c.name).join(" & ")}
                      {conv.unreadCount > 0 && (
                        <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full">
                           {conv.unreadCount} {t("messages.new")}
                        </span>
                      )}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                       {conv.lastMessage?.body || t("messages.no_messages_yet")}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground text-right shrink-0 ml-4">
                    {formatDate(conv.updatedAt)}
                  </div>
                </CardContent>
              </Card>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
