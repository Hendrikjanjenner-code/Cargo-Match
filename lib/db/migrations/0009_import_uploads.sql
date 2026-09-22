CREATE TABLE IF NOT EXISTS import_uploads (
  object_path text PRIMARY KEY,
  owner_scope text NOT NULL,
  shipment_id text NOT NULL,
  name text NOT NULL,
  mime_type text NOT NULL,
  size integer NOT NULL CHECK (size > 0 AND size <= 2097152),
  immutable_path text,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour'
);