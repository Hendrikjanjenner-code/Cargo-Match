# Import UI contract (frozen)

Types: `artifacts/cargomatch/src/demo/server/import-contract.ts`.
Projection: `workspace.importControl: ImportControlView`, `context.importModules: ImportModule[]`.
Send every action through existing demo action endpoint with `type: IMPORT_CONTROL`.
All operations except SET_MODULE require shipmentId. IDs come from projections.

- SET_MODULE: module, enabled (company OWNER/ADMIN with IMPORT_ADMIN).
- UPLOAD_DOCUMENT: documentType, name, objectPath, mimeType, size. Metadata only; safe storage endpoint supplies objectPath.
- EXTRACT_DOCUMENT / REVIEW_DOCUMENT: documentId; review also accepted and evidence.
- CONFIRM_FIELD: field, value, evidence. Resolve weight mismatch by confirming weightKg=18420 with evidence; reviewing source documents remains required.
- CUSTOMS_EDIT: field, value, evidence (goods fields hsCode, origin, valuationConfirmed, classificationConfirmed).
- CUSTOMS_APPROVE: evidence. Requires readiness and human classification/origin/valuation review.
- CUSTOMS_SUBMIT: evidence. Only simulated demo provider.
- CUSTOMS_EVENT: status RELEASED or HELD, evidence.
- PAY_CHARGE: chargeId, evidence (simulated in demo).
- SET_GATE: gate, satisfied, evidence. Customs/payment gates derive from their modules and cannot be manually passed.
- FIND_DELIVERY: idempotent matching through existing eligibility. Existing workspace opportunities and INTEREST/ACCEPT remain the consent mechanism.
- PLAN_DELIVERY: matchId, evidence; DELIVER: evidence. Neither interest nor connection is a booking.
- EXCEPTION: exceptionId, command, note; ASSIGN uses userId, SNOOZE uses until.
- ASSIGN_PARTNER: userId, modules, evidence. Exact shipment assignment only, never a global trust invitation.
- CONFIRM_COMPANY / CONFIRM_REPRESENTATION: evidence; DELIVERY_CHOICE: value, evidence.

Missing module permissions and cross-house access return 403, invalid input 400, blocked transitions 409. All data is synthetic, provider events are never live. Download documents by documentId through authorized storage routes; fixtureId identifies synthetic fixture text.

Final contract additions: CREATE_SHIPMENT uses shipment object (all route fields, kind; no statuses); EDIT_SHIPMENT uses same object plus shipmentId/evidence. ADD_CHARGE / EDIT_CHARGE use charge object (edit adds chargeId). CONFIGURE_GATE uses gate, required, evidence; mandatory customs/payment gates cannot be removed.

Backend adapter API (imports/domain.ts): `projectImportControl(state, actor)`, `importModules(state, actor)`, `applyImportAction(state, actor, input, integration, options?)`. State is ImportState from imports/types.ts. Integration supplies findDelivery(shipment): string[], isConnectedEligible(shipment, matchId): boolean, findActor(userId). Options: `{now?: Date, trustedDocument?: {objectPath, name, mimeType, size}}`. Direct UPLOAD_DOCUMENT without trustedDocument is denied; storage route must validate ownership and supply proof. `assertDocumentAccess(state, actor, shipmentId, documentId)` returns authorized metadata; `fixtureContent(document)` returns synthetic text only for known fixture IDs. These core functions do not load personas or persistence. `seedImports(now)` is DEMO ONLY; never use for production.

Adapter exports now implemented: `createImportState(companyId, now?)` initializes empty `demo:false` state with disabled entitlements (enable SHIPMENTS before dependent modules); ImportActor/ImportState/ImportIntegration exported from domain as types. `attachImportDocument(state, actor, shipmentId, verifiedMetadata, integration?)` returns the new Document; metadata is `{objectPath,name,mimeType,size,documentType?}` (default OTHER). Only routes that verified storage ownership may invoke it. Generic core rejects real-state PAY_CHARGE, CUSTOMS_SUBMIT and CUSTOMS_EVENT because no live providers are configured. Integration callbacks never import demo personas; only demo/domain.ts's adapter does.

Final review additions (existing operations): CONFIRM_FIELD supports eori, commodityCode, originCountry, customsValue (number), importInstructions; these are readiness requirements, prefilled with explicit DEMO review values. CREATE/EDIT_SHIPMENT shipment accepts optional requiredDocumentTypes (nonempty supported type list). Supported upload/required types also include AWB, SEA_WAYBILL, CERTIFICATE, LICENSE, IMPORT_LICENSE, HEALTH_CERTIFICATE, PHYTOSANITARY_CERTIFICATE, INSURANCE, ARRIVAL_NOTICE, CUSTOMS_DECLARATION. Parent link is optional parentId (management only); India houses are ARRIVING with a separately authorized consolidation master. Optional integration.notify(shipment,eventKey,message) supports idempotent ready notifications. Vessel internal authorizedCompanyIds never appears in projection. No further contract changes planned.