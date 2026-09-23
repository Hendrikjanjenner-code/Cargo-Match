import { pgTable, text, jsonb, integer, timestamp, index, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod/v4";

/** No foreign keys to real users, companies, sessions or commercial records. */
export const demoSandboxesTable = pgTable("demo_sandboxes", {
  tokenHash: text("token_hash").primaryKey(),
  csrfToken: text("csrf_token").notNull(),
  personaId: text("persona_id").notNull(),
  revision: integer("revision").notNull().default(1),
  state: jsonb("state").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("demo_sandboxes_expiry_idx").on(table.expiresAt)]);
export const insertDemoSandboxSchema = createInsertSchema(demoSandboxesTable);
export type InsertDemoSandbox = z.infer<typeof insertDemoSandboxSchema>;
export type DemoSandbox = typeof demoSandboxesTable.$inferSelect;
export const demoEcosystemsTable = pgTable("demo_ecosystems", {
  id: text("id").primaryKey(), state: jsonb("state").notNull(), generation: integer("generation").notNull().default(1),
  createdAt: timestamp("created_at", {withTimezone: true}).notNull().defaultNow(),
});
export const demoCompaniesTable = pgTable("demo_companies", {id: text("id").primaryKey(), profile: jsonb("profile").notNull()});
export const demoUsersTable = pgTable("demo_users", {
  id: text("id").primaryKey(), profile: jsonb("profile").notNull(), active: boolean("active").notNull().default(true),
});
export const demoMembershipsTable = pgTable("demo_memberships", {
  userId: text("user_id").primaryKey().references(() => demoUsersTable.id),
  companyId: text("company_id").notNull().references(() => demoCompaniesTable.id), active: boolean("active").notNull().default(true),
});
export const demoSessionsTable = pgTable("demo_sessions", {
  tokenHash: text("token_hash").primaryKey(), ecosystemId: text("ecosystem_id").notNull().references(() => demoEcosystemsTable.id),
  personaId: text("persona_id").notNull().references(() => demoUsersTable.id), csrfToken: text("csrf_token").notNull(),
  revision: integer("revision").notNull().default(1), expiresAt: timestamp("expires_at", {withTimezone: true}).notNull(),
}, t => [index("demo_sessions_expiry_idx").on(t.expiresAt)]);
export const insertDemoEcosystemSchema = createInsertSchema(demoEcosystemsTable);
export const insertDemoUserSchema = createInsertSchema(demoUsersTable);
export const insertDemoCompanySchema = createInsertSchema(demoCompaniesTable);
export const insertDemoMembershipSchema = createInsertSchema(demoMembershipsTable);
export const insertDemoSessionSchema = createInsertSchema(demoSessionsTable);