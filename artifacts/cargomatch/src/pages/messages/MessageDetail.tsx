import { useState, useEffect, useRef } from "react";
import { useRoute, Link } from "wouter";
import { 
  useGetMyConversation, 
  useListConversationMessages, 
  useSendConversationMessage, 
  useMarkConversationMessagesRead,
  getGetMyConversationQueryKey,
  getListConversationMessagesQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, Button, Textarea } from "@/components/ui/primitives";
import { ArrowLeft, Send } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { t } from "@/lib/i18n";

export default function MessageDetail() {
  const [, params] = useRoute("/messages/:id");
  const id = params?.id || "";
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversation, isLoading: convLoading } = useGetMyConversation(id, {
    query: { enabled: !!id, queryKey: getGetMyConversationQueryKey(id) }
  });

  const { data: messagesData, isLoading: msgsLoading } = useListConversationMessages(id, {
    query: { 
      enabled: !!id, 
      queryKey: getListConversationMessagesQueryKey(id),
      refetchInterval: 5000 // Poll every 5s for real-time feel
    }
  });

  const sendMessage = useSendConversationMessage();
  const markRead = useMarkConversationMessagesRead();
  const markReadFnRef = useRef(markRead.mutate);
  markReadFnRef.current = markRead.mutate;

  const messages = messagesData?.items || [];
  const unreadMsgIds = messages.filter(m => !m.readAt).map(m => m.id);

  useEffect(() => {
    if (unreadMsgIds.length > 0 && id) {
      markReadFnRef.current({ conversationId: id, data: { messageIds: unreadMsgIds } }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListConversationMessagesQueryKey(id) })
      });
    }
  }, [unreadMsgIds.length, id, queryClient]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    sendMessage.mutate({ conversationId: id, data: { body: body.trim() } }, {
      onSuccess: () => {
        setBody("");
        queryClient.invalidateQueries({ queryKey: getListConversationMessagesQueryKey(id) });
      }
    });
  };

  if (convLoading || msgsLoading) return <div className="p-8 text-center text-muted-foreground">{t("common.loading")}</div>;
  if (!conversation) return <div className="p-8 text-center text-destructive">Conversation not found.</div>;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-4 pb-4 border-b">
        <Link href="/messages" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {conversation.participantCompanies.map(c => c.name).join(" & ")}
          </h1>
          <p className="text-xs text-muted-foreground">Match Reference: {conversation.matchId}</p>
        </div>
      </div>

      <Card className="flex-1 overflow-hidden flex flex-col bg-muted/20 border-x-0 sm:border-x">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">{t("messages.start_conversation")}</div>
          ) : (
            messages.slice().reverse().map(msg => {
              // Very simple heuristic for own vs other message layout based on styling. 
              // Without knowing exact own company ID from simple msg object, we assume we want simple alternating or just neutral list.
              // Actually, we can fetch my company and compare senderCompanyId, but a neutral UI is fine for pilot.
              return (
                <div key={msg.id} className="flex flex-col mb-4 bg-white p-3 rounded-lg border shadow-sm max-w-[85%] self-start">
                  <div className="text-xs font-semibold text-primary mb-1">
                    {conversation.participantCompanies.find(c => c.id === msg.senderCompanyId)?.name || "User"}
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{msg.body}</div>
                  <div className="text-[10px] text-muted-foreground mt-2 text-right">
                    {formatDateTime(msg.createdAt)}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-background border-t">
          <form onSubmit={handleSend} className="flex gap-2">
            <Textarea 
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder={t("messages.send_placeholder")}
              className="resize-none min-h-[44px] h-[44px]"
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(e);
                }
              }}
            />
            <Button type="submit" disabled={!body.trim() || sendMessage.isPending} className="h-[44px] px-6">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
