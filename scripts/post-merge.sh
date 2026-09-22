#!/bin/bash
set -euo pipefail
pnpm install --frozen-lockfile
# Extend the existing CargoMatch database using reviewed, idempotent SQL.
# A generic schema push can prompt to rebuild unrelated tables on task merge.
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
  -f lib/db/migrations/0003_deepsea_bulk_vertical.sql \
  -f lib/db/migrations/0004_deepsea_reachability_manual_fields.sql \
  -f lib/db/migrations/0004_availability_suggestions.sql \
  -f lib/db/migrations/0004_liner_breakbulk_vertical.sql
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
  -f lib/db/migrations/0005_road_freight_vertical.sql
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
  -f lib/db/migrations/0006_road_operational_flags.sql
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
  -f lib/db/migrations/0007_isolated_demo.sql
pnpm --filter @workspace/scripts run seed-locations
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
  -f lib/db/migrations/0008_company_imports.sql \
  -f lib/db/migrations/0009_import_uploads.sql
