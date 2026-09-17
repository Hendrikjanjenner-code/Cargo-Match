# CargoMatch

Privacy-protected cargo and vessel-capacity introductions for European inland shipping. This is the first core version, not the complete pilot platform.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/cargomatch` — React web interface.
- `artifacts/api-server` — shared API and business services.
- `lib/api-spec/openapi.yaml` — API contract; regenerate clients after changes.
- `lib/db/src/schema` — PostgreSQL schema.
- `docs/cargomatch-architecture.md` — business rules, ownership, privacy views and state transitions.

## Architecture decisions

- Prioritize authorization and commercial privacy over secondary functionality.
- CONNECTED grants consent-based contact disclosure and communication; it never books transport or reserves tonnage.
- Use managed authentication rather than application-owned passwords.
- The initial scope excludes trusted networks, full map experience, invitations, administration, advanced analytics and complete Dutch/German translation.

## Product

Core journey: company onboarding, vessel and listing management, eligibility and explainable matching, anonymous discovery, mutual interest, and private conversation.

## User preferences

Compact, desktop-first European logistics interface; navy, marine blue and teal. Avoid excessive animation and unsupported savings claims.

## Gotchas

- Never send private data to the frontend merely to hide it visually.
- Public-facing scores and bands must not reveal exact private tonnage, timestamps or distances indirectly.
- Validate third-company isolation through API requests, not just interface checks.
- Run `pnpm run typecheck` and `pnpm --filter @workspace/api-server test` for static checks and the core API/privacy regression suite. Test fixtures create ordinary isolated sessions, not runtime authentication bypasses.
- OAuth and cross-origin checks accept only configured origins. For a custom published domain, configure `APP_ORIGIN` to the verified HTTPS origin; do not trust arbitrary request Host headers.

## Pointers
- Deepsea Dry Bulk manual pilot, additive migration, and explicitly deferred multimodal scope: `docs/deepsea-pilot.md`. Use the separate Deepsea navigation; existing listings default to inland mode.

- AIS foundation and development-only simulated provider setup: `docs/ais-foundation.md`. Production remains not configured; explicit internal-vessel mappings are required before simulated positions can be shown. AIS never changes commercial availability.
- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
