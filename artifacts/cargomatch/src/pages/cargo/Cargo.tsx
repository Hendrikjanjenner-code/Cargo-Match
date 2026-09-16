import { useState } from "react";
import { 
  useListMyCargo, useCreateMyCargo, useUpdateMyCargo, useWithdrawMyCargo, useCloseMyCargo, 
  getListMyCargoQueryKey, getListMarketplaceQueryKey, getListMyMatchesQueryKey, useListLocations,
  VesselType, Visibility, CargoListing, ListingStatus
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Select, Label, Card, CardHeader, CardTitle, CardContent, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge, Textarea } from "@/components/ui/primitives";
import { Plus, XCircle, Ban, Edit2, PlayCircle, AlertCircle } from "lucide-react";
import { formatDate, formatDateInput, formatDateTimeInput } from "@/lib/utils";
import { t } from "@/lib/i18n";

const schema = z.object({
  cargoName: z.string().min(1, t("validation.cargo_name_required")),
  cargoType: z.string().min(1, t("validation.cargo_type_required")),
  weightTonnes: z.coerce.number().min(1, t("validation.weight_required")),
  loadingLocationId: z.string().min(1, t("validation.location_required")),
  destinationLocationId: z.string().min(1, t("validation.location_required")),
  loadingFrom: z.string().min(1, t("validation.loading_from_required")),
  loadingUntil: z.string().min(1, t("validation.loading_until_required")),
  expectedUnloadingDate: z.string().optional(),
  requiredVesselType: z.nativeEnum(VesselType),
  specialRequirements: z.string().optional(),
  visibility: z.nativeEnum(Visibility),
  notes: z.string().optional()
});

type FormValues = z.infer<typeof schema>;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export default function Cargo() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState<ListingStatus | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  
  const queryClient = useQueryClient();
  
  const { data: cargoData, isLoading, error: cargoError } = useListMyCargo();
  const { data: locationsData, error: locationsError } = useListLocations({ pageSize: 100 });
  const locations = locationsData?.items || [];

  const createCargo = useCreateMyCargo();
  const updateCargo = useUpdateMyCargo();
  const withdrawCargo = useWithdrawMyCargo();
  const closeCargo = useCloseMyCargo();

  const isPending =
    createCargo.isPending ||
    updateCargo.isPending ||
    withdrawCargo.isPending ||
    closeCargo.isPending;

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { requiredVesselType: VesselType.DRY_CARGO, visibility: Visibility.OPEN_NETWORK }
  });

  const invalidateCargoCaches = () => {
    void queryClient.invalidateQueries({ queryKey: getListMyCargoQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListMarketplaceQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListMyMatchesQueryKey() });
  };

  const onSubmit = (data: FormValues, requestedStatus?: ListingStatus) => {
    setFormError(null);
    setLifecycleError(null);
    // A draft stays a draft when the form is submitted without an explicit
    // publish choice. The Publish button passes ACTIVE explicitly below.
    const status = requestedStatus ?? editingStatus ?? ListingStatus.DRAFT;
    const payload = {
      ...data,
      listingStatus: status,
      loadingFrom: new Date(data.loadingFrom).toISOString(),
      loadingUntil: new Date(data.loadingUntil).toISOString(),
      expectedUnloadingDate: data.expectedUnloadingDate || undefined,
      specialRequirements: data.specialRequirements || undefined,
      notes: data.notes || undefined
    };

    if (editingId) {
      updateCargo.mutate({ cargoId: editingId, data: payload }, {
        onSuccess: () => {
          invalidateCargoCaches();
          closeForm();
        },
        onError: error => setFormError(errorMessage(error, t("error.save")))
      });
    } else {
      createCargo.mutate({ data: payload }, {
        onSuccess: () => {
          invalidateCargoCaches();
          closeForm();
        },
        onError: error => setFormError(errorMessage(error, t("error.save")))
      });
    }
  };

  const handleEdit = (c: CargoListing) => {
    reset({
      cargoName: c.cargoName,
      cargoType: c.cargoType,
      weightTonnes: c.weightTonnes,
      loadingLocationId: c.loadingLocationId,
      destinationLocationId: c.destinationLocationId,
      loadingFrom: formatDateTimeInput(c.loadingFrom),
      loadingUntil: formatDateTimeInput(c.loadingUntil),
      expectedUnloadingDate: c.expectedUnloadingDate ? formatDateInput(c.expectedUnloadingDate) : "",
      requiredVesselType: c.requiredVesselType,
      specialRequirements: c.specialRequirements || "",
      visibility: c.visibility,
      notes: c.notes || ""
    });
    setEditingId(c.id);
    setEditingStatus(c.listingStatus);
    setFormError(null);
    setLifecycleError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setEditingStatus(null);
    setFormError(null);
    setLifecycleError(null);
    reset({ 
      cargoName: "", cargoType: "", weightTonnes: 0, loadingLocationId: "", 
      destinationLocationId: "", loadingFrom: "", loadingUntil: "", 
      expectedUnloadingDate: "", requiredVesselType: VesselType.DRY_CARGO, 
      specialRequirements: "", visibility: Visibility.OPEN_NETWORK, notes: "" 
    });
  };

  const handleStatusChange = (id: string, action: 'withdraw' | 'close' | 'publish') => {
    setLifecycleError(null);
    if (action === 'publish') {
      updateCargo.mutate({ cargoId: id, data: { listingStatus: ListingStatus.ACTIVE } }, {
        onSuccess: invalidateCargoCaches,
        onError: error => setLifecycleError(errorMessage(error, t("error.publish")))
      });
      return;
    }

    const confirmMsg = action === 'withdraw'
      ? t("cargo.confirm_withdraw")
      : t("cargo.confirm_close");
    if (!confirm(confirmMsg)) return;

    const mutation = action === 'withdraw' ? withdrawCargo : closeCargo;
    mutation.mutate({ cargoId: id }, {
      onSuccess: invalidateCargoCaches,
      onError: error => setLifecycleError(errorMessage(error, t("error.lifecycle")))
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("cargo.title")}</h1>
          <p className="text-muted-foreground">{t("cargo.subtitle")}</p>
        </div>
        <Button onClick={() => showForm ? closeForm() : setShowForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {showForm ? t("action.cancel") : t("action.add")}
        </Button>
      </div>

      {cargoError && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMessage(cargoError, t("error.load_cargo"))}</span>
        </div>
      )}
      {lifecycleError && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{lifecycleError}</span>
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader><CardTitle>{editingId ? t("action.edit") : t("action.create")} {t("cargo.entity")}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(data => onSubmit(data))} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("cargo.internal_reference_label")}</Label>
                  <Input {...register("cargoName")} placeholder={t("cargo.name_placeholder")} />
                  {errors.cargoName && <span className="text-xs text-destructive">{errors.cargoName.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label>{t("cargo.type_label")}</Label>
                  <Input {...register("cargoType")} placeholder={t("cargo.type_placeholder")} />
                  {errors.cargoType && <span className="text-xs text-destructive">{errors.cargoType.message}</span>}
                </div>
                
                <div className="space-y-2">
                  <Label>{t("cargo.loading_location_label")}</Label>
                  <Select {...register("loadingLocationId")}>
                    <option value="">{t("cargo.select_location")}</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.country})</option>)}
                  </Select>
                  {errors.loadingLocationId && <span className="text-xs text-destructive">{errors.loadingLocationId.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label>{t("cargo.destination_location_label")}</Label>
                  <Select {...register("destinationLocationId")}>
                    <option value="">{t("cargo.select_location")}</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.country})</option>)}
                  </Select>
                  {errors.destinationLocationId && <span className="text-xs text-destructive">{errors.destinationLocationId.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label>{t("cargo.loading_from_label")}</Label>
                  <Input type="datetime-local" {...register("loadingFrom")} />
                  {errors.loadingFrom && <span className="text-xs text-destructive">{errors.loadingFrom.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label>{t("cargo.loading_until_label")}</Label>
                  <Input type="datetime-local" {...register("loadingUntil")} />
                  {errors.loadingUntil && <span className="text-xs text-destructive">{errors.loadingUntil.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label>{t("cargo.weight_label")}</Label>
                  <Input type="number" {...register("weightTonnes")} />
                  {errors.weightTonnes && <span className="text-xs text-destructive">{errors.weightTonnes.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label>{t("cargo.unloading_date_label")}</Label>
                  <Input type="date" {...register("expectedUnloadingDate")} />
                </div>
                
                <div className="space-y-2">
                  <Label>{t("cargo.vessel_type_label")}</Label>
                  <Select {...register("requiredVesselType")}>
                    {Object.values(VesselType).map(t => <option key={t} value={t}>{t}</option>)}
                  </Select>
                  {errors.requiredVesselType && <span className="text-xs text-destructive">{errors.requiredVesselType.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label>{t("cargo.visibility_label")}</Label>
                  <Select {...register("visibility")}>
                    {Object.values(Visibility).map(v => <option key={v} value={v}>{v.replace('_', ' ')}</option>)}
                  </Select>
                  {errors.visibility && <span className="text-xs text-destructive">{errors.visibility.message}</span>}
                  <p className="text-xs text-muted-foreground">{t("cargo.visibility_hint")}</p>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>{t("cargo.special_requirements_label")}</Label>
                  <Textarea {...register("specialRequirements")} placeholder={t("cargo.special_requirements_placeholder")} />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>{t("cargo.notes_label")}</Label>
                  <Textarea {...register("notes")} placeholder={t("cargo.notes_placeholder")} />
                </div>
              </div>

              {locationsError && (
                <div role="alert" className="flex items-start gap-2 text-sm text-destructive mt-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorMessage(locationsError, t("error.load_locations"))}</span>
                </div>
              )}
              {formError && (
                <div role="alert" className="flex items-start gap-2 text-sm text-destructive mt-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={closeForm}>{t("action.cancel")}</Button>
                <Button type="button" variant="outline" disabled={isPending} onClick={handleSubmit(data => onSubmit(data, ListingStatus.DRAFT))}>
                  {t("action.save_draft")}
                </Button>
                <Button type="button" disabled={isPending} onClick={handleSubmit(data => onSubmit(data, ListingStatus.ACTIVE))}>
                  {isPending ? t("common.loading") : t("action.publish")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("cargo.reference_header")}</TableHead>
              <TableHead>{t("cargo.route_header")}</TableHead>
              <TableHead>{t("cargo.window_header")}</TableHead>
              <TableHead>{t("cargo.specs_header")}</TableHead>
              <TableHead>{t("matches.status")}</TableHead>
              <TableHead className="text-right">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center">{t("common.loading")}</TableCell></TableRow>
            ) : cargoError ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-destructive">{t("error.load_cargo")}</TableCell></TableRow>
            ) : cargoData?.items.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t("common.no_data")}</TableCell></TableRow>
            ) : (
              cargoData?.items.map(c => {
                const loadingLoc = locations.find(l => l.id === c.loadingLocationId)?.name || t("common.unknown");
                const destLoc = locations.find(l => l.id === c.destinationLocationId)?.name || t("common.unknown");
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.cargoName}</TableCell>
                    <TableCell>
                      {loadingLoc} &rarr; {destLoc}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(c.loadingFrom)} - {formatDate(c.loadingUntil)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {c.weightTonnes}t<br/>{c.cargoType}
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.listingStatus === 'ACTIVE' ? 'default' : 'secondary'}>
                         {t(`status.${c.listingStatus.toLowerCase()}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {(c.listingStatus === 'ACTIVE' || c.listingStatus === 'DRAFT') && (
                        <Button variant="outline" size="sm" onClick={() => handleEdit(c)} title={t("action.edit")}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      )}
                      {c.listingStatus === 'DRAFT' && (
                        <Button variant="outline" size="sm" onClick={() => handleStatusChange(c.id, 'publish')} title={t("action.publish")}>
                          <PlayCircle className="h-4 w-4 text-emerald-600" />
                        </Button>
                      )}
                      {c.listingStatus === 'ACTIVE' && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => handleStatusChange(c.id, 'withdraw')} title={t("action.withdraw")}>
                            <Ban className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => handleStatusChange(c.id, 'close')} title={t("action.close")}>
                            <XCircle className="h-4 w-4 text-emerald-600" />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
