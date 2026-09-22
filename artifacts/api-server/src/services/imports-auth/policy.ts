import type { ImportActor, ImportState } from "../imports/types";
import { IMPORT_MODULES } from "../imports/types";
import { DemoError } from "../demo/types";

export function realActor(userId: string, companyId: string, role: string): ImportActor {
  const admin = role === "OWNER" || role === "ADMIN";
  return { id: userId, companyId, membershipRole: role,
    permissions: [...IMPORT_MODULES.map(m => `IMPORT_${m}`), ...(admin ? ["IMPORT_ADMIN", "IMPORT_CUSTOMS_APPROVE"] : [])] };
}
export function emptyImportState(companyId: string): ImportState {
  return { demo: false, clock: new Date().toISOString(), entitlements: { [companyId]: [...IMPORT_MODULES] }, shipments: [], vessels: [] };
}
export function assertRealAction(input: Record<string, unknown>, actor: ImportActor): void {
  if (["CUSTOMS_SUBMIT", "CUSTOMS_EVENT", "FIND_DELIVERY", "PLAN_DELIVERY", "DELIVER"].includes(String(input.operation))) {
    throw new DemoError(409, "INVALID_STATE", "Production provider or shipment-to-marketplace integration is not configured. Use the existing marketplace; no simulated events are accepted.");
  }
  if (input.operation === "PAY_CHARGE") {
    throw new DemoError(409, "INVALID_STATE", "Simulated payment is unavailable. Record payment metadata with RECORD_PAYMENT and evidence; no funds are transferred.");
  }
  if (["CREATE_SHIPMENT", "ASSIGN_PARTNER", "RECORD_PAYMENT"].includes(String(input.operation)) && !["OWNER", "ADMIN"].includes(actor.membershipRole)) {
    throw new DemoError(403, "FORBIDDEN", "Company owner or administrator authority is required.");
  }
}