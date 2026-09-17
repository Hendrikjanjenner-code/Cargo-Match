import React, { useState } from "react";
import { 
  useListMyCargo, useCreateMyCargo, useUpdateMyCargo, useWithdrawMyCargo, useCloseMyCargo, 
  getListMyCargoQueryKey, getListMarketplaceQueryKey, getListMyMatchesQueryKey, useListLocations,
  VesselType, Visibility, CargoListing, ListingStatus, TransportMode, LocationType
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Select, Label, Card, CardHeader, CardTitle, CardContent, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge, Textarea } from "@/components/ui/primitives";
import { DeepseaVesselClass } from "@workspace/api-client-react";
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
  expectedUnloadingDate: z.string().optional().nullable(),
  requiredVesselType: z.nativeEnum(VesselType),
  specialRequirements: z.string().optional().nullable(),
  visibility: z.nativeEnum(Visibility),
  notes: z.string().optional().nullable(),

  quantityTolerancePercent: z.preprocess((val) => (val === "" || val === undefined || val === null) ? null : val, z.coerce.number().min(0, "Min 0").max(99.99, "Max 99.99").nullable().optional()),
  minimumVesselDwtTonnes: z.preprocess((val) => (val === "" || val === undefined || val === null) ? null : val, z.coerce.number().positive("Must be positive").nullable().optional()),
  maximumVesselDwtTonnes: z.preprocess((val) => (val === "" || val === undefined || val === null) ? null : val, z.coerce.number().positive("Must be positive").nullable().optional()),
  maximumDraftMetres: z.preprocess((val) => (val === "" || val === undefined || val === null) ? null : val, z.coerce.number().positive("Must be positive").nullable().optional()),
  requiredGear: z.string().optional().nullable(),
  preferredVesselClass: z.preprocess((value) => value === "" ? null : value, z.nativeEnum(DeepseaVesselClass).optional().nullable())
});

type FormValues = z.infer<typeof schema>;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export default function DeepseaCargo() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState<ListingStatus | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  
  const queryClient = useQueryClient();
  
  const { data: cargoData, isLoading, error: cargoError } = useListMyCargo({ transportMode: TransportMode.DEEPSEA_BULK });
  const { data: locationsData, error: locationsError } = useListLocations({ pageSize: 100, locationType: LocationType.PORT });
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
    defaultValues: { requiredVesselType: VesselType.DRY_CARGO, visibility: Visibility.OPEN_NETWORK, quantityTolerancePercent: 0 }
  });

  const invalidateCargoCaches = () => {
    void queryClient.invalidateQueries({ queryKey: getListMyCargoQueryKey({ transportMode: TransportMode.DEEPSEA_BULK }) });
    void queryClient.invalidateQueries({ queryKey: getListMarketplaceQueryKey({ transportMode: TransportMode.DEEPSEA_BULK }) });
    void queryClient.invalidateQueries({ queryKey: getListMyMatchesQueryKey({ transportMode: TransportMode.DEEPSEA_BULK }) });
  };

  const onSubmit = (data: FormValues, requestedStatus?: ListingStatus) => {
    setFormError(null);
    setLifecycleError(null);
    const status = requestedStatus ?? editingStatus ?? ListingStatus.DRAFT;
    const basePayload = {
      transportMode: TransportMode.DEEPSEA_BULK,
      cargoName: data.cargoName,
      cargoType: data.cargoType,
      weightTonnes: data.weightTonnes,
      loadingLocationId: data.loadingLocationId,
      destinationLocationId: data.destinationLocationId,
      loadingFrom: new Date(data.loadingFrom).toISOString(),
      loadingUntil: new Date(data.loadingUntil).toISOString(),
      requiredVesselType: data.requiredVesselType,
      visibility: data.visibility,
      listingStatus: status,
      deepseaRequirement: {
        quantityTolerancePercent: data.quantityTolerancePercent ?? undefined,
        minimumVesselDwtTonnes: data.minimumVesselDwtTonnes ?? null,
        maximumVesselDwtTonnes: data.maximumVesselDwtTonnes ?? null,
        maximumDraftMetres: data.maximumDraftMetres ?? null,
        requiredGear: data.requiredGear || null,
        preferredVesselClass: data.preferredVesselClass || null
      }
    };

    if (editingId) {
      const payload = { 
        ...basePayload, 
        expectedUnloadingDate: data.expectedUnloadingDate ? new Date(data.expectedUnloadingDate).toISOString() : null,
        specialRequirements: data.specialRequirements || null,
        notes: data.notes || null
      };
      updateCargo.mutate({ cargoId: editingId, data: payload }, {
        onSuccess: () => {
          invalidateCargoCaches();
          closeForm();
        },
        onError: (err) => setFormError(errorMessage(err, t("error.save")))
      });
    } else {
      const payload = { 
        ...basePayload, 
        expectedUnloadingDate: data.expectedUnloadingDate ? new Date(data.expectedUnloadingDate).toISOString() : undefined,
        specialRequirements: data.specialRequirements || undefined,
        notes: data.notes || undefined
      };
      createCargo.mutate({ data: payload }, {
        onSuccess: () => {
          invalidateCargoCaches();
          closeForm();
        },
        onError: (err) => setFormError(errorMessage(err, t("error.save")))
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
      notes: c.notes || "",
      quantityTolerancePercent: c.deepseaRequirement?.quantityTolerancePercent ?? 0,
      minimumVesselDwtTonnes: c.deepseaRequirement?.minimumVesselDwtTonnes ?? undefined,
      maximumVesselDwtTonnes: c.deepseaRequirement?.maximumVesselDwtTonnes ?? undefined,
      maximumDraftMetres: c.deepseaRequirement?.maximumDraftMetres ?? undefined,
      requiredGear: c.deepseaRequirement?.requiredGear ?? "",
      preferredVesselClass: c.deepseaRequirement?.preferredVesselClass ?? null
    });
    setEditingId(c.id);
    setEditingStatus(c.listingStatus);
    setShowForm(true);
    setFormError(null);
    setLifecycleError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setEditingStatus(null);
    setFormError(null);
    reset({
      cargoName: "", cargoType: "", weightTonnes: 0, loadingLocationId: "", destinationLocationId: "",
      loadingFrom: "", loadingUntil: "", expectedUnloadingDate: "", requiredVesselType: VesselType.DRY_CARGO,
      specialRequirements: "", visibility: Visibility.OPEN_NETWORK, notes: "",
      quantityTolerancePercent: 0, minimumVesselDwtTonnes: undefined, maximumVesselDwtTonnes: undefined, maximumDraftMetres: undefined, requiredGear: "", preferredVesselClass: undefined
    });
  };

  const handleStatusChange = (id: string, action: 'publish' | 'withdraw' | 'close') => {
    setLifecycleError(null);
    const options = {
      onSuccess: invalidateCargoCaches,
      onError: (err: unknown) => setLifecycleError(errorMessage(err, t("error.lifecycle")))
    };

    if (action === 'publish') {
      updateCargo.mutate({ cargoId: id, data: { listingStatus: ListingStatus.ACTIVE } }, options);
    } else if (action === 'withdraw') {
      withdrawCargo.mutate({ cargoId: id }, options);
    } else if (action === 'close') {
      closeCargo.mutate({ cargoId: id }, options);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("deepsea.cargo.title")}</h1>
          <p className="text-muted-foreground">{t("deepsea.cargo.subtitle")}</p>
        </div>
        <Button onClick={() => showForm ? closeForm() : setShowForm(true)} disabled={isPending}>
          <Plus className="h-4 w-4 mr-2" />
          {showForm ? t("action.cancel") : t("action.add")}
        </Button>
      </div>

      {lifecycleError && (
        <div role="alert" className="flex items-start gap-2 p-4 text-destructive bg-destructive/10 rounded-md">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{lifecycleError}</span>
        </div>
      )}

      {locationsError && (
        <div role="alert" className="p-4 text-destructive bg-destructive/10 rounded-md">
          {errorMessage(locationsError, t("error.load_locations"))}
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? t("deepsea.cargo.edit") : t("deepsea.cargo.add")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form id="cargo-form" className="space-y-4">
              {Object.keys(errors).length > 0 && <div role="alert" className="text-sm text-destructive">
                {t("deepsea.form_invalid")}
                <ul>{Object.entries(errors).map(([field, error]) => <li key={field}>{error?.message}</li>)}</ul>
              </div>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="cargoName">{t("deepsea.cargo.cargo_name")}</Label>
                  <Input id="cargoName" {...register("cargoName")} placeholder="e.g. Coal 40k" />
                  {errors.cargoName && <span className="text-xs text-destructive">{errors.cargoName.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cargoType">{t("deepsea.cargo.cargo_type")}</Label>
                  <Input id="cargoType" {...register("cargoType")} placeholder="e.g. COAL" />
                  {errors.cargoType && <span className="text-xs text-destructive">{errors.cargoType.message}</span>}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="weightTonnes">{t("deepsea.cargo.weight")}</Label>
                  <Input id="weightTonnes" type="number" {...register("weightTonnes")} />
                  {errors.weightTonnes && <span className="text-xs text-destructive">{errors.weightTonnes.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quantityTolerancePercent">{t("deepsea.cargo.quantity_tolerance")}</Label>
                  <Input id="quantityTolerancePercent" type="number" step="0.1" {...register("quantityTolerancePercent")} />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="loadingLocationId">{t("deepsea.cargo.loading_port")}</Label>
                  <Select id="loadingLocationId" {...register("loadingLocationId")}>
                    <option value="">{t("deepsea.cargo.select_loading")}</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.country})</option>)}
                  </Select>
                  {errors.loadingLocationId && <span className="text-xs text-destructive">{errors.loadingLocationId.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="destinationLocationId">{t("deepsea.cargo.destination_port")}</Label>
                  <Select id="destinationLocationId" {...register("destinationLocationId")}>
                    <option value="">{t("deepsea.cargo.select_destination")}</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.country})</option>)}
                  </Select>
                  {errors.destinationLocationId && <span className="text-xs text-destructive">{errors.destinationLocationId.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="loadingFrom">{t("deepsea.cargo.loading_start")}</Label>
                  <Input id="loadingFrom" type="datetime-local" {...register("loadingFrom")} />
                  {errors.loadingFrom && <span className="text-xs text-destructive">{errors.loadingFrom.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="loadingUntil">{t("deepsea.cargo.loading_end")}</Label>
                  <Input id="loadingUntil" type="datetime-local" {...register("loadingUntil")} />
                  {errors.loadingUntil && <span className="text-xs text-destructive">{errors.loadingUntil.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expectedUnloadingDate">{t("deepsea.cargo.expected_unloading")}</Label>
                  <Input id="expectedUnloadingDate" type="date" {...register("expectedUnloadingDate")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="requiredVesselType">{t("deepsea.cargo.req_vessel_type")}</Label>
                  <Select id="requiredVesselType" {...register("requiredVesselType")}>
                    {Object.values(VesselType).map(t => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="minimumVesselDwtTonnes">{t("deepsea.cargo.min_dwt")}</Label>
                  <Input id="minimumVesselDwtTonnes" type="number" {...register("minimumVesselDwtTonnes")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maximumVesselDwtTonnes">{t("deepsea.cargo.max_dwt")}</Label>
                  <Input id="maximumVesselDwtTonnes" type="number" {...register("maximumVesselDwtTonnes")} />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="maximumDraftMetres">{t("deepsea.cargo.max_draft")}</Label>
                  <Input id="maximumDraftMetres" type="number" step="0.1" {...register("maximumDraftMetres")} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="requiredGear">{t("deepsea.cargo.required_gear")}</Label>
                  <Input id="requiredGear" {...register("requiredGear")} placeholder={t("deepsea.cargo.required_gear_placeholder")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="preferredVesselClass">{t("deepsea.cargo.preferred_class")}</Label>
                  <Select id="preferredVesselClass" {...register("preferredVesselClass")}>
                    <option value="">{t("deepsea.any_class")}</option>
                    {Object.values(DeepseaVesselClass).map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="visibility">{t("deepsea.cargo.visibility")}</Label>
                  <Select id="visibility" {...register("visibility")}>
                    {Object.values(Visibility).map(v => <option key={v} value={v}>{v.replace('_', ' ')}</option>)}
                  </Select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="specialRequirements">{t("deepsea.cargo.special_reqs")}</Label>
                  <Input id="specialRequirements" {...register("specialRequirements")} placeholder="e.g. Needs grab cranes" />
                </div>
                
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="notes">{t("deepsea.cargo.internal_notes")}</Label>
                  <Textarea id="notes" {...register("notes")} placeholder="Private notes, never shared." />
                </div>
              </div>
              
              {formError && (
                <div className="text-sm text-destructive mt-2">{formError}</div>
              )}
              
              <div className="flex justify-end gap-2 mt-4">
                <Button type="button" variant="outline" onClick={closeForm} disabled={isPending}>{t("action.cancel")}</Button>
                {(!editingId || editingStatus === ListingStatus.DRAFT) && (
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={handleSubmit((data) => onSubmit(data, ListingStatus.DRAFT))}
                    disabled={isPending}
                  >
                    {isPending ? t("common.loading") : t("action.save_draft")}
                  </Button>
                )}
                <Button 
                  type="button" 
                  onClick={handleSubmit((data) => onSubmit(data, editingStatus === ListingStatus.ACTIVE ? undefined : ListingStatus.ACTIVE))}
                  disabled={isPending}
                >
                  {isPending ? t("common.loading") : (editingStatus === ListingStatus.ACTIVE ? t("action.save_changes") : t("action.publish"))}
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
