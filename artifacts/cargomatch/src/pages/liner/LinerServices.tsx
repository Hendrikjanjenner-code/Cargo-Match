import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ArrowRight, CheckCircle, FileEdit, Navigation, Plus, Ship, Trash2, X } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Select, Textarea } from "@/components/ui/primitives";
import {
  getListMyLinerSailingsQueryKey, getListMyLinerServicesQueryKey, getListMyLinerVesselsQueryKey,
  LinerCargoType, LinerStowage, listLocations, listMyLinerSailings, listMyLinerServices,
  listMyLinerVessels, ListingStatus, LocationType, useCreateMyLinerSailing, useCreateMyLinerService,
  useCreateMyLinerVessel, useGetMyCompany, useUpdateMyLinerSailing, useUpdateMyLinerService,
  useUpdateMyLinerVessel, useWithdrawMyLinerSailing, useWithdrawMyLinerService, Visibility,
} from "@workspace/api-client-react";

const positive = z.coerce.number().finite().positive("Must be greater than zero");
const vesselSchema = z.object({ vesselName: z.string().trim().min(1, "Name is required"), imoNumber: z.string().regex(/^\d{7}$/, "IMO must be exactly 7 digits") });
const serviceSchema = z.object({
  serviceName: z.string().trim().min(1, "Required"), tradeLane: z.string().trim().min(1, "Required"),
  visibility: z.nativeEnum(Visibility), listingStatus: z.nativeEnum(ListingStatus), notes: z.string().optional(),
});
const rotationSchema = z.object({
  locationId: z.string().min(1, "Required"), sequence: z.coerce.number().finite().int().min(1),
  estimatedArrival: z.string().min(1, "Required"), estimatedDeparture: z.string().min(1, "Required"),
});
const sailingSchema = z.object({
  linerVesselId: z.string().min(1, "Required"), voyageReference: z.string().trim().min(1, "Required"),
  departureAt: z.string().min(1, "Required"), cargoCutoffAt: z.string().min(1, "Required"),
  visibility: z.nativeEnum(Visibility), listingStatus: z.nativeEnum(ListingStatus),
  portRotation: z.array(rotationSchema).min(2, "At least two ports are required"),
  commercialCapacity: z.object({
    availableCommercialTonnes: positive, maximumPieceWeightTonnes: positive, maximumPieceLengthMetres: positive,
    maximumPieceWidthMetres: positive, maximumPieceHeightMetres: positive, liftingCapacityTonnes: positive,
    stowage: z.nativeEnum(LinerStowage), acceptedCargoTypes: z.array(z.nativeEnum(LinerCargoType)).min(1, "Select at least one"),
  }),
  notes: z.string().optional(),
}).superRefine((value, context) => {
  if (new Date(value.cargoCutoffAt) >= new Date(value.departureAt)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["cargoCutoffAt"], message: "Cut-off must be before departure." });
  value.portRotation.forEach((port, index) => {
    if (new Date(port.estimatedArrival) >= new Date(port.estimatedDeparture)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["portRotation", index, "estimatedDeparture"], message: "Departure must be after arrival." });
  });
});
type VesselForm = z.infer<typeof vesselSchema>;
type ServiceForm = z.infer<typeof serviceSchema>;
type SailingForm = z.infer<typeof sailingSchema>;

const vesselDefaults: VesselForm = { vesselName: "", imoNumber: "" };
const serviceDefaults: ServiceForm = { serviceName: "", tradeLane: "", visibility: Visibility.PRIVATE, listingStatus: ListingStatus.DRAFT, notes: "" };
const sailingDefaults: SailingForm = {
  linerVesselId: "", voyageReference: "", departureAt: "", cargoCutoffAt: "", visibility: Visibility.PRIVATE, listingStatus: ListingStatus.DRAFT,
  portRotation: [{ locationId: "", sequence: 1, estimatedArrival: "", estimatedDeparture: "" }, { locationId: "", sequence: 2, estimatedArrival: "", estimatedDeparture: "" }],
  commercialCapacity: { availableCommercialTonnes: 0 as never, maximumPieceWeightTonnes: 0 as never, maximumPieceLengthMetres: 0 as never, maximumPieceWidthMetres: 0 as never, maximumPieceHeightMetres: 0 as never, liftingCapacityTonnes: 0 as never, stowage: LinerStowage.EITHER, acceptedCargoTypes: [LinerCargoType.BREAKBULK] },
  notes: "",
};

function localDateTime(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function errorMessage(error: unknown) {
  const data = (error as { data?: { error?: unknown } } | undefined)?.data;
  return typeof data?.error === "string" ? data.error : error instanceof Error ? error.message : "The request could not be completed.";
}
function invalidateLinerQueries(client: ReturnType<typeof useQueryClient>) {
  return client.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/liner") });
}
function useAllPorts() {
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

export default function LinerServices() {
  const [activeTab, setActiveTab] = useState<"vessels" | "services">("vessels");
  const [selectedService, setSelectedService] = useState<{ id: string; name: string } | null>(null);
  const { data: company, isLoading, error } = useGetMyCompany();
  const canManage = company?.membershipRole === "OWNER" || company?.membershipRole === "ADMIN";
  if (isLoading) return <div>Loading...</div>;
  if (error) return <div role="alert" className="p-4 text-destructive border rounded-md">{errorMessage(error)}</div>;
  return <div className="space-y-6">
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"><h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><Ship className="h-8 w-8 text-primary" />Liner Services & Vessels</h1><div className="flex space-x-2 bg-muted p-1 rounded-md"><button type="button" className={`px-4 py-2 text-sm font-medium rounded-sm ${activeTab === "vessels" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => { setActiveTab("vessels"); setSelectedService(null); }}>Vessels</button><button type="button" className={`px-4 py-2 text-sm font-medium rounded-sm ${activeTab === "services" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => setActiveTab("services")}>Services & Sailings</button></div></div>
    {!canManage && <div className="p-3 text-sm text-muted-foreground border rounded-md">Your membership is read-only for liner services and vessels.</div>}
    {activeTab === "vessels" && <VesselsTab canManage={canManage} />}
    {activeTab === "services" && !selectedService && <ServicesTab canManage={canManage} onSelectService={setSelectedService} />}
    {activeTab === "services" && selectedService && <SailingsTab canManage={canManage} service={selectedService} onBack={() => setSelectedService(null)} />}
  </div>;
}

function VesselsTab({ canManage }: { canManage: boolean }) {
  const client = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const vesselsQuery = useQuery({ queryKey: [...getListMyLinerVesselsQueryKey(), "all"], queryFn: async () => {
    const items = [];
    for (let page = 1; ; page += 1) { const response = await listMyLinerVessels({ page, pageSize: 100 }); items.push(...response.items); if (items.length >= response.total) return items; }
  } });
  const create = useCreateMyLinerVessel(); const update = useUpdateMyLinerVessel();
  const form = useForm<VesselForm>({ resolver: zodResolver(vesselSchema), defaultValues: vesselDefaults });
  const submit = async (values: VesselForm) => {
    try {
      if (editingId) await update.mutateAsync({ linerVesselId: editingId, data: { vesselName: values.vesselName } });
      else await create.mutateAsync({ data: values });
      await invalidateLinerQueries(client); setShowForm(false); setEditingId(null); form.reset(vesselDefaults);
    } catch (error) { setActionError(errorMessage(error)); }
  };
  const toggle = async (id: string, active: boolean) => {
    try { await update.mutateAsync({ linerVesselId: id, data: { active: !active } }); await invalidateLinerQueries(client); }
    catch (error) { setActionError(errorMessage(error)); }
  };
  if (vesselsQuery.isLoading) return <div>Loading vessels...</div>;
  if (vesselsQuery.error) return <div role="alert" className="p-4 text-destructive border rounded-md">{errorMessage(vesselsQuery.error)}</div>;
  const vessels = vesselsQuery.data ?? [];
  return <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>My Liner Vessels</CardTitle>{canManage && <Button size="sm" onClick={() => { setActionError(null); setEditingId(null); form.reset(vesselDefaults); setShowForm(!showForm); }}>{showForm ? "Cancel" : <><Plus className="h-4 w-4 mr-1" />Add Vessel</>}</Button>}</CardHeader><CardContent>
    {actionError && <div role="alert" className="mb-4 p-3 text-sm text-destructive border rounded-md">{actionError}</div>}
    {showForm && <form onSubmit={form.handleSubmit(submit)} className="bg-muted/30 p-4 rounded-lg border mb-6 grid gap-4 sm:grid-cols-2"><Field label="Vessel name" id="vessel-name"><Input id="vessel-name" {...form.register("vesselName")} />{ErrorText(form.formState.errors.vesselName?.message)}</Field><Field label="IMO number (7 digits)" id="imo-number"><Input id="imo-number" {...form.register("imoNumber")} readOnly={!!editingId} aria-readonly={!!editingId} />{ErrorText(form.formState.errors.imoNumber?.message)}</Field><div className="col-span-full"><Button type="submit" disabled={create.isPending || update.isPending}>{editingId ? "Update vessel" : "Register vessel"}</Button></div></form>}
    {vessels.length === 0 ? <div className="text-center p-8 text-muted-foreground">No vessels registered yet.</div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Vessel name</th><th className="p-2">IMO</th><th className="p-2">Status</th>{canManage && <th className="p-2 text-right">Actions</th>}</tr></thead><tbody>{vessels.map((vessel) => <tr key={vessel.id} className="border-b"><td className="p-2 font-medium">{vessel.vesselName}</td><td className="p-2">{vessel.imoNumber}</td><td className="p-2"><Badge variant={vessel.active ? "default" : "secondary"}>{vessel.active ? "Active" : "Inactive"}</Badge></td>{canManage && <td className="p-2 text-right"><Button variant="ghost" size="sm" onClick={() => { setEditingId(vessel.id); form.reset({ vesselName: vessel.vesselName, imoNumber: vessel.imoNumber }); setShowForm(true); }}><FileEdit className="h-4 w-4" /></Button><Button variant="ghost" size="sm" disabled={update.isPending} onClick={() => toggle(vessel.id, vessel.active)}>{vessel.active ? <X className="h-4 w-4 text-destructive" /> : <CheckCircle className="h-4 w-4 text-primary" />}</Button></td>}</tr>)}</tbody></table></div>}
  </CardContent></Card>;
}

function ServicesTab({ canManage, onSelectService }: { canManage: boolean; onSelectService: (service: { id: string; name: string }) => void }) {
  const client = useQueryClient(); const [editingId, setEditingId] = useState<string | null>(null); const [showForm, setShowForm] = useState(false); const [actionError, setActionError] = useState<string | null>(null);
  const servicesQuery = useQuery({ queryKey: [...getListMyLinerServicesQueryKey(), "all"], queryFn: async () => {
    const items = [];
    for (let page = 1; ; page += 1) { const response = await listMyLinerServices({ page, pageSize: 100 }); items.push(...response.items); if (items.length >= response.total) return items; }
  } });
  const create = useCreateMyLinerService(); const update = useUpdateMyLinerService(); const withdrawMutation = useWithdrawMyLinerService();
  const form = useForm<ServiceForm>({ resolver: zodResolver(serviceSchema), defaultValues: serviceDefaults });
  const submit = async (values: ServiceForm) => { try { const notes = values.notes?.trim(); if (editingId) await update.mutateAsync({ linerServiceId: editingId, data: { ...values, notes: notes || null } }); else await create.mutateAsync({ data: { ...values, notes: notes || undefined } }); await invalidateLinerQueries(client); setEditingId(null); setShowForm(false); form.reset(serviceDefaults); } catch (error) { setActionError(errorMessage(error)); } };
  const withdraw = async (id: string) => { if (!confirm("Withdraw this service and all its sailings?")) return; try { await withdrawMutation.mutateAsync({ linerServiceId: id }); await invalidateLinerQueries(client); } catch (error) { setActionError(errorMessage(error)); } };
  if (servicesQuery.isLoading) return <div>Loading services...</div>;
  if (servicesQuery.error) return <div role="alert" className="p-4 text-destructive border rounded-md">{errorMessage(servicesQuery.error)}</div>;
  const services = servicesQuery.data ?? [];
  return <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>My Liner Services</CardTitle>{canManage && <Button size="sm" onClick={() => { setActionError(null); setEditingId(null); form.reset(serviceDefaults); setShowForm(!showForm); }}>{showForm ? "Cancel" : <><Plus className="h-4 w-4 mr-1" />Create Service</>}</Button>}</CardHeader><CardContent>
    {actionError && <div role="alert" className="mb-4 p-3 text-sm text-destructive border rounded-md">{actionError}</div>}
    {showForm && <form onSubmit={form.handleSubmit(submit)} className="bg-muted/30 p-4 rounded-lg border mb-6 grid gap-4 sm:grid-cols-2"><Field label="Service name" id="service-name"><Input id="service-name" {...form.register("serviceName")} />{ErrorText(form.formState.errors.serviceName?.message)}</Field><Field label="Trade lane" id="trade-lane"><Input id="trade-lane" {...form.register("tradeLane")} />{ErrorText(form.formState.errors.tradeLane?.message)}</Field><Field label="Visibility" id="service-visibility"><Select id="service-visibility" {...form.register("visibility")}>{Object.values(Visibility).map((value) => <option key={value} value={value}>{value.replace("_", " ")}</option>)}</Select></Field><Field label="Listing status" id="service-status"><Select id="service-status" {...form.register("listingStatus")}><option value={ListingStatus.DRAFT}>DRAFT</option><option value={ListingStatus.ACTIVE}>ACTIVE</option></Select></Field><div className="col-span-full"><Field label="Internal notes" id="service-notes"><Textarea id="service-notes" {...form.register("notes")} /></Field></div><div className="col-span-full"><Button type="submit" disabled={create.isPending || update.isPending}>{editingId ? "Update service" : "Create service"}</Button></div></form>}
    {services.length === 0 ? <div className="text-center p-8 text-muted-foreground">No services configured.</div> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{services.map((service) => <Card key={service.id} className="overflow-hidden flex flex-col"><CardHeader className="p-4 bg-muted/30 border-b pb-3"><div className="flex justify-between items-start"><CardTitle className="text-lg">{service.serviceName}</CardTitle><Badge variant={service.listingStatus === "ACTIVE" ? "default" : "secondary"}>{service.listingStatus}</Badge></div><div className="text-sm text-muted-foreground mt-1 flex items-center gap-1"><Navigation className="h-3 w-3" />{service.tradeLane}</div></CardHeader><CardContent className="p-4 flex-1 flex justify-between items-end gap-2"><span className="text-sm">{service.visibility.replace("_", " ")}</span><div className="flex gap-1">{canManage && service.listingStatus !== "WITHDRAWN" && <><Button variant="ghost" size="sm" onClick={() => { setEditingId(service.id); form.reset({ serviceName: service.serviceName, tradeLane: service.tradeLane, visibility: service.visibility, listingStatus: service.listingStatus, notes: service.notes ?? "" }); setShowForm(true); }}>Edit</Button>{service.listingStatus === "ACTIVE" && <Button variant="ghost" size="sm" className="text-destructive" disabled={withdrawMutation.isPending} onClick={() => withdraw(service.id)}>Withdraw</Button>}</>}<Button size="sm" onClick={() => onSelectService({ id: service.id, name: service.serviceName })}>Sailings <ArrowRight className="h-4 w-4 ml-1" /></Button></div></CardContent></Card>)}</div>}
  </CardContent></Card>;
}

function SailingsTab({ canManage, service, onBack }: { canManage: boolean; service: { id: string; name: string }; onBack: () => void }) {
  const client = useQueryClient(); const [editingId, setEditingId] = useState<string | null>(null); const [showForm, setShowForm] = useState(false); const [actionError, setActionError] = useState<string | null>(null); const [originalDates, setOriginalDates] = useState<Record<string, string>>({});
  const sailingsQuery = useQuery({ queryKey: getListMyLinerSailingsQueryKey(service.id), queryFn: () => listMyLinerSailings(service.id) });
  const vesselsQuery = useQuery({ queryKey: [...getListMyLinerVesselsQueryKey(), "all-for-sailing"], queryFn: async () => { const items = []; for (let page = 1; ; page += 1) { const response = await listMyLinerVessels({ page, pageSize: 100 }); items.push(...response.items); if (items.length >= response.total) return items; } } });
  const portsQuery = useAllPorts(); const create = useCreateMyLinerSailing(); const update = useUpdateMyLinerSailing(); const withdrawMutation = useWithdrawMyLinerSailing();
  const form = useForm<SailingForm>({ resolver: zodResolver(sailingSchema), defaultValues: sailingDefaults });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "portRotation" });
  const iso = (value: string, key: string) => originalDates[key] && localDateTime(originalDates[key]) === value ? originalDates[key] : new Date(value).toISOString();
  const submit = async (values: SailingForm) => {
    const data = { ...values, departureAt: iso(values.departureAt, "departure"), cargoCutoffAt: iso(values.cargoCutoffAt, "cutoff"), portRotation: values.portRotation.map((port, index) => ({ ...port, estimatedArrival: iso(port.estimatedArrival, `arrival-${index}`), estimatedDeparture: iso(port.estimatedDeparture, `departure-${index}`) })) };
    const notes = values.notes?.trim();
    try { if (editingId) await update.mutateAsync({ linerSailingId: editingId, data: { ...data, notes: notes || null } }); else await create.mutateAsync({ linerServiceId: service.id, data: { ...data, notes: notes || undefined } }); await invalidateLinerQueries(client); setEditingId(null); setShowForm(false); setOriginalDates({}); form.reset(sailingDefaults); } catch (error) { setActionError(errorMessage(error)); }
  };
  const edit = (sailing: Awaited<ReturnType<typeof listMyLinerSailings>>["items"][number]) => {
    const dates: Record<string, string> = { departure: sailing.departureAt, cutoff: sailing.cargoCutoffAt };
    sailing.portRotation.forEach((port, index) => { dates[`arrival-${index}`] = port.estimatedArrival; dates[`departure-${index}`] = port.estimatedDeparture; });
    setEditingId(sailing.id); setOriginalDates(dates); form.reset({ linerVesselId: sailing.linerVesselId, voyageReference: sailing.voyageReference, departureAt: localDateTime(sailing.departureAt), cargoCutoffAt: localDateTime(sailing.cargoCutoffAt), visibility: sailing.visibility, listingStatus: sailing.listingStatus, portRotation: sailing.portRotation.map((port) => ({ ...port, estimatedArrival: localDateTime(port.estimatedArrival), estimatedDeparture: localDateTime(port.estimatedDeparture) })), commercialCapacity: sailing.commercialCapacity, notes: sailing.notes ?? "" }); setShowForm(true);
  };
  const withdraw = async (id: string) => { if (!confirm("Withdraw this sailing?")) return; try { await withdrawMutation.mutateAsync({ linerSailingId: id }); await invalidateLinerQueries(client); } catch (error) { setActionError(errorMessage(error)); } };
  const queryError = sailingsQuery.error || vesselsQuery.error || portsQuery.error;
  if (sailingsQuery.isLoading || vesselsQuery.isLoading || portsQuery.isLoading) return <div>Loading sailings...</div>;
  if (queryError) return <div role="alert" className="p-4 text-destructive border rounded-md">{errorMessage(queryError)}</div>;
  const sailings = sailingsQuery.data?.items ?? []; const vessels = vesselsQuery.data ?? []; const activeVessels = vessels.filter((vessel) => vessel.active); const ports = portsQuery.data ?? [];
  return <Card><CardHeader className="flex flex-row items-center gap-4"><Button variant="outline" size="sm" onClick={onBack}>← Back</Button><CardTitle className="flex-1">Sailings — {service.name}</CardTitle>{canManage && <Button size="sm" onClick={() => { setActionError(null); setEditingId(null); setOriginalDates({}); form.reset(sailingDefaults); setShowForm(!showForm); }}>{showForm ? "Cancel" : <><Plus className="h-4 w-4 mr-1" />New Sailing</>}</Button>}</CardHeader><CardContent className="pt-6">
    {actionError && <div role="alert" className="mb-4 p-3 text-sm text-destructive border rounded-md">{actionError}</div>}
    {showForm && <SailingFormView form={form} fields={fields} append={append} remove={remove} vessels={activeVessels} ports={ports} pending={create.isPending || update.isPending} editing={!!editingId} onSubmit={submit} />}
    {sailings.length === 0 ? <div className="text-center p-8 text-muted-foreground">No sailings configured for {service.name}.</div> : <div className="space-y-4">{sailings.map((sailing) => <Card key={sailing.id}><CardContent className="p-4"><div className="flex justify-between gap-3"><div><Badge variant="outline">{sailing.voyageReference}</Badge><h4 className="font-semibold mt-2">{vessels.find((vessel) => vessel.id === sailing.linerVesselId)?.vesselName ?? "Unknown vessel"}</h4><p className="text-sm text-muted-foreground">Departure: {new Date(sailing.departureAt).toLocaleString()} · Cut-off: {new Date(sailing.cargoCutoffAt).toLocaleString()}</p></div><Badge variant={sailing.listingStatus === "ACTIVE" ? "default" : "secondary"}>{sailing.listingStatus}</Badge></div><div className="mt-3 text-sm"><strong>Port rotation:</strong> {sailing.portRotation.slice().sort((a, b) => a.sequence - b.sequence).map((port) => ports.find((candidate) => candidate.id === port.locationId)?.name ?? "Unknown port").join(" → ")}</div>{canManage && sailing.listingStatus !== "WITHDRAWN" && <div className="flex justify-end gap-2 pt-3 mt-3 border-t"><Button variant="outline" size="sm" onClick={() => edit(sailing)}>Edit</Button>{sailing.listingStatus === "ACTIVE" && <Button variant="outline" size="sm" className="text-destructive" disabled={withdrawMutation.isPending} onClick={() => withdraw(sailing.id)}>Withdraw</Button>}</div>}</CardContent></Card>)}</div>}
  </CardContent></Card>;
}

function SailingFormView({ form, fields, append, remove, vessels, ports, pending, editing, onSubmit }: { form: ReturnType<typeof useForm<SailingForm>>; fields: ReturnType<typeof useFieldArray<SailingForm, "portRotation">>["fields"]; append: ReturnType<typeof useFieldArray<SailingForm, "portRotation">>["append"]; remove: ReturnType<typeof useFieldArray<SailingForm, "portRotation">>["remove"]; vessels: Awaited<ReturnType<typeof listMyLinerVessels>>["items"]; ports: Awaited<ReturnType<typeof listLocations>>["items"]; pending: boolean; editing: boolean; onSubmit: (values: SailingForm) => Promise<void> }) {
  return <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 border rounded-lg p-4 mb-8"><div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3"><Field label="Vessel" id="sailing-vessel"><Select id="sailing-vessel" {...form.register("linerVesselId")}><option value="">Select vessel</option>{vessels.map((vessel) => <option key={vessel.id} value={vessel.id}>{vessel.vesselName} ({vessel.imoNumber})</option>)}</Select>{ErrorText(form.formState.errors.linerVesselId?.message)}</Field><Field label="Voyage reference" id="voyage-reference"><Input id="voyage-reference" {...form.register("voyageReference")} /></Field><Field label="Departure at" id="departure-at"><Input id="departure-at" type="datetime-local" step="1" {...form.register("departureAt")} /></Field><Field label="Cargo cut-off" id="cargo-cutoff"><Input id="cargo-cutoff" type="datetime-local" step="1" {...form.register("cargoCutoffAt")} />{ErrorText(form.formState.errors.cargoCutoffAt?.message)}</Field><Field label="Visibility" id="sailing-visibility"><Select id="sailing-visibility" {...form.register("visibility")}>{Object.values(Visibility).map((value) => <option key={value} value={value}>{value.replace("_", " ")}</option>)}</Select></Field><Field label="Listing status" id="sailing-status"><Select id="sailing-status" {...form.register("listingStatus")}><option value={ListingStatus.DRAFT}>DRAFT</option><option value={ListingStatus.ACTIVE}>ACTIVE</option></Select></Field></div>
    <section className="space-y-3"><div className="flex justify-between items-center"><h3 className="font-semibold">Port rotation</h3><Button type="button" size="sm" variant="outline" onClick={() => append({ locationId: "", sequence: fields.length + 1, estimatedArrival: "", estimatedDeparture: "" })}>Add port call</Button></div>{fields.map((field, index) => <div key={field.id} className="grid gap-3 sm:grid-cols-4 items-end border p-3 rounded"><Field label={`Port ${index + 1}`} id={`port-${index}`}><Select id={`port-${index}`} {...form.register(`portRotation.${index}.locationId`)}><option value="">Select port</option>{ports.map((port) => <option key={port.id} value={port.id}>{port.name}</option>)}</Select></Field><Field label="ETA" id={`eta-${index}`}><Input id={`eta-${index}`} type="datetime-local" step="1" {...form.register(`portRotation.${index}.estimatedArrival`)} /></Field><Field label="ETD" id={`etd-${index}`}><Input id={`etd-${index}`} type="datetime-local" step="1" {...form.register(`portRotation.${index}.estimatedDeparture`)} />{ErrorText(form.formState.errors.portRotation?.[index]?.estimatedDeparture?.message)}</Field><Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => remove(index)} aria-label={`Remove port ${index + 1}`}><Trash2 className="h-4 w-4" /></Button></div>)}{ErrorText(form.formState.errors.portRotation?.message)}</section>
    <section className="grid gap-4 sm:grid-cols-2 md:grid-cols-3"><h3 className="col-span-full font-semibold">Commercial capacity</h3><CapacityField form={form} name="availableCommercialTonnes" label="Available tonnes" /><CapacityField form={form} name="liftingCapacityTonnes" label="Lifting capacity (t)" /><CapacityField form={form} name="maximumPieceWeightTonnes" label="Maximum piece weight (t)" /><CapacityField form={form} name="maximumPieceLengthMetres" label="Maximum length (m)" /><CapacityField form={form} name="maximumPieceWidthMetres" label="Maximum width (m)" /><CapacityField form={form} name="maximumPieceHeightMetres" label="Maximum height (m)" /><Field label="Stowage" id="sailing-stowage"><Select id="sailing-stowage" {...form.register("commercialCapacity.stowage")}>{Object.values(LinerStowage).map((value) => <option key={value} value={value}>{value}</option>)}</Select></Field><fieldset className="md:col-span-2"><legend className="text-sm font-medium mb-2">Accepted cargo types</legend><div className="flex flex-wrap gap-3">{Object.values(LinerCargoType).map((type) => <label key={type} className="flex items-center gap-1"><input type="checkbox" value={type} {...form.register("commercialCapacity.acceptedCargoTypes")} />{type.replace(/_/g, " ")}</label>)}</div>{ErrorText(form.formState.errors.commercialCapacity?.acceptedCargoTypes?.message)}</fieldset></section>
    <Field label="Internal notes" id="sailing-notes"><Textarea id="sailing-notes" {...form.register("notes")} /></Field><Button type="submit" disabled={pending}>{editing ? "Save sailing updates" : "Create sailing"}</Button>
  </form>;
}
function CapacityField({ form, name, label }: { form: ReturnType<typeof useForm<SailingForm>>; name: "availableCommercialTonnes" | "liftingCapacityTonnes" | "maximumPieceWeightTonnes" | "maximumPieceLengthMetres" | "maximumPieceWidthMetres" | "maximumPieceHeightMetres"; label: string }) {
  const id = `capacity-${name}`;
  return <Field label={label} id={id}><Input id={id} type="number" min="0.1" step="any" {...form.register(`commercialCapacity.${name}`)} /></Field>;
}
function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) { return <div className="space-y-2"><label htmlFor={id} className="text-sm font-medium leading-none">{label}</label>{children}</div>; }
function ErrorText(message?: string) { return message ? <p role="alert" className="text-xs text-destructive">{message}</p> : null; }