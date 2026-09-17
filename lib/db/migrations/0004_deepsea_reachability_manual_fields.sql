-- Additive Deepsea reachability fields.
-- Existing estimates are preserved; widening integer days to double precision
-- enables fractional user estimates without truncation.
DO $$ BEGIN
  CREATE TYPE deepsea_route_choice AS ENUM (
    'UNSPECIFIED', 'DIRECT', 'SUEZ', 'PANAMA', 'CAPE_GOOD_HOPE', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE deepsea_capacity_extensions
  ALTER COLUMN manual_positioning_days TYPE double precision
  USING manual_positioning_days::double precision;

ALTER TABLE deepsea_capacity_extensions
  ADD COLUMN IF NOT EXISTS route_choice deepsea_route_choice
    NOT NULL DEFAULT 'UNSPECIFIED',
  ADD COLUMN IF NOT EXISTS route_notes varchar(500),
  ADD COLUMN IF NOT EXISTS departure_uncertainty_days double precision,
  ADD COLUMN IF NOT EXISTS positioning_buffer_days double precision;

DO $$ BEGIN
  ALTER TABLE deepsea_capacity_extensions
    ADD CONSTRAINT deepsea_departure_uncertainty_check
    CHECK (
      departure_uncertainty_days IS NULL OR
      (departure_uncertainty_days >= 0 AND departure_uncertainty_days <= 365)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE deepsea_capacity_extensions
    ADD CONSTRAINT deepsea_positioning_buffer_check
    CHECK (
      positioning_buffer_days IS NULL OR
      (positioning_buffer_days >= 0 AND positioning_buffer_days <= 365)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;