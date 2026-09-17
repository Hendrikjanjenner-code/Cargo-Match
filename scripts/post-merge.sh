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
pnpm --filter @workspace/scripts run seed-locations
