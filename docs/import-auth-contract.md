# Authenticated import adapter

Implemented using shared `applyImportAction`, `projectImportControl`, `shipmentModules` and `assertDocumentAccess`, never `seedDemo`.

Main mounts default router from `routes/imports.ts` with existing authenticated `/api` router, after global same-origin write and auth middleware.
GET `/api/import/session` and POST `/api/import/actions` will return `{ workspace: { importControl }, context: { importModules }, demo: false }`.
Company state is selected exclusively from authenticated membership, transactionally locked on the existing company row. No caller-supplied company identity is accepted.

## Exact endpoints and persistence
- GET `/import/session` returns the above envelope; context also includes companyId, userId, membershipRole, permissions, and active same-company `members: [{id,name,membershipRole,permissions}]` for authorized task assignment forms.
- POST `/import/actions` takes `{type?: "IMPORT_CONTROL", operation, ...operationFields}` and returns the same envelope.
- Supported shared actions: SET_MODULE, CREATE_SHIPMENT, EDIT_SHIPMENT, EXTRACT_DOCUMENT, REVIEW_DOCUMENT, CONFIRM_FIELD, CUSTOMS_EDIT, CUSTOMS_APPROVE, ADD_CHARGE, EDIT_CHARGE, SET_GATE, CONFIGURE_GATE, EXCEPTION, ASSIGN_PARTNER, CONFIRM_COMPANY, CONFIRM_REPRESENTATION, DELIVERY_CHOICE.
- CREATE_SHIPMENT/EDIT_SHIPMENT use `shipment: {reference,name,kind,origin,destination,port,eta,incoterm?,container?,masterReference?,houseReference?}`. EDIT requires evidence.
- ADD_CHARGE/EDIT_CHARGE use `charge:{label,amount,currency,supplier,invoiceReference,estimated,vat}`, evidence, and for editing chargeId.
- RECORD_PAYMENT uses shipmentId, chargeId, evidence; OWNER/ADMIN only. This records a manual assertion, transfers no money, emits MANUAL_RECORDED audit, and cannot satisfy customs release.
- POST `/import/uploads/request-url` takes `{shipmentId,name,mimeType,size}` and returns `{uploadURL,objectPath}`. PUT bytes to uploadURL.
- POST `/import/uploads/complete` takes `{shipmentId,objectPath,documentType}` and returns session. Storage receipt/ownership and actual uploaded size are verified. Retrying the same immutable object path does not add a version.
- GET `/import/documents/:shipmentId/:documentId` authorizes before streaming storage bytes. No object path download bypass.
- Migration `0008_company_imports.sql`; main also applies storage migration `0009_import_uploads.sql`. Main handles migration execution.

## Authority and safety
Existing active company membership and ACTIVE company status are re-read and row-locked on every operation. OWNER/ADMIN administer modules and create shipments, assign colleagues, record payments and approve customs preparation. Members only operate on explicitly assigned shipments and permitted modules. All ten modules start enabled for an empty company; no shipment or tracking seed exists. Assignment is limited to active members of the same company; this does not create cross-company partner invitations.
Unknown IDs and forbidden shipments/documents return 403. Authentication returns 401; malformed action 400; blocked transitions/provider gaps 409. Existing application same-origin write middleware remains authoritative.
Unsupported document extraction returns REVIEW_REQUIRED with no invented proposals. Documents contain metadata only. Shipment events include old/new metadata, user, timestamps and MANUAL_RECORDED source; module changes also write existing audit_logs within the state transaction.

## Explicit foundation limitations
CUSTOMS_SUBMIT/CUSTOMS_EVENT, PAY_CHARGE, FIND_DELIVERY/PLAN_DELIVERY/DELIVER return 409, never simulate production providers. Use RECORD_PAYMENT for manually recorded payments. Mandatory customs release cannot be satisfied, so production pickup/delivery remains blocked pending a real provider and authorized evidence integration.
Existing marketplace routes/services remain unchanged and usable; automatic shipment-to-mode-specific cargo creation/matching is not implemented, rather than creating an isolated or falsely eligible matching flow. Cross-company partner sharing is not implemented.
The OpenAPI session projection is extensible JSON to match the shared domain; domain validates action-specific fields. OpenAPI generated clients and Zod were regenerated.
Unit tests cover empty production state, tenant/assignment isolation, module authority, object path claims, prohibited simulation and safety gates.
Authenticated route integration tests use real persisted sessions/memberships: create and restore shipment, module toggles, member denial, cross-company isolation, forged storage metadata rejection, manual payment recording, manual carrier evidence, blocked customs claims, and hostile Origin rejection. Fourteen auth unit/integration tests pass. Concurrent transaction stress and browser checks remain main-agent validation responsibilities.
RECORD_PAYMENT is an explicit shared-domain operation, never rewritten into PAY_CHARGE and never routed through SyntheticPaymentProvider. Shipment delivery is intentionally unavailable, not claimed complete.