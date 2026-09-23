import React, { useState, useRef } from "react";
import { ImportControlView, ImportAction } from "../../import-contract";
import { DemoPersona, DemoOpportunity, DemoMatch } from "../../api";
import { ImportShipments } from "./ImportShipments";
import { ImportDocuments } from "./ImportDocuments";
import { ImportCustoms } from "./ImportCustoms";
import { ImportCharges } from "./ImportCharges";
import { ImportRelease } from "./ImportRelease";
import { ImportDelivery } from "./ImportDelivery";
import { ImportControlTower } from "./ImportControlTower";
import { ImportPartners } from "./ImportPartners";
import { ImportExceptions } from "./ImportExceptions";
import { ImportSettings } from "./ImportSettings";
import { ImportDashboard } from "./ImportDashboard";

export interface ImportWorkspaceProps {
  view: string;
  entityId: string | null;
  onNavigate: (view: string, id: string | null) => void;
  control: ImportControlView;
  executeAction: (action: ImportAction) => Promise<void>;
  busy: boolean;
  permissions: string[];
  currentUserId?: string;
  personas: DemoPersona[];
  opportunities: (DemoOpportunity | DemoMatch)[];
  manager: boolean;
  isCustoms: boolean;
  isFinance: boolean;
  isReceiver: boolean;
  onUploadDocument: (file: File, shipmentId: string, docType: string) => Promise<void>;
  getDocumentUrl: (shipmentId: string, documentId: string) => string;
}

export function ImportWorkspace(props: ImportWorkspaceProps) {
  const { view, control, executeAction, busy } = props;
  const [feedback, setFeedback] = useState("");
  const [evidence, setEvidence] = useState("");
  const evidenceRef = useRef("");

  const run = async (action: ImportAction) => { 
    const proof = action.evidence?.trim() || evidenceRef.current.trim();
    if (!proof && !["CREATE_SHIPMENT", "SET_MODULE", "FIND_DELIVERY", "EXTRACT_DOCUMENT", "EXCEPTION", "UPLOAD_DOCUMENT", "CUSTOMS_REVIEW_OPEN"].includes(action.operation)) {
      setFeedback("Vul eerst een onderbouwing of bewijsreferentie in voor deze actie.");
      document.getElementById("import-evidence")?.focus();
      return;
    }
    try { 
      await executeAction({ ...action, evidence: proof }); 
      setFeedback("Actie uitgevoerd."); 
      setTimeout(() => setFeedback(""), 3000);
    } catch (e) { 
      setFeedback(e instanceof Error ? e.message : "Actie mislukt."); 
    } 
  };

  const sharedProps = { ...props, run, feedback, setFeedback };

  return (
    <div className="space-y-6">
      {feedback && (
        <div role="status" className="fixed top-4 right-4 z-50 bg-blue-900 text-white px-4 py-2 rounded shadow-lg">
          {feedback}
        </div>
      )}
      
      <div className="bg-white p-3 rounded border border-slate-200 shadow-sm flex flex-wrap items-center gap-4">
        <label htmlFor="import-evidence" className="font-semibold text-sm text-slate-700 whitespace-nowrap">Onderbouwing (Evidence):</label>
        <input 
          id="import-evidence"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 max-w-md" 
          value={evidence} 
          onChange={e => { evidenceRef.current = e.target.value; setEvidence(e.target.value); }} 
          placeholder="Verplichte reden of referentie voor acties..." 
        />
      </div>

      {view === "import" && <ImportDashboard {...sharedProps} />}
      {view === "import_shipments" && <ImportShipments {...sharedProps} />}
      {view === "import_documents" && <ImportDocuments {...sharedProps} />}
      {view === "import_customs" && <ImportCustoms {...sharedProps} />}
      {view === "import_charges" && <ImportCharges {...sharedProps} />}
      {view === "import_release" && <ImportRelease {...sharedProps} />}
      {view === "import_delivery" && <ImportDelivery {...sharedProps} />}
      {view === "import_control" && <ImportControlTower {...sharedProps} />}
      {view === "import_partners" && <ImportPartners {...sharedProps} />}
      {view === "import_exceptions" && <ImportExceptions {...sharedProps} />}
      {view === "import_settings" && <ImportSettings {...sharedProps} />}
    </div>
  );
}