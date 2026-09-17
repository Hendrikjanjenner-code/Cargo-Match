import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { usersTable } from "./auth";
import {
  capacityOffersTable,
  companiesTable,
  locationsTable,
  vesselsTable,
} from "./cargomatch";

export const availabilitySuggestionStatusEnum = pgEnum(
  "availability_suggestion_status",
  ["PENDING", "DISMISSED", "CONVERTED"],
);

/**
 * A tenant-authored, immutable operational plan. It is deliberately not a
 * telemetry record: source metadata is retained only to explain who supplied
 * the plan and when it was observed.
 */
export const availabilitySuggestionsTable = pgTable(
  "availability_suggestions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    vesselId: uuid("vessel_id")
      .notNull()
      .references(() => vesselsTable.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locationsTable.id),
    createdBy: varchar("created_by")
      .notNull()
      .references(() => usersTable.id),
    expectedAvailableFrom: timestamp("expected_available_from", {
      withTimezone: true,
    }).notNull(),
    expectedAvailableUntil: timestamp("expected_available_until", {
      withTimezone: true,
    }).notNull(),
    sourceReference: varchar("source_reference", { length: 300 }).notNull(),
    sourceObservedAt: timestamp("source_observed_at", {
      withTimezone: true,
    }).notNull(),
    participationConfirmed: boolean("participation_confirmed").notNull(),
    sourceUseConfirmed: boolean("source_use_confirmed").notNull(),
    uncertaintyAcknowledged: boolean("uncertainty_acknowledged").notNull(),
    identityMappingId: uuid("identity_mapping_id").notNull(),
    identityMappingRevision: varchar("identity_mapping_revision", {
      length: 128,
    }).notNull(),
    status: availabilitySuggestionStatusEnum("status")
      .notNull()
      .default("PENDING"),
    capacityOfferId: uuid("capacity_offer_id").references(
      () => capacityOffersTable.id,
      { onDelete: "set null" },
    ),
    convertedBy: varchar("converted_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "availability_suggestions_window_check",
      sql`${table.expectedAvailableFrom} < ${table.expectedAvailableUntil}`,
    ),
    check(
      "availability_suggestions_acknowledgements_check",
      sql`${table.participationConfirmed} = true AND ${table.sourceUseConfirmed} = true AND ${table.uncertaintyAcknowledged} = true`,
    ),
    index("availability_suggestions_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    index("availability_suggestions_status_idx").on(table.status),
    index("availability_suggestions_vessel_idx").on(table.vesselId),
  ],
);

export const availabilitySuggestionRelations = relations(
  availabilitySuggestionsTable,
  ({ one }) => ({
    company: one(companiesTable, {
      fields: [availabilitySuggestionsTable.companyId],
      references: [companiesTable.id],
    }),
    vessel: one(vesselsTable, {
      fields: [availabilitySuggestionsTable.vesselId],
      references: [vesselsTable.id],
    }),
    location: one(locationsTable, {
      fields: [availabilitySuggestionsTable.locationId],
      references: [locationsTable.id],
    }),
  }),
);

export type AvailabilitySuggestion =
  typeof availabilitySuggestionsTable.$inferSelect;
export type NewAvailabilitySuggestion =
  typeof availabilitySuggestionsTable.$inferInsert;