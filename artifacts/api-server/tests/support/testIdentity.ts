/**
 * Test-only identity fixture.
 *
 * This helper is imported by test files only. It creates a normal Replit
 * session row and returns the same cookie value that production auth
 * middleware consumes. It is deliberately not under src and is not imported
 * by the application bundle.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { companyMembersTable, companiesTable, db, usersTable } from "@workspace/db";

import { createSession, deleteSession, type SessionData } from "../../src/lib/auth";

export async function createTestIdentity(options: {
  email?: string;
  companyName?: string;
  role?: "OWNER" | "ADMIN" | "MEMBER";
  withCompany?: boolean;
} = {}) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Test identities cannot be created in production");
  }
  // OIDC subjects are opaque strings, not domain-entity UUIDs.
  const userId = `oidc-test-${randomUUID()}`;
  const email = options.email ?? `test-${userId}@example.invalid`;
  const [user] = await db
    .insert(usersTable)
    .values({
      id: userId,
      email,
      firstName: "Test",
      lastName: "Identity",
    })
    .returning();
  const company = options.withCompany === false
    ? null
    : await createCompany(userId, email, options);
  const session: SessionData = {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
    },
    access_token: "test-session",
  };
  const sid = await createSession(session);
  return { user, company, sid, cookie: `sid=${sid}` };
}

async function createCompany(
  userId: string,
  email: string,
  options: {
    companyName?: string;
    role?: "OWNER" | "ADMIN" | "MEMBER";
  },
) {
  const [company] = await db
    .insert(companiesTable)
    .values({
      name: options.companyName ?? `Test Company ${userId}`,
      country: "NL",
      activities: ["SHIPPER", "CARRIER"],
      primaryContactName: "Test Identity",
      email,
      phone: "+31000000000",
    })
    .returning();
  await db.insert(companyMembersTable).values({
    companyId: company.id,
    userId,
    role: options.role ?? "OWNER",
  });
  return company;
}

export async function addTestMembership(
  userId: string,
  companyId: string,
  role: "OWNER" | "ADMIN" | "MEMBER" = "MEMBER",
) {
  const [membership] = await db
    .insert(companyMembersTable)
    .values({ userId, companyId, role })
    .returning();
  return membership;
}

export async function disposeTestIdentity(identity: Awaited<ReturnType<typeof createTestIdentity>>) {
  await deleteSession(identity.sid);
  if (identity.company) {
    await db.delete(companiesTable).where(eq(companiesTable.id, identity.company.id));
  }
  await db.delete(usersTable).where(eq(usersTable.id, identity.user.id));
}