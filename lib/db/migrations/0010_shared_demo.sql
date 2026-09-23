-- Additive demo-only storage. Never references or migrates real identities.
CREATE TABLE IF NOT EXISTS demo_ecosystems (
  id text PRIMARY KEY,
  state jsonb NOT NULL,
  generation integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS demo_companies (
  id text PRIMARY KEY,
  profile jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS demo_users (
  id text PRIMARY KEY,
  profile jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS demo_memberships (
  user_id text PRIMARY KEY REFERENCES demo_users(id),
  company_id text NOT NULL REFERENCES demo_companies(id),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS demo_sessions (
  token_hash text PRIMARY KEY,
  ecosystem_id text NOT NULL REFERENCES demo_ecosystems(id),
  persona_id text NOT NULL REFERENCES demo_users(id),
  csrf_token text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS demo_sessions_expiry_idx ON demo_sessions(expires_at);