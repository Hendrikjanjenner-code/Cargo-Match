import type { Request, Response } from "express";
import { eq } from "drizzle-orm";

import {
  companyMembersTable,
  companiesTable,
} from "@workspace/db";
import { db } from "@workspace/db";

type CompanyActivity = "SHIPPER" | "CARRIER" | "CHARTERER";
type MembershipRole = "OWNER" | "ADMIN" | "MEMBER";

export const error = (res: Response, status: number, message: string) => {
  res.status(status).json({ error: message });
};

export function requireAuth(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    error(res, 401, "Authentication required");
    return null;
  }
  res.setHeader("Cache-Control", "private, no-store");
  return req.user.id;
}

export type CurrentMembership = {
  company: typeof companiesTable.$inferSelect;
  membership: typeof companyMembersTable.$inferSelect;
};

/** Pilot commercial authority is explicit; a driver membership never grants it. */
export function hasRoadCommercialAuthority(current: CurrentMembership): boolean {
  return current.membership.active &&
    (current.membership.role === "OWNER" || current.membership.role === "ADMIN");
}

export async function getMembership(
  userId: string,
): Promise<CurrentMembership | null> {
  const [row] = await db
    .select({ company: companiesTable, membership: companyMembersTable })
    .from(companyMembersTable)
    .innerJoin(
      companiesTable,
      eq(companiesTable.id, companyMembersTable.companyId),
    )
    .where(eq(companyMembersTable.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Re-read a membership from the transaction that is about to mutate tenant
 * data. The optional row lock keeps authorization and the dependent write in
 * the same serialized decision.
 */
export async function getMembershipWithin(
  executor: any,
  userId: string,
  lock = false,
): Promise<CurrentMembership | null> {
  let query = executor
    .select({ company: companiesTable, membership: companyMembersTable })
    .from(companyMembersTable)
    .innerJoin(
      companiesTable,
      eq(companiesTable.id, companyMembersTable.companyId),
    )
    .where(eq(companyMembersTable.userId, userId));
  if (lock) query = query.for("update");
  const [row] = await query.limit(1);
  return row ?? null;
}

export async function requireMembership(
  req: Request,
  res: Response,
  options: {
    active?: boolean;
    roles?: MembershipRole[];
  } = {},
): Promise<CurrentMembership | null> {
  const userId = requireAuth(req, res);
  if (!userId) return null;
  const current = await getMembership(userId);
  if (!current || !current.membership.active) {
    error(res, 403, "An active company membership is required");
    return null;
  }
  if (
    options.roles &&
    !options.roles.includes(current.membership.role as MembershipRole)
  ) {
    error(res, 403, "Insufficient company permissions");
    return null;
  }
  if (
    options.active !== false &&
    (current.company.status === "SUSPENDED" ||
      current.company.status === "CLOSED")
  ) {
    error(res, 403, "Company is not active");
    return null;
  }
  return current;
}

export function publicCompanyActivity(value: unknown): CompanyActivity[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is CompanyActivity =>
          entry === "SHIPPER" ||
          entry === "CARRIER" ||
          entry === "CHARTERER",
      )
    : [];
}

export function pageParams(
  page: unknown,
  pageSize: unknown,
): { page: number; pageSize: number; offset: number } {
  const parsedPage = Number(page ?? 1);
  const parsedSize = Number(pageSize ?? 25);
  const safePage =
    Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const safeSize =
    Number.isInteger(parsedSize) && parsedSize > 0
      ? Math.min(parsedSize, 100)
      : 25;
  return { page: safePage, pageSize: safeSize, offset: (safePage - 1) * safeSize };
}

export function parseUuid(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : null;
}

export function isoDate(value: unknown): Date | null {
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}