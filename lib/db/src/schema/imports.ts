import { pgTable, uuid, jsonb, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { companiesTable } from "./cargomatch";

/** Domain metadata only. Document bytes live exclusively in private App Storage. */
export const companyImportsTable = pgTable("company_imports", {
  companyId: uuid("company_id").primaryKey().references(() => companiesTable.id, { onDelete: "cascade" }),
  state: jsonb("state").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertCompanyImportsSchema = createInsertSchema(companyImportsTable);
export type CompanyImports = typeof companyImportsTable.$inferSelect;