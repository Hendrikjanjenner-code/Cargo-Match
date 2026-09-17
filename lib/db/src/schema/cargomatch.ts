import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { usersTable } from "./auth";

export const companyActivityEnum = pgEnum("company_activity", [
  "SHIPPER",
  "CARRIER",
  "CHARTERER",
]);
export const membershipRoleEnum = pgEnum("membership_role", [
  "OWNER",
  "ADMIN",
  "MEMBER",
]);
export const companyStatusEnum = pgEnum("company_status", [
  "ACTIVE",
  "SUSPENDED",
  "CLOSED",
]);
export const vesselTypeEnum = pgEnum("vessel_type", [
  "DRY_CARGO",
  "TANKER",
  "CONTAINER",
  "PUSH_BARGE",
  "OTHER",
]);
export const transportModeEnum = pgEnum("transport_mode", [
  "INLAND_WATERWAY",
  "DEEPSEA_BULK",
]);
export const deepseaVesselClassEnum = pgEnum("deepsea_vessel_class", [
  "HANDYSIZE",
  "HANDYMAX",
  "SUPRAMAX",
  "ULTRAMAX",
  "PANAMAX",
  "KAMSARMAX",
  "POST_PANAMAX",
  "CAPESIZE",
  "NEWCASTLEMAX",
  "OTHER",
]);
export const availabilityConfidenceEnum = pgEnum("availability_confidence", [
  "EXPECTED",
  "CONFIRMED",
]);
export const locationTypeEnum = pgEnum("location_type", [
  "PORT",
  "TERMINAL_AREA",
  "CITY",
  "INDUSTRIAL_AREA",
  "OTHER",
]);
export const visibilityEnum = pgEnum("visibility", ["PRIVATE", "OPEN_NETWORK"]);
export const listingStatusEnum = pgEnum("listing_status", [
  "DRAFT",
  "ACTIVE",
  "WITHDRAWN",
  "EXPIRED",
  "CLOSED",
]);
export const availabilityTypeEnum = pgEnum("availability_type", [
  "FULLY_EMPTY",
  "PARTIALLY_AVAILABLE",
]);
export const matchStatusEnum = pgEnum("match_status", [
  "NEW",
  "INTEREST_SENT",
  "CONNECTED",
  "DECLINED",
  "EXPIRED",
]);
export const interestStatusEnum = pgEnum("interest_status", [
  "PENDING",
  "ACCEPTED",
  "DECLINED",
]);
export const notificationTypeEnum = pgEnum("notification_type", [
  "NEW_MATCH",
  "INTEREST_RECEIVED",
  "INTEREST_ACCEPTED",
  "INTEREST_DECLINED",
  "NEW_MESSAGE",
  "LISTING_EXPIRES_SOON",
]);
export const vesselIdentifierTypeEnum = pgEnum("vessel_identifier_type", [
  "ENI",
  "MMSI",
  "IMO",
  "VESSELFINDER_ID",
  "MARINETRAFFIC_ID",
  "OTHER",
]);
export const identityConflictStatusEnum = pgEnum("identity_conflict_status", [
  "OPEN",
  "RESOLVED",
]);

export const companiesTable = pgTable(
  "companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 200 }).notNull(),
    country: varchar("country", { length: 2 }).notNull(),
    activities: text("activities").array().notNull(),
    primaryContactName: varchar("primary_contact_name", {
      length: 200,
    }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    phone: varchar("phone", { length: 64 }).notNull(),
    vatRegistrationNumber: varchar("vat_registration_number", { length: 64 }),
    verified: boolean("verified").notNull().default(false),
    status: companyStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("companies_status_idx").on(table.status),
    uniqueIndex("companies_name_country_idx").on(table.name, table.country),
  ],
);

export const companyMembersTable = pgTable(
  "company_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull().default("MEMBER"),
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
    uniqueIndex("company_members_company_user_idx").on(
      table.companyId,
      table.userId,
    ),
    uniqueIndex("company_members_user_unique_idx").on(table.userId),
    index("company_members_user_idx").on(table.userId),
  ],
);

export const locationsTable = pgTable(
  "locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 200 }).notNull(),
    country: varchar("country", { length: 2 }).notNull(),
    region: varchar("region", { length: 200 }).notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    privacyLatitude: doublePrecision("privacy_latitude").notNull(),
    privacyLongitude: doublePrecision("privacy_longitude").notNull(),
    locationType: locationTypeEnum("location_type").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    uniqueIndex("locations_name_country_idx").on(table.name, table.country),
    index("locations_active_idx").on(table.active),
  ],
);

export const vesselsTable = pgTable(
  "vessels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    transportMode: transportModeEnum("transport_mode")
      .notNull()
      .default("INLAND_WATERWAY"),
    vesselName: varchar("vessel_name", { length: 200 }).notNull(),
    eniNumber: varchar("eni_number", { length: 32 }),
    vesselType: vesselTypeEnum("vessel_type").notNull(),
    totalCapacityTonnes: doublePrecision("total_capacity_tonnes").notNull(),
    lengthMetres: doublePrecision("length_metres"),
    widthMetres: doublePrecision("width_metres"),
    maximumDraftMetres: doublePrecision("maximum_draft_metres"),
    cargoCompatibility: text("cargo_compatibility").array().notNull(),
    homeRegion: varchar("home_region", { length: 200 }),
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
    index("vessels_company_idx").on(table.companyId),
    index("vessels_company_active_idx").on(table.companyId, table.active),
    index("vessels_company_mode_idx").on(table.companyId, table.transportMode),
    uniqueIndex("vessels_company_name_idx").on(
      table.companyId,
      table.vesselName,
    ),
  ],
);

/** Mode-specific dry-bulk particulars; the base vessel row remains shared. */
export const deepseaVesselProfilesTable = pgTable(
  "deepsea_vessel_profiles",
  {
    vesselId: uuid("vessel_id")
      .primaryKey()
      .references(() => vesselsTable.id, { onDelete: "cascade" }),
    vesselClass: deepseaVesselClassEnum("vessel_class").notNull(),
    dwtTonnes: doublePrecision("dwt_tonnes").notNull(),
    summerDraftMetres: doublePrecision("summer_draft_metres"),
    gearConfiguration: varchar("gear_configuration", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("deepsea_vessel_profiles_dwt_idx").on(table.dwtTonnes)],
);

/**
 * A tenant claim about a CargoMatch vessel and one stable external AIS
 * identity. Draft claims are tenant-local; only operator-reviewed verified
 * rows participate in the global uniqueness boundary used by AIS.
 * Identifier values are kept separate from vessel names deliberately: names
 * are not an identity key and are never accepted by the identity API.
 */
export const vesselExternalIdentifiersTable = pgTable(
  "vessel_external_identifiers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    vesselId: uuid("vessel_id")
      .notNull()
      .references(() => vesselsTable.id, { onDelete: "cascade" }),
    identifierType: vesselIdentifierTypeEnum("identifier_type").notNull(),
    identifierValue: varchar("identifier_value", { length: 200 }).notNull(),
    /**
     * Normalized key material is intentionally not exposed by the API. It
     * makes the uniqueness constraint deterministic across casing/whitespace
     * and treats canonical ENI/MMSI/IMO identifiers as provider-neutral.
     */
    normalizedIdentifierValue: varchar("normalized_identifier_value", {
      length: 200,
    }).notNull(),
    provider: varchar("provider", { length: 64 }),
    providerKey: varchar("provider_key", { length: 64 }).notNull(),
    verified: boolean("verified").notNull().default(false),
    verificationEvidence: jsonb("verification_evidence").$type<{
      source: string;
      reference?: string;
      notes?: string;
      capturedAt?: string;
    } | null>(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /**
     * Only the server-filesystem operator verification path may set this
     * marker. A tenant's evidence and verified flag never establish trust.
     */
    operatorReviewedAt: timestamp("operator_reviewed_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("vessel_external_identifiers_verified_unique_idx")
      .on(
        table.identifierType,
        table.normalizedIdentifierValue,
        table.providerKey,
      )
      .where(
        sql`${table.verified} = true AND ${table.operatorReviewedAt} IS NOT NULL`,
      ),
    uniqueIndex("vessel_external_identifiers_draft_unique_idx").on(
      table.companyId,
      table.identifierType,
      table.normalizedIdentifierValue,
      table.providerKey,
    ),
    index("vessel_external_identifiers_company_vessel_idx").on(
      table.companyId,
      table.vesselId,
    ),
    index("vessel_external_identifiers_vessel_idx").on(table.vesselId),
  ],
);

/**
 * Failed registrations are recorded without copying any conflicting tenant's
 * mapping into the caller-visible response. This gives operators an auditable
 * conflict trail while preserving tenant isolation.
 */
export const vesselIdentityConflictsTable = pgTable(
  "vessel_identity_conflicts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    vesselId: uuid("vessel_id")
      .notNull()
      .references(() => vesselsTable.id, { onDelete: "cascade" }),
    identifierType: vesselIdentifierTypeEnum("identifier_type").notNull(),
    normalizedIdentifierValue: varchar("normalized_identifier_value", {
      length: 200,
    }).notNull(),
    providerKey: varchar("provider_key", { length: 64 }).notNull(),
    provider: varchar("provider", { length: 64 }),
    reason: varchar("reason", { length: 80 }).notNull(),
    status: identityConflictStatusEnum("status").notNull().default("OPEN"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: varchar("resolved_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("vessel_identity_conflicts_company_vessel_idx").on(
      table.companyId,
      table.vesselId,
      table.createdAt,
    ),
    index("vessel_identity_conflicts_status_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);

export const cargoListingsTable = pgTable(
  "cargo_listings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    transportMode: transportModeEnum("transport_mode")
      .notNull()
      .default("INLAND_WATERWAY"),
    cargoName: varchar("cargo_name", { length: 200 }).notNull(),
    cargoType: varchar("cargo_type", { length: 100 }).notNull(),
    weightTonnes: doublePrecision("weight_tonnes").notNull(),
    loadingLocationId: uuid("loading_location_id")
      .notNull()
      .references(() => locationsTable.id),
    destinationLocationId: uuid("destination_location_id")
      .notNull()
      .references(() => locationsTable.id),
    loadingFrom: timestamp("loading_from", { withTimezone: true }).notNull(),
    loadingUntil: timestamp("loading_until", { withTimezone: true }).notNull(),
    expectedUnloadingDate: date("expected_unloading_date", { mode: "string" }),
    requiredVesselType: vesselTypeEnum("required_vessel_type").notNull(),
    specialRequirements: text("special_requirements"),
    visibility: visibilityEnum("visibility").notNull(),
    notes: text("notes"),
    listingStatus: listingStatusEnum("listing_status")
      .notNull()
      .default("DRAFT"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("cargo_company_idx").on(table.companyId),
    index("cargo_marketplace_idx").on(
      table.listingStatus,
      table.visibility,
      table.loadingFrom,
    ),
    index("cargo_loading_location_idx").on(table.loadingLocationId),
    index("cargo_mode_marketplace_idx").on(table.transportMode, table.listingStatus),
  ],
);

export const deepseaCargoRequirementsTable = pgTable(
  "deepsea_cargo_requirements",
  {
    cargoListingId: uuid("cargo_listing_id")
      .primaryKey()
      .references(() => cargoListingsTable.id, { onDelete: "cascade" }),
    quantityTolerancePercent: doublePrecision("quantity_tolerance_percent")
      .notNull()
      .default(0),
    minimumVesselDwtTonnes: doublePrecision("minimum_vessel_dwt_tonnes"),
    maximumVesselDwtTonnes: doublePrecision("maximum_vessel_dwt_tonnes"),
    maximumDraftMetres: doublePrecision("maximum_draft_metres"),
    requiredGear: varchar("required_gear", { length: 120 }),
    preferredVesselClass: deepseaVesselClassEnum("preferred_vessel_class"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "deepsea_cargo_tolerance_check",
      sql`${table.quantityTolerancePercent} >= 0 AND ${table.quantityTolerancePercent} < 100`,
    ),
    check(
      "deepsea_cargo_dwt_range_check",
      sql`${table.minimumVesselDwtTonnes} IS NULL OR ${table.maximumVesselDwtTonnes} IS NULL OR ${table.minimumVesselDwtTonnes} <= ${table.maximumVesselDwtTonnes}`,
    ),
  ],
);

export const capacityOffersTable = pgTable(
  "capacity_offers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    transportMode: transportModeEnum("transport_mode")
      .notNull()
      .default("INLAND_WATERWAY"),
    vesselId: uuid("vessel_id")
      .notNull()
      .references(() => vesselsTable.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locationsTable.id),
    availableFrom: timestamp("available_from", {
      withTimezone: true,
    }).notNull(),
    availableUntil: timestamp("available_until", {
      withTimezone: true,
    }).notNull(),
    availabilityType: availabilityTypeEnum("availability_type").notNull(),
    availableCapacityTonnes: doublePrecision(
      "available_capacity_tonnes",
    ).notNull(),
    cargoCompatibility: text("cargo_compatibility").array().notNull(),
    preferredDirection: varchar("preferred_direction", {
      length: 200,
    }).notNull(),
    maximumPositioningDistanceKm: doublePrecision(
      "maximum_positioning_distance_km",
    ).notNull(),
    visibility: visibilityEnum("visibility").notNull(),
    availabilityConfidence: availabilityConfidenceEnum("availability_confidence")
      .notNull()
      .default("CONFIRMED"),
    notes: text("notes"),
    listingStatus: listingStatusEnum("listing_status")
      .notNull()
      .default("DRAFT"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("capacity_company_idx").on(table.companyId),
    index("capacity_marketplace_idx").on(
      table.listingStatus,
      table.visibility,
      table.availableFrom,
    ),
    index("capacity_location_idx").on(table.locationId),
    index("capacity_vessel_idx").on(table.vesselId),
    index("capacity_mode_marketplace_idx").on(
      table.transportMode,
      table.listingStatus,
    ),
  ],
);

/**
 * Expected future open-position details for deepsea bulk. Capacity offers
 * retain the common capacity/listing/consent foreign keys and workflow.
 */
export const deepseaCapacityExtensionsTable = pgTable(
  "deepsea_capacity_extensions",
  {
    capacityOfferId: uuid("capacity_offer_id")
      .primaryKey()
      .references(() => capacityOffersTable.id, { onDelete: "cascade" }),
    manualPositioningDays: integer("manual_positioning_days"),
    approximateMaxDistanceKm: doublePrecision("approximate_max_distance_km"),
    previousVoyageContext: text("previous_voyage_context"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export const matchesTable = pgTable(
  "matches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cargoListingId: uuid("cargo_listing_id")
      .notNull()
      .references(() => cargoListingsTable.id, { onDelete: "cascade" }),
    capacityOfferId: uuid("capacity_offer_id")
      .notNull()
      .references(() => capacityOffersTable.id, { onDelete: "cascade" }),
    status: matchStatusEnum("status").notNull().default("NEW"),
    totalScore: doublePrecision("total_score").notNull(),
    distanceScore: doublePrecision("distance_score").notNull(),
    timingScore: doublePrecision("timing_score").notNull(),
    capacityScore: doublePrecision("capacity_score").notNull(),
    vesselTypeScore: doublePrecision("vessel_type_score").notNull(),
    directionScore: doublePrecision("direction_score").notNull(),
    cargoCompatibilityScore: doublePrecision(
      "cargo_compatibility_score",
    ).notNull(),
    approximatePositioningDistanceKm: doublePrecision(
      "approximate_positioning_distance_km",
    ).notNull(),
    calculationVersion: varchar("calculation_version", {
      length: 32,
    }).notNull(),
    calculatedAt: timestamp("calculated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    evaluationInputs: jsonb("evaluation_inputs")
      .$type<Record<string, string>>()
      .notNull(),
    explanation: text("explanation").notNull(),
    isStale: boolean("is_stale").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("matches_cargo_capacity_idx").on(
      table.cargoListingId,
      table.capacityOfferId,
    ),
    index("matches_status_idx").on(table.status),
    index("matches_cargo_idx").on(table.cargoListingId),
    index("matches_capacity_idx").on(table.capacityOfferId),
  ],
);

export const interestsTable = pgTable(
  "interests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matchesTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    status: interestStatusEnum("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("interests_match_company_idx").on(
      table.matchId,
      table.companyId,
    ),
    index("interests_match_idx").on(table.matchId),
  ],
);

export const conversationsTable = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matchesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("conversations_match_idx").on(table.matchId)],
);

export const messagesTable = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    senderCompanyId: uuid("sender_company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    senderUserId: varchar("sender_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

export const messageReadsTable = pgTable(
  "message_reads",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messagesTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId] }),
    index("message_reads_user_idx").on(table.userId),
  ],
);

export const notificationsTable = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    message: text("message").notNull(),
    relatedMatchId: uuid("related_match_id").references(() => matchesTable.id, {
      onDelete: "set null",
    }),
    relatedConversationId: uuid("related_conversation_id").references(
      () => conversationsTable.id,
      { onDelete: "set null" },
    ),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("notifications_user_created_idx").on(table.userId, table.createdAt),
    index("notifications_unread_idx").on(table.userId, table.readAt),
  ],
);

export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: varchar("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    companyId: uuid("company_id").references(() => companiesTable.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 80 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
    index("audit_logs_company_idx").on(table.companyId, table.createdAt),
  ],
);

export const companyRelations = relations(companiesTable, ({ many }) => ({
  members: many(companyMembersTable),
  vessels: many(vesselsTable),
  cargoListings: many(cargoListingsTable),
  capacityOffers: many(capacityOffersTable),
}));

export const companyMembersRelations = relations(
  companyMembersTable,
  ({ one }) => ({
    company: one(companiesTable, {
      fields: [companyMembersTable.companyId],
      references: [companiesTable.id],
    }),
    user: one(usersTable, {
      fields: [companyMembersTable.userId],
      references: [usersTable.id],
    }),
  }),
);
