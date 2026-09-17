# CargoMatch ROAD pilot contract

The ROAD vertical is additive to the shared cargo/capacity/match model. It
does not create a second match or consent workflow and it never treats a
vessel as a road asset.

## Endpoints

- `GET|POST /road/assets`: planner-owned real assets.
- `GET|PATCH /road/assets/{roadAssetId}` and
  `POST /road/assets/{roadAssetId}/deactivate`: owner/admin writes.
- `GET|POST /road/cargo`, `GET|PATCH /road/cargo/{cargoId}`,
  `POST /road/cargo/{cargoId}/withdraw|close`: shipper-owned ROAD cargo.
- `GET|POST /road/capacity`, `GET|PATCH /road/capacity/{capacityId}`,
  `POST /road/capacity/{capacityId}/withdraw|close`: planner-owned ROAD
  capacity based on the current delivery and manually-derived future
  availability.
- `GET /road/drivers`: active MEMBER users available for planner assignment
  (planner authority only).
- Every ROAD capacity response includes `assignments`. Planner responses
  include all assignments for the capacity; an assigned MEMBER response
  includes only that driver's assignment. Assignment IDs are the IDs used by
  `/road/assignments/{assignmentId}/confirm|flag`; `flag` additionally
  requires a specific `matchId` and persists the operational flag for planner
  review.
- `GET /road/matches`, `GET /road/matches/{matchId}`: privacy-safe shared
  matches backed by `matches.cargoListingId` and `matches.capacityOfferId`.
- `POST /road/capacity/{capacityId}/assignments`: planner assigns a MEMBER driver.
- `POST /road/assignments/{assignmentId}/confirm` and
  `POST /road/assignments/{assignmentId}/flag`: operational driver actions.

## Invariants

- Asset types are exactly `TRUCK`, `TRACTOR`, `TRAILER`, and
  `TRUCK_TRAILER_COMBINATION`.
- ROAD rows are rejected by generic vessel/listing routes. ROAD capacity has a
  nullable `capacity_offers.vessel_id` and a required road capacity extension.
- Every road capacity validates tonnes, cubic metres, loading metres, and
  pallet positions simultaneously against both the registered asset and the
  offer.
- Future location/time is a planner or driver/TMS/manual claim derived from
  current delivery. An uncertainty interval is explicit; GPS/telematics never
  establishes commercial availability on its own.
- Matching uses road eligibility only. No vessel score, AIS, or maritime
  routing is used.
- OWNER/ADMIN are commercial planner authorities. A MEMBER may only confirm
  operational status or flag an opportunity for an assigned asset; a driver
  cannot publish, edit, withdraw, consent, or otherwise make a binding
  commercial decision.
- `POST /road/assignments/{assignmentId}/flag` requires `matchId` for the
  specific current eligible ROAD opportunity. The association is persisted as
  an operational flag and notifies active OWNER/ADMIN planners.
- Capacity and match listing reads by a MEMBER are restricted to assignments
  for that authenticated driver and contain only operational projections.
- A connected match is a privacy-safe introduction, never a booking,
  reservation, or transport confirmation.