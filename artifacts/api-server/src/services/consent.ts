import { and, eq, inArray } from "drizzle-orm";
import {
  companyMembersTable,
  conversationsTable,
  interestsTable,
  matchesTable,
  notificationsTable,
} from "@workspace/db";

type Executor = any;

export type ConsentAction = "INTEREST" | "ACCEPT" | "DECLINE";

/**
 * One consent state machine for every match domain. Callers must lock and
 * freshly revalidate domain eligibility before invoking it. CONNECTED rows
 * are intentionally never invalidated by later listing withdrawals.
 */
export async function applyMatchConsent(
  tx: Executor,
  input: {
    match: typeof matchesTable.$inferSelect;
    actorCompanyId: string;
    action: ConsentAction;
    participantCompanyIds: [string, string];
    notificationDomain: "marketplace" | "liner";
    commercialPlannersOnly?: boolean;
  },
) {
  const { match, actorCompanyId, action, participantCompanyIds, notificationDomain } = input;
  if (!participantCompanyIds.includes(actorCompanyId)) throw new Error("STALE_MATCH");
  const [existingInterest] = await tx.select().from(interestsTable).where(and(eq(interestsTable.matchId, match.id), eq(interestsTable.companyId, actorCompanyId)));
  const [pending] = await tx.select().from(interestsTable).where(and(eq(interestsTable.matchId, match.id), eq(interestsTable.status, "PENDING")));
  const notify = async (companyIds: string[], type: "INTEREST_RECEIVED" | "INTEREST_ACCEPTED" | "INTEREST_DECLINED", title: string, message: string, conversationId?: string) => {
    const recipients = await tx.select({ userId: companyMembersTable.userId }).from(companyMembersTable).where(and(
      inArray(companyMembersTable.companyId, companyIds),
      eq(companyMembersTable.active, true),
      ...(input.commercialPlannersOnly ? [inArray(companyMembersTable.role, ["OWNER", "ADMIN"])] : []),
    ));
    if (recipients.length) await tx.insert(notificationsTable).values(recipients.map(({ userId }: { userId: string }) => ({ userId, type, title, message, relatedMatchId: match.id, relatedMatchDomain: notificationDomain === "liner" ? "LINER" : "MARKETPLACE", relatedConversationId: conversationId })));
  };
  const noun = notificationDomain === "liner" ? "liner" : "marketplace";
  if (action === "INTEREST") {
    if (match.status !== "NEW" || existingInterest) throw new Error("INVALID_INTEREST");
    await tx.insert(interestsTable).values({ matchId: match.id, companyId: actorCompanyId, status: "PENDING" });
    await tx.update(matchesTable).set({ status: "INTEREST_SENT", updatedAt: new Date() }).where(eq(matchesTable.id, match.id));
    await notify(participantCompanyIds.filter((id) => id !== actorCompanyId), "INTEREST_RECEIVED", "New match interest", `A company has shown interest in an eligible ${noun} match.`);
    return;
  }
  if (action === "ACCEPT") {
    if (match.status !== "INTEREST_SENT" || existingInterest || !pending || pending.companyId === actorCompanyId) throw new Error("INVALID_ACCEPT");
    await tx.update(interestsTable).set({ status: "ACCEPTED", updatedAt: new Date() }).where(eq(interestsTable.id, pending.id));
    await tx.insert(interestsTable).values({ matchId: match.id, companyId: actorCompanyId, status: "ACCEPTED" });
    const [conversation] = await tx.insert(conversationsTable).values({ matchId: match.id }).onConflictDoNothing({ target: conversationsTable.matchId }).returning();
    await tx.update(matchesTable).set({ status: "CONNECTED", isStale: false, updatedAt: new Date() }).where(eq(matchesTable.id, match.id));
    await notify([...participantCompanyIds], "INTEREST_ACCEPTED", "Match connected", `Both companies consented to connect on a ${noun} opportunity. Conversation access is now available.`, conversation?.id);
    return;
  }
  if (match.status !== "INTEREST_SENT" || existingInterest || !pending || pending.companyId === actorCompanyId) throw new Error("INVALID_DECLINE");
  await tx.update(interestsTable).set({ status: "DECLINED", updatedAt: new Date() }).where(eq(interestsTable.id, pending.id));
  await tx.update(matchesTable).set({ status: "DECLINED", updatedAt: new Date() }).where(eq(matchesTable.id, match.id));
  await notify(participantCompanyIds.filter((id) => id !== actorCompanyId), "INTEREST_DECLINED", "Match declined", `The other company declined this ${noun} match.`);
}