import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

/** Only upload receipts: object bytes remain in private App Storage. */
export const importUploadsTable = pgTable("import_uploads", {
  objectPath: text("object_path").primaryKey(),
  ownerScope: text("owner_scope").notNull(),
  shipmentId: text("shipment_id").notNull(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  immutablePath: text("immutable_path"),
  expiresAt: timestamp("expires_at", {withTimezone: true}).notNull(),
});
export const insertImportUploadSchema = createInsertSchema(importUploadsTable);
export type ImportUpload = typeof importUploadsTable.$inferSelect;