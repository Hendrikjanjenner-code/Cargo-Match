-- Additive manual operational availability suggestions.
-- No telemetry is requested or stored. Existing listings and rows are untouched.
DO $$ BEGIN
  CREATE TYPE availability_suggestion_status AS ENUM
    ('PENDING', 'DISMISSED', 'CONVERTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS availability_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vessel_id uuid NOT NULL REFERENCES vessels(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  created_by varchar NOT NULL REFERENCES users(id),
  expected_available_from timestamptz NOT NULL,
  expected_available_until timestamptz NOT NULL,
  source_reference varchar(300) NOT NULL,
  source_observed_at timestamptz NOT NULL,
  participation_confirmed boolean NOT NULL,
  source_use_confirmed boolean NOT NULL,
  uncertainty_acknowledged boolean NOT NULL,
  identity_mapping_id uuid NOT NULL,
  identity_mapping_revision varchar(128) NOT NULL,
  status availability_suggestion_status NOT NULL DEFAULT 'PENDING',
  capacity_offer_id uuid REFERENCES capacity_offers(id) ON DELETE SET NULL,
  converted_by varchar REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT availability_suggestions_window_check
    CHECK (expected_available_from < expected_available_until),
  CONSTRAINT availability_suggestions_acknowledgements_check
    CHECK (
      participation_confirmed = true
      AND source_use_confirmed = true
      AND uncertainty_acknowledged = true
    )
);
CREATE INDEX IF NOT EXISTS availability_suggestions_company_created_idx
  ON availability_suggestions(company_id, created_at);
CREATE INDEX IF NOT EXISTS availability_suggestions_status_idx
  ON availability_suggestions(status);
CREATE INDEX IF NOT EXISTS availability_suggestions_vessel_idx
  ON availability_suggestions(vessel_id);