-- Persist driver flags against a specific eligible shared ROAD opportunity.
DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'ROAD_OPPORTUNITY_FLAGGED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE road_driver_assignments
  ADD COLUMN IF NOT EXISTS flagged_match_id uuid REFERENCES matches(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS road_operational_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES road_driver_assignments(id) ON DELETE CASCADE,
  capacity_offer_id uuid NOT NULL REFERENCES capacity_offers(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  driver_user_id varchar(255) NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS road_operational_flags_assignment_idx
  ON road_operational_flags(assignment_id, created_at);
CREATE INDEX IF NOT EXISTS road_operational_flags_match_idx
  ON road_operational_flags(match_id);