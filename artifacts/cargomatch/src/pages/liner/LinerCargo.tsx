import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Anchor, ArrowRight, FileEdit, MapPin, Package, Plus } from "lucide-react";
import { Button, Input, Select, Card, CardHeader, CardTitle, CardContent, Badge, Textarea } from "@/components/ui/primitives";
import {
  getListMyLinerCargoQueryKey, listLocations, listMyLinerCargo, LocationType, LinerCargoType,
  LinerStowage, ListingStatus, useCreateMyLinerCargo, useGetMyCompany, useUpdateMyLinerCargo,
  useWithdrawMyLinerCargo, Visibility,
} from "@workspace/api-client-react";

const positive = z.coerce.number().finite().positive("Must be greater than zero");
const cargoSchema = z.object({
  cargoName: z.string().trim().min(1, "Required"),
  cargoType: z.nativeEnum(LinerCargoType),
  pieceCount: z.coerce.number().finite().int("Must be a whole number").min(1),
  totalWeightTonnes: positive,
  pieceWeightTonnes: positive,
  pieceLengthMetres: positive,
  pieceWidthMetres: positive,
  pieceHeightMetres: positive,
  requiredLiftingTonnes: z.preprocess((value) => value === "" || value === undefined ? null : value, positive.nullable()),
  requiredStowage: z.nativeEnum(LinerStowage),
  originLocationId: z.string().min(1, "Required"),
  destinationLocationId: z.string().min(1, "Required"),
  readyAt: z.string().min(1, "Required"),
  visibility: z.nativeEnum(Visibility),
  listingStatus: z.nativeEnum(ListingStatus),
  notes: z.string().optional(),
}).superRefine(({ pieceCount, pieceWeightTonnes, totalWeightTonnes }, context) => {
  if (totalWeightTonnes < pieceWeightTonnes) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["totalWeightTonnes"], message: "Total weight must be at least the heaviest piece." });
  }
  if (totalWeightTonnes > pieceCount * pieceWeightTonnes) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["totalWeightTonnes"], message: "Total weight cannot exceed piece count × heaviest piece weight." });
  }
});
type CargoForm = z.infer<typeof cargoSchema>;

const initialValues: CargoForm = {
  cargoName: "", cargoType: LinerCargoType.BREAKBULK, pieceCount: 1, totalWeightTonnes: 0 as never,
  pieceWeightTonnes: 0 as never, pieceLengthMetres: 0 as never, pieceWidthMetres: 0 as never,
  pieceHeightMetres: 0 as never, requiredLiftingTonnes: null, requiredStowage: LinerStowage.EITHER,
  originLocationId: "", destinationLocationId: "", readyAt: "", visibility: Visibility.PRIVATE,
  listingStatus: ListingStatus.DRAFT, notes: "",
};

function localDateTime(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function apiErrorMessage(error: unknown) {
  const data = (error as { data?: { error?: unknown } } | undefined)?.data;
  return typeof data?.error === "string" ? data.error : error instanceof Error ? error.message : "The request could not be completed.";
}
function useActivePorts() {
  return useQuery({
    queryKey: ["liner", "active-ports"],
    queryFn: async () => {
      const items = [];
      for (let page = 1; ; page += 1) {
        const response = await listLocations({ locationType: LocationType.PORT, page, pageSize: 100 });
        items.push(...response.items);
        if (items.length >= response.total) return items.filter((location) => location.active);
      }
    },
  });
}
function invalidateLinerQueries(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/liner") });
}

export default function LinerCargo() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [originalReadyAt, setOriginalReadyAt] = useState<{ local: string; iso: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data: company, isLoading: companyLoading, error: companyError } = useGetMyCompany();
  const canManage = company?.membershipRole === "OWNER" || company?.membershipRole === "ADMIN";
  const cargoQuery = useQuery({
    queryKey: [...getListMyLinerCargoQueryKey(), "all"],
    queryFn: async () => {
      const items = [];
      for (let page = 1; ; page += 1) {
        const response = await listMyLinerCargo({ page, pageSize: 100 });
        items.push(...response.items);
        if (items.length >= response.total) return items;
      }
    },
  });
  const portsQuery = useActivePorts();
  const createCargo = useCreateMyLinerCargo();
  const updateCargo = useUpdateMyLinerCargo();
  const withdrawCargo = useWithdrawMyLinerCargo();
  const form = useForm<CargoForm>({ resolver: zodResolver(cargoSchema), defaultValues: initialValues });

  const openCreate = () => {
    setActionError(null); setEditingId(null); setOriginalReadyAt(null); form.reset(initialValues); setShowForm(true);
  };
  const onSubmit = async (values: CargoForm) => {
    const readyAt = originalReadyAt?.local === values.readyAt ? originalReadyAt.iso : new Date(values.readyAt).toISOString();
    const data = { ...values, readyAt, requiredLiftingTonnes: values.requiredLiftingTonnes ?? null };
    const notes = values.notes?.trim();
    try {
      if (editingId) await updateCargo.mutateAsync({ linerCargoId: editingId, data: { ...data, notes: notes || null } });
      else await createCargo.mutateAsync({ data: { ...data, notes: notes || undefined } });
      await invalidateLinerQueries(queryClient);
      setEditingId(null); setOriginalReadyAt(null); setShowForm(false); form.reset(initialValues);
    } catch (error) {
      form.setError("root", { message: apiErrorMessage(error) });
    }
  };
  const edit = (cargo: Awaited<ReturnType<typeof listMyLinerCargo>>["items"][number]) => {
    const readyAt = localDateTime(cargo.readyAt);
    setEditingId(cargo.id); setOriginalReadyAt({ local: readyAt, iso: cargo.readyAt });
    form.reset({ ...cargo, readyAt, requiredLiftingTonnes: cargo.requiredLiftingTonnes ?? null, notes: cargo.notes ?? "" });
    setShowForm(true);
  };
  const withdraw = async (id: string) => {
    if (!confirm("Withdraw this cargo listing?")) return;
    try {
      await withdrawCargo.mutateAsync({ linerCargoId: id });
      await invalidateLinerQueries(queryClient);
    } catch (error) {
      setActionError(apiErrorMessage(error));
    }
  };
  const ports = portsQuery.data ?? [];
  const cargoList = cargoQuery.data ?? [];
  const queryError = companyError || cargoQuery.error || portsQuery.error;

  return <div className="space-y-6">
    <div className="flex justify-between items-center gap-4">
      <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><Package className="h-8 w-8 text-primary" />Liner Cargo</h1>
      {canManage && <Button onClick={showForm ? () => setShowForm(false) : openCreate}>{showForm ? "Cancel" : <><Plus className="h-4 w-4 mr-1" />Post Cargo</>}</Button>}
    </div>
    {companyLoading || cargoQuery.isLoading || portsQuery.isLoading ? <div className="p-8 text-center text-muted-foreground">Loading...</div> : queryError ? <div role="alert" className="p-4 text-destructive border rounded-md">{apiErrorMessage(queryError)}</div> : <>
      {!canManage && <div className="p-3 text-sm text-muted-foreground border rounded-md">Your membership is read-only for liner cargo.</div>}
      {actionError && <div role="alert" className="p-3 text-sm text-destructive border rounded-md">{actionError}</div>}
      {showForm && <Card className="border-primary/20 shadow-md"><CardHeader className="bg-muted/30 border-b"><CardTitle>{editingId ? "Edit Cargo Listing" : "New Cargo Listing"}</CardTitle></CardHeader><CardContent className="p-6">
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <h3 className="col-span-full font-semibold text-lg border-b pb-2">Basic Info</h3>
            <Field label="Cargo name / reference" id="cargo-name"><Input id="cargo-name" {...form.register("cargoName")} />{ErrorText(form.formState.errors.cargoName?.message)}</Field>
            <Field label="Cargo type" id="cargo-type"><Select id="cargo-type" {...form.register("cargoType")}>{Object.values(LinerCargoType).map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}</Select></Field>
            <Field label="Ready date" id="ready-at"><Input id="ready-at" type="datetime-local" step="1" {...form.register("readyAt")} />{ErrorText(form.formState.errors.readyAt?.message)}</Field>
            <Field label="Origin port" id="origin-port"><Select id="origin-port" {...form.register("originLocationId")}><option value="">Select origin</option>{ports.map((port) => <option key={port.id} value={port.id}>{port.name}</option>)}</Select>{ErrorText(form.formState.errors.originLocationId?.message)}</Field>
            <Field label="Destination port" id="destination-port"><Select id="destination-port" {...form.register("destinationLocationId")}><option value="">Select destination</option>{ports.map((port) => <option key={port.id} value={port.id}>{port.name}</option>)}</Select>{ErrorText(form.formState.errors.destinationLocationId?.message)}</Field>
            <Field label="Visibility" id="cargo-visibility"><Select id="cargo-visibility" {...form.register("visibility")}>{Object.values(Visibility).map((value) => <option key={value} value={value}>{value.replace("_", " ")}</option>)}</Select></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4 bg-muted/10 p-4 rounded-lg border">
            <h3 className="col-span-full font-semibold text-lg border-b pb-2">Weights and maximum dimensions</h3>
            <Field label="Total weight (t)" id="total-weight"><Input id="total-weight" type="number" min="0.1" step="any" {...form.register("totalWeightTonnes")} />{ErrorText(form.formState.errors.totalWeightTonnes?.message)}</Field>
            <Field label="Piece count" id="piece-count"><Input id="piece-count" type="number" min="1" step="1" {...form.register("pieceCount")} />{ErrorText(form.formState.errors.pieceCount?.message)}</Field>
            <Field label="Heaviest piece (t)" id="piece-weight"><Input id="piece-weight" type="number" min="0.1" step="any" {...form.register("pieceWeightTonnes")} />{ErrorText(form.formState.errors.pieceWeightTonnes?.message)}</Field>
            <Field label="Required lifting (t, optional)" id="lifting"><Input id="lifting" type="number" min="0.1" step="any" {...form.register("requiredLiftingTonnes")} /></Field>
            <Field label="Maximum length (m)" id="piece-length"><Input id="piece-length" type="number" min="0.1" step="any" {...form.register("pieceLengthMetres")} /></Field>
            <Field label="Maximum width (m)" id="piece-width"><Input id="piece-width" type="number" min="0.1" step="any" {...form.register("pieceWidthMetres")} /></Field>
            <Field label="Maximum height (m)" id="piece-height"><Input id="piece-height" type="number" min="0.1" step="any" {...form.register("pieceHeightMetres")} /></Field>
            <Field label="Required stowage" id="stowage"><Select id="stowage" {...form.register("requiredStowage")}>{Object.values(LinerStowage).map((value) => <option key={value} value={value}>{value}</option>)}</Select></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Listing status" id="cargo-status"><Select id="cargo-status" {...form.register("listingStatus")}><option value={ListingStatus.DRAFT}>DRAFT</option><option value={ListingStatus.ACTIVE}>ACTIVE</option></Select></Field><Field label="Internal notes" id="cargo-notes"><Textarea id="cargo-notes" {...form.register("notes")} className="min-h-[80px]" /></Field></div>
          {ErrorText(form.formState.errors.root?.message)}
          <div className="flex justify-end pt-4 border-t"><Button type="button" variant="outline" className="mr-2" onClick={() => setShowForm(false)}>Cancel</Button><Button type="submit" disabled={createCargo.isPending || updateCargo.isPending}>{editingId ? "Save changes" : "Post cargo"}</Button></div>
        </form>
      </CardContent></Card>}
      {cargoList.length === 0 && !showForm ? <Card className="border-dashed"><CardContent className="p-12 text-center text-muted-foreground">No cargo listed yet.{canManage && <div className="mt-4"><Button onClick={openCreate}>Post Cargo</Button></div>}</CardContent></Card> : <div className="grid gap-4 lg:grid-cols-2">{cargoList.map((cargo) => {
        const origin = ports.find((port) => port.id === cargo.originLocationId)?.name ?? "Unknown port";
        const destination = ports.find((port) => port.id === cargo.destinationLocationId)?.name ?? "Unknown port";
        return <Card key={cargo.id}><CardHeader className="bg-muted/20 pb-3 border-b"><div className="flex justify-between gap-2"><div><CardTitle className="text-lg">{cargo.cargoName}</CardTitle><div className="text-sm text-muted-foreground mt-1 flex items-center gap-2"><MapPin className="h-3 w-3" />{origin}<ArrowRight className="h-3 w-3" /><Anchor className="h-3 w-3" />{destination}</div></div><Badge variant={cargo.listingStatus === "ACTIVE" ? "default" : "secondary"}>{cargo.listingStatus}</Badge></div></CardHeader><CardContent className="p-4"><div className="grid grid-cols-2 gap-3 text-sm"><div><span className="text-muted-foreground block text-xs">Total weight</span>{cargo.totalWeightTonnes} t</div><div><span className="text-muted-foreground block text-xs">Pieces / heaviest</span>{cargo.pieceCount} / {cargo.pieceWeightTonnes} t</div><div><span className="text-muted-foreground block text-xs">Maximum dimensions (L × W × H)</span>{cargo.pieceLengthMetres} × {cargo.pieceWidthMetres} × {cargo.pieceHeightMetres} m</div><div><span className="text-muted-foreground block text-xs">Ready</span>{new Date(cargo.readyAt).toLocaleString()}</div></div>{canManage && <div className="flex justify-end gap-2 pt-3 mt-3 border-t"><Button variant="outline" size="sm" onClick={() => edit(cargo)}><FileEdit className="h-4 w-4 mr-1" />Edit</Button>{cargo.listingStatus === "ACTIVE" && <Button variant="outline" size="sm" onClick={() => withdraw(cargo.id)} disabled={withdrawCargo.isPending} className="text-destructive">Withdraw</Button>}</div>}</CardContent></Card>;
      })}</div>}
    </>}
  </div>;
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="space-y-2"><label htmlFor={id} className="text-sm font-medium leading-none">{label}</label>{children}</div>;
}
function ErrorText(message?: string) {
  return message ? <p role="alert" className="text-xs text-destructive">{message}</p> : null;
}