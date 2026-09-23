# Shared server demo contract

All routes are `/api/demo/*`, enabled only with `NODE_ENV=development` or `test` and not `DEMO_ENABLED=false`. Never call real-data APIs from this demo. Fetch with `credentials: "same-origin"`. No bearer token or sandbox ID is accepted.

The Vite UI applies that same environment/disable policy to development serving. Production/static builds always compile out Explore Demo, persona cards and switch/reset entry points. Explicit or remembered demo URLs fail closed to the standard landing rather than mounting a demo whose API is disabled. Restart development services together when changing the demo-enabled environment flag.

## Storage migration

`0010_shared_demo.sql` creates a canonical `demo_ecosystems` world (business records stored once in JSONB), persisted `demo_users`, `demo_companies`, `demo_memberships`, and independent `demo_sessions`. None references production identities or business tables. Apply through the reviewed post-merge script. Old `demo_sandboxes` are retained but no longer authenticated; their cookies must restart explicitly. Missing storage returns 503, never local fallback. Production routes stay disabled even when tables exist.

An explicit POST start initializes the shared world and stable identity rows idempotently (ON CONFLICT DO NOTHING). It never overwrites existing exercises. Each visitor receives only a new principal session. Active persisted memberships/profiles are loaded on every operation; switches cannot select inactive users. Initialization and all world mutations use transaction locks; the world row is locked before sessions. Consent cannot race a withdrawal/reset into stale disclosure. Session expiry/logout never deletes the shared world.

## Session and CSRF

- `GET /session`: returns `DemoSession` or 401. Does not create a session.
- `POST /start` body `{personaId?: "andy"}`: joins the shared world with an independent account session, or resumes the existing principal unchanged. Requires same-origin `Origin` and `X-Demo-Request: 1`.
- `POST /switch` body `{personaId}`; `POST /logout` body `{}`; `POST /actions` body a `DemoAction`: require same-origin Origin, `X-Demo-Request: 1`, `X-Demo-CSRF: session.csrfToken`, `X-Demo-Revision: String(session.revision)`.
- Every successful response except logout is the complete projected `DemoSession`; replace all cached demo data. Logout returns 204. Switch increments revision; stale tabs get 409 `STALE_DEMO_PRINCIPAL` and must reload GET session before continuing.
- Errors are `{error: string, code: string}`. 400 invalid input, 401 no demo session, 403 denied, 404 disabled/unknown record, 409 stale or incompatible action.

## Response (stable names)

`DemoSession = {demo: true, csrfToken: string, revision: number, seededAt: string, stale: boolean, context: {user: Persona, company: DemoCompany, permissions: string[], allowedModes: Mode[], modules: Record<string,"ACTIVE"|"PILOT"|"COMING_LATER"|"HIDDEN">}, personas: Persona[], workspace: {assets: Asset[], cargos: Listing[], capacity: Listing[], opportunities: Opportunity[], matches: Match[], messages: Message[], notifications: Notification[], referrals: Referral[], imports: ImportShipment[], companies: DemoCompany[], audit: Audit[]}}`

Modes: `INLAND | DEEPSEA | LINER | ROAD | RAIL | AIR | IMPORT`.
Persona IDs: `andy, sophie, mark, eva, laura, thomas, jan, anna, sarah, david, emma, michael, customs-specialist, finance, consignee, natalie, consignee-c`.
Persona: `{id,name,companyId,membershipRole:"OWNER"|"ADMIN"|"MEMBER",operationalProfile,platformRole:"USER"|"DEMO_ADMIN",primaryMode,permissions:string[],assignedAssetIds:string[]}`.
Company: `{id,name,activities:string[],modes:Mode[],demo:true}`.
Asset: `{id,companyId,mode,name,type,capacity,volume?,equipment:string[],location,availableAt,demo:true}`.
Listing: `{id,companyId,mode,kind:"CARGO"|"CAPACITY",name,assetId?,origin,destination,quantity,volume?,equipment:string[],availableFrom,availableUntil,status:"DRAFT"|"ACTIVE"|"WITHDRAWN",visibility:"OPEN_NETWORK"|"PRIVATE",demo:true}`.
Opportunity: `{id,cargoId,capacityId,mode,origin,destination,quantity,score,provisional:true,status,ownSide:"CARGO"|"CAPACITY",counterpartyName?,assetName?,contact?}`. Names/contact only after CONNECTED. Regions rather than precise locations before consent.
Match: opportunity fields plus `{leftConsent:boolean,rightConsent:boolean}`; only participant matches.
Message: `{id,matchId,conversationId,senderId,senderName,body,createdAt,readBy,demo:true}` (connected participants only). A match stores one interest and one canonical conversation identifier. `READ_CONVERSATION` persists reads for the current connected participant.
Notification: `{id,userId,title,read,createdAt,demo:true}`.
Referral: `{id,fromUserId,toUserId,opportunityId,note,status:"SENT"|"REVIEWED"|"DISMISSED"|"INTEREST_SENT"|"CONNECTED",createdAt,demo:true}`.
ImportShipment: `{id,name,receiverCompanyId,status,arrivalAt,documents:{id,name,status}[],charges:{id,label,amount,currency}[],paymentStatus,releaseStatus,pickupStatus,demo:true}`; only David/authorized receiver Laura; mutations David only.
Audit: `{id,actorId,action,createdAt,matchId?,demo:true}`; authorized participating companies see their events, with counterparty actor identities redacted before connection. Emma sees all demo activity. No credentials or raw state.

## Actions

- `{type:"INTEREST"|"ACCEPT"|"DECLINE",matchId}`: distinct canonical permissions `SHOW_INTEREST`, `ACCEPT_CONNECTION`, and `DECLINE_CONNECTION`. INTEREST requires NEW with neither side consented. ACCEPT/DECLINE require INTEREST_SENT, the other company consented and the actor's company not yet consented. The sender cannot decline its own interest. NEW/CONNECTED/DECLINED/STALE cannot be accepted or declined. Repeated/invalid transitions return 409 `INVALID_STATE`; missing permission returns 403 `FORBIDDEN`. Incoming interest cannot be accepted via INTEREST instead of ACCEPT.
- `{type:"MESSAGE",matchId,body}` (1–2000 chars)
- `{type:"READ_CONVERSATION",matchId}` (connected commercial participant only)
- `{type:"CONFIRM_AVAILABILITY",assetId,availableAt}` (assigned operational asset or authorized fleet manager; records evidence, never publishes or consents)
- `{type:"SEND_TO_PLANNER",matchId,note?}` (Mark → Eva, Jan → Thomas)
- `{type:"REVIEW_REFERRAL",referralId}`
- `{type:"DISMISS_REFERRAL",referralId}` (assigned planner; sends real notification)
- `{type:"SAVE_ASSET",assetId?,mode?,name?,assetType?,capacity?,volume?,equipment?,location?,availableAt?,technical?}` (own authorized assets only; omit assetId to create. Creation requires mode/name/assetType/capacity/equipment/location/availableAt, and AIR requires volume. Edits merge existing values. `assetType` avoids collision with action `type`.)
- `{type:"SAVE_LISTING",listingId?,listing:{mode,kind,name,assetId?,origin,destination,quantity,volume?,equipment,availableFrom,availableUntil,visibility}}` (creates draft or edits own; server owns id/company/status)
- `{type:"PUBLISH_LISTING"|"WITHDRAW_LISTING",listingId}`
- `{type:"IMPORT_STEP",shipmentId,step:"ARRIVED"|"DOCUMENTS_READY"|"PAYMENT_SIMULATED"|"RELEASED"|"PICKUP_READY"}`
- `{type:"READ_NOTIFICATION",notificationId}`
- `{type:"RESET",confirmation:"RESET ALL DEMO DATA?"}` (Emma permission only). Resets ALL demo business progress and relative dates, retains identity/membership records and seed base assets/configuration. Every other session receives new revision/CSRF credentials and must refresh before writing. UI requires typed confirmation and a second global-impact warning. No real data is reset.

All actions return refreshed session. The primary deepsea match ID is `match-deepsea`; other positive IDs `match-inland`, `match-road`, `match-rail`, `match-air`, `match-liner`. Own listings are returned in full; other companies' listings are not returned. Opportunities are safe projections, not editable listing objects. Existing real OIDC cookies never authorize a demo request and demo cookies never authorize real APIs.

## Technical fields and catalogues

Both assets and listings include optional `technical: {wagonCount?,wagonType?,temperatureMin?,temperatureMax?,cargoType?,cutoffAt?,pieceWeight?,maxPieceWeight?,manualPositioningDays?,positioningBufferDays?,uncertaintyDays?,draft?,maxDraft?,gear?,vesselClass?,loadingMetres?,pallets?,adrClasses?:string[],vesselType?,requiredVesselType?,maximumPositioningDistanceKm?,minimumDwt?,maximumDwt?,quantityTolerancePercent?,requiredTrailerType?,availabilityUncertaintyMinutes?,currentDeliveryExpectedAt?,expectedAvailabilityAt?,preferredDirection?,pieceCount?,pieceLength?,pieceWidth?,pieceHeight?,maxPieceLength?,maxPieceWidth?,maxPieceHeight?,liftingCapacity?,requiredLifting?,stowage?}`. Numbers must be actual JSON numbers. All positive except temperatures and the days/uncertainty/tolerance fields (nonnegative). Counts are integers; tolerance < 100, stowage `HOLD|DECK|EITHER`. SAVE_LISTING requires the complete listing form and preserves only supplied technical fields. Capacity may never exceed asset tonnage/volume/equipment/technical limits.

Rail requires wagonCount and wagonType on assets and listings. Air requires volume on assets/listings and cutoffAt on capacity strictly before availableFrom (flight departure). All four original modes require cargoType. Inland/deepsea cargo requires requiredVesselType; vessel assets use vesselType. Inland/deepsea/road capacity requires maximumPositioningDistanceKm. Road capacity requires volume/loadingMetres/pallets/currentDeliveryExpectedAt/expectedAvailabilityAt/availabilityUncertaintyMinutes; road physical assets require loadingMetres/pallets/volume. Liner capacity requires cutoffAt/maxPieceWeight/maxPieceLength/maxPieceWidth/maxPieceHeight/liftingCapacity/stowage; cargo requires pieceCount/pieceWeight/pieceLength/pieceWidth/pieceHeight/stowage. Deepsea capacity requires explicit manualPositioningDays. The original inland/deepsea/road pure eligibility and scoring functions and the liner pure eligibility function are called through an isolated in-memory adapter, never real repositories. Missing technical inputs are not manufactured to make matching pass.

Transport module keys match Mode: INLAND/DEEPSEA/LINER ACTIVE, ROAD/RAIL/AIR PILOT, IMPORT PILOT unless `DEMO_IMPORT_ENABLED=false` (HIDDEN). AIR_CARGO and CARGOMATCH_IMPORT expose the corresponding source-prompt flag names; DEMO_MODE is ACTIVE in an enabled demo, and GUIDED_DEMO is PILOT unless `DEMO_GUIDED_ENABLED=false` (HIDDEN). All demo routes are disabled outside development/test. `context.allowedModes` limits the company separately from module state. Emma has no commercial mode membership but VIEW_ADMIN/RESET_DEMO. Air's authorized cargo counterparty is David, not Laura; rail/inland/road/liner cargo counterparty is Laura. Commercial consent remains explicit and unconnected initial chains require both companies.

Session also returns `catalogue:{locations:string[]}`: use these exact catalogue names for asset location and listing origin/destination, never arbitrary user-entered positions. Opportunities include `source:"FICTIONAL_MANUAL",verification:"NOT_VERIFIED"`; never live AIS/GPS. `workspace.evidence` contains authorized `{assetId,actorId,availableAt,createdAt,demo:true}` records.

Fictional scenario clock times are UTC, explicitly labelled in the UI and entered as UTC in demo forms. In particular Truck 42 is expected empty tomorrow at 14:00 UTC, after the 13:30 UTC delivery; these are estimates, not telemetry.

## Shared import integration

`IMPORT_CONTROL` reuses the import domain and existing pure modal matchers. `ARRIVING` (owner demo action with evidence) creates a single stable delivery requirement and shipment-derived cargo from explicit physical transport requirements, never clones another cargo's assumed requirements. China uses Truck 45 container chassis, 18.420 tonnes/28m³, 12.2 loading metres and 24 pallet positions as explicit synthetic planning assumptions. Dedicated container barge and flat-wagon rail examples serve Rotterdam–Duisburg. Barge cargo is available Wednesday 08:00; the shipper requests a loading window from 12:00, the barge is available 11:00. This preserves the production matcher's full loading-window coverage rule rather than silently weakening it. Road's Eindhoven North seed is approximately 18 km geodesic positioning from Eindhoven, not verified driving distance.

Shipments lacking explicit transport requirements return 409 on FIND_DELIVERY, rather than fabricating dimensions or modes. Introduction, planning, customs approval and release remain separate.

`ASSIGN_CUSTOMS_REVIEW` accepts shipmentId/userId/evidence; only the owner may assign an entitled specialist. `CUSTOMS_REVIEW_OPEN` and `CUSTOMS_REVIEW_COMPLETE` (evidence required to complete) act only on the assigned case. The persisted review/exception/assignment is shared with Michael. Completion records recommendation and recalculates readiness, never automatically approves customs. Natalie starts with no shipments. David sees the assigned master and all three houses; each consignee sees only its own house and authorized document/charge subset.

## Verification

`shared-demo.integration.test.ts` uses independent cookies in a disposable test-prefixed ecosystem; covers real shared consent, concurrent acceptance, messages/read status, referrals, rail/air, all three import delivery modes, customs assignment, three-house privacy, seed idempotence, logout and global-reset stale writes. Existing demo HTTP tests continue to check production isolation, CSRF, cookie boundaries, API denials, concurrent withdrawal and switches. Browser clients poll every 20 seconds and refresh on focus; switching clears private state. No WebSocket/live-AIS claim.

POST /start with a valid existing cookie resumes unchanged even if personaId differs; use /switch with CSRF/revision for a change. Every switch rotates the CSRF token as well as incrementing revision; always replace session and clear private views. Disabled production endpoints return 404 before accessing any storage. Import is independently hidden with `DEMO_IMPORT_ENABLED=false`.