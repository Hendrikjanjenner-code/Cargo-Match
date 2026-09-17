-- Additive conventional/breakbulk liner vertical. It does not alter inland or
-- deepsea source data and does not invent vessel rows from commercial listings.
DO $$ BEGIN
  CREATE TYPE liner_cargo_type AS ENUM (
    'BREAKBULK', 'PROJECT_CARGO', 'HEAVY_LIFT', 'STEEL', 'MACHINERY', 'RORO'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE liner_stowage AS ENUM ('DECK', 'HOLD', 'EITHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS liner_vessels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vessel_name varchar(200) NOT NULL CHECK (length(trim(vessel_name)) > 0),
  imo_number varchar(7) NOT NULL CHECK (imo_number ~ '^[0-9]{7}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, imo_number)
);
CREATE INDEX IF NOT EXISTS liner_vessels_company_active_idx ON liner_vessels(company_id, active);

CREATE TABLE IF NOT EXISTS liner_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  service_name varchar(200) NOT NULL CHECK (length(trim(service_name)) > 0),
  trade_lane varchar(300) NOT NULL CHECK (length(trim(trade_lane)) > 0),
  visibility visibility NOT NULL,
  listing_status listing_status NOT NULL DEFAULT 'DRAFT',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS liner_services_company_idx ON liner_services(company_id);
CREATE INDEX IF NOT EXISTS liner_services_marketplace_idx ON liner_services(listing_status, visibility);

CREATE TABLE IF NOT EXISTS liner_sailings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES liner_services(id) ON DELETE CASCADE,
  liner_vessel_id uuid NOT NULL REFERENCES liner_vessels(id),
  voyage_reference varchar(100) NOT NULL CHECK (length(trim(voyage_reference)) > 0),
  departure_at timestamptz NOT NULL,
  cargo_cutoff_at timestamptz NOT NULL CHECK (cargo_cutoff_at < departure_at),
  visibility visibility NOT NULL,
  listing_status listing_status NOT NULL DEFAULT 'DRAFT',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, voyage_reference)
);
CREATE INDEX IF NOT EXISTS liner_sailings_marketplace_idx ON liner_sailings(listing_status, visibility, departure_at);
DO $$ BEGIN
  ALTER TABLE liner_sailings DROP CONSTRAINT IF EXISTS liner_sailings_liner_vessel_id_fkey;
  ALTER TABLE liner_sailings ADD CONSTRAINT liner_sailings_liner_vessel_id_fkey
    FOREIGN KEY (liner_vessel_id) REFERENCES liner_vessels(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS liner_port_rotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sailing_id uuid NOT NULL REFERENCES liner_sailings(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  estimated_arrival timestamptz NOT NULL,
  estimated_departure timestamptz NOT NULL CHECK (estimated_departure >= estimated_arrival),
  UNIQUE (sailing_id, sequence)
);
CREATE INDEX IF NOT EXISTS liner_port_rotations_location_idx ON liner_port_rotations(location_id);

CREATE TABLE IF NOT EXISTS liner_sailing_capacities (
  sailing_id uuid PRIMARY KEY REFERENCES liner_sailings(id) ON DELETE CASCADE,
  available_commercial_tonnes double precision NOT NULL CHECK (available_commercial_tonnes > 0),
  maximum_piece_weight_tonnes double precision NOT NULL CHECK (maximum_piece_weight_tonnes > 0),
  maximum_piece_length_metres double precision NOT NULL CHECK (maximum_piece_length_metres > 0),
  maximum_piece_width_metres double precision NOT NULL CHECK (maximum_piece_width_metres > 0),
  maximum_piece_height_metres double precision NOT NULL CHECK (maximum_piece_height_metres > 0),
  lifting_capacity_tonnes double precision NOT NULL CHECK (lifting_capacity_tonnes > 0),
  stowage liner_stowage NOT NULL,
  accepted_cargo_types liner_cargo_type[] NOT NULL CHECK (cardinality(accepted_cargo_types) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS liner_cargo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cargo_name varchar(200) NOT NULL CHECK (length(trim(cargo_name)) > 0),
  cargo_type liner_cargo_type NOT NULL,
  piece_count integer NOT NULL CHECK (piece_count > 0),
  total_weight_tonnes double precision NOT NULL CHECK (total_weight_tonnes > 0),
  piece_weight_tonnes double precision NOT NULL CHECK (piece_weight_tonnes > 0),
  piece_length_metres double precision NOT NULL CHECK (piece_length_metres > 0),
  piece_width_metres double precision NOT NULL CHECK (piece_width_metres > 0),
  piece_height_metres double precision NOT NULL CHECK (piece_height_metres > 0),
  required_lifting_tonnes double precision CHECK (required_lifting_tonnes IS NULL OR required_lifting_tonnes > 0),
  required_stowage liner_stowage NOT NULL,
  origin_location_id uuid NOT NULL REFERENCES locations(id),
  destination_location_id uuid NOT NULL REFERENCES locations(id),
  ready_at timestamptz NOT NULL,
  visibility visibility NOT NULL,
  listing_status listing_status NOT NULL DEFAULT 'DRAFT',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (origin_location_id <> destination_location_id)
);
CREATE INDEX IF NOT EXISTS liner_cargo_company_idx ON liner_cargo(company_id);
CREATE INDEX IF NOT EXISTS liner_cargo_marketplace_idx ON liner_cargo(listing_status, visibility, ready_at);

-- The common match/interest/conversation workflow is extended rather than
-- duplicated. Existing inland/deepsea rows retain their required pair.
ALTER TABLE matches ALTER COLUMN cargo_listing_id DROP NOT NULL;
ALTER TABLE matches ALTER COLUMN capacity_offer_id DROP NOT NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS liner_cargo_id uuid REFERENCES liner_cargo(id) ON DELETE CASCADE;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS liner_sailing_id uuid REFERENCES liner_sailings(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS matches_liner_cargo_sailing_idx
  ON matches(liner_cargo_id, liner_sailing_id)
  WHERE liner_cargo_id IS NOT NULL AND liner_sailing_id IS NOT NULL;
DO $$ BEGIN
  ALTER TABLE matches ADD CONSTRAINT matches_exactly_one_domain_pair_check CHECK (
    (cargo_listing_id IS NOT NULL AND capacity_offer_id IS NOT NULL AND liner_cargo_id IS NULL AND liner_sailing_id IS NULL)
    OR
    (cargo_listing_id IS NULL AND capacity_offer_id IS NULL AND liner_cargo_id IS NOT NULL AND liner_sailing_id IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Lets clients route match notifications safely without guessing the domain.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS related_match_domain varchar(20) NOT NULL DEFAULT 'MARKETPLACE';