import {
  ListMyNotificationsQueryParams,
  ListMyNotificationsResponse,
  MarkNotificationReadParams,
  MarkNotificationReadResponse,
} from "@workspace/api-zod";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, notificationsTable } from "@workspace/db";

import { error, pageParams, requireAuth } from "../lib/http";
import { lockDomain } from "../services/matching";

const router: IRouter = Router();

router.get("/notifications", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const parsed = ListMyNotificationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    error(res, 400, "Invalid notification filters");
    return;
  }
  const { page, pageSize, offset } = pageParams(
    parsed.data.page,
    parsed.data.pageSize,
  );
  const where = parsed.data.unreadOnly
    ? and(
        eq(notificationsTable.userId, userId),
        isNull(notificationsTable.readAt),
      )
    : eq(notificationsTable.userId, userId);
  const [items, [{ total }], [{ unreadCount }]] = await Promise.all([
    db
      .select()
      .from(notificationsTable)
      .where(where)
      .orderBy(desc(notificationsTable.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: count() }).from(notificationsTable).where(where),
    db
      .select({ unreadCount: count() })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, userId),
          isNull(notificationsTable.readAt),
        ),
      ),
  ]);
  res.json(
    ListMyNotificationsResponse.parse({
      items,
      page,
      pageSize,
      total,
      unreadCount,
    }),
  );
});

router.post("/notifications/:notificationId/read", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const parsed = MarkNotificationReadParams.safeParse(req.params);
  if (!parsed.success) {
    error(res, 400, "Invalid notification id");
    return;
  }
  const notification = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const [updated] = await tx
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notificationsTable.id, parsed.data.notificationId),
          eq(notificationsTable.userId, userId),
        ),
      )
      .returning();
    return updated;
  });
  if (!notification) {
    error(res, 404, "Notification not found");
    return;
  }
  res.json(MarkNotificationReadResponse.parse(notification));
});

export default router;