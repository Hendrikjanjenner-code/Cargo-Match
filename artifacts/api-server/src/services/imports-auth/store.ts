import { db, companyImportsTable, companyMembersTable, auditLogsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getMembershipWithin } from "../../lib/http";
import { DemoError } from "../demo/types";
import { applyImportAction, projectImportControl } from "../imports/domain";
import type { ImportState, ImportActor, ImportIntegration, Document } from "../imports/types";
import { emptyImportState, realActor, assertRealAction } from "./policy";
type EligibleMember = { id: string; name: string; membershipRole: string; permissions: string[] };
type CompanyIntegration = ImportIntegration & { members: EligibleMember[] };

export async function withCompanyImport<T>(userId: string, write: boolean,
  callback: (state: ImportState, actor: ImportActor, integration: CompanyIntegration) => Promise<T> | T): Promise<T> {
  return db.transaction(async tx => {
    // Locks both existing membership and company rows, even before the state row exists.
    const current = await getMembershipWithin(tx, userId, true);
    if (!current || !current.membership.active || current.company.status !== "ACTIVE") throw new DemoError(403, "FORBIDDEN", "Active company membership required.");
    const companyId = current.company.id;
    const actor = realActor(userId, companyId, current.membership.role);
    const [stored] = await tx.select().from(companyImportsTable).where(eq(companyImportsTable.companyId, companyId));
    const state = stored ? structuredClone(stored.state) as ImportState : emptyImportState(companyId);
    const oldEntitlements = structuredClone(state.entitlements);
    if (state.demo || state.shipments.some(s => s.companyId !== companyId)) throw new Error("Invalid production import state");
    const members = await tx.select().from(companyMembersTable).where(eq(companyMembersTable.companyId, companyId));
    const names = await tx.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName }).from(usersTable)
      .innerJoin(companyMembersTable, eq(companyMembersTable.userId, usersTable.id)).where(eq(companyMembersTable.companyId, companyId));
    const integration: CompanyIntegration = {
      members: members.filter(m => m.active).map(m => ({ id: m.userId, name: names.filter(n => n.id === m.userId).map(n => [n.firstName, n.lastName].filter(Boolean).join(" "))[0] || m.userId,
        membershipRole: m.role, permissions: realActor(m.userId, companyId, m.role).permissions })),
      findActor: id => { const m = members.find(m => m.userId === id && m.active); return m ? realActor(m.userId, companyId, m.role) : undefined; },
      // Explicit FIND_DELIVERY is rejected by policy; incidental domain refresh must
      // neither forge eligibility nor prevent an unrelated manual metadata update.
      findDelivery: shipment => shipment.delivery.listingIds,
      isConnectedEligible: () => false,
    };
    const result = await callback(state, actor, integration);
    if (write) {
      await tx.insert(auditLogsTable).values({ actorUserId: userId, companyId, action: "IMPORT_UPDATE", entityType: "COMPANY_IMPORT",
        entityId: companyId, metadata: { revision: (stored?.revision ?? 0) + 1, oldEntitlements, newEntitlements: state.entitlements } });
      await tx.insert(companyImportsTable).values({ companyId, state, revision: 1 }).onConflictDoUpdate({
        target: companyImportsTable.companyId, set: { state, revision: (stored?.revision ?? 0) + 1, updatedAt: new Date() },
      });
    }
    return result;
  });
}
export function importSession(state: ImportState, actor: ImportActor, members: EligibleMember[] = []) {
  const importControl = projectImportControl(state, actor);
  return { demo: false as const, workspace: { importControl }, context: { importModules: importControl.modules, companyId: actor.companyId, userId: actor.id, membershipRole: actor.membershipRole, permissions: actor.permissions, members } };
}
export function mutateImport(state: ImportState, actor: ImportActor, integration: CompanyIntegration, input: Record<string, unknown>, trustedDocument?: Pick<Document, "objectPath" | "name" | "mimeType" | "size">) {
  assertRealAction(input, actor);
  const action = input;
  const before = structuredClone(state);
  applyImportAction(state, actor, action, integration, trustedDocument ? {
    trustedDocument: trustedDocument as {objectPath: string; name: string; mimeType: string; size: number},
  } : {});
  // Shared module mutations have no shipment timeline; preserve their audit as well.
  if (input.operation === "RECORD_PAYMENT") {
    const shipment = state.shipments.find(s => s.id === input.shipmentId);
    const event = shipment?.timeline.at(-1);
    if (event) event.action = "RECORD_PAYMENT";
  }
  const changed = state.shipments.find(s => s.id === input.shipmentId);
  const original = before.shipments.find(s => s.id === input.shipmentId);
  const event = changed?.timeline.at(-1);
  if (event && original && changed) {
    const auditMetadata = (s: typeof changed) => ({ documents: s.documents, charges: s.charges, exceptions: s.exceptions,
      fields: s.fields, customs: s.customs, gates: s.gates, delivery: s.delivery, assignments: s.assignments });
    event.oldValue = structuredClone(auditMetadata(original));
    event.newValue = { ...structuredClone(auditMetadata(changed)), evidence: input.evidence ?? input.note };
  }
  return { session: importSession(state, actor, integration.members), before };
}