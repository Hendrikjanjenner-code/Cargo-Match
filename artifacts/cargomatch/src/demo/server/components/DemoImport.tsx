import React from "react";
import { useDemo } from "../DemoContext";
import { moduleEnabled } from "./demo-display";
import { ImportWorkspace } from "./import/ImportWorkspace";
import { useDemoRouting } from "./useDemoRouting";
import { uploadImportDocument, importDocumentUrl } from "../import-documents";

export function DemoImport({ view = "import" }: { view?: string }) {
  const { session, executeAction, busy, reloadSession } = useDemo();
  const { entityId, navigate } = useDemoRouting();

  if (!session || !moduleEnabled(session, "IMPORT")) {
    return <p role="alert">Import is niet beschikbaar voor dit profiel.</p>;
  }

  const p = session.context.permissions;
  const manager = p.includes("IMPORT_ADMIN") || p.includes("MANAGE_IMPORT");
  const isCustoms = p.includes("IMPORT_CUSTOMS");
  const isFinance = p.includes("IMPORT_CHARGES");
  const isReceiver = p.includes("VIEW_IMPORT_RECEIVER") || session.context.user.operationalProfile === "CONSIGNEE";

  const control = session.workspace.importControl;

  if (!control) {
    return <p className="text-muted-foreground mt-4">Geen importgegevens beschikbaar voor dit profiel.</p>;
  }

  const handleUpload = async (file: File, shipmentId: string, docType: string) => {
    await uploadImportDocument(file, shipmentId, docType, session);
    await reloadSession();
  };

  return (
    <ImportWorkspace
      view={view}
      entityId={entityId}
      onNavigate={(nextView, id) => {
        const match = session.workspace.opportunities.find(m => m.id === id);
        navigate({ demoView: nextView, entityId: id, ...(nextView === "match_detail" && match ? {demoMode: match.mode} : {}) });
      }}
      control={control}
      executeAction={executeAction}
      busy={busy}
      permissions={session.context.permissions}
      personas={session.personas}
      opportunities={[...session.workspace.opportunities, ...session.workspace.matches]}
      manager={manager}
      isCustoms={isCustoms}
      isFinance={isFinance}
      isReceiver={isReceiver}
      onUploadDocument={handleUpload}
      getDocumentUrl={(shipmentId, documentId) => importDocumentUrl(shipmentId, documentId, true)}
    />
  );
}