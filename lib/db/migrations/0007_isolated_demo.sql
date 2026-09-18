-- Intentionally independent from all production identity and business tables.
CREATE TABLE IF NOT EXISTS demo_sandboxes (
  token_hash text PRIMARY KEY,
  csrf_token text NOT NULL,
  persona_id text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  state jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS demo_sandboxes_expiry_idx ON demo_sandboxes(expires_at);