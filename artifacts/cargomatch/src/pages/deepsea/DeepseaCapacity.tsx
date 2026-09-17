import React, { useState } from "react";
import { 
  useListMyCapacity, useCreateMyCapacity, useUpdateMyCapacity, useWithdrawMyCapacity, useCloseMyCapacity, 
  getListMyCapacityQueryKey, getListMarketplaceQueryKey, getListMyMatchesQueryKey, useListLocations,
  useListMyVessels, AvailabilityType, Visibility, CapacityOffer, ListingStatus, TransportMode, LocationType, AvailabilityConfidence,
  DeepseaCapacityExtensionRouteChoice, DeepseaCapacityExtension
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
  maximumPositioningDistanceKm: z.coerce.number().positive("Must be greater than 0"),
  visibility: z.nativeEnum(Visibility),
  notes: z.string().optional(),

  availabilityConfidence: z.nativeEnum(AvailabilityConfidence),
  manualPositioningDays: z.preprocess((val) => (val === "" || val === undefined || val === null) ? null : val, z.coerce.number().min(0, "Cannot be negative").max(365, "Cannot exceed 365 days").nullable().optional()),
  approximateMaxDistanceKm: z.preprocess((val) => (val === "" || val === undefined || val === null) ? null : val, z.coerce.number().positive("Must be positive").nullable().optional()),
  previousVoyageContext: z.string().optional().nullable(),
  routeChoice: z.nativeEnum(DeepseaCapacityExtensionRouteChoice).default(DeepseaCapacityExtensionRouteChoice.UNSPECIFIED),
  routeNotes: z.string().max(500, "Route notes cannot exceed 500 characters").optional().nullable(),
  departureUncertaintyDays: z.preprocess((val) => (val === "" || val === undefined || val === null) ? null : val, z.coerce.number().min(0, "Cannot be negative").max(365, "Cannot exceed 365 days").nullable().optional()),
  positioningBufferDays: z.preprocess((val) => (val === "" || val === undefined || val === null) ? null : val, z.coerce.number().min(0, "Cannot be negative").max(365, "Cannot exceed 365 days").nullable().optional())
}).refine(
  values => !values.availableFrom || !values.availableUntil || new Date(values.availableUntil).getTime() >= new Date(values.availableFrom).getTime(),
  { path: ["availableUntil"], message: t("validation.available_until_after_from") }
);

type FormValues = z.infer<typeof schema>;
const DEEPSEA_ROUTE_CHOICES = Object.values(DeepseaCapacityExtensionRouteChoice);

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export default function DeepseaCapacity() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState<ListingStatus | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  
  const queryClient = useQueryClient();
  
  const { data: capacityData, isLoading, error: capacityError } = useListMyCapacity({ transportMode: TransportMode.DEEPSEA_BULK });
  const { data: locationsData, error: locationsError } = useListLocations({ pageSize: 100, locationType: LocationType.PORT });
  const { data: vesselsData, error: vesselsError } = useListMyVessels({ activeOnly: true, transportMode: TransportMode.DEEPSEA_BULK });
  
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

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { 
      availabilityType: AvailabilityType.FULLY_EMPTY, 
      visibility: Visibility.OPEN_NETWORK, 
      maximumPositioningDistanceKm: 1000,
      availabilityConfidence: AvailabilityConfidence.EXPECTED,
      routeChoice: DeepseaCapacityExtensionRouteChoice.UNSPECIFIED
    }
  });
  const watchedAvailableFrom = watch("availableFrom");
  const watchedDepartureUncertainty = watch("departureUncertaintyDays");
  const availableFromDate = watchedAvailableFrom ? new Date(watchedAvailableFrom) : null;
  const departureUncertaintyRaw = watchedDepartureUncertainty == null
    ? ""
    : String(watchedDepartureUncertainty);
  const departureUncertaintyNumber = departureUncertaintyRaw === ""
    ? null
    : Number(departureUncertaintyRaw);
  const validDepartureUncertainty = departureUncertaintyNumber != null &&
    Number.isFinite(departureUncertaintyNumber) &&
    departureUncertaintyNumber >= 0 &&
    departureUncertaintyNumber <= 365;
  const validAvailableFrom = availableFromDate != null &&
    !Number.isNaN(availableFromDate.getTime());
  const availableFromIsPast = availableFromDate != null &&
    validAvailableFrom &&
    availableFromDate.getTime() < Date.now();
  const manualLatestDeparture = validAvailableFrom && departureUncertaintyNumber != null && validDepartureUncertainty
    ? new Date(Math.max(availableFromDate.getTime(), Date.now()) + departureUncertaintyNumber * 86400000)
    : null;

  const invalidateCapacityCaches = () => {
    void queryClient.invalidateQueries({ queryKey: getListMyCapacityQueryKey({ transportMode: TransportMode.DEEPSEA_BULK }) });
    void queryClient.invalidateQueries({ queryKey: getListMarketplaceQueryKey({ transportMode: TransportMode.DEEPSEA_BULK }) });
    void queryClient.invalidateQueries({ queryKey: getListMyMatchesQueryKey({ transportMode: TransportMode.DEEPSEA_BULK }) });
  };

  const onSubmit = (data: FormValues, requestedStatus?: ListingStatus) => {
    setFormError(null);
    setLifecycleError(null);
    const status = requestedStatus ?? editingStatus ?? ListingStatus.DRAFT;
    const basePayload = {
      transportMode: TransportMode.DEEPSEA_BULK,
      vesselId: data.vesselId,
      locationId: data.locationId,
      availableFrom: new Date(data.availableFrom).toISOString(),
      availableUntil: new Date(data.availableUntil).toISOString(),
      availabilityType: data.availabilityType,
      availableCapacityTonnes: data.availableCapacityTonnes,
      cargoCompatibility: data.cargoCompatibility.split(",").map(s => s.trim()).filter(Boolean),
      preferredDirection: data.preferredDirection,
      maximumPositioningDistanceKm: data.maximumPositioningDistanceKm,
      visibility: data.visibility,
      listingStatus: status,
      availabilityConfidence: data.availabilityConfidence,
      deepseaExtension: {
        manualPositioningDays: data.manualPositioningDays ?? null,
        approximateMaxDistanceKm: data.approximateMaxDistanceKm ?? null,
        previousVoyageContext: data.previousVoyageContext || null,
        routeChoice: data.routeChoice || DeepseaCapacityExtensionRouteChoice.UNSPECIFIED,
        routeNotes: data.routeNotes || null,
        departureUncertaintyDays: data.departureUncertaintyDays ?? null,
        positioningBufferDays: data.positioningBufferDays ?? null
      } satisfies DeepseaCapacityExtension
    };

    if (editingId) {
      const payload = { ...basePayload, notes: data.notes || null };
      updateCapacity.mutate({ capacityId: editingId, data: payload }, {
        onSuccess: () => {
          invalidateCapacityCaches();
          closeForm();
        },
        onError: (err) => setFormError(errorMessage(err, t("error.save")))
      });
    } else {
      const payload = { ...basePayload, notes: data.notes || undefined };
      createCapacity.mutate({ data: payload }, {
        onSuccess: () => {
          invalidateCapacityCaches();
          closeForm();
        },
        onError: (err) => setFormError(errorMessage(err, t("error.save")))
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
      notes: c.notes || "",
      availabilityConfidence: (c as any).availabilityConfidence || AvailabilityConfidence.EXPECTED, // Need cast if API type incomplete? Wait, it's optional on the request but might not be on the response if we don't have it explicitly typed. It's actually not on CapacityOffer? Ah! wait. Is it on CapacityOffer? Let's check schemas again.
      manualPositioningDays: c.deepseaExtension?.manualPositioningDays ?? undefined,
      approximateMaxDistanceKm: c.deepseaExtension?.approximateMaxDistanceKm ?? undefined,
      previousVoyageContext: c.deepseaExtension?.previousVoyageContext || "",
      routeChoice: c.deepseaExtension?.routeChoice || DeepseaCapacityExtensionRouteChoice.UNSPECIFIED,
      routeNotes: c.deepseaExtension?.routeNotes || "",
      departureUncertaintyDays: c.deepseaExtension?.departureUncertaintyDays ?? undefined,
      positioningBufferDays: c.deepseaExtension?.positioningBufferDays ?? undefined
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
      vesselId: "", locationId: "", availableFrom: "", availableUntil: "",
      availabilityType: AvailabilityType.FULLY_EMPTY, availableCapacityTonnes: 0,
      cargoCompatibility: "", preferredDirection: "", maximumPositioningDistanceKm: 1000,
      visibility: Visibility.OPEN_NETWORK, notes: "", availabilityConfidence: AvailabilityConfidence.EXPECTED,
       manualPositioningDays: undefined, approximateMaxDistanceKm: undefined, previousVoyageContext: "",
       routeChoice: DeepseaCapacityExtensionRouteChoice.UNSPECIFIED, routeNotes: "", departureUncertaintyDays: undefined, positioningBufferDays: undefined
    });
  };

  const handleStatusChange = (id: string, action: 'publish' | 'withdraw' | 'close' | 'reopen') => {
    setLifecycleError(null);
    const options = {
      onSuccess: invalidateCapacityCaches,
      onError: (err: unknown) => setLifecycleError(errorMessage(err, t("error.lifecycle")))
    };

    if (action === 'publish' || action === 'reopen') {
      updateCapacity.mutate({ capacityId: id, data: { listingStatus: ListingStatus.ACTIVE } }, options);
    } else if (action === 'withdraw') {
      withdrawCap.mutate({ capacityId: id }, options);
    } else if (action === 'close') {
      closeCap.mutate({ capacityId: id }, options);
    }
  };

  const clearDeepseaFields = () => {
    setValue("manualPositioningDays", undefined);
    setValue("approximateMaxDistanceKm", undefined);
    setValue("previousVoyageContext", "");
    setValue("routeChoice", DeepseaCapacityExtensionRouteChoice.UNSPECIFIED);
    setValue("routeNotes", "");
    setValue("departureUncertaintyDays", undefined);
    setValue("positioningBufferDays", undefined);
  };

  const resetFormFields = () => {
    reset({
      vesselId: "", locationId: "", availableFrom: "", availableUntil: "",
      availabilityType: AvailabilityType.FULLY_EMPTY, availableCapacityTonnes: 0,
      cargoCompatibility: "", preferredDirection: "", maximumPositioningDistanceKm: 1000,
      visibility: Visibility.OPEN_NETWORK, notes: "", availabilityConfidence: AvailabilityConfidence.EXPECTED,
      manualPositioningDays: undefined, approximateMaxDistanceKm: undefined, previousVoyageContext: "",
      routeChoice: DeepseaCapacityExtensionRouteChoice.UNSPECIFIED, routeNotes: "", departureUncertaintyDays: undefined, positioningBufferDays: undefined
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("deepsea.capacity.title")}</h1>
          <p className="text-muted-foreground">{t("deepsea.capacity.subtitle")}</p>
        </div>
        <Button onClick={() => showForm ? closeForm() : setShowForm(true)} disabled={isPending || vessels.length === 0}>
          <Plus className="h-4 w-4 mr-2" />
          {showForm ? t("action.cancel") : t("action.add")}
        </Button>
      </div>

      {vessels.length === 0 && !vesselsError && !isLoading && (
        <div role="alert" className="p-4 text-blue-800 bg-blue-50 border border-blue-200 rounded-md">
          {t("deepsea.capacity.no_vessels")}
        </div>
      )}

      {lifecycleError && (
        <div role="alert" className="flex items-start gap-2 p-4 text-destructive bg-destructive/10 rounded-md">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{lifecycleError}</span>
        </div>
      )}

      {(locationsError || vesselsError) && (
        <div role="alert" className="p-4 text-destructive bg-destructive/10 rounded-md">
          {t("error.load_required")}
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? t("deepsea.capacity.edit") : t("deepsea.capacity.add")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4">
              {Object.keys(errors).length > 0 && <div role="alert" className="text-sm text-destructive">
                {t("deepsea.form_invalid")}
                <ul>{Object.entries(errors).map(([field, error]) => <li key={field}>{error?.message}</li>)}</ul>
              </div>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="vesselId">{t("deepsea.capacity.vessel")}</Label>
                  <Select id="vesselId" {...register("vesselId")}>
                    <option value="">{t("deepsea.capacity.select_vessel")}</option>
                    {vessels.map(v => <option key={v.id} value={v.id}>{v.vesselName}</option>)}
                  </Select>
                  {errors.vesselId && <span className="text-xs text-destructive">{errors.vesselId.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="locationId">{t("deepsea.capacity.port")}</Label>
                  <Select id="locationId" {...register("locationId")}>
                    <option value="">{t("deepsea.capacity.select_port")}</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.country})</option>)}
                  </Select>
                  {errors.locationId && <span className="text-xs text-destructive">{errors.locationId.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="availableFrom">{t("deepsea.capacity.available_from")}</Label>
                  <Input id="availableFrom" type="datetime-local" {...register("availableFrom")} />
                  {errors.availableFrom && <span className="text-xs text-destructive">{errors.availableFrom.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="availableUntil">{t("deepsea.capacity.available_until")}</Label>
                  <Input id="availableUntil" type="datetime-local" {...register("availableUntil")} />
                  {errors.availableUntil && <span className="text-xs text-destructive">{errors.availableUntil.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="availabilityConfidence">{t("deepsea.capacity.confidence")}</Label>
                  <Select id="availabilityConfidence" {...register("availabilityConfidence")}>
                    {Object.values(AvailabilityConfidence).map(v => <option key={v} value={v}>{v.replace('_', ' ')}</option>)}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="availabilityType">{t("deepsea.capacity.availability_type")}</Label>
                  <Select id="availabilityType" {...register("availabilityType")}>
                    {Object.values(AvailabilityType).map(v => <option key={v} value={v}>{v.replace('_', ' ')}</option>)}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="availableCapacityTonnes">{t("deepsea.capacity.avail_capacity")}</Label>
                  <Input id="availableCapacityTonnes" type="number" {...register("availableCapacityTonnes")} />
                  {errors.availableCapacityTonnes && <span className="text-xs text-destructive">{errors.availableCapacityTonnes.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="preferredDirection">{t("deepsea.capacity.direction")}</Label>
                  <Input id="preferredDirection" {...register("preferredDirection")} placeholder={t("deepsea.capacity.direction_placeholder")} />
                  {errors.preferredDirection && <span className="text-xs text-destructive">{errors.preferredDirection.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cargoCompatibility">{t("deepsea.capacity.cargo_compatibility")}</Label>
                  <Input id="cargoCompatibility" {...register("cargoCompatibility")} placeholder="e.g. COAL, GRAIN" />
                  {errors.cargoCompatibility && <span className="text-xs text-destructive">{errors.cargoCompatibility.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maximumPositioningDistanceKm">{t("deepsea.capacity.max_pos_distance")}</Label>
                  <Input id="maximumPositioningDistanceKm" type="number" {...register("maximumPositioningDistanceKm")} />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="manualPositioningDays">{t("deepsea.capacity.manual_pos_days")}</Label>
                  <Input id="manualPositioningDays" type="number" step="any" min="0" max="365" {...register("manualPositioningDays")} />
                  <p className="text-xs text-muted-foreground">{t("deepsea.capacity.manual_pos_days_help")}</p>
                  {errors.manualPositioningDays && <span className="text-xs text-destructive">{errors.manualPositioningDays.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="approximateMaxDistanceKm">{t("deepsea.capacity.approx_max_distance")}</Label>
                  <Input id="approximateMaxDistanceKm" type="number" min="0" {...register("approximateMaxDistanceKm")} />
                  {errors.approximateMaxDistanceKm && <span className="text-xs text-destructive">{errors.approximateMaxDistanceKm.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="departureUncertaintyDays">{t("deepsea.capacity.departure_uncertainty")}</Label>
                  <Input id="departureUncertaintyDays" type="number" step="any" min="0" max="365" {...register("departureUncertaintyDays")} />
                  <p className="text-xs text-muted-foreground">{t("deepsea.capacity.departure_uncertainty_help")}</p>
                  {availableFromIsPast && (
                    <p className="text-xs text-amber-700">{t("deepsea.capacity.available_from_past_help")}</p>
                  )}
                  {manualLatestDeparture && !Number.isNaN(manualLatestDeparture.getTime()) && (
                    <p className="text-xs text-amber-700">{t("deepsea.capacity.latest_departure_preview")}: {manualLatestDeparture.toLocaleString()}</p>
                  )}
                  {errors.departureUncertaintyDays && <span className="text-xs text-destructive">{errors.departureUncertaintyDays.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="positioningBufferDays">{t("deepsea.capacity.positioning_buffer")}</Label>
                  <Input id="positioningBufferDays" type="number" step="any" min="0" max="365" {...register("positioningBufferDays")} />
                  <p className="text-xs text-muted-foreground">{t("deepsea.capacity.positioning_buffer_help")}</p>
                  {errors.positioningBufferDays && <span className="text-xs text-destructive">{errors.positioningBufferDays.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="routeChoice">{t("deepsea.capacity.route_choice")}</Label>
                  <Select id="routeChoice" {...register("routeChoice")}>
                    {DEEPSEA_ROUTE_CHOICES.map(v => <option key={v} value={v}>{t(`deepsea.capacity.route.${v}`)}</option>)}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="routeNotes">{t("deepsea.capacity.route_notes")}</Label>
                  <Textarea id="routeNotes" maxLength={500} {...register("routeNotes")} placeholder={t("deepsea.capacity.route_notes_placeholder")} />
                  {errors.routeNotes && <span className="text-xs text-destructive">{errors.routeNotes.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="visibility">{t("deepsea.cargo.visibility")}</Label>
                  <Select id="visibility" {...register("visibility")}>
                    {Object.values(Visibility).map(v => <option key={v} value={v}>{v.replace('_', ' ')}</option>)}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="previousVoyageContext">{t("deepsea.capacity.prev_voyage")}</Label>
                  <Input id="previousVoyageContext" {...register("previousVoyageContext")} placeholder={t("deepsea.capacity.prev_voyage_placeholder")} />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="notes">{t("deepsea.cargo.internal_notes")}</Label>
                  <Textarea id="notes" {...register("notes")} placeholder="Private notes, never shared." />
                </div>
              </div>

              <div className="md:col-span-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {t("deepsea.capacity.route_notice")}
              </div>

              {formError && (
                <div className="text-sm text-destructive mt-2">{formError}</div>
              )}
              
              <div className="flex justify-end gap-2 mt-4">
                <Button type="button" variant="outline" onClick={closeForm} disabled={isPending}>{t("action.cancel")}</Button>
                <Button type="button" variant="outline" onClick={resetFormFields} disabled={isPending}>{t("action.reset_fields")}</Button>
                <Button type="button" variant="outline" onClick={clearDeepseaFields} disabled={isPending}>{t("action.clear_fields")}</Button>
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
              <TableHead>{t("deepsea.capacity.vessel_port")}</TableHead>
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
                      <div className="text-xs text-muted-foreground">At {loc}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(c.availableFrom)} to {formatDate(c.availableUntil)}
                      <div className="text-muted-foreground">{t("deepsea.capacity.earliest_departure")}</div>
                      {c.deepseaExtension?.departureUncertaintyDays != null && (
                        <div className="text-amber-700">{t("deepsea.capacity.latest_departure_provisional")}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {c.availableCapacityTonnes}t<br/>{c.availabilityType.replace('_', ' ')}
                    </TableCell>
                    <TableCell className="text-xs">
                      {c.preferredDirection}
                      <div className="text-muted-foreground">
                        {t("deepsea.capacity.route")}: {t(`deepsea.capacity.route.${c.deepseaExtension?.routeChoice || DeepseaCapacityExtensionRouteChoice.UNSPECIFIED}`)}
                      </div>
                      <div className="text-amber-700">{t("deepsea.capacity.route_not_verified")}</div>
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
                      {(c.listingStatus === 'WITHDRAWN' || c.listingStatus === 'CLOSED' || c.listingStatus === 'EXPIRED') && (
                        <Button variant="outline" size="sm" onClick={() => handleStatusChange(c.id, 'reopen')} title={t("action.reopen")}>
                          <PlayCircle className="h-4 w-4 text-emerald-600" />
                        </Button>
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
