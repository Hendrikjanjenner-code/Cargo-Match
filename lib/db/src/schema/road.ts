import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  capacityOffersTable,
  cargoListingsTable,
  companiesTable,
  locationsTable,
  matchesTable,
} from "./cargomatch";

export const roadAssetTypeEnum = pgEnum("road_asset_type", [
  "TRUCK",
  "TRACTOR",
  "TRAILER",
  "TRUCK_TRAILER_COMBINATION",
]);
export const roadAvailabilitySourceEnum = pgEnum("road_availability_source", [
  "MANUAL",
  "DRIVER_INPUT",
  "TMS",
  "TELEMATICS",
]);
export const roadAssignmentStatusEnum = pgEnum("road_assignment_status", [
  "ASSIGNED",
  "CONFIRMED",
  "FLAGGED",
]);

/**
 * A real physical road asset. Telematics identifiers are deliberately absent:
 * the pilot starts with manual/planner/driver input and does not create a
 * vendor subscription or imply that GPS proves commercial availability.
 */
export const roadAssetsTable = pgTable(
  "road_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    assetType: roadAssetTypeEnum("asset_type").notNull(),
    assetName: varchar("asset_name", { length: 200 }).notNull(),
    registrationReference: varchar("registration_reference", { length: 80 }),
    payloadTonnes: doublePrecision("payload_tonnes").notNull(),
    volumeCubicMetres: doublePrecision("volume_cubic_metres").notNull(),
    loadingMetres: doublePrecision("loading_metres").notNull(),
    palletPositions: integer("pallet_positions").notNull(),
    trailerType: varchar("trailer_type", { length: 80 }),
    equipment: text("equipment").array().notNull().default(sql`ARRAY[]::text[]`),
    temperatureMinCelsius: doublePrecision("temperature_min_celsius"),
    temperatureMaxCelsius: doublePrecision("temperature_max_celsius"),
    adrClasses: text("adr_classes").array().notNull().default(sql`ARRAY[]::text[]`),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("road_assets_company_idx").on(table.companyId),
    index("road_assets_company_active_idx").on(table.companyId, table.active),
    check("road_assets_payload_check", sql`${table.payloadTonnes} > 0`),
    check("road_assets_volume_check", sql`${table.volumeCubicMetres} > 0`),
    check("road_assets_loading_metres_check", sql`${table.loadingMetres} > 0`),
    check("road_assets_pallets_check", sql`${table.palletPositions} > 0`),
    check(
      "road_assets_temperature_range_check",
      sql`${table.temperatureMinCelsius} IS NULL OR ${table.temperatureMaxCelsius} IS NULL OR ${table.temperatureMinCelsius} <= ${table.temperatureMaxCelsius}`,
    ),
  ],
);

/** Road-only requirements attached to the shared cargo listing ID. */
export const roadCargoRequirementsTable = pgTable(
  "road_cargo_requirements",
  {
    cargoListingId: uuid("cargo_listing_id")
      .primaryKey()
      .references(() => cargoListingsTable.id, { onDelete: "cascade" }),
    volumeCubicMetres: doublePrecision("volume_cubic_metres"),
    loadingMetres: doublePrecision("loading_metres"),
    palletPositions: integer("pallet_positions"),
    requiredTrailerType: varchar("required_trailer_type", { length: 80 }),
    requiredEquipment: text("required_equipment").array().notNull().default(sql`ARRAY[]::text[]`),
    temperatureMinCelsius: doublePrecision("temperature_min_celsius"),
    temperatureMaxCelsius: doublePrecision("temperature_max_celsius"),
    adrClasses: text("adr_classes").array().notNull().default(sql`ARRAY[]::text[]`),
    direction: varchar("direction", { length: 200 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    check("road_cargo_volume_check", sql`${table.volumeCubicMetres} IS NULL OR ${table.volumeCubicMetres} > 0`),
    check("road_cargo_loading_metres_check", sql`${table.loadingMetres} IS NULL OR ${table.loadingMetres} > 0`),
    check("road_cargo_pallets_check", sql`${table.palletPositions} IS NULL OR ${table.palletPositions} > 0`),
    check(
      "road_cargo_temperature_range_check",
      sql`${table.temperatureMinCelsius} IS NULL OR ${table.temperatureMaxCelsius} IS NULL OR ${table.temperatureMinCelsius} <= ${table.temperatureMaxCelsius}`,
    ),
  ],
);

/**
 * The future road availability claim is intentionally manual and explicit.
 * Current delivery is retained to explain the derivation; GPS/telematics
 * signals never automatically turn this row into commercial capacity.
 */
export const roadCapacityExtensionsTable = pgTable(
  "road_capacity_extensions",
  {
    capacityOfferId: uuid("capacity_offer_id")
      .primaryKey()
      .references(() => capacityOffersTable.id, { onDelete: "cascade" }),
    roadAssetId: uuid("road_asset_id")
      .notNull()
      .references(() => roadAssetsTable.id),
    currentDeliveryLocationId: uuid("current_delivery_location_id")
      .notNull()
      .references(() => locationsTable.id),
    currentDeliveryExpectedAt: timestamp("current_delivery_expected_at", {
      withTimezone: true,
    }).notNull(),
    expectedAvailabilityLocationId: uuid("expected_availability_location_id")
      .notNull()
      .references(() => locationsTable.id),
    expectedAvailabilityAt: timestamp("expected_availability_at", {
      withTimezone: true,
    }).notNull(),
    availabilityUncertaintyMinutes: integer("availability_uncertainty_minutes")
      .notNull()
      .default(0),
    availabilitySource: roadAvailabilitySourceEnum("availability_source")
      .notNull()
      .default("MANUAL"),
    availableVolumeCubicMetres: doublePrecision("available_volume_cubic_metres").notNull(),
    availableLoadingMetres: doublePrecision("available_loading_metres").notNull(),
    availablePalletPositions: integer("available_pallet_positions").notNull(),
    trailerType: varchar("trailer_type", { length: 80 }),
    equipment: text("equipment").array().notNull().default(sql`ARRAY[]::text[]`),
    temperatureMinCelsius: doublePrecision("temperature_min_celsius"),
    temperatureMaxCelsius: doublePrecision("temperature_max_celsius"),
    adrClasses: text("adr_classes").array().notNull().default(sql`ARRAY[]::text[]`),
    preferredDirection: varchar("preferred_direction", { length: 200 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("road_capacity_extensions_asset_idx").on(table.roadAssetId),
    index("road_capacity_extensions_availability_idx").on(
      table.expectedAvailabilityLocationId,
      table.expectedAvailabilityAt,
    ),
    check("road_capacity_uncertainty_check", sql`${table.availabilityUncertaintyMinutes} >= 0`),
    check("road_capacity_volume_check", sql`${table.availableVolumeCubicMetres} > 0`),
    check("road_capacity_loading_metres_check", sql`${table.availableLoadingMetres} > 0`),
    check("road_capacity_pallets_check", sql`${table.availablePalletPositions} > 0`),
    check("road_capacity_temperature_range_check", sql`${table.temperatureMinCelsius} IS NULL OR ${table.temperatureMaxCelsius} IS NULL OR ${table.temperatureMinCelsius} <= ${table.temperatureMaxCelsius}`),
  ],
);

export const roadDriverAssignmentsTable = pgTable(
  "road_driver_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    capacityOfferId: uuid("capacity_offer_id")
      .notNull()
      .references(() => capacityOffersTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    driverUserId: varchar("driver_user_id", { length: 255 }).notNull(),
    assignedByUserId: varchar("assigned_by_user_id", { length: 255 }).notNull(),
    status: roadAssignmentStatusEnum("status").notNull().default("ASSIGNED"),
    operationalNote: text("operational_note"),
    flaggedReason: text("flagged_reason"),
    flaggedMatchId: uuid("flagged_match_id").references(() => matchesTable.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("road_assignments_capacity_driver_idx").on(table.capacityOfferId, table.driverUserId),
    index("road_assignments_driver_idx").on(table.driverUserId, table.status),
    index("road_assignments_company_idx").on(table.companyId, table.status),
  ],
);

export const roadOperationalFlagsTable = pgTable(
  "road_operational_flags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assignmentId: uuid("assignment_id").notNull().references(() => roadDriverAssignmentsTable.id, { onDelete: "cascade" }),
    capacityOfferId: uuid("capacity_offer_id").notNull().references(() => capacityOffersTable.id, { onDelete: "cascade" }),
    matchId: uuid("match_id").notNull().references(() => matchesTable.id, { onDelete: "cascade" }),
    driverUserId: varchar("driver_user_id", { length: 255 }).notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("road_operational_flags_assignment_idx").on(table.assignmentId, table.createdAt),
    index("road_operational_flags_match_idx").on(table.matchId),
  ],
);

export const roadAssetsRelations = relations(roadAssetsTable, ({ one, many }) => ({
  company: one(companiesTable, { fields: [roadAssetsTable.companyId], references: [companiesTable.id] }),
  capacityExtensions: many(roadCapacityExtensionsTable),
}));