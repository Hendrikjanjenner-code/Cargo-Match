import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import {
  getGetImportSessionQueryKey,
  getGetMyCompanyQueryKey,
  useExecuteImportAction,
  useGetImportSession,
  useGetMyCompany,
  type ImportActionInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ImportWorkspace, type ImportWorkspaceProps } from "@/demo/server/components/import/ImportWorkspace";
import type { ImportAction, ImportControlView, ImportModule } from "@/demo/server/import-contract";
import { importDocumentUrl, uploadImportDocument } from "@/demo/server/import-documents";

const requestOptions = {
  credentials: "same-origin" as const,
  headers: { "X-Requested-With": "XMLHttpRequest" },
};

const moduleViews: Partial<Record<ImportModule, string>> = {
  SHIPMENTS: "import_shipments",
  DOCUMENTS: "import_documents",
  CUSTOMS: "import_customs",
  CHARGES: "import_charges",
  RELEASE: "import_release",
  DELIVERY: "import_delivery",
  CONTROL: "import_control",
  PARTNERS: "import_partners",
  EXCEPTIONS: "import_exceptions",
};

const moduleLabels: Record<ImportModule, string> = {
  SHIPMENTS: "Shipments",
  DOCUMENTS: "Documents",
  IMPORT: "Import review",
  CUSTOMS: "Customs",
  CHARGES: "Charges",
  RELEASE: "Release",
  DELIVERY: "Delivery",
  CONTROL: "Control tower",
  PARTNERS: "Partners",
  EXCEPTIONS: "Exceptions",
};

export default function ImportPage() {
  const { isAuthenticated, user } = useAuth();
  const queryClient = useQueryClient();
  const [view, setView] = useState("import");
  const [entityId, setEntityId] = useState<string | null>(null);
  const [moduleError, setModuleError] = useState("");
  const authIdentity = user?.id ?? user?.email ?? "";
  const sessionKey = useMemo(
    () => [...getGetImportSessionQueryKey(), authIdentity] as const,
    [authIdentity],
  );

  const companyQuery = useGetMyCompany({
    query: {
      enabled: isAuthenticated,
      queryKey: getGetMyCompanyQueryKey(),
      staleTime: 15_000,
    },
  });
  const sessionQuery = useGetImportSession({
    query: {
      enabled: isAuthenticated && !!companyQuery.data,
      queryKey: sessionKey,
      staleTime: 15_000,
      gcTime: 60_000,
      retry: false,
    },
    request: requestOptions,
  });
  const actionMutation = useExecuteImportAction({ request: requestOptions });

  useEffect(() => {
    return () => {
      void queryClient.cancelQueries({ queryKey: sessionKey });
      queryClient.removeQueries({ queryKey: sessionKey });
    };
  }, [authIdentity, queryClient]);

  const control = sessionQuery.data?.workspace.importControl as ImportControlView | undefined;
  const context = sessionQuery.data?.context;
  const permissions = context?.permissions ?? [];
  const membershipRole = context?.membershipRole ?? "";
  const manager = permissions.includes("IMPORT_ADMIN") && ["OWNER", "ADMIN"].includes(membershipRole);
  const members = (context?.members ?? []).map(member => ({
    ...member,
    companyId: context?.companyId ?? "",
  })) as ImportWorkspaceProps["personas"];
  const enabledModules = useMemo(
    () => new Set(control?.modules ?? []),
    [control?.modules],
  );

  const executeAction = async (action: ImportAction) => {
    // The shared demo UI names its simulated payment operation PAY_CHARGE.
    // Production records evidence only; it never invokes the simulated provider.
    const productionAction = action.operation === "PAY_CHARGE"
      ? { ...action, operation: "RECORD_PAYMENT" }
      : action;
    const next = await actionMutation.mutateAsync({ data: productionAction as ImportActionInput });
    if (next.demo !== false) throw new Error("The authenticated import service returned an invalid session.");
    queryClient.setQueryData(sessionKey, next);
  };

  const handleUpload = async (file: File, shipmentId: string, documentType: string) => {
    await uploadImportDocument(file, shipmentId, documentType, undefined);
    await queryClient.invalidateQueries({ queryKey: sessionKey });
  };

  if (companyQuery.isLoading || sessionQuery.isLoading) {
    return <p role="status" data-testid="status-import-loading">Loading import workspace…</p>;
  }

  const error = companyQuery.error ?? sessionQuery.error;
  if (error) {
    return (
      <section role="alert" className="rounded-lg border bg-card p-6" data-testid="status-import-error">
        <h1 className="text-xl font-semibold">Import workspace unavailable</h1>
        <p className="my-3 text-muted-foreground">{error instanceof Error ? error.message : "The workspace could not be loaded."}</p>
        <Button data-testid="button-retry-import" onClick={() => void sessionQuery.refetch()}>Try again</Button>
      </section>
    );
  }

  if (!sessionQuery.data || sessionQuery.data.demo !== false || !control) {
    return <p role="alert" data-testid="status-import-invalid">The import service returned no authenticated company workspace.</p>;
  }

  const visibleView = view === "import" || Object.entries(moduleViews).some(
    ([module, candidate]) => candidate === view && enabledModules.has(module as ImportModule),
  ) ? view : "import";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2" aria-label="Import workspace navigation">
        <Button variant={visibleView === "import" ? "default" : "outline"} data-testid="button-import-overview" onClick={() => { setView("import"); setEntityId(null); }}>
          Overview
        </Button>
        {control.modules.flatMap(module => {
          const nextView = moduleViews[module];
          return nextView ? [(
            <Button key={module} variant={visibleView === nextView ? "default" : "outline"} data-testid={`button-import-module-${module.toLowerCase()}`} onClick={() => { setView(nextView); setEntityId(null); }}>
              {moduleLabels[module]}
            </Button>
          )] : [];
        })}
      </div>

      {manager && (
        <section className="rounded-lg border bg-card p-5" data-testid="panel-import-modules">
          <h2 className="font-semibold">Import modules</h2>
          <p className="mb-4 text-sm text-muted-foreground">Enable modules in dependency order. Changes apply only to your authenticated company.</p>
          {moduleError && <p role="alert" className="mb-3 text-sm text-destructive" data-testid="status-import-module-error">{moduleError}</p>}
          <div className="flex flex-wrap gap-2">
            {(Object.keys(moduleLabels) as ImportModule[]).map(module => {
              const enabled = enabledModules.has(module);
              const dependencies = control.dependencies[module] ?? [];
              const canEnable = dependencies.every(dependency => enabledModules.has(dependency));
              const hasEnabledDependent = Object.entries(control.dependencies).some(
                ([candidate, required]) => enabledModules.has(candidate as ImportModule) && required.includes(module),
              );
              return (
                <Button
                  key={module}
                  variant={enabled ? "secondary" : "outline"}
                  disabled={actionMutation.isPending || (!enabled && !canEnable) || (enabled && hasEnabledDependent)}
                  data-testid={`button-toggle-import-module-${module.toLowerCase()}`}
                  title={!enabled && !canEnable ? `Requires ${dependencies.join(", ")}` : undefined}
                  onClick={() => {
                    setModuleError("");
                    void executeAction({ type: "IMPORT_CONTROL", operation: "SET_MODULE", module, enabled: !enabled })
                      .catch(reason => setModuleError(reason instanceof Error ? reason.message : "The module could not be updated."));
                  }}
                >
                  {enabled ? "Disable" : "Enable"} {moduleLabels[module]}
                </Button>
              );
            })}
          </div>
        </section>
      )}

      {control.modules.length === 0 ? (
        <section className="rounded-lg border border-dashed p-8 text-center" data-testid="status-import-empty">
          <h1 className="text-xl font-semibold">No import modules enabled</h1>
          <p className="mt-2 text-muted-foreground">
            {manager ? "Start by enabling Shipments above. Additional modules become available as their dependencies are enabled." : "A company owner or administrator must enable import modules."}
          </p>
        </section>
      ) : (
        <ImportWorkspace
          view={visibleView}
          entityId={entityId}
          onNavigate={(nextView, id) => { setView(nextView); setEntityId(id); }}
          control={control}
          executeAction={executeAction}
          busy={actionMutation.isPending}
          permissions={permissions}
          personas={members}
          opportunities={[]}
          manager={manager}
          isCustoms={permissions.includes("IMPORT_CUSTOMS")}
          isFinance={permissions.includes("IMPORT_CHARGES")}
          isReceiver={permissions.includes("IMPORT_IMPORT")}
          onUploadDocument={handleUpload}
          getDocumentUrl={(shipmentId, documentId) => importDocumentUrl(shipmentId, documentId, false)}
        />
      )}
    </div>
  );
}