import { useState } from "react";
import { 
  useListMyCapacity, useCreateMyCapacity, useUpdateMyCapacity, useWithdrawMyCapacity, useCloseMyCapacity, 
  getListMyCapacityQueryKey, useListLocations, useListMyVessels, AvailabilityType, Visibility, CapacityOffer, ListingStatus
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Select, Label, Card, CardHeader, CardTitle, CardContent, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge, Textarea } from "@/components/ui/primitives";
import { Plus, XCircle, Ban, Edit2, PlayCircle } from "lucide-react";
import { formatDate, formatDateTimeInput } from "@/lib/utils";
import { t } from "@/lib/i18n";

const schema = z.object({
  vesselId: z.string().min(1, "Vessel required"),
  locationId: z.string().min(1, "Location required"),
  availableFrom: z.string().min(1, "Required"),
  availableUntil: z.string().min(1, "Required"),
  availabilityType: z.nativeEnum(AvailabilityType),
  availableCapacityTonnes: z.coerce.number().min(1),
  cargoCompatibility: z.string().min(1, "Comma separated compatibility required"),
  preferredDirection: z.string().min(1, "Required"),
  maximumPositioningDistanceKm: z.coerce.number().min(0),
  visibility: z.nativeEnum(Visibility),
  notes: z.string().optional()
});

type FormValues = z.infer<typeof schema>;

export default function Capacity() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const queryClient = useQueryClient();
  
  const { data: capacityData, isLoading } = useListMyCapacity();
  const { data: locationsData } = useListLocations({ pageSize: 100 });
  const { data: vesselsData } = useListMyVessels({ activeOnly: true });
  
  const locations = locationsData?.items || [];
  const vessels = vesselsData?.items || [];

  const createCapacity = useCreateMyCapacity();
  const updateCapacity = useUpdateMyCapacity();
  const withdrawCap = useWithdrawMyCapacity();
  const closeCap = useCloseMyCapacity();

  const isPending = createCapacity.isPending || updateCapacity.isPending;
  const isError = createCapacity.isError || updateCapacity.isError;

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { availabilityType: AvailabilityType.FULLY_EMPTY, visibility: Visibility.OPEN_NETWORK, maximumPositioningDistanceKm: 50 }
  });

  const onSubmit = (data: FormValues, status: ListingStatus = ListingStatus.ACTIVE) => {
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
          queryClient.invalidateQueries({ queryKey: getListMyCapacityQueryKey() });
          closeForm();
        }
      });
    } else {
      createCapacity.mutate({ data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMyCapacityQueryKey() });
          closeForm();
        }
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
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    reset({
      vesselId: "", locationId: "", availableFrom: "", availableUntil: "",
      availabilityType: AvailabilityType.FULLY_EMPTY, availableCapacityTonnes: 0,
      cargoCompatibility: "", preferredDirection: "", maximumPositioningDistanceKm: 50,
      visibility: Visibility.OPEN_NETWORK, notes: ""
    });
  };

  const handleStatusChange = (id: string, action: 'withdraw' | 'close' | 'publish') => {
    if (action === 'publish') {
      updateCapacity.mutate({ capacityId: id, data: { listingStatus: ListingStatus.ACTIVE } }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMyCapacityQueryKey() })
      });
      return;
    }
    const mutation = action === 'withdraw' ? withdrawCap : closeCap;
    mutation.mutate({ capacityId: id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMyCapacityQueryKey() })
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

      {showForm && (
        <Card>
          <CardHeader><CardTitle>{editingId ? t("action.edit") : t("action.create")} Capacity</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(data => onSubmit(data))} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                <div className="space-y-2">
                  <Label>Vessel *</Label>
                  <Select {...register("vesselId")}>
                    <option value="">Select active vessel...</option>
                    {vessels.map(v => <option key={v.id} value={v.id}>{v.vesselName} ({v.totalCapacityTonnes}t)</option>)}
                  </Select>
                  {errors.vesselId && <span className="text-xs text-destructive">{errors.vesselId.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label>Current/Available Location *</Label>
                  <Select {...register("locationId")}>
                    <option value="">Select location...</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.country})</option>)}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Available From *</Label>
                  <Input type="datetime-local" {...register("availableFrom")} />
                </div>
                <div className="space-y-2">
                  <Label>Available Until *</Label>
                  <Input type="datetime-local" {...register("availableUntil")} />
                </div>

                <div className="space-y-2">
                  <Label>Available Capacity (Tonnes) *</Label>
                  <Input type="number" {...register("availableCapacityTonnes")} />
                </div>
                <div className="space-y-2">
                  <Label>Availability Type *</Label>
                  <Select {...register("availabilityType")}>
                    {Object.values(AvailabilityType).map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Preferred Direction *</Label>
                  <Input {...register("preferredDirection")} placeholder="e.g. ARA, Upstream Rhine" />
                </div>
                <div className="space-y-2">
                  <Label>Max Positioning Dist. (km)</Label>
                  <Input type="number" {...register("maximumPositioningDistanceKm")} />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Accepted Cargo (comma separated) *</Label>
                  <Input {...register("cargoCompatibility")} placeholder="e.g. GRAIN, COAL" />
                </div>

                <div className="space-y-2">
                  <Label>Visibility *</Label>
                  <Select {...register("visibility")}>
                    {Object.values(Visibility).map(v => <option key={v} value={v}>{v.replace('_', ' ')}</option>)}
                  </Select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Internal Notes (Optional)</Label>
                  <Textarea {...register("notes")} placeholder="Private notes, never shared." />
                </div>
              </div>

              {isError && (
                <div className="text-sm text-destructive mt-2">{t("error.save")}</div>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={closeForm}>{t("action.cancel")}</Button>
                <Button type="button" variant="outline" disabled={isPending} onClick={handleSubmit(data => onSubmit(data, ListingStatus.DRAFT))}>
                  Save Draft
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? t("common.loading") : "Publish"}
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
              <TableHead>Vessel / Location</TableHead>
              <TableHead>Availability Window</TableHead>
              <TableHead>Capacity / Type</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center">{t("common.loading")}</TableCell></TableRow>
            ) : capacityData?.items.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t("common.no_data")}</TableCell></TableRow>
            ) : (
              capacityData?.items.map(c => {
                const loc = locations.find(l => l.id === c.locationId)?.name || "Unknown";
                const vessel = vessels.find(v => v.id === c.vesselId)?.vesselName || "Unknown Vessel";
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="font-medium">{vessel}</div>
                      <div className="text-xs text-muted-foreground">At {loc}</div>
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
                        {c.listingStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {(c.listingStatus === 'ACTIVE' || c.listingStatus === 'DRAFT') && (
                        <Button variant="outline" size="sm" onClick={() => handleEdit(c)} title={t("action.edit")}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      )}
                      {c.listingStatus === 'DRAFT' && (
                        <Button variant="outline" size="sm" onClick={() => handleStatusChange(c.id, 'publish')} title="Publish">
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
