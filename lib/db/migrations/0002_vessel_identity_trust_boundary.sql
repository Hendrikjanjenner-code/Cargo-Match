-- Establish the AIS identity trust boundary.
--
-- Older development databases may have the original global unique index,
-- which incorrectly blocks an unverified claim in one tenant when another
-- tenant has the same draft identifier. Verified mappings remain globally
-- unique; every identity key is unique within its tenant.

ALTER TABLE vessel_external_identifiers
  ADD COLUMN IF NOT EXISTS operator_reviewed_at TIMESTAMPTZ;

-- Rows created by the old tenant-facing verified=true path are not trusted.
-- Keep their claim for tenant review, but make it non-operational until an
-- operator reviews the external ownership evidence through the filesystem CLI.
UPDATE vessel_external_identifiers
SET verified = FALSE,
    verified_at = NULL,
    operator_reviewed_at = NULL
WHERE verified = TRUE
  AND operator_reviewed_at IS NULL;

DROP INDEX IF EXISTS vessel_external_identifiers_unique_idx;
DROP INDEX IF EXISTS vessel_external_identifiers_verified_unique_idx;
DROP INDEX IF EXISTS vessel_external_identifiers_draft_unique_idx;

CREATE UNIQUE INDEX IF NOT EXISTS vessel_external_identifiers_verified_unique_idx
  ON vessel_external_identifiers (
    identifier_type,
    normalized_identifier_value,
    provider_key
  )
  WHERE verified = TRUE AND operator_reviewed_at IS NOT NULL;

-- The previous draft-only index allowed a draft beside an approved mapping
-- within one tenant. Preserve one canonical row and audit any rows that must
-- be removed before enforcing tenant-local uniqueness across all rows.
DROP TABLE IF EXISTS _ais_identity_duplicate_rows;
CREATE TEMP TABLE _ais_identity_duplicate_rows AS
SELECT id
FROM (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, identifier_type,
        normalized_identifier_value, provider_key
      ORDER BY
        (verified = TRUE AND operator_reviewed_at IS NOT NULL) DESC,
        updated_at DESC,
        id
    ) AS row_number
  FROM vessel_external_identifiers
) ranked
WHERE row_number > 1;

INSERT INTO vessel_identity_conflicts (
  company_id,
  vessel_id,
  identifier_type,
  normalized_identifier_value,
  provider_key,
  provider,
  reason
)
SELECT
  mapping.company_id,
  mapping.vessel_id,
  mapping.identifier_type,
  mapping.normalized_identifier_value,
  mapping.provider_key,
  mapping.provider,
  'DUPLICATE_DRAFT_MIGRATION'
FROM vessel_external_identifiers mapping
JOIN _ais_identity_duplicate_rows duplicate
  ON duplicate.id = mapping.id;

DELETE FROM vessel_external_identifiers mapping
USING _ais_identity_duplicate_rows duplicate
WHERE duplicate.id = mapping.id;

DROP TABLE _ais_identity_duplicate_rows;

CREATE UNIQUE INDEX IF NOT EXISTS vessel_external_identifiers_draft_unique_idx
  ON vessel_external_identifiers (
    company_id,
    identifier_type,
    normalized_identifier_value,
    provider_key
  );