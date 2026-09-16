import { useState } from "react";
import { 
  useListMyCargo, useCreateMyCargo, useUpdateMyCargo, useWithdrawMyCargo, useCloseMyCargo, 
  getListMyCargoQueryKey, useListLocations, VesselType, Visibility, CargoListing, ListingStatus 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Select, Label, Card, CardHeader, CardTitle, CardContent, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge, Textarea } from "@/components/ui/primitives";
import { Plus, XCircle, Ban, Edit2, PlayCircle } from "lucide-react";
import { formatDate, formatDateInput, formatDateTimeInput } from "@/lib/utils";
import { t } from "@/lib/i18n";

const schema = z.object({
  cargoName: z.string().min(1, "Name required"),
  cargoType: z.string().min(1, "Type required"),
  weightTonnes: z.coerce.number().min(1),
  loadingLocationId: z.string().min(1, "Required"),
  destinationLocationId: z.string().min(1, "Required"),
  loadingFrom: z.string().min(1, "Required"),
  loadingUntil: z.string().min(1, "Required"),
  expectedUnloadingDate: z.string().optional(),
  requiredVesselType: z.nativeEnum(VesselType),
  specialRequirements: z.string().optional(),
  visibility: z.nativeEnum(Visibility),
  notes: z.string().optional()
});

type FormValues = z.infer<typeof schema>;

export default function Cargo() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const queryClient = useQueryClient();
  
  const { data: cargoData, isLoading } = useListMyCargo();
  const { data: locationsData } = useListLocations({ pageSize: 100 });
  const locations = locationsData?.items || [];

  const createCargo = useCreateMyCargo();
  const updateCargo = useUpdateMyCargo();
  const withdrawCargo = useWithdrawMyCargo();
  const closeCargo = useCloseMyCargo();

  const isPending = createCargo.isPending || updateCargo.isPending;
  const isError = createCargo.isError || updateCargo.isError;

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { requiredVesselType: VesselType.DRY_CARGO, visibility: Visibility.OPEN_NETWORK }
  });

  const onSubmit = (data: FormValues, status: ListingStatus = ListingStatus.ACTIVE) => {
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
          queryClient.invalidateQueries({ queryKey: getListMyCargoQueryKey() });
          closeForm();
        }
      });
    } else {
      createCargo.mutate({ data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMyCargoQueryKey() });
          closeForm();
        }
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
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    reset({ 
      cargoName: "", cargoType: "", weightTonnes: 0, loadingLocationId: "", 
      destinationLocationId: "", loadingFrom: "", loadingUntil: "", 
      expectedUnloadingDate: "", requiredVesselType: VesselType.DRY_CARGO, 
      specialRequirements: "", visibility: Visibility.OPEN_NETWORK, notes: "" 
    });
  };

  const handleStatusChange = (id: string, action: 'withdraw' | 'close' | 'publish') => {
    if (action === 'publish') {
      updateCargo.mutate({ cargoId: id, data: { listingStatus: ListingStatus.ACTIVE } }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMyCargoQueryKey() })
      });
      return;
    }

    const confirmMsg = action === 'withdraw' ? "Withdraw this listing? It will be removed from discovery." : "Close this listing as completed?";
    if (!confirm(confirmMsg)) return;

    const mutation = action === 'withdraw' ? withdrawCargo : closeCargo;
    mutation.mutate({ cargoId: id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMyCargoQueryKey() })
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

      {showForm && (
        <Card>
          <CardHeader><CardTitle>{editingId ? t("action.edit") : t("action.create")} Cargo</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(data => onSubmit(data))} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Internal Reference / Name *</Label>
                  <Input {...register("cargoName")} placeholder="e.g. Wheat to Duisburg" />
                  {errors.cargoName && <span className="text-xs text-destructive">{errors.cargoName.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label>Cargo Type *</Label>
                  <Input {...register("cargoType")} placeholder="e.g. GRAIN" />
                  {errors.cargoType && <span className="text-xs text-destructive">{errors.cargoType.message}</span>}
                </div>
                
                <div className="space-y-2">
                  <Label>Loading Location *</Label>
                  <Select {...register("loadingLocationId")}>
                    <option value="">Select location...</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.country})</option>)}
                  </Select>
                  {errors.loadingLocationId && <span className="text-xs text-destructive">{errors.loadingLocationId.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label>Destination Location *</Label>
                  <Select {...register("destinationLocationId")}>
                    <option value="">Select location...</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.country})</option>)}
                  </Select>
                  {errors.destinationLocationId && <span className="text-xs text-destructive">{errors.destinationLocationId.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label>Loading From *</Label>
                  <Input type="datetime-local" {...register("loadingFrom")} />
                </div>
                <div className="space-y-2">
                  <Label>Loading Until *</Label>
                  <Input type="datetime-local" {...register("loadingUntil")} />
                </div>

                <div className="space-y-2">
                  <Label>Weight (Tonnes) *</Label>
                  <Input type="number" {...register("weightTonnes")} />
                </div>
                <div className="space-y-2">
                  <Label>Expected Unloading Date (Optional)</Label>
                  <Input type="date" {...register("expectedUnloadingDate")} />
                </div>
                
                <div className="space-y-2">
                  <Label>Required Vessel Type *</Label>
                  <Select {...register("requiredVesselType")}>
                    {Object.values(VesselType).map(t => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Visibility *</Label>
                  <Select {...register("visibility")}>
                    {Object.values(Visibility).map(v => <option key={v} value={v}>{v.replace('_', ' ')}</option>)}
                  </Select>
                  <p className="text-xs text-muted-foreground">Open Network listings hide private data behind bands until connected.</p>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Special Requirements (Optional)</Label>
                  <Textarea {...register("specialRequirements")} placeholder="e.g. Needs cleaning certificate" />
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
              <TableHead>Reference</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Window</TableHead>
              <TableHead>Specs</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center">{t("common.loading")}</TableCell></TableRow>
            ) : cargoData?.items.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t("common.no_data")}</TableCell></TableRow>
            ) : (
              cargoData?.items.map(c => {
                const loadingLoc = locations.find(l => l.id === c.loadingLocationId)?.name || "Unknown";
                const destLoc = locations.find(l => l.id === c.destinationLocationId)?.name || "Unknown";
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
