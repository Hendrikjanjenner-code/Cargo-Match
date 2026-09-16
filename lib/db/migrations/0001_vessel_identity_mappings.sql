-- Persistent AIS vessel identity mappings.
--
-- This migration is idempotent so it can be used by development bootstrap
-- tooling as well as a normal Drizzle migration run. Canonical identifiers
-- use an empty provider_key; provider-specific IDs use their lower-case
-- provider name. Only operator-reviewed verified rows participate in the
-- global uniqueness boundary. Every identity key is also unique within its
-- tenant, so a draft cannot sit beside a verified row in that tenant.

DO $$ BEGIN
  CREATE TYPE vessel_identifier_type AS ENUM (
    'ENI',
    'MMSI',
    'IMO',
    'VESSELFINDER_ID',
    'MARINETRAFFIC_ID',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE identity_conflict_status AS ENUM ('OPEN', 'RESOLVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS vessel_external_identifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vessel_id UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  identifier_type vessel_identifier_type NOT NULL,
  identifier_value VARCHAR(200) NOT NULL,
  normalized_identifier_value VARCHAR(200) NOT NULL,
  provider VARCHAR(64),
  provider_key VARCHAR(64) NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_evidence JSONB,
  verified_at TIMESTAMPTZ,
  operator_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS vessel_external_identifiers_verified_unique_idx
  ON vessel_external_identifiers (
    identifier_type,
    normalized_identifier_value,
    provider_key
  )
  WHERE verified = TRUE AND operator_reviewed_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vessel_external_identifiers_draft_unique_idx
  ON vessel_external_identifiers (
    company_id,
    identifier_type,
    normalized_identifier_value,
    provider_key
  );
CREATE INDEX IF NOT EXISTS vessel_external_identifiers_company_vessel_idx
  ON vessel_external_identifiers (company_id, vessel_id);
CREATE INDEX IF NOT EXISTS vessel_external_identifiers_vessel_idx
  ON vessel_external_identifiers (vessel_id);

CREATE TABLE IF NOT EXISTS vessel_identity_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vessel_id UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  identifier_type vessel_identifier_type NOT NULL,
  normalized_identifier_value VARCHAR(200) NOT NULL,
  provider_key VARCHAR(64) NOT NULL,
  provider VARCHAR(64),
  reason VARCHAR(80) NOT NULL,
  status identity_conflict_status NOT NULL DEFAULT 'OPEN',
  resolved_at TIMESTAMPTZ,
  resolved_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vessel_identity_conflicts_company_vessel_idx
  ON vessel_identity_conflicts (company_id, vessel_id, created_at);
CREATE INDEX IF NOT EXISTS vessel_identity_conflicts_status_idx
  ON vessel_identity_conflicts (status, created_at);