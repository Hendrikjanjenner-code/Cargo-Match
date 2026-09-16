import { useState } from "react";
import { 
  useListMyCapacity, useCreateMyCapacity, useUpdateMyCapacity, useWithdrawMyCapacity, useCloseMyCapacity, 
  getListMyCapacityQueryKey, getListMarketplaceQueryKey, getListMyMatchesQueryKey, useListLocations,
  useListMyVessels, AvailabilityType, Visibility, CapacityOffer, ListingStatus
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Select, Label, Card, CardHeader, CardTitle, CardContent, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge, Textarea } from "@/components/ui/primitives";
import { Plus, XCircle, Ban, Edit2, PlayCircle, AlertCircle } from "lucide-react";
import { formatDate, formatDateTimeInput } from "@/lib/utils";
import { t } from "@/lib/i18n";

const schema = z.object({
  vesselId: z.string().min(1, t("validation.vessel_required")),
  locationId: z.string().min(1, t("validation.location_required")),
  availableFrom: z.string().min(1, t("validation.available_from_required")),
  availableUntil: z.string().min(1, t("validation.available_until_required")),
  availabilityType: z.nativeEnum(AvailabilityType),
  availableCapacityTonnes: z.coerce.number().min(1, t("validation.capacity_required")),
  cargoCompatibility: z.string().min(1, t("validation.cargo_compatibility_required")),
  preferredDirection: z.string().min(1, t("validation.direction_required")),
  maximumPositioningDistanceKm: z.coerce.number().min(0, t("validation.distance_invalid")),
  visibility: z.nativeEnum(Visibility),
  notes: z.string().optional()
});

type FormValues = z.infer<typeof schema>;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export default function Capacity() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState<ListingStatus | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  
  const queryClient = useQueryClient();
  
  const { data: capacityData, isLoading, error: capacityError } = useListMyCapacity();
  const { data: locationsData, error: locationsError } = useListLocations({ pageSize: 100 });
  const { data: vesselsData, error: vesselsError } = useListMyVessels({ activeOnly: true });
  
  const locations = locationsData?.items || [];
  const vessels = vesselsData?.items || [];

  const createCapacity = useCreateMyCapacity();
  const updateCapacity = useUpdateMyCapacity();
  const withdrawCap = useWithdrawMyCapacity();
  const closeCap = useCloseMyCapacity();

  const isPending =
    createCapacity.isPending ||
    updateCapacity.isPending ||
    withdrawCap.isPending ||
    closeCap.isPending;

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { availabilityType: AvailabilityType.FULLY_EMPTY, visibility: Visibility.OPEN_NETWORK, maximumPositioningDistanceKm: 50 }
  });

  const invalidateCapacityCaches = () => {
    void queryClient.invalidateQueries({ queryKey: getListMyCapacityQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListMarketplaceQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListMyMatchesQueryKey() });
  };

  const onSubmit = (data: FormValues, requestedStatus?: ListingStatus) => {
    setFormError(null);
    setLifecycleError(null);
    // Keep a draft in DRAFT unless the user explicitly chooses Publish.
    const status = requestedStatus ?? editingStatus ?? ListingStatus.DRAFT;
    const payload = {
      ...data,
      listingStatus: status,
      availableFrom: new Date(data.availableFrom).toISOString(),
      availableUntil: new Date(data.availableUntil).toISOString(),
      notes: data.notes || undefined,
      cargoCompatibility: data.cargoCompatibility.split(",").map(s => s.trim()).filter(Boolean)
    };

    if (editingId) {
      updateCapacity.mutate({ capacityId: editingId, data: payload }, {
        onSuccess: () => {
          invalidateCapacityCaches();
          closeForm();
        },
        onError: error => setFormError(errorMessage(error, t("error.save")))
      });
    } else {
      createCapacity.mutate({ data: payload }, {
        onSuccess: () => {
          invalidateCapacityCaches();
          closeForm();
        },
        onError: error => setFormError(errorMessage(error, t("error.save")))
      });
    }
  };

  const handleEdit = (c: CapacityOffer) => {
    reset({
      vesselId: c.vesselId,
      locationId: c.locationId,
      availableFrom: formatDateTimeInput(c.availableFrom),
      availableUntil: formatDateTimeInput(c.availableUntil),
      availabilityType: c.availabilityType,
      availableCapacityTonnes: c.availableCapacityTonnes,
      cargoCompatibility: c.cargoCompatibility.join(", "),
      preferredDirection: c.preferredDirection,
      maximumPositioningDistanceKm: c.maximumPositioningDistanceKm,
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
      vesselId: "", locationId: "", availableFrom: "", availableUntil: "",
      availabilityType: AvailabilityType.FULLY_EMPTY, availableCapacityTonnes: 0,
      cargoCompatibility: "", preferredDirection: "", maximumPositioningDistanceKm: 50,
      visibility: Visibility.OPEN_NETWORK, notes: ""
    });
  };

  const handleStatusChange = (id: string, action: 'withdraw' | 'close' | 'publish') => {
    setLifecycleError(null);
    if (action === 'publish') {
      updateCapacity.mutate({ capacityId: id, data: { listingStatus: ListingStatus.ACTIVE } }, {
        onSuccess: invalidateCapacityCaches,
        onError: error => setLifecycleError(errorMessage(error, t("error.publish")))
      });
      return;
    }
    const confirmMsg = action === 'withdraw'
      ? t("capacity.confirm_withdraw")
      : t("capacity.confirm_close");
    if (!confirm(confirmMsg)) return;
    const mutation = action === 'withdraw' ? withdrawCap : closeCap;
    mutation.mutate({ capacityId: id }, {
      onSuccess: invalidateCapacityCaches,
      onError: error => setLifecycleError(errorMessage(error, t("error.lifecycle")))
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("capacity.title")}</h1>
          <p className="text-muted-foreground">{t("capacity.subtitle")}</p>
        </div>
        <Button onClick={() => showForm ? closeForm() : setShowForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {showForm ? t("action.cancel") : t("action.add")}
        </Button>
      </div>

      {capacityError && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMessage(capacityError, t("error.load_capacity"))}</span>
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
          <CardHeader><CardTitle>{editingId ? t("action.edit") : t("action.create")} {t("capacity.entity")}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(data => onSubmit(data))} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                <div className="space-y-2">
                  <Label>{t("capacity.vessel_label")}</Label>
                  <Select {...register("vesselId")}>
                    <option value="">{t("capacity.select_vessel")}</option>
                    {vessels.map(v => <option key={v.id} value={v.id}>{v.vesselName} ({v.totalCapacityTonnes}t)</option>)}
                  </Select>
                  {errors.vesselId && <span className="text-xs text-destructive">{errors.vesselId.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label>{t("capacity.location_label")}</Label>
                  <Select {...register("locationId")}>
                    <option value="">{t("capacity.select_location")}</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.country})</option>)}
                  </Select>
                  {errors.locationId && <span className="text-xs text-destructive">{errors.locationId.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label>{t("capacity.available_from_label")}</Label>
                  <Input type="datetime-local" {...register("availableFrom")} />
                  {errors.availableFrom && <span className="text-xs text-destructive">{errors.availableFrom.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label>{t("capacity.available_until_label")}</Label>
                  <Input type="datetime-local" {...register("availableUntil")} />
                  {errors.availableUntil && <span className="text-xs text-destructive">{errors.availableUntil.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label>{t("capacity.available_capacity_label")}</Label>
                  <Input type="number" {...register("availableCapacityTonnes")} />
                  {errors.availableCapacityTonnes && <span className="text-xs text-destructive">{errors.availableCapacityTonnes.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label>{t("capacity.availability_type_label")}</Label>
                  <Select {...register("availabilityType")}>
                    {Object.values(AvailabilityType).map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                  </Select>
                  {errors.availabilityType && <span className="text-xs text-destructive">{errors.availabilityType.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label>{t("capacity.direction_label")}</Label>
                  <Input {...register("preferredDirection")} placeholder={t("capacity.direction_placeholder")} />
                  {errors.preferredDirection && <span className="text-xs text-destructive">{errors.preferredDirection.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label>{t("capacity.distance_label")}</Label>
                  <Input type="number" {...register("maximumPositioningDistanceKm")} />
                  {errors.maximumPositioningDistanceKm && <span className="text-xs text-destructive">{errors.maximumPositioningDistanceKm.message}</span>}
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>{t("capacity.cargo_compatibility_label")}</Label>
                  <Input {...register("cargoCompatibility")} placeholder={t("capacity.cargo_compatibility_placeholder")} />
                  {errors.cargoCompatibility && <span className="text-xs text-destructive">{errors.cargoCompatibility.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label>{t("capacity.visibility_label")}</Label>
                  <Select {...register("visibility")}>
                    {Object.values(Visibility).map(v => <option key={v} value={v}>{v.replace('_', ' ')}</option>)}
                  </Select>
                  {errors.visibility && <span className="text-xs text-destructive">{errors.visibility.message}</span>}
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>{t("capacity.notes_label")}</Label>
                  <Textarea {...register("notes")} placeholder={t("capacity.notes_placeholder")} />
                </div>
              </div>

              {locationsError && (
                <div role="alert" className="flex items-start gap-2 text-sm text-destructive mt-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorMessage(locationsError, t("error.load_locations"))}</span>
                </div>
              )}
              {vesselsError && (
                <div role="alert" className="flex items-start gap-2 text-sm text-destructive mt-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorMessage(vesselsError, t("error.load_vessels"))}</span>
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
              <TableHead>{t("capacity.vessel_location_header")}</TableHead>
              <TableHead>{t("capacity.availability_window_header")}</TableHead>
              <TableHead>{t("capacity.capacity_type_header")}</TableHead>
              <TableHead>{t("capacity.direction_header")}</TableHead>
              <TableHead>{t("matches.status")}</TableHead>
              <TableHead className="text-right">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center">{t("common.loading")}</TableCell></TableRow>
            ) : capacityError ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-destructive">{t("error.load_capacity")}</TableCell></TableRow>
            ) : capacityData?.items.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t("common.no_data")}</TableCell></TableRow>
            ) : (
              capacityData?.items.map(c => {
                const loc = locations.find(l => l.id === c.locationId)?.name || t("common.unknown");
                const vessel = vessels.find(v => v.id === c.vesselId)?.vesselName || t("common.unknown_vessel");
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="font-medium">{vessel}</div>
                      <div className="text-xs text-muted-foreground">{t("capacity.at_location")} {loc}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(c.availableFrom)} to {formatDate(c.availableUntil)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {c.availableCapacityTonnes}t<br/>{c.availabilityType.replace('_', ' ')}
                    </TableCell>
                    <TableCell className="text-xs">{c.preferredDirection}</TableCell>
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
