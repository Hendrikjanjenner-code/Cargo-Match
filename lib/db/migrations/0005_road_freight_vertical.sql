-- Additive ROAD freight vertical. Existing cargo/capacity IDs are reused so
-- shared matches, interests, conversations, and consent remain authoritative.
DO $$ BEGIN
  ALTER TYPE transport_mode ADD VALUE IF NOT EXISTS 'ROAD';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE road_asset_type AS ENUM ('TRUCK', 'TRACTOR', 'TRAILER', 'TRUCK_TRAILER_COMBINATION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE road_availability_source AS ENUM ('MANUAL', 'DRIVER_INPUT', 'TMS', 'TELEMATICS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE road_assignment_status AS ENUM ('ASSIGNED', 'CONFIRMED', 'FLAGGED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE cargo_listings ALTER COLUMN required_vessel_type DROP NOT NULL;
ALTER TABLE capacity_offers ALTER COLUMN vessel_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS road_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_type road_asset_type NOT NULL,
  asset_name varchar(200) NOT NULL CHECK (length(trim(asset_name)) > 0),
  registration_reference varchar(80),
  payload_tonnes double precision NOT NULL CHECK (payload_tonnes > 0),
  volume_cubic_metres double precision NOT NULL CHECK (volume_cubic_metres > 0),
  loading_metres double precision NOT NULL CHECK (loading_metres > 0),
  pallet_positions integer NOT NULL CHECK (pallet_positions > 0),
  trailer_type varchar(80),
  equipment text[] NOT NULL DEFAULT ARRAY[]::text[],
  temperature_min_celsius double precision,
  temperature_max_celsius double precision,
  adr_classes text[] NOT NULL DEFAULT ARRAY[]::text[],
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (temperature_min_celsius IS NULL OR temperature_max_celsius IS NULL OR temperature_min_celsius <= temperature_max_celsius)
);
CREATE INDEX IF NOT EXISTS road_assets_company_idx ON road_assets(company_id);
CREATE INDEX IF NOT EXISTS road_assets_company_active_idx ON road_assets(company_id, active);

CREATE TABLE IF NOT EXISTS road_cargo_requirements (
  cargo_listing_id uuid PRIMARY KEY REFERENCES cargo_listings(id) ON DELETE CASCADE,
  volume_cubic_metres double precision CHECK (volume_cubic_metres IS NULL OR volume_cubic_metres > 0),
  loading_metres double precision CHECK (loading_metres IS NULL OR loading_metres > 0),
  pallet_positions integer CHECK (pallet_positions IS NULL OR pallet_positions > 0),
  required_trailer_type varchar(80),
  required_equipment text[] NOT NULL DEFAULT ARRAY[]::text[],
  temperature_min_celsius double precision,
  temperature_max_celsius double precision,
  adr_classes text[] NOT NULL DEFAULT ARRAY[]::text[],
  direction varchar(200),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (temperature_min_celsius IS NULL OR temperature_max_celsius IS NULL OR temperature_min_celsius <= temperature_max_celsius)
);

CREATE TABLE IF NOT EXISTS road_capacity_extensions (
  capacity_offer_id uuid PRIMARY KEY REFERENCES capacity_offers(id) ON DELETE CASCADE,
  road_asset_id uuid NOT NULL REFERENCES road_assets(id),
  current_delivery_location_id uuid NOT NULL REFERENCES locations(id),
  current_delivery_expected_at timestamptz NOT NULL,
  expected_availability_location_id uuid NOT NULL REFERENCES locations(id),
  expected_availability_at timestamptz NOT NULL,
  availability_uncertainty_minutes integer NOT NULL DEFAULT 0 CHECK (availability_uncertainty_minutes >= 0),
  availability_source road_availability_source NOT NULL DEFAULT 'MANUAL',
  available_volume_cubic_metres double precision NOT NULL CHECK (available_volume_cubic_metres > 0),
  available_loading_metres double precision NOT NULL CHECK (available_loading_metres > 0),
  available_pallet_positions integer NOT NULL CHECK (available_pallet_positions > 0),
  trailer_type varchar(80),
  equipment text[] NOT NULL DEFAULT ARRAY[]::text[],
  temperature_min_celsius double precision,
  temperature_max_celsius double precision,
  adr_classes text[] NOT NULL DEFAULT ARRAY[]::text[],
  preferred_direction varchar(200),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (temperature_min_celsius IS NULL OR temperature_max_celsius IS NULL OR temperature_min_celsius <= temperature_max_celsius)
);
CREATE INDEX IF NOT EXISTS road_capacity_extensions_asset_idx ON road_capacity_extensions(road_asset_id);
CREATE INDEX IF NOT EXISTS road_capacity_extensions_availability_idx ON road_capacity_extensions(expected_availability_location_id, expected_availability_at);

CREATE TABLE IF NOT EXISTS road_driver_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capacity_offer_id uuid NOT NULL REFERENCES capacity_offers(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_user_id varchar(255) NOT NULL,
  assigned_by_user_id varchar(255) NOT NULL,
  status road_assignment_status NOT NULL DEFAULT 'ASSIGNED',
  operational_note text,
  flagged_reason text,
  flagged_match_id uuid REFERENCES matches(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (capacity_offer_id, driver_user_id)
);
CREATE INDEX IF NOT EXISTS road_assignments_driver_idx ON road_driver_assignments(driver_user_id, status);
CREATE INDEX IF NOT EXISTS road_assignments_company_idx ON road_driver_assignments(company_id, status);
CREATE TABLE IF NOT EXISTS road_operational_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES road_driver_assignments(id) ON DELETE CASCADE,
  capacity_offer_id uuid NOT NULL REFERENCES capacity_offers(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  driver_user_id varchar(255) NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS road_operational_flags_assignment_idx ON road_operational_flags(assignment_id, created_at);
CREATE INDEX IF NOT EXISTS road_operational_flags_match_idx ON road_operational_flags(match_id);