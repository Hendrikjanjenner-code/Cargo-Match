import type { ImportAction, ImportModule } from "../../import-contract";

export function exceptionAction(shipmentId: string, exceptionId: string, command: NonNullable<ImportAction["command"]>, note: string, extra: Pick<ImportAction, "userId" | "until"> = {}): ImportAction {
  if (!note.trim()) throw new Error("Een toelichting op deze uitzonderingsactie is verplicht.");
  if (command === "ASSIGN" && !extra.userId) throw new Error("Kies een bevoegde behandelaar.");
  if (command === "SNOOZE" && (!extra.until || !Number.isFinite(Date.parse(extra.until)))) throw new Error("Kies een geldige snoozedatum.");
  return {type: "IMPORT_CONTROL", operation: "EXCEPTION", shipmentId, exceptionId, command, note: note.trim(), ...extra};
}

export function partnerAction(shipmentId: string, userId: string, modules: ImportModule[]): ImportAction {
  if (!userId || modules.length === 0) throw new Error("Kies een collega en minimaal één toegestane module.");
  return {type: "IMPORT_CONTROL", operation: "ASSIGN_PARTNER", shipmentId, userId, modules: [...new Set(modules)]};
}