import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { useGetMyCompany } from "@workspace/api-client-react";
import {
  AlertTriangle, ArrowRight, CheckCircle2, Edit2, Flag, MapPin, MessageSquare,
  Package, Plus, Save, Send, Truck, UserRound, XCircle,
} from "lucide-react";
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label,
  Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea,
} from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";
import {
  roadApi, type RoadAsset, type RoadCapacity, type RoadCargo, type RoadMatch,
  type RoadOpportunityProjection, roadAssetTypes, toIso, roadAssetFormPayload, roadDriverActions,
} from "@/lib/road-api";

type Tab = "assets" | "capacity" | "cargo" | "opportunities" | "matches";
const tabs: Array<{ id: Tab; label: string; icon: typeof Truck; path: string }> = [
  { id: "assets", label: "Road assets", icon: Truck, path: "/road/assets" },
  { id: "capacity", label: "Future capacity", icon: MapPin, path: "/road/capacity" },
  { id: "cargo", label: "Road cargo", icon: Package, path: "/road/cargo" },
  { id: "opportunities", label: "Next-load opportunities", icon: ArrowRight, path: "/road/opportunities" },
  { id: "matches", label: "Road matches", icon: CheckCircle2, path: "/road/matches" },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The road API could not complete the request.";
}
function list(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}
function Field({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}{help && <p className="text-xs text-muted-foreground">{help}</p>}</div>;
}
function ErrorNotice({ error }: { error: unknown }) {
  return error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{errorMessage(error)}</div> : null;
}
function Empty({ message }: { message: string }) {
  return <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">{message}</div>;
}
function ProjectionSummary({ projection }: { projection?: RoadOpportunityProjection }) {
  if (!projection) return <span className="text-muted-foreground">Projection unavailable</span>;
  return <div className="space-y-1 text-sm">
    <div>{projection.originRegion} → {projection.destinationRegion}</div>
    <div>{projection.loadingDateBand} · {projection.loadingTimeWindowBand}</div>
    <div>{projection.weightBand} · {projection.cargoTypeBand}</div>
    <div className="text-xs text-muted-foreground">{projection.equipmentBand} · {projection.temperatureBand} · {projection.adrBand}</div>
    <div className="text-xs text-muted-foreground">{projection.dimensionalRequirementsBand}</div>
  </div>;
}
function CapacityProjectionSummary({ projection }: { projection?: RoadOpportunityProjection }) {
  if (!projection) return <span className="text-muted-foreground">Capacity projection unavailable</span>;
  return <div className="space-y-1 text-sm">
    <div>{projection.freeAreaBand} · {projection.freeTimeBand}</div>
    <div>{projection.freeCapacityBand}</div>
    <div className="text-xs text-muted-foreground">{projection.capacityEquipmentBand} · {projection.capacityTemperatureBand} · {projection.capacityAdrBand}</div>
  </div>;
}
function StatusBadge({ value }: { value?: string }) {
  const status = value || "UNKNOWN";
  return <Badge variant={status === "ACTIVE" || status === "CONNECTED" ? "default" : "secondary"}>{status.replaceAll("_", " ")}</Badge>;
}

function useRoadQueries() {
  const { data: company } = useGetMyCompany();
  const planner = company?.membershipRole === "OWNER" || company?.membershipRole === "ADMIN";
  const assets = useQuery({ queryKey: ["/api/road/assets"], queryFn: ({ signal }) => roadApi.listAssets(signal), refetchInterval: 15000 });
  const capacity = useQuery({ queryKey: ["/api/road/capacity"], queryFn: ({ signal }) => roadApi.listCapacity(signal), refetchInterval: 15000 });
  const cargo = useQuery({ queryKey: ["/api/road/cargo"], queryFn: ({ signal }) => roadApi.listCargo(signal), refetchInterval: 15000, enabled: planner });
  const drivers = useQuery({ queryKey: ["/api/road/drivers"], queryFn: ({ signal }) => roadApi.listDrivers(signal), staleTime: 30_000, enabled: planner });
  const locations = useQuery({ queryKey: ["/api/locations", "road"], queryFn: ({ signal }) => roadApi.listLocations(signal), staleTime: 60_000 });
  return { assets, capacity, cargo, drivers, locations };
}

function AssetForm({ asset, onDone }: { asset?: RoadAsset; onDone: () => void }) {
  const mutation = useMutationRefresh();
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      assetType: asset?.assetType || "TRUCK_TRAILER_COMBINATION",
      assetName: asset?.assetName || "",
      registrationReference: asset?.registrationReference || "",
      payloadTonnes: asset?.payloadTonnes || "",
      volumeCubicMetres: asset?.volumeCubicMetres || "",
      loadingMetres: asset?.loadingMetres || "",
      palletPositions: asset?.palletPositions || "",
      trailerType: asset?.trailerType || "",
      equipment: asset?.equipment?.join(", ") || "",
      temperatureMinCelsius: asset?.temperatureMinCelsius ?? "",
      temperatureMaxCelsius: asset?.temperatureMaxCelsius ?? "",
      adrClasses: asset?.adrClasses?.join(", ") || "",
      notes: asset?.notes || "",
    },
  });
  const submit = (data: Record<string, any>) => {
    const payload = roadAssetFormPayload(data, Boolean(asset));
    mutation.run(asset ? () => roadApi.updateAsset(asset.id, payload) : () => roadApi.createAsset(payload), onDone);
  };
  return <Card>
    <CardHeader><CardTitle>{asset ? "Edit road asset" : "Add road asset"}</CardTitle></CardHeader>
    <CardContent><form onSubmit={handleSubmit(submit)} className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Asset type"><Select {...register("assetType", { required: true })}>{roadAssetTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</Select></Field>
        <Field label="Asset name"><Input {...register("assetName", { required: true })} placeholder="e.g. Unit 42" />{errors.assetName && <p className="text-xs text-destructive">Name is required.</p>}</Field>
        <Field label="Registration reference"><Input {...register("registrationReference")} placeholder="Optional internal reference" /></Field>
        <Field label="Payload (tonnes)"><Input type="number" min="0.01" step="0.01" {...register("payloadTonnes", { required: true, min: 0.01 })} /></Field>
        <Field label="Volume (m³)"><Input type="number" min="0.01" step="0.01" {...register("volumeCubicMetres", { required: true, min: 0.01 })} /></Field>
        <Field label="Loading metres"><Input type="number" min="0.01" step="0.01" {...register("loadingMetres", { required: true, min: 0.01 })} /></Field>
        <Field label="Pallet positions"><Input type="number" min="1" step="1" {...register("palletPositions", { required: true, min: 1 })} /></Field>
        <Field label="Trailer type"><Input {...register("trailerType")} placeholder="Curtainsider, refrigerated..." /></Field>
        <Field label="Equipment" help="Comma-separated capability labels."><Input {...register("equipment")} placeholder="tail lift, mega, loading ramp" /></Field>
        <Field label="Temperature minimum (°C)"><Input type="number" step="0.1" {...register("temperatureMinCelsius")} /></Field>
        <Field label="Temperature maximum (°C)"><Input type="number" step="0.1" {...register("temperatureMaxCelsius")} /></Field>
        <Field label="ADR classes" help="Comma-separated ADR classes; leave blank if not applicable."><Input {...register("adrClasses")} placeholder="3, 8, 9" /></Field>
        <Field label="Private planner notes"><Textarea {...register("notes")} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onDone}>Cancel</Button><Button type="submit" disabled={mutation.pending}><Save className="mr-2 h-4 w-4" />{mutation.pending ? "Saving…" : "Save asset"}</Button></div>
      <ErrorNotice error={mutation.error} />
    </form></CardContent>
  </Card>;
}

function CapacityForm({ capacity, onDone }: { capacity?: RoadCapacity; onDone: () => void }) {
  const { assets, locations, drivers } = useRoadQueries();
  const mutation = useMutationRefresh();
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      roadAssetId: capacity?.roadAssetId || "", currentDeliveryLocationId: capacity?.currentDeliveryLocationId || "",
      assignedDriverId: "",
      currentDeliveryExpectedAt: capacity?.currentDeliveryExpectedAt?.slice(0, 16) || "",
      expectedAvailabilityLocationId: capacity?.expectedAvailabilityLocationId || "",
      expectedAvailabilityAt: capacity?.expectedAvailabilityAt?.slice(0, 16) || "",
      availabilityUncertaintyMinutes: capacity?.availabilityUncertaintyMinutes || 0,
      availabilitySource: capacity?.availabilitySource || "MANUAL",
      listingStatus: capacity?.listingStatus || "DRAFT",
      visibility: capacity?.visibility || "OPEN_NETWORK",
      availableCapacityTonnes: capacity?.availableCapacityTonnes || "",
      availableVolumeCubicMetres: capacity?.availableVolumeCubicMetres || "",
      availableLoadingMetres: capacity?.availableLoadingMetres || "",
      availablePalletPositions: capacity?.availablePalletPositions || "",
      trailerType: capacity?.trailerType || "", equipment: capacity?.equipment?.join(", ") || "",
      temperatureMinCelsius: capacity?.temperatureMinCelsius ?? "", temperatureMaxCelsius: capacity?.temperatureMaxCelsius ?? "",
      adrClasses: capacity?.adrClasses?.join(", ") || "", preferredDirection: capacity?.preferredDirection || "",
      cargoCompatibility: capacity?.cargoCompatibility?.join(", ") || "ALL",
      notes: capacity?.notes || "",
    },
  });
  const submit = (data: Record<string, any>) => {
    const payload = {
      roadAssetId: data.roadAssetId,
      currentDeliveryLocationId: data.currentDeliveryLocationId,
      expectedAvailabilityLocationId: data.expectedAvailabilityLocationId,
      currentDeliveryExpectedAt: toIso(data.currentDeliveryExpectedAt), expectedAvailabilityAt: toIso(data.expectedAvailabilityAt),
      availabilityUncertaintyMinutes: Number(data.availabilityUncertaintyMinutes || 0),
      availabilitySource: data.availabilitySource,
      availableCapacityTonnes: Number(data.availableCapacityTonnes),
      cargoCompatibility: list(data.cargoCompatibility).length ? list(data.cargoCompatibility) : ["ALL"],
      maximumPositioningDistanceKm: 100,
      visibility: data.visibility || "OPEN_NETWORK",
      listingStatus: capacity?.listingStatus || "DRAFT",
      availableVolumeCubicMetres: Number(data.availableVolumeCubicMetres),
      availableLoadingMetres: Number(data.availableLoadingMetres),
      availablePalletPositions: Number(data.availablePalletPositions),
       temperatureMinCelsius: data.temperatureMinCelsius === "" ? (capacity ? null : undefined) : Number(data.temperatureMinCelsius),
       temperatureMaxCelsius: data.temperatureMaxCelsius === "" ? (capacity ? null : undefined) : Number(data.temperatureMaxCelsius),
      equipment: list(data.equipment),
      adrClasses: list(data.adrClasses),
       notes: data.notes || (capacity ? null : undefined),
       trailerType: data.trailerType || (capacity ? null : undefined),
       preferredDirection: data.preferredDirection || (capacity ? null : undefined),
    };
    mutation.run(async () => {
      const saved = capacity
        ? await roadApi.updateCapacity(capacity.id, payload)
        : await roadApi.createCapacity(payload);
      if (data.assignedDriverId) await roadApi.assignDriver(saved.id, data.assignedDriverId);
    }, onDone);
  };
  return <Card>
    <CardHeader><CardTitle>{capacity ? "Edit future capacity" : "Add future capacity"}</CardTitle></CardHeader>
    <CardContent><form onSubmit={handleSubmit(submit)} className="space-y-5">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mr-2 inline h-4 w-4" />This is a manual future-capacity claim. Current GPS or telematics position never proves free capacity.</div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Asset"><Select {...register("roadAssetId", { required: true })}><option value="">Select an asset</option>{assets.data?.items.filter((a) => a.active).map((a) => <option value={a.id} key={a.id}>{a.assetName} · {a.assetType}</option>)}</Select>{errors.roadAssetId && <p className="text-xs text-destructive">Asset is required.</p>}</Field>
        <Field label="Assigned driver" help="Assignment grants operational access only; it does not grant commercial authority."><Select {...register("assignedDriverId")}><option value="">No driver assignment</option>{drivers.data?.items.map((driver) => <option value={driver.userId} key={driver.userId}>{[driver.firstName, driver.lastName].filter(Boolean).join(" ") || driver.email || driver.userId}</option>)}</Select></Field>
        <Field label="Availability source"><Select {...register("availabilitySource")}><option>MANUAL</option><option>DRIVER_INPUT</option><option>TMS</option><option>TELEMATICS</option></Select><p className="text-xs text-muted-foreground">Source is evidence only; planner confirmation controls commercial availability.</p></Field>
        <Field label="Current delivery location"><LocationSelect register={register("currentDeliveryLocationId", { required: true })} locations={locations.data?.items || []} /></Field>
        <Field label="Current delivery expected at"><Input type="datetime-local" {...register("currentDeliveryExpectedAt", { required: true })} /></Field>
        <Field label="Expected free location"><LocationSelect register={register("expectedAvailabilityLocationId", { required: true })} locations={locations.data?.items || []} /></Field>
        <Field label="Expected free time"><Input type="datetime-local" {...register("expectedAvailabilityAt", { required: true })} /></Field>
        <Field label="Time uncertainty (minutes)" help="Explicitly communicates planning uncertainty."><Input type="number" min="0" {...register("availabilityUncertaintyMinutes")} /></Field>
        <Field label="Available payload (tonnes)"><Input type="number" min="0.01" step="0.01" {...register("availableCapacityTonnes", { required: true })} /></Field>
        <Field label="Available volume (m³)"><Input type="number" min="0.01" step="0.01" {...register("availableVolumeCubicMetres", { required: true })} /></Field>
        <Field label="Available loading metres"><Input type="number" min="0.01" step="0.01" {...register("availableLoadingMetres", { required: true })} /></Field>
        <Field label="Available pallet positions"><Input type="number" min="1" {...register("availablePalletPositions", { required: true })} /></Field>
        <Field label="Trailer type"><Input {...register("trailerType")} /></Field>
        <Field label="Direction"><Input {...register("preferredDirection")} placeholder="e.g. Eindhoven → Rotterdam / Benelux" /></Field>
        <Field label="Equipment"><Input {...register("equipment")} placeholder="Comma-separated labels" /></Field>
        <Field label="ADR classes"><Input {...register("adrClasses")} placeholder="Comma-separated classes" /></Field>
        <Field label="Cargo compatibility" help="Use ALL for every cargo type, or enter explicit cargo-type labels separated by commas."><Input {...register("cargoCompatibility")} /></Field>
        <Field label="Temperature minimum (°C)"><Input type="number" step="0.1" {...register("temperatureMinCelsius")} /></Field>
        <Field label="Temperature maximum (°C)"><Input type="number" step="0.1" {...register("temperatureMaxCelsius")} /></Field>
        <Field label="Private notes"><Textarea {...register("notes")} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onDone}>Cancel</Button><Button type="submit" disabled={mutation.pending}><Save className="mr-2 h-4 w-4" />{mutation.pending ? "Saving…" : "Save draft"}</Button></div><ErrorNotice error={mutation.error} />
    </form></CardContent>
  </Card>;
}

function LocationSelect({ register, locations }: { register: Record<string, any>; locations: Array<{ id: string; name: string; country?: string }> }) {
  return <Select {...register}><option value="">Select a location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}{location.country ? ` (${location.country})` : ""}</option>)}</Select>;
}

function CargoForm({ cargo, onDone }: { cargo?: RoadCargo; onDone: () => void }) {
  const { locations } = useRoadQueries();
  const mutation = useMutationRefresh();
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      cargoName: cargo?.cargoName || "", cargoType: cargo?.cargoType || "", weightTonnes: cargo?.weightTonnes || "",
      listingStatus: cargo?.listingStatus || "DRAFT",
      loadingLocationId: cargo?.loadingLocationId || "", destinationLocationId: cargo?.destinationLocationId || "",
      loadingFrom: cargo?.loadingFrom?.slice(0, 16) || "", loadingUntil: cargo?.loadingUntil?.slice(0, 16) || "",
      volumeCubicMetres: cargo?.volumeCubicMetres ?? "", loadingMetres: cargo?.loadingMetres ?? "", palletPositions: cargo?.palletPositions ?? "",
      requiredTrailerType: cargo?.requiredTrailerType || "", requiredEquipment: cargo?.requiredEquipment?.join(", ") || "",
      temperatureMinCelsius: cargo?.temperatureMinCelsius ?? "", temperatureMaxCelsius: cargo?.temperatureMaxCelsius ?? "",
      adrClasses: cargo?.adrClasses?.join(", ") || "", direction: cargo?.direction || "", notes: cargo?.notes || "",
    },
  });
  const submit = (data: Record<string, any>) => {
    const nullableNumber = (value: string) => value === "" ? null : Number(value);
    const payload = {
      cargoName: data.cargoName, cargoType: data.cargoType, weightTonnes: Number(data.weightTonnes),
      loadingLocationId: data.loadingLocationId, destinationLocationId: data.destinationLocationId,
      loadingFrom: toIso(data.loadingFrom), loadingUntil: toIso(data.loadingUntil),
      visibility: "OPEN_NETWORK", listingStatus: cargo?.listingStatus || "DRAFT", notes: data.notes || undefined,
      roadRequirements: {
        volumeCubicMetres: nullableNumber(data.volumeCubicMetres), loadingMetres: nullableNumber(data.loadingMetres),
        palletPositions: nullableNumber(data.palletPositions), requiredTrailerType: data.requiredTrailerType || null,
        requiredEquipment: list(data.requiredEquipment),
        temperatureMinCelsius: nullableNumber(data.temperatureMinCelsius), temperatureMaxCelsius: nullableNumber(data.temperatureMaxCelsius),
        adrClasses: list(data.adrClasses), direction: data.direction || null, notes: data.notes || null,
      },
    };
    mutation.run(cargo ? () => roadApi.updateCargo(cargo.id, payload) : () => roadApi.createCargo(payload), onDone);
  };
  return <Card>
    <CardHeader><CardTitle>{cargo ? "Edit road cargo" : "Publish next-load cargo"}</CardTitle></CardHeader>
    <CardContent><form onSubmit={handleSubmit(submit)} className="space-y-5"><div className="grid gap-4 md:grid-cols-2">
      <Field label="Cargo reference"><Input {...register("cargoName", { required: true })} />{errors.cargoName && <p className="text-xs text-destructive">Reference is required.</p>}</Field>
      <Field label="Cargo type"><Input {...register("cargoType", { required: true })} placeholder="General, food, ADR..." /></Field>
      <Field label="Weight (tonnes)"><Input type="number" min="0.01" step="0.01" {...register("weightTonnes", { required: true })} /></Field>
      <Field label="Loading location"><LocationSelect register={register("loadingLocationId", { required: true })} locations={locations.data?.items || []} /></Field>
      <Field label="Destination"><LocationSelect register={register("destinationLocationId", { required: true })} locations={locations.data?.items || []} /></Field>
      <Field label="Loading from"><Input type="datetime-local" {...register("loadingFrom", { required: true })} /></Field>
      <Field label="Loading until"><Input type="datetime-local" {...register("loadingUntil", { required: true })} /></Field>
      <Field label="Volume (m³)"><Input type="number" min="0" step="0.01" {...register("volumeCubicMetres")} /></Field>
      <Field label="Loading metres"><Input type="number" min="0" step="0.01" {...register("loadingMetres")} /></Field>
      <Field label="Pallet positions"><Input type="number" min="0" {...register("palletPositions")} /></Field>
      <Field label="Required trailer type"><Input {...register("requiredTrailerType")} /></Field>
      <Field label="Required equipment"><Input {...register("requiredEquipment")} placeholder="Comma-separated labels" /></Field>
      <Field label="ADR classes"><Input {...register("adrClasses")} placeholder="Comma-separated classes" /></Field>
      <Field label="Temperature minimum (°C)"><Input type="number" step="0.1" {...register("temperatureMinCelsius")} /></Field>
      <Field label="Temperature maximum (°C)"><Input type="number" step="0.1" {...register("temperatureMaxCelsius")} /></Field>
      <Field label="Direction"><Input {...register("direction")} placeholder="e.g. eastbound, Benelux" /></Field>
      <Field label="Private notes"><Textarea {...register("notes")} /></Field>
    </div><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onDone}>Cancel</Button><Button type="submit" disabled={mutation.pending}><Save className="mr-2 h-4 w-4" />{mutation.pending ? "Saving…" : "Save draft"}</Button></div><ErrorNotice error={mutation.error} /></form></CardContent>
  </Card>;
}

function useMutationRefresh() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (operation: () => Promise<unknown>, onDone?: () => void) => {
    setPending(true); setError(null);
    try {
      await operation();
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const path = query.queryKey[0];
          return typeof path === "string" && (path.startsWith("/api/road") || path.startsWith("/api/matches"));
        },
      });
      onDone?.();
    }
    catch (caught) { setError(caught); }
    finally { setPending(false); }
  };
  return { run, pending, error };
}

function AssetsTab({ planner }: { planner: boolean }) {
  const { assets, capacity } = useRoadQueries();
  const [editing, setEditing] = useState<RoadAsset | undefined>();
  const [showForm, setShowForm] = useState(false);
  const mutation = useMutationRefresh();
  if (showForm && planner) return <AssetForm asset={editing} onDone={() => { setShowForm(false); setEditing(undefined); }} />;
  return <div className="space-y-4">
    <div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold">Road assets</h2><p className="text-sm text-muted-foreground">{planner ? "Manage vehicles and assigned drivers." : "Assets assigned to you. Commercial controls stay with the planner."}</p></div>{planner && <Button onClick={() => { setEditing(undefined); setShowForm(true); }}><Plus className="mr-2 h-4 w-4" />Add asset</Button>}</div>
    <ErrorNotice error={assets.error || capacity.error} />
    <Card><Table><TableHeader><TableRow><TableHead>Asset</TableHead><TableHead>Capacity limits</TableHead><TableHead>Equipment / temperature</TableHead><TableHead>Driver</TableHead><TableHead>Status</TableHead>{planner && <TableHead className="text-right">Actions</TableHead>}</TableRow></TableHeader><TableBody>{assets.isLoading || capacity.isLoading ? <TableRow><TableCell colSpan={6}>Loading road assets…</TableCell></TableRow> : !(assets.data?.items.filter((asset) => planner || capacity.data?.items.some((offer) => offer.roadAssetId === asset.id)).length) ? <TableRow><TableCell colSpan={6}><Empty message="No assigned road assets have been persisted yet." /></TableCell></TableRow> : assets.data.items.filter((asset) => planner || capacity.data?.items.some((offer) => offer.roadAssetId === asset.id)).map((asset) => <TableRow key={asset.id}><TableCell><div className="font-medium">{asset.assetName}</div><div className="text-xs text-muted-foreground">{asset.assetType.replaceAll("_", " ")} {asset.registrationReference ? `· ${asset.registrationReference}` : ""}</div></TableCell><TableCell className="text-sm">{asset.payloadTonnes} t · {asset.volumeCubicMetres} m³<br />{asset.loadingMetres} lm · {asset.palletPositions} pallets</TableCell><TableCell className="text-xs">{asset.equipment.join(", ") || "No equipment listed"}<br />{asset.temperatureMinCelsius != null ? `${asset.temperatureMinCelsius} to ${asset.temperatureMaxCelsius} °C` : "Ambient"}{asset.adrClasses.length ? ` · ADR ${asset.adrClasses.join(", ")}` : ""}</TableCell><TableCell className="text-sm"><UserRound className="mr-1 inline h-3.5 w-3.5" />Assignment handled on future capacity</TableCell><TableCell><StatusBadge value={asset.active ? "ACTIVE" : "INACTIVE"} /></TableCell>{planner && <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => { setEditing(asset); setShowForm(true); }}><Edit2 className="h-4 w-4" /></Button><Button size="sm" variant="ghost" className="ml-2 text-destructive" disabled={mutation.pending} onClick={() => { if (confirm("Deactivate this road asset?")) mutation.run(() => roadApi.deleteAsset(asset.id)); }}><XCircle className="h-4 w-4" /></Button></TableCell>}</TableRow>)}</TableBody></Table></Card>
  </div>;
}

function CapacityTab({ planner }: { planner: boolean }) {
  const { capacity, assets, locations } = useRoadQueries();
  const [editing, setEditing] = useState<RoadCapacity | undefined>();
  const [showForm, setShowForm] = useState(false);
  const mutation = useMutationRefresh();
  if (showForm && planner) return <CapacityForm capacity={editing} onDone={() => { setShowForm(false); setEditing(undefined); }} />;
  const locationName = (id: string, fallback?: string) => fallback || locations.data?.items.find((location) => location.id === id)?.name || id;
  return <div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold">Future road capacity</h2><p className="text-sm text-muted-foreground">Current delivery → expected free location and time → next suitable load.</p></div>{planner && <Button onClick={() => { setEditing(undefined); setShowForm(true); }} disabled={!assets.data?.items.length}><Plus className="mr-2 h-4 w-4" />Add capacity</Button>}</div><div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Manual / driver confirmation is explicit. GPS capacity is not accepted as proof of commercial availability.</div><ErrorNotice error={capacity.error} /><Card><Table><TableHeader><TableRow><TableHead>Asset / delivery</TableHead><TableHead>Expected free</TableHead><TableHead>Four capacity limits</TableHead><TableHead>Requirements</TableHead><TableHead>Status</TableHead>{planner && <TableHead className="text-right">Actions</TableHead>}</TableRow></TableHeader><TableBody>{capacity.isLoading ? <TableRow><TableCell colSpan={6}>Loading future capacity…</TableCell></TableRow> : !capacity.data?.items.length ? <TableRow><TableCell colSpan={6}><Empty message="No future capacity claims have been persisted yet." /></TableCell></TableRow> : capacity.data.items.map((item) => <TableRow key={item.id}><TableCell><div className="font-medium">{item.roadAsset?.assetName || assets.data?.items.find((asset) => asset.id === item.roadAssetId)?.assetName || item.roadAssetId}</div><div className="text-xs text-muted-foreground">{locationName(item.currentDeliveryLocationId, item.currentDeliveryLocationName)} · {formatDate(item.currentDeliveryExpectedAt)}</div></TableCell><TableCell><div className="font-medium">{locationName(item.expectedAvailabilityLocationId, item.expectedAvailabilityLocationName)}</div><div className="text-xs text-muted-foreground">{formatDate(item.expectedAvailabilityAt)} – {item.availableUntil ? formatDate(item.availableUntil) : "Availability end not provided"} ± {item.availabilityUncertaintyMinutes} min</div><div className="text-xs text-amber-700">{item.availabilitySource.replaceAll("_", " ")} · manually stated</div></TableCell><TableCell className="text-sm">{item.availableCapacityTonnes} t<br />{item.availableVolumeCubicMetres} m³ · {item.availableLoadingMetres} lm<br />{item.availablePalletPositions} pallets</TableCell><TableCell className="text-xs">{item.preferredDirection || "Any direction"}<br />{item.equipment.join(", ") || "No equipment"}{item.adrClasses.length ? ` · ADR ${item.adrClasses.join(", ")}` : ""}<br />{item.temperatureMinCelsius != null ? `${item.temperatureMinCelsius}–${item.temperatureMaxCelsius} °C` : "Ambient"}</TableCell><TableCell><StatusBadge value={item.listingStatus} />{item.assignments?.filter((assignment) => assignment.status === "FLAGGED").map((assignment) => <div key={assignment.id} className="mt-1 text-xs text-amber-700">Driver flag{assignment.flaggedMatchId ? ` · match ${assignment.flaggedMatchId.slice(0, 8)}` : ""}{assignment.flaggedReason ? `: ${assignment.flaggedReason}` : ""}</div>)}</TableCell>{planner && <TableCell className="text-right space-x-1">{(item.listingStatus === "DRAFT" || item.listingStatus === "ACTIVE") && <Button size="sm" variant="outline" onClick={() => { setEditing(item); setShowForm(true); }}><Edit2 className="h-4 w-4" /></Button>}{item.listingStatus === "DRAFT" && <Button size="sm" variant="outline" disabled={mutation.pending} onClick={() => mutation.run(() => roadApi.changeCapacityStatus(item.id, "publish"))}>Publish</Button>}{item.listingStatus === "ACTIVE" && <Button size="sm" variant="ghost" disabled={mutation.pending} onClick={() => mutation.run(() => roadApi.changeCapacityStatus(item.id, "withdraw"))}>Withdraw</Button>}</TableCell>}</TableRow>)}</TableBody></Table></Card></div>;
}

function CargoTab({ planner }: { planner: boolean }) {
  const { cargo, locations } = useRoadQueries();
  const [editing, setEditing] = useState<RoadCargo | undefined>();
  const [showForm, setShowForm] = useState(false);
  const mutation = useMutationRefresh();
  if (showForm && planner) return <CargoForm cargo={editing} onDone={() => { setShowForm(false); setEditing(undefined); }} />;
  const locationName = (id: string, fallback?: string) => fallback || locations.data?.items.find((location) => location.id === id)?.name || id;
  return <div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold">Road cargo</h2><p className="text-sm text-muted-foreground">Publish the next load without booking or reserving a vehicle.</p></div>{planner && <Button onClick={() => { setEditing(undefined); setShowForm(true); }}><Plus className="mr-2 h-4 w-4" />Add cargo</Button>}</div><ErrorNotice error={cargo.error} /><Card><Table><TableHeader><TableRow><TableHead>Cargo</TableHead><TableHead>Route / window</TableHead><TableHead>Limits</TableHead><TableHead>Requirements</TableHead><TableHead>Status</TableHead>{planner && <TableHead className="text-right">Actions</TableHead>}</TableRow></TableHeader><TableBody>{cargo.isLoading ? <TableRow><TableCell colSpan={6}>Loading road cargo…</TableCell></TableRow> : !cargo.data?.items.length ? <TableRow><TableCell colSpan={6}><Empty message="No road cargo has been persisted yet." /></TableCell></TableRow> : cargo.data.items.map((item) => <TableRow key={item.id}><TableCell><div className="font-medium">{item.cargoName}</div><div className="text-xs text-muted-foreground">{item.cargoType} · {item.weightTonnes} t</div></TableCell><TableCell className="text-sm">{locationName(item.loadingLocationId, item.loadingLocationName)} → {locationName(item.destinationLocationId, item.destinationLocationName)}<div className="text-xs text-muted-foreground">{formatDate(item.loadingFrom)} – {formatDate(item.loadingUntil)}</div></TableCell><TableCell className="text-xs">{item.volumeCubicMetres ?? "—"} m³ · {item.loadingMetres ?? "—"} lm<br />{item.palletPositions ?? "—"} pallets</TableCell><TableCell className="text-xs">{item.requiredTrailerType || "Any trailer"}<br />{item.requiredEquipment.join(", ") || "No equipment"}{item.adrClasses.length ? ` · ADR ${item.adrClasses.join(", ")}` : ""}<br />{item.direction || "Any direction"}</TableCell><TableCell><StatusBadge value={item.listingStatus} /></TableCell>{planner && <TableCell className="text-right space-x-1">{(item.listingStatus === "DRAFT" || item.listingStatus === "ACTIVE") && <Button size="sm" variant="outline" onClick={() => { setEditing(item); setShowForm(true); }}><Edit2 className="h-4 w-4" /></Button>}{item.listingStatus === "DRAFT" && <Button size="sm" variant="outline" disabled={mutation.pending} onClick={() => mutation.run(() => roadApi.changeCargoStatus(item.id, "publish"))}>Publish</Button>}{item.listingStatus === "ACTIVE" && <Button size="sm" variant="ghost" disabled={mutation.pending} onClick={() => mutation.run(() => roadApi.changeCargoStatus(item.id, "withdraw"))}>Withdraw</Button>}</TableCell>}</TableRow>)}</TableBody></Table></Card></div>;
}

function OpportunitiesTab() {
  const { capacity } = useRoadQueries();
  const { data, isLoading, error } = useQuery({ queryKey: ["/api/road/opportunities"], queryFn: ({ signal }) => roadApi.listOpportunities(signal), refetchInterval: 15000 });
  const mutation = useMutationRefresh();
  return <div className="space-y-4">
    <div><h2 className="text-xl font-semibold">Next-load opportunities</h2><p className="text-sm text-muted-foreground">Sanitized road opportunities near an assigned asset’s expected free location and time.</p></div>
    <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">Opportunities are introductions only. No party identity, price, booking, or binding commercial commitment is disclosed here.</div>
    <ErrorNotice error={error || capacity.error || mutation.error} />
    <Card><Table>
      <TableHeader><TableRow><TableHead>Road opportunity</TableHead><TableHead>Capacity context</TableHead><TableHead>Fit explanation</TableHead><TableHead className="text-right">Operational action</TableHead></TableRow></TableHeader>
      <TableBody>{isLoading || capacity.isLoading
        ? <TableRow><TableCell colSpan={4}>Finding opportunities…</TableCell></TableRow>
        : !data?.items.length
          ? <TableRow><TableCell colSpan={4}><Empty message="No sanitized opportunities are available yet." /></TableCell></TableRow>
          : data.items.map((item: RoadMatch) => {
            const assignment = capacity.data?.items.find((offer) => offer.id === item.capacityOfferId)?.assignments?.[0];
            const actions = roadDriverActions(assignment, item.status);
            return <TableRow key={item.id}>
               <TableCell className="font-medium"><ProjectionSummary projection={item.projection} /><div className="text-xs text-muted-foreground">Match {item.id.slice(0, 8)}</div></TableCell>
               <TableCell><CapacityProjectionSummary projection={item.projection} /></TableCell>
               <TableCell className="text-sm">{item.explanation}<div className="text-xs text-muted-foreground">No commercial identity disclosed</div></TableCell>
              <TableCell className="text-right space-x-1">
                {assignment?.confirmedAt && <Badge variant="secondary">Status confirmed</Badge>}
                {assignment?.flaggedMatchId === item.id && <Badge variant="secondary">Sent to planner</Badge>}
                {assignment && actions.canConfirm && <Button variant="outline" size="sm" disabled={mutation.pending} onClick={() => mutation.run(() => roadApi.confirmAssignment(assignment.id))}><CheckCircle2 className="mr-2 h-4 w-4" />Confirm status</Button>}
                {assignment && actions.canFlag && <Button variant="outline" size="sm" disabled={mutation.pending} onClick={() => mutation.run(() => roadApi.flagAssignment(assignment.id, item.id, "Driver flagged this next-load opportunity"))}><Flag className="mr-2 h-4 w-4" />Send to planner</Button>}
                {!assignment && <span className="text-xs text-muted-foreground">Assignment action unavailable</span>}
              </TableCell>
            </TableRow>;
          })}</TableBody>
    </Table></Card>
  </div>;
}

function MatchesTab({ planner }: { planner: boolean }) {
  const [, setLocation] = useLocation();
  const { data, isLoading, error } = useQuery({ queryKey: ["/api/road/matches", "ROAD", planner], queryFn: ({ signal }) => roadApi.listMatches(signal, planner), refetchInterval: 15000 });
  return <div className="space-y-4"><div><h2 className="text-xl font-semibold">Road matches</h2><p className="text-sm text-muted-foreground">Privacy-safe introductions: shared interest → accept → CONNECTED. A match never books transport.</p></div><ErrorNotice error={error} /><Card><Table><TableHeader><TableRow><TableHead>Status</TableHead><TableHead>Road opportunity</TableHead><TableHead>Free capacity context</TableHead><TableHead>Generated</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <TableRow><TableCell colSpan={5}>Loading road matches…</TableCell></TableRow> : !data?.items.length ? <TableRow><TableCell colSpan={5}><Empty message="No road matches have been found yet." /></TableCell></TableRow> : data.items.map((match: RoadMatch) => <TableRow key={match.id}><TableCell><StatusBadge value={match.status} /></TableCell><TableCell className="text-sm"><ProjectionSummary projection={match.projection} /><div className="text-xs text-muted-foreground">{match.explanation}</div></TableCell><TableCell><CapacityProjectionSummary projection={match.projection} /></TableCell><TableCell className="text-sm text-muted-foreground">{formatDate(match.createdAt)}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setLocation(`/road/matches/${match.id}`)}>View details</Button></TableCell></TableRow>)}</TableBody></Table></Card></div>;
}

function MatchDetail({ id }: { id: string }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: company, isLoading: companyLoading } = useGetMyCompany();
  const planner = company?.membershipRole === "OWNER" || company?.membershipRole === "ADMIN";
  const { data: match, isLoading, error } = useQuery({ queryKey: ["/api/road/matches", id, planner], queryFn: () => roadApi.getMatch(id, planner), enabled: !companyLoading, refetchInterval: 10000 });
  const mutation = useMutationRefresh();
  if (isLoading) return <div className="p-10 text-center text-muted-foreground">Loading road introduction…</div>;
  if (error || !match) return <ErrorNotice error={error || new Error("Road match was not found.")} />;
  const action = (value: "INTEREST" | "ACCEPT" | "DECLINE") => mutation.run(async () => { await roadApi.actOnMatch(id, value); await queryClient.invalidateQueries({ queryKey: ["/api/matches"] }); }, undefined);
  return <div className="mx-auto max-w-4xl space-y-5"><Button variant="ghost" onClick={() => setLocation("/road/matches")}>← Back to road matches</Button><div className="flex items-start justify-between"><div><h2 className="text-2xl font-bold">Road introduction</h2><p className="text-sm text-muted-foreground">No booking, reservation, price, or vessel-style score is part of this pilot.</p></div><StatusBadge value={match.status} /></div><div className="grid gap-5 md:grid-cols-2"><Card><CardHeader><CardTitle>Sanitized cargo fit</CardTitle></CardHeader><CardContent><ProjectionSummary projection={match.projection} /></CardContent></Card><Card><CardHeader><CardTitle>Expected free capacity</CardTitle></CardHeader><CardContent><CapacityProjectionSummary projection={match.projection} /></CardContent></Card></div><Card><CardContent className="flex flex-wrap items-center gap-3 p-5">{planner && match.status === "NEW" && <Button disabled={mutation.pending} onClick={() => action("INTEREST")}><Send className="mr-2 h-4 w-4" />Share interest</Button>}{planner && match.status === "INTEREST_SENT" && match.canAccept && !match.initiatedByMe && <><Button variant="outline" disabled={mutation.pending} onClick={() => action("DECLINE")}>Decline</Button><Button disabled={mutation.pending} onClick={() => action("ACCEPT")}><CheckCircle2 className="mr-2 h-4 w-4" />Accept and connect</Button></>}{planner && match.status === "INTEREST_SENT" && match.initiatedByMe && <span className="text-sm text-muted-foreground">Interest shared. Waiting for the other party.</span>}{match.status === "CONNECTED" && <><span className="text-sm font-medium text-emerald-700">Connected. Commercial details may now be discussed privately.</span>{planner && <Button variant="outline" onClick={() => setLocation("/messages")}><MessageSquare className="mr-2 h-4 w-4" />Open conversations</Button>}</>}{match.status === "DECLINED" && <span className="text-sm text-destructive">This introduction was declined.</span>}<ErrorNotice error={mutation.error} /></CardContent></Card></div>;
}

export default function RoadPilot({ matchId }: { matchId?: string }) {
  const [location] = useLocation();
  const { data: company, isLoading: companyLoading, error: companyError } = useGetMyCompany();
  const planner = company?.membershipRole === "OWNER" || company?.membershipRole === "ADMIN";
  const activeTab = (tabs.find((tab) => location === tab.path || location.startsWith(`${tab.path}/`))?.id || "assets") as Tab;
  if (matchId) return <MatchDetail id={matchId} />;
  if (companyLoading) return <div className="p-10 text-center text-muted-foreground">Loading road pilot…</div>;
  if (companyError) return <ErrorNotice error={companyError} />;
  return <div className="space-y-6">
    <div className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-start md:justify-between"><div><div className="flex items-center gap-2"><Truck className="h-7 w-7 text-accent" /><h1 className="text-2xl font-bold tracking-tight">Road pilot</h1><Badge variant="outline">MANUAL PILOT</Badge></div><p className="mt-1 max-w-3xl text-muted-foreground">Find a next load after a planned road delivery. Availability is an explicit estimate, not GPS capacity.</p></div><div className="text-right text-sm text-muted-foreground"><div>{planner ? "Planner / commercial authority" : "Operational member / driver view"}</div><div>{company?.name}</div></div></div>
    <div className="flex gap-2 overflow-x-auto pb-1">{tabs.map((tab) => <Link key={tab.id} href={tab.path} className={`flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm ${activeTab === tab.id ? "border-accent bg-accent/10 text-accent" : "hover:bg-muted"}`}><tab.icon className="h-4 w-4" />{tab.label}</Link>)}</div>
    {!planner && activeTab === "assets" && <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><UserRound className="mr-2 inline h-4 w-4" />Driver view is limited to assigned assets, operational status, sanitized opportunities, and flags to the planner. Commercial controls are unavailable.</div>}
    {activeTab === "assets" && <AssetsTab planner={planner} />}
     {activeTab === "capacity" && <CapacityTab planner={planner} />}
    {activeTab === "cargo" && (planner ? <CargoTab planner /> : <Empty message="Road cargo publishing is reserved for an OWNER or ADMIN planner." />)}
    {activeTab === "opportunities" && <OpportunitiesTab />}
     {activeTab === "matches" && <MatchesTab planner={planner} />}
  </div>;
}