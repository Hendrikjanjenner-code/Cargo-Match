-- Additive Deepsea Dry Bulk pilot migration.
-- Existing rows remain INLAND_WATERWAY and CONFIRMED; no data is removed.
DO $$ BEGIN
  CREATE TYPE transport_mode AS ENUM ('INLAND_WATERWAY', 'DEEPSEA_BULK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE deepsea_vessel_class AS ENUM (
    'HANDYSIZE', 'HANDYMAX', 'SUPRAMAX', 'ULTRAMAX', 'PANAMAX',
    'KAMSARMAX', 'POST_PANAMAX', 'CAPESIZE', 'NEWCASTLEMAX', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE availability_confidence AS ENUM ('EXPECTED', 'CONFIRMED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE vessels ADD COLUMN IF NOT EXISTS transport_mode transport_mode NOT NULL DEFAULT 'INLAND_WATERWAY';
ALTER TABLE cargo_listings ADD COLUMN IF NOT EXISTS transport_mode transport_mode NOT NULL DEFAULT 'INLAND_WATERWAY';
ALTER TABLE capacity_offers ADD COLUMN IF NOT EXISTS transport_mode transport_mode NOT NULL DEFAULT 'INLAND_WATERWAY';
ALTER TABLE capacity_offers ADD COLUMN IF NOT EXISTS availability_confidence availability_confidence NOT NULL DEFAULT 'CONFIRMED';
CREATE INDEX IF NOT EXISTS vessels_company_mode_idx ON vessels(company_id, transport_mode);
CREATE INDEX IF NOT EXISTS cargo_mode_marketplace_idx ON cargo_listings(transport_mode, listing_status);
CREATE INDEX IF NOT EXISTS capacity_mode_marketplace_idx ON capacity_offers(transport_mode, listing_status);

CREATE TABLE IF NOT EXISTS deepsea_vessel_profiles (
  vessel_id uuid PRIMARY KEY REFERENCES vessels(id) ON DELETE CASCADE,
  vessel_class deepsea_vessel_class NOT NULL,
  dwt_tonnes double precision NOT NULL CHECK (dwt_tonnes > 0),
  summer_draft_metres double precision CHECK (summer_draft_metres IS NULL OR summer_draft_metres > 0),
  gear_configuration varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deepsea_vessel_profiles_dwt_idx ON deepsea_vessel_profiles(dwt_tonnes);

CREATE TABLE IF NOT EXISTS deepsea_cargo_requirements (
  cargo_listing_id uuid PRIMARY KEY REFERENCES cargo_listings(id) ON DELETE CASCADE,
  quantity_tolerance_percent double precision NOT NULL DEFAULT 0 CHECK (quantity_tolerance_percent >= 0 AND quantity_tolerance_percent < 100),
  minimum_vessel_dwt_tonnes double precision CHECK (minimum_vessel_dwt_tonnes IS NULL OR minimum_vessel_dwt_tonnes > 0),
  maximum_vessel_dwt_tonnes double precision CHECK (maximum_vessel_dwt_tonnes IS NULL OR maximum_vessel_dwt_tonnes > 0),
  maximum_draft_metres double precision CHECK (maximum_draft_metres IS NULL OR maximum_draft_metres > 0),
  required_gear varchar(120),
  preferred_vessel_class deepsea_vessel_class,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Safe for an already-applied migration: this changes only the future insert
-- default and deliberately does not rewrite existing explicit values.
ALTER TABLE deepsea_cargo_requirements
  ALTER COLUMN quantity_tolerance_percent SET DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE deepsea_cargo_requirements
    ADD CONSTRAINT deepsea_cargo_tolerance_check
    CHECK (quantity_tolerance_percent >= 0 AND quantity_tolerance_percent < 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE deepsea_cargo_requirements
    ADD CONSTRAINT deepsea_cargo_dwt_range_check
    CHECK (
      minimum_vessel_dwt_tonnes IS NULL OR maximum_vessel_dwt_tonnes IS NULL
      OR minimum_vessel_dwt_tonnes <= maximum_vessel_dwt_tonnes
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS deepsea_capacity_extensions (
  capacity_offer_id uuid PRIMARY KEY REFERENCES capacity_offers(id) ON DELETE CASCADE,
  manual_positioning_days integer CHECK (manual_positioning_days IS NULL OR manual_positioning_days >= 0),
  approximate_max_distance_km double precision CHECK (approximate_max_distance_km IS NULL OR approximate_max_distance_km > 0),
  previous_voyage_context text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);