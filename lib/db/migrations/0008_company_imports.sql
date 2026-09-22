CREATE TABLE IF NOT EXISTS company_imports (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);