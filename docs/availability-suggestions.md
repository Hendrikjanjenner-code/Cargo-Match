# Availability suggestions

Availability suggestions are tenant-private, immutable manual operational
plans. Only an OWNER or ADMIN of an ACTIVE company may submit, review, dismiss,
or confirm one. A plan identifies an active company vessel and active catalogue
location, has a future expected availability window, and records a
planner-supplied source reference (maximum 300 characters) whose observation is
no older than 24 hours. The request explicitly acknowledges operator
participation, source use, and date uncertainty.

Creation and conversion both require an independently operator-reviewed active
AIS identity. A deterministic mapping revision is bound to the immutable plan;
if the identity mapping changes, the plan is `INVALIDATED` on read and cannot
be converted. No provider request is made, no telemetry is stored, and the
feature has zero provider budget. This is a human operational plan, not an ETA
prediction. It does not establish free tonnes, commercial availability, actual
unloading, or ETA.

Plans expire at the earlier of 24 hours after creation and the expected
availability end. `EXPIRED` and `INVALIDATED` are derived statuses and do not
rewrite the immutable row. Replacement is dismiss plus a new plan; there is no
edit endpoint. During review, the operator may correct the capacity location
and dates; the original suggestion remains an immutable source snapshot.
If the original expected start has elapsed, its original location is inactive,
the vessel is inactive, or the verified identity revision has changed, the
suggestion is invalidated and cannot be confirmed, even when the operator
enters a corrected future window and location.
Confirming a plan atomically creates a DRAFT capacity offer with `EXPECTED`
availability confidence and marks the plan converted. It never publishes or
matches a listing. Manual capacity creation without a suggestion continues
through normal validation unchanged.

The additive development migration is
`lib/db/migrations/0004_availability_suggestions.sql`; apply it after the
existing migrations (or run the normal database migration/bootstrap command)
before using the endpoints.