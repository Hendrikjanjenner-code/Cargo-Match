import { pgTable, text, jsonb, integer, timestamp, index } from "drizzle-orm/pg-core";
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