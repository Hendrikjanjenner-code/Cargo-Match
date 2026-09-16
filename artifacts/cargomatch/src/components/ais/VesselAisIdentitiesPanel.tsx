import { FormEvent, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AisIdentityIdentifierType,
  type AisIdentityEvidence,
  type AisIdentityUpdateRequest,
  type VesselAisIdentity,
  type VesselAisIdentityConflict,
  getGetMyVesselAisQueryKey,
  getListMyVesselAisIdentitiesQueryKey,
  useDeleteMyVesselAisIdentity,
  useListMyVesselAisIdentities,
  useRegisterMyVesselAisIdentity,
  useUpdateMyVesselAisIdentity,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  Check,
  Edit2,
  Info,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

type IdentifierType = AisIdentityIdentifierType;

type EvidenceDraft = {
  source: string;
  reference: string;
  notes: string;
};

const identifierTypes = Object.values(AisIdentityIdentifierType);

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return t("vessels.ais.identities.request_failed");
}

function emptyEvidence(): EvidenceDraft {
  return { source: "", reference: "", notes: "" };
}

function evidenceDraft(evidence: AisIdentityEvidence | null): EvidenceDraft {
  return {
    source: evidence?.source ?? "",
    reference: evidence?.reference ?? "",
    notes: evidence?.notes ?? "",
  };
}

function hasEvidence(evidence: EvidenceDraft): boolean {
  return Boolean(
    evidence.source.trim() ||
      evidence.reference.trim() ||
      evidence.notes.trim(),
  );
}

function evidencePayload(
  evidence: EvidenceDraft,
): AisIdentityEvidence | null {
  if (!hasEvidence(evidence)) return null;
  return {
    source: evidence.source.trim(),
    ...(evidence.reference.trim()
      ? { reference: evidence.reference.trim() }
      : {}),
    ...(evidence.notes.trim() ? { notes: evidence.notes.trim() } : {}),
  };
}

function invalidateIdentityAndAisQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  vesselId: string,
) {
  void queryClient.invalidateQueries({
    queryKey: getListMyVesselAisIdentitiesQueryKey(vesselId),
  });
  void queryClient.invalidateQueries({
    queryKey: getGetMyVesselAisQueryKey(vesselId),
  });
}

function formatEvidence(evidence: AisIdentityEvidence | null) {
  if (!evidence) {
    return (
      <span className="italic text-muted-foreground">
        {t("vessels.ais.identities.no_evidence")}
      </span>
    );
  }

  return (
    <span className="space-y-0.5">
      <span className="block">
        <span className="font-medium text-muted-foreground">
          {t("vessels.ais.identities.source")}:
        </span>{" "}
        {evidence.source}
      </span>
      {evidence.reference && (
        <span className="block">
          <span className="font-medium text-muted-foreground">
            {t("vessels.ais.identities.reference")}:
          </span>{" "}
          {evidence.reference}
        </span>
      )}
      {evidence.notes && (
        <span className="block whitespace-pre-wrap">
          <span className="font-medium text-muted-foreground">
            {t("vessels.ais.identities.notes")}:
          </span>{" "}
          {evidence.notes}
        </span>
      )}
    </span>
  );
}

function IdentityCard({
  identity,
  canWrite,
  onEdit,
  onDelete,
  deletePending,
}: {
  identity: VesselAisIdentity;
  canWrite: boolean;
  onEdit: (identity: VesselAisIdentity) => void;
  onDelete: (identity: VesselAisIdentity) => void;
  deletePending: boolean;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {identity.identifierType}
            </span>
            <Badge
              variant={identity.verified ? "default" : "outline"}
              className={cn(
                "gap-1 text-[10px]",
                identity.verified
                  ? "bg-emerald-600 text-white hover:bg-emerald-600"
                  : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
              )}
            >
              {identity.verified ? (
                <ShieldCheck className="h-3 w-3" />
              ) : (
                <Info className="h-3 w-3" />
              )}
              {identity.verified
                ? t("vessels.ais.identities.verified")
                : t("vessels.ais.identities.unverified")}
            </Badge>
          </div>
          <div className="mt-1 break-all font-mono text-sm font-medium">
            {identity.identifierValue}
          </div>
          {identity.provider && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t("vessels.ais.identities.provider")}: {identity.provider}
            </div>
          )}
        </div>
        {canWrite && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label={`${t("action.edit")} ${identity.identifierType}`}
              onClick={() => onEdit(identity)}
            >
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              aria-label={`${t("action.delete")} ${identity.identifierType}`}
              onClick={() => onDelete(identity)}
              disabled={deletePending}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      <div className="mt-2 border-t pt-2 text-xs">
        <span className="font-medium text-muted-foreground">
          {t("vessels.ais.identities.evidence")}:
        </span>{" "}
        {formatEvidence(identity.evidence)}
      </div>
    </div>
  );
}

function ConflictCard({ conflict }: { conflict: VesselAisIdentityConflict }) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold uppercase tracking-wide">
              {conflict.identifierType}
            </span>
            <Badge variant="destructive" className="text-[10px]">
              {conflict.status === "OPEN"
                ? t("vessels.ais.identities.conflict_open")
                : t("vessels.ais.identities.conflict_resolved")}
            </Badge>
          </div>
          <div className="mt-1 break-all font-mono text-sm font-medium">
            {conflict.identifierValue}
          </div>
          <p className="mt-1 text-destructive">{conflict.reason}</p>
          {conflict.provider && (
            <p className="mt-1 text-muted-foreground">
              {t("vessels.ais.identities.provider")}: {conflict.provider}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function VesselAisIdentitiesPanel({ vesselId }: { vesselId: string }) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [identifierType, setIdentifierType] =
    useState<IdentifierType>(AisIdentityIdentifierType.ENI);
  const [identifierValue, setIdentifierValue] = useState("");
  const [provider, setProvider] = useState("");
  const [evidence, setEvidence] = useState<EvidenceDraft>(emptyEvidence);
  const [formError, setFormError] = useState<string | null>(null);

  const identitiesQuery = useListMyVesselAisIdentities(vesselId, {
    query: {
      queryKey: getListMyVesselAisIdentitiesQueryKey(vesselId),
      staleTime: 10_000,
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
      retry: false,
    },
  });
  const registerMutation = useRegisterMyVesselAisIdentity();
  const updateMutation = useUpdateMyVesselAisIdentity();
  const deleteMutation = useDeleteMyVesselAisIdentity();
  const canWrite = identitiesQuery.data?.canManage === true;

  const items = identitiesQuery.data?.items ?? [];
  const conflicts = identitiesQuery.data?.conflicts ?? [];
  const openConflictCount = useMemo(
    () => conflicts.filter((conflict) => conflict.status === "OPEN").length,
    [conflicts],
  );
  const isSaving = registerMutation.isPending || updateMutation.isPending;

  function resetForm() {
    setIsAdding(false);
    setEditingId(null);
    setIdentifierType(AisIdentityIdentifierType.ENI);
    setIdentifierValue("");
    setProvider("");
    setEvidence(emptyEvidence());
    setFormError(null);
  }

  function startAdd() {
    resetForm();
    setIsAdding(true);
  }

  function startEdit(identity: VesselAisIdentity) {
    setFormError(null);
    setIsAdding(false);
    setEditingId(identity.id);
    setIdentifierType(identity.identifierType);
    setIdentifierValue(identity.identifierValue);
    setProvider(identity.provider ?? "");
    setEvidence(evidenceDraft(identity.evidence));
  }

  function validateEvidence(): AisIdentityEvidence | null | undefined {
    const source = evidence.source.trim();
    if (hasEvidence(evidence) && !source) {
      setFormError(t("vessels.ais.identities.source_required"));
      return undefined;
    }
    return evidencePayload(evidence);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const value = identifierValue.trim();
    if (!editingId && !value) {
      setFormError(t("vessels.ais.identities.identifier_required"));
      return;
    }
    const evidenceValue = validateEvidence();
    if (evidenceValue === undefined) return;

    if (editingId) {
      const data: AisIdentityUpdateRequest = {
        verified: false,
        evidence: evidenceValue,
      };
      updateMutation.mutate(
        { vesselId, mappingId: editingId, data },
        {
          onSuccess: () => {
            invalidateIdentityAndAisQueries(queryClient, vesselId);
            resetForm();
          },
          onError: (error) => setFormError(errorMessage(error)),
        },
      );
      return;
    }

    registerMutation.mutate(
      {
        vesselId,
        data: {
          identifierType,
          identifierValue: value,
          provider: provider.trim() || null,
          verified: false,
          evidence: evidenceValue,
        },
      },
      {
        onSuccess: () => {
          invalidateIdentityAndAisQueries(queryClient, vesselId);
          resetForm();
        },
        onError: (error) => setFormError(errorMessage(error)),
      },
    );
  }

  function handleDelete(identity: VesselAisIdentity) {
    if (
      !window.confirm(
        t("vessels.ais.identities.confirm_delete").replace(
          "{identifier}",
          `${identity.identifierType} ${identity.identifierValue}`,
        ),
      )
    ) {
      return;
    }
    deleteMutation.mutate(
      { vesselId, mappingId: identity.id },
      {
        onSuccess: () => {
          invalidateIdentityAndAisQueries(queryClient, vesselId);
          if (editingId === identity.id) resetForm();
        },
      },
    );
  }

  function updateEvidence(field: keyof EvidenceDraft, value: string) {
    setEvidence((current) => ({ ...current, [field]: value }));
  }

  return (
    <section
      className="rounded-lg border bg-card p-3 text-card-foreground"
      aria-labelledby={`ais-identities-${vesselId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id={`ais-identities-${vesselId}`}
              className="text-sm font-semibold"
            >
              {t("vessels.ais.identities.title")}
            </h3>
            {openConflictCount > 0 && (
              <Badge variant="destructive" className="gap-1 text-[10px]">
                <AlertTriangle className="h-3 w-3" />
                {t("vessels.ais.identities.conflicts_count").replace(
                  "{count}",
                  String(openConflictCount),
                )}
              </Badge>
            )}
          </div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            {t("vessels.ais.identities.description")}
          </p>
        </div>
        {canWrite && !isAdding && !editingId && (
          <Button type="button" size="sm" onClick={startAdd}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("vessels.ais.identities.add")}
          </Button>
        )}
      </div>

      {identitiesQuery.isLoading && (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
          {t("vessels.ais.identities.loading")}
        </div>
      )}

      {identitiesQuery.isError && (
        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm"
          role="alert"
        >
          <span className="text-destructive">
            {errorMessage(identitiesQuery.error)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void identitiesQuery.refetch()}
            disabled={identitiesQuery.isFetching}
          >
            <RefreshCcw
              className={cn(
                "mr-1.5 h-3.5 w-3.5",
                identitiesQuery.isFetching && "animate-spin",
              )}
            />
            {t("vessels.ais.refresh")}
          </Button>
        </div>
      )}

      {!identitiesQuery.isLoading &&
        !identitiesQuery.isError &&
        items.length === 0 &&
        conflicts.length === 0 && (
          <div className="mt-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            {t("vessels.ais.identities.empty")}
          </div>
        )}

      {items.length > 0 && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {items.map((identity) => (
            <IdentityCard
              key={identity.id}
              identity={identity}
              canWrite={canWrite}
              onEdit={startEdit}
              onDelete={handleDelete}
              deletePending={deleteMutation.isPending}
            />
          ))}
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="mt-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t("vessels.ais.identities.conflicts")}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {conflicts.map((conflict) => (
              <ConflictCard key={conflict.id} conflict={conflict} />
            ))}
          </div>
        </div>
      )}

      {!canWrite && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("vessels.ais.identities.read_only")}
        </p>
      )}

      {(isAdding || editingId) && canWrite && (
        <form
          onSubmit={handleSubmit}
          className="mt-3 rounded-md border bg-muted/20 p-3"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">
              {editingId
                ? t("vessels.ais.identities.edit")
                : t("vessels.ais.identities.add")}
            </h4>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={resetForm}
              aria-label={t("action.cancel")}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`identity-type-${vesselId}`}>
                {t("vessels.ais.identities.identifier_type")}
              </Label>
              <Select
                id={`identity-type-${vesselId}`}
                value={identifierType}
                onChange={(event) =>
                  setIdentifierType(event.target.value as IdentifierType)
                }
                disabled={Boolean(editingId) || isSaving}
              >
                {identifierTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`identity-value-${vesselId}`}>
                {t("vessels.ais.identities.identifier_value")}
              </Label>
              <Input
                id={`identity-value-${vesselId}`}
                value={identifierValue}
                onChange={(event) => setIdentifierValue(event.target.value)}
                readOnly={Boolean(editingId)}
                disabled={Boolean(editingId) || isSaving}
                placeholder={t("vessels.ais.identities.identifier_placeholder")}
              />
              {editingId && (
                <p className="text-[11px] text-muted-foreground">
                  {t("vessels.ais.identities.identifier_immutable")}
                </p>
              )}
            </div>
            {!editingId && (
              <div className="space-y-1.5">
                <Label htmlFor={`identity-provider-${vesselId}`}>
                  {t("vessels.ais.identities.provider")}
                </Label>
                <Input
                  id={`identity-provider-${vesselId}`}
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                  disabled={isSaving}
                  placeholder={t("vessels.ais.identities.provider_placeholder")}
                />
              </div>
            )}
            <p className="text-sm text-muted-foreground md:col-span-2">
              Claims require independent operator approval before AIS access.
              Saving changes removes any earlier verification.
            </p>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor={`identity-evidence-source-${vesselId}`}>
                {t("vessels.ais.identities.source")}
              </Label>
              <Input
                id={`identity-evidence-source-${vesselId}`}
                value={evidence.source}
                onChange={(event) => updateEvidence("source", event.target.value)}
                disabled={isSaving}
                placeholder={t("vessels.ais.identities.source_placeholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`identity-evidence-reference-${vesselId}`}>
                {t("vessels.ais.identities.reference")}
              </Label>
              <Input
                id={`identity-evidence-reference-${vesselId}`}
                value={evidence.reference}
                onChange={(event) =>
                  updateEvidence("reference", event.target.value)
                }
                disabled={isSaving}
                placeholder={t("vessels.ais.identities.reference_placeholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`identity-evidence-notes-${vesselId}`}>
                {t("vessels.ais.identities.notes")}
              </Label>
              <Textarea
                id={`identity-evidence-notes-${vesselId}`}
                value={evidence.notes}
                onChange={(event) => updateEvidence("notes", event.target.value)}
                disabled={isSaving}
                placeholder={t("vessels.ais.identities.notes_placeholder")}
                className="min-h-[56px]"
              />
            </div>
          </div>

          {formError && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {formError}
            </p>
          )}
          {(registerMutation.isError || updateMutation.isError) &&
            !formError && (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {errorMessage(
                  registerMutation.error ?? updateMutation.error,
                )}
              </p>
            )}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetForm}
              disabled={isSaving}
            >
              {t("action.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={isSaving}>
              {isSaving ? (
                <RefreshCcw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t("action.save")}
            </Button>
          </div>
        </form>
      )}

      {deleteMutation.isError && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {errorMessage(deleteMutation.error)}
        </p>
      )}
      <div className="mt-3 flex items-start gap-2 border-t pt-3 text-[11px] leading-snug text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>{t("vessels.ais.identities.mapping_disclaimer")}</p>
      </div>
    </section>
  );
}