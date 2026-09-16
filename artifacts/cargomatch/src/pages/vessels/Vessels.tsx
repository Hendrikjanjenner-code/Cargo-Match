import { useState } from "react";
import { useListMyVessels, useCreateMyVessel, useUpdateMyVessel, useDeactivateMyVessel, getListMyVesselsQueryKey, VesselType, Vessel } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Select, Label, Card, CardHeader, CardTitle, CardContent, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge, Textarea } from "@/components/ui/primitives";
import { Plus, Trash2, Edit2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { t } from "@/lib/i18n";

const schema = z.object({
  vesselName: z.string().min(1, t("vessels.error_name_required")),
  vesselType: z.nativeEnum(VesselType),
  totalCapacityTonnes: z.coerce.number().min(1, t("vessels.error_capacity_positive")),
  eniNumber: z.string().optional(),
  cargoCompatibility: z.string().min(1, t("vessels.error_compatibility_required")),
  notes: z.string().optional()
});

type FormValues = z.infer<typeof schema>;

export default function Vessels() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const queryClient = useQueryClient();
  const { data: vesselsData, isLoading } = useListMyVessels();
  const createVessel = useCreateMyVessel();
  const updateVessel = useUpdateMyVessel();
  const deactivateVessel = useDeactivateMyVessel();

  const isPending = createVessel.isPending || updateVessel.isPending;
  const isError = createVessel.isError || updateVessel.isError;

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { vesselType: VesselType.DRY_CARGO }
  });

  const onSubmit = (data: FormValues) => {
    const payload = {
      ...data,
      eniNumber: data.eniNumber || undefined,
      notes: data.notes || undefined,
      cargoCompatibility: data.cargoCompatibility.split(",").map(s => s.trim()).filter(Boolean)
    };

    if (editingId) {
      updateVessel.mutate({ vesselId: editingId, data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMyVesselsQueryKey() });
          closeForm();
        }
      });
    } else {
      createVessel.mutate({ data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMyVesselsQueryKey() });
          closeForm();
        }
      });
    }
  };

  const handleEdit = (v: Vessel) => {
    reset({
      vesselName: v.vesselName,
      vesselType: v.vesselType,
      totalCapacityTonnes: v.totalCapacityTonnes,
      eniNumber: v.eniNumber || "",
      cargoCompatibility: v.cargoCompatibility.join(", "),
      notes: v.notes || ""
    });
    setEditingId(v.id);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    reset({ vesselType: VesselType.DRY_CARGO, vesselName: "", eniNumber: "", totalCapacityTonnes: 0, cargoCompatibility: "", notes: "" });
  };

  const handleDeactivate = (id: string) => {
    if (confirm(t("vessels.confirm_deactivate"))) {
      deactivateVessel.mutate({ vesselId: id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMyVesselsQueryKey() });
        }
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("vessels.title")}</h1>
          <p className="text-muted-foreground">{t("vessels.subtitle")}</p>
        </div>
        <Button onClick={() => showForm ? closeForm() : setShowForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {showForm ? t("action.cancel") : t("action.add")}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? t("action.edit") : t("action.create")} {t("vessels.entity")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("vessels.vessel_name")}</Label>
                  <Input {...register("vesselName")} placeholder={t("vessels.vessel_name_placeholder")} />
                  {errors.vesselName && <span className="text-xs text-destructive">{errors.vesselName.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label>{t("vessels.eni_number")}</Label>
                  <Input {...register("eniNumber")} placeholder={t("vessels.eni_placeholder")} />
                </div>
                <div className="space-y-2">
                  <Label>{t("vessels.vessel_type")}</Label>
                  <Select {...register("vesselType")}>
                    {Object.values(VesselType).map(t => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("vessels.total_capacity")}</Label>
                  <Input type="number" {...register("totalCapacityTonnes")} />
                  {errors.totalCapacityTonnes && <span className="text-xs text-destructive">{errors.totalCapacityTonnes.message}</span>}
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>{t("vessels.cargo_compatibility")}</Label>
                  <Input {...register("cargoCompatibility")} placeholder={t("vessels.cargo_compatibility_placeholder")} />
                  {errors.cargoCompatibility && <span className="text-xs text-destructive">{errors.cargoCompatibility.message}</span>}
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>{t("vessels.internal_notes")}</Label>
                  <Textarea {...register("notes")} placeholder={t("vessels.internal_notes_placeholder")} />
                </div>
              </div>
              
              {isError && (
                <div className="text-sm text-destructive mt-2">{t("error.save")}</div>
              )}
              
              <div className="flex justify-end gap-2 mt-4">
                <Button type="button" variant="outline" onClick={closeForm}>{t("action.cancel")}</Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? t("common.loading") : t("action.save")}
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
              <TableHead>{t("vessels.name_eni")}</TableHead>
              <TableHead>{t("vessels.type")}</TableHead>
              <TableHead>{t("vessels.capacity")}</TableHead>
              <TableHead>{t("vessels.status")}</TableHead>
              <TableHead>{t("vessels.added")}</TableHead>
              <TableHead className="text-right">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center">{t("common.loading")}</TableCell></TableRow>
            ) : vesselsData?.items.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t("common.no_data")}</TableCell></TableRow>
            ) : (
              vesselsData?.items.map(v => (
                <TableRow key={v.id}>
                  <TableCell>
                    <div className="font-medium">{v.vesselName}</div>
                    <div className="text-xs text-muted-foreground">{v.eniNumber || t("vessels.no_eni")}</div>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{v.vesselType}</Badge></TableCell>
                  <TableCell>{v.totalCapacityTonnes} t</TableCell>
                  <TableCell>
                    {v.active ? <Badge variant="default" className="bg-emerald-600">{t("status.active")}</Badge> : <Badge variant="outline">{t("status.inactive")}</Badge>}
                  </TableCell>
                  <TableCell>{formatDate(v.createdAt)}</TableCell>
                  <TableCell className="text-right space-x-2">
                    {v.active && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => handleEdit(v)} title={t("action.edit")}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDeactivate(v.id)} className="text-destructive hover:bg-destructive/10" title={t("action.delete")}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
