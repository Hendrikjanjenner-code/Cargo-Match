import {
  GetMyConversationParams,
  GetMyConversationResponse,
  ListConversationMessagesParams,
  ListConversationMessagesResponse,
  ListMyConversationsQueryParams,
  ListMyConversationsResponse,
  MarkConversationMessagesReadBody,
  MarkConversationMessagesReadParams,
  MarkConversationMessagesReadResponse,
  SendConversationMessageBody,
  SendConversationMessageParams,
  SendConversationMessageResponse,
} from "@workspace/api-zod";
import { and, desc, eq, inArray, notInArray, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  capacityOffersTable,
  cargoListingsTable,
  companiesTable,
  companyMembersTable,
  conversationsTable,
  matchesTable,
  messageReadsTable,
  messagesTable,
  notificationsTable,
  linerCargoTable,
  linerSailingsTable,
  linerServicesTable,
  db,
} from "@workspace/db";

import { error, getMembershipWithin, pageParams, requireMembership } from "../lib/http";
import { connectedCompany } from "../lib/privacy";
import { lockDomain } from "../services/matching";

const router: IRouter = Router();

type ConversationView = {
  conversation: typeof conversationsTable.$inferSelect;
  participantCompanies: Array<typeof companiesTable.$inferSelect>;
  lastMessage: (typeof messagesTable.$inferSelect & { readAt: Date | null }) | null;
  unreadCount: number;
};

async function getConversation(
  conversationId: string,
  userId: string,
  companyId: string,
): Promise<ConversationView | null> {
  const [base] = await db.select({ conversation: conversationsTable, match: matchesTable })
    .from(conversationsTable).innerJoin(matchesTable, eq(matchesTable.id, conversationsTable.matchId))
    .where(and(eq(conversationsTable.id, conversationId), eq(matchesTable.status, "CONNECTED")));
  if (!base) return null;
  let row: { conversation: typeof conversationsTable.$inferSelect; cargoCompanyId: string; capacityCompanyId: string } | null = null;
  if (base.match.linerCargoId && base.match.linerSailingId) {
    const [liner] = await db.select({ cargoCompanyId: linerCargoTable.companyId, capacityCompanyId: linerServicesTable.companyId })
      .from(linerCargoTable).innerJoin(linerSailingsTable, eq(linerSailingsTable.id, base.match.linerSailingId))
      .innerJoin(linerServicesTable, eq(linerServicesTable.id, linerSailingsTable.serviceId))
      .where(eq(linerCargoTable.id, base.match.linerCargoId));
    if (liner) row = { conversation: base.conversation, ...liner };
  } else if (base.match.cargoListingId && base.match.capacityOfferId) {
    const [standard] = await db.select({ cargoCompanyId: cargoListingsTable.companyId, capacityCompanyId: capacityOffersTable.companyId })
      .from(cargoListingsTable).innerJoin(capacityOffersTable, eq(capacityOffersTable.id, base.match.capacityOfferId))
      .where(eq(cargoListingsTable.id, base.match.cargoListingId));
    if (standard) row = { conversation: base.conversation, ...standard };
  }
  if (!row || (row.cargoCompanyId !== companyId && row.capacityCompanyId !== companyId)) return null;
  return row ? buildConversationView(row, userId) : null;
}

async function buildConversationView(
  row: {
    conversation: typeof conversationsTable.$inferSelect;
    cargoCompanyId: string;
    capacityCompanyId: string;
  },
  userId: string,
): Promise<ConversationView> {
  const [participantCompanies, allMessages] = await Promise.all([
    db
      .select()
      .from(companiesTable)
      .where(
        inArray(companiesTable.id, [
          row.cargoCompanyId,
          row.capacityCompanyId,
        ]),
      ),
    db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, row.conversation.id))
      .orderBy(desc(messagesTable.createdAt)),
  ]);
  const reads = allMessages.length
    ? await db
        .select()
        .from(messageReadsTable)
        .where(
          and(
            eq(messageReadsTable.userId, userId),
            inArray(
              messageReadsTable.messageId,
              allMessages.map((message) => message.id),
            ),
          ),
        )
    : [];
  const readMap = new Map(reads.map((read) => [read.messageId, read.readAt]));
  const last = allMessages[0];
  return {
    conversation: row.conversation,
    participantCompanies,
    lastMessage: last ? { ...last, readAt: readMap.get(last.id) ?? null } : null,
    unreadCount: allMessages.filter(
      (message) => message.senderUserId !== userId && !readMap.has(message.id),
    ).length,
  };
}

function viewResponse(view: ConversationView) {
  return {
    id: view.conversation.id,
    matchId: view.conversation.matchId,
    participantCompanies: view.participantCompanies.map(connectedCompany),
    lastMessage: view.lastMessage,
    unreadCount: view.unreadCount,
    createdAt: view.conversation.createdAt,
    updatedAt: view.conversation.updatedAt,
  };
}

router.get("/conversations", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = ListMyConversationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    error(res, 400, "Invalid conversation filters");
    return;
  }
  const rows = await db.select({ id: conversationsTable.id }).from(conversationsTable)
    .innerJoin(matchesTable, eq(matchesTable.id, conversationsTable.matchId))
    .where(eq(matchesTable.status, "CONNECTED"));
  const conversationIds = rows.map(({ id }) => id);
  const views = [];
  for (const id of conversationIds) {
    const view = await getConversation(id, req.user!.id, current.company.id);
    if (view) views.push(view);
  }
  const { page, pageSize, offset } = pageParams(
    parsed.data.page,
    parsed.data.pageSize,
  );
  res.json(
    ListMyConversationsResponse.parse({
      items: views.slice(offset, offset + pageSize).map(viewResponse),
      page,
      pageSize,
      total: views.length,
    }),
  );
});

router.get("/conversations/:conversationId", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = GetMyConversationParams.safeParse(req.params);
  if (!parsed.success) {
    error(res, 400, "Invalid conversation id");
    return;
  }
  const view = await getConversation(
    parsed.data.conversationId,
    req.user!.id,
    current.company.id,
  );
  if (!view) {
    error(res, 404, "Conversation not found");
    return;
  }
  res.json(GetMyConversationResponse.parse(viewResponse(view)));
});

router.get("/conversations/:conversationId/messages", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = ListConversationMessagesParams.safeParse(req.params);
  if (!parsed.success) {
    error(res, 400, "Invalid conversation id");
    return;
  }
  const view = await getConversation(
    parsed.data.conversationId,
    req.user!.id,
    current.company.id,
  );
  if (!view) {
    error(res, 404, "Conversation not found");
    return;
  }
  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, view.conversation.id))
    .orderBy(messagesTable.createdAt);
  const reads = messages.length
    ? await db
        .select()
        .from(messageReadsTable)
        .where(
          and(
            eq(messageReadsTable.userId, req.user!.id),
            inArray(messageReadsTable.messageId, messages.map(({ id }) => id)),
          ),
        )
    : [];
  const readMap = new Map(reads.map((read) => [read.messageId, read.readAt]));
  res.json(
    ListConversationMessagesResponse.parse({
      items: messages.map((message) => ({
        ...message,
        readAt: readMap.get(message.id) ?? null,
      })),
      page: 1,
      pageSize: messages.length,
      total: messages.length,
    }),
  );
});

router.post("/conversations/:conversationId/messages", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const params = SendConversationMessageParams.safeParse(req.params);
  const body = SendConversationMessageBody.safeParse({
    ...req.body,
    body: typeof req.body?.body === "string" ? req.body.body.trim() : req.body?.body,
  });
  if (!params.success || !body.success) {
    error(res, 400, "Invalid message");
    return;
  }
  const view = await getConversation(
    params.data.conversationId,
    req.user!.id,
    current.company.id,
  );
  if (!view) {
    error(res, 404, "Conversation not found");
    return;
  }
  const message = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const freshMembership = await getMembershipWithin(tx, req.user!.id, true);
    if (!freshMembership || !freshMembership.membership.active || freshMembership.company.status !== "ACTIVE" || freshMembership.company.id !== current.company.id) return null;
    const [created] = await tx
      .insert(messagesTable)
      .values({
        conversationId: view.conversation.id,
        senderCompanyId: freshMembership.company.id,
        senderUserId: req.user!.id,
        body: body.data.body.trim(),
      })
      .returning();
    const recipientMembers = await tx
      .select({ userId: companyMembersTable.userId })
      .from(companyMembersTable)
      .where(
        and(
          inArray(companyMembersTable.companyId, view.participantCompanies.map((company) => company.id)),
          notInArray(companyMembersTable.companyId, [freshMembership.company.id]),
          eq(companyMembersTable.active, true),
        ),
      );
    if (recipientMembers.length) {
      await tx.insert(notificationsTable).values(
        recipientMembers.map(({ userId }) => ({
          userId,
          type: "NEW_MESSAGE" as const,
          title: "New conversation message",
          message: "You have a new message from a connected company.",
          relatedConversationId: view.conversation.id,
        })),
      );
    }
    return created;
  });
  if (!message) return error(res, 403, "Company membership is no longer authorized");
  res.status(201).json(
    SendConversationMessageResponse.parse({ ...message, readAt: null }),
  );
});

router.post("/conversations/:conversationId/read", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const params = MarkConversationMessagesReadParams.safeParse(req.params);
  const body = MarkConversationMessagesReadBody.safeParse(req.body);
  if (!params.success || !body.success) {
    error(res, 400, "Invalid read state");
    return;
  }
  const view = await getConversation(
    params.data.conversationId,
    req.user!.id,
    current.company.id,
  );
  if (!view) {
    error(res, 404, "Conversation not found");
    return;
  }
  const messages = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, view.conversation.id),
        inArray(messagesTable.id, body.data.messageIds),
      ),
    );
  if (messages.length !== body.data.messageIds.length) {
    error(res, 400, "One or more messages are not in this conversation");
    return;
  }
  const readAt = new Date();
  const marked = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const freshMembership = await getMembershipWithin(tx, req.user!.id, true);
    if (!freshMembership || !freshMembership.membership.active || freshMembership.company.status !== "ACTIVE" || freshMembership.company.id !== current.company.id) return false;
    await tx
      .insert(messageReadsTable)
      .values(
        messages.map(({ id }) => ({
          messageId: id,
          userId: req.user!.id,
          readAt,
        })),
      )
      .onConflictDoUpdate({
        target: [messageReadsTable.messageId, messageReadsTable.userId],
        set: { readAt },
      });
    return true;
  });
  if (!marked) {
    error(res, 403, "Company membership is no longer authorized");
    return;
  }
  res.json(
    MarkConversationMessagesReadResponse.parse({
      messageIds: messages.map(({ id }) => id),
      readAt,
    }),
  );
});

export default router;