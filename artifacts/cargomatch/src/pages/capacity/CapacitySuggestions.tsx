import { useState } from "react";
import { 
  useListMyAvailabilitySuggestions, useCreateAvailabilitySuggestion, useDismissAvailabilitySuggestion,
  getListMyAvailabilitySuggestionsQueryKey, getListMyCapacityQueryKey,
  useListMyVesselAisIdentities, getListMyVesselAisIdentitiesQueryKey,
   AvailabilitySuggestion, AvailabilitySuggestionStatus,
  Vessel, PublicLocation, TransportMode
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Select, Label, Card, CardContent, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, Plus, Info, Ban, ArrowRightCircle } from "lucide-react";
import { formatDateTimeInput } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { Link } from "wouter";

const suggestionSchema = z.object({
  vesselId: z.string().min(1, t("validation.vessel_required")),
  locationId: z.string().min(1, t("validation.location_required")),
  expectedAvailableFrom: z.string().min(1, t("validation.available_from_required")),
  expectedAvailableUntil: z.string().min(1, t("validation.available_until_required")),
  sourceReference: z.string().trim().min(1, "Vul de bronreferentie in.").max(300, "Gebruik maximaal 300 tekens."),
  sourceObservedAt: z.string().min(1, "Vul het tijdstip van de bron in.").refine(val => {
    const time = new Date(val).getTime();
    const now = Date.now();
    return time <= now && (now - time) <= 24 * 60 * 60 * 1000;
  }, { message: "Observation must be within the last 24 uur" }),
  participationConfirmed: z.boolean().refine(val => val === true, "Bevestig de deelname van dit schip."),
  sourceUseConfirmed: z.boolean().refine(val => val === true, "Bevestig dat u deze bron mag gebruiken."),
  uncertaintyAcknowledged: z.boolean().refine(val => val === true, "Bevestig dat de planning onzeker is."),
}).refine(data => {
  const from = new Date(data.expectedAvailableFrom).getTime();
  return from >= Date.now();
}, {
  message: "Begintijd moet in de toekomst liggen",
  path: ["expectedAvailableFrom"]
}).refine(data => {
  const from = new Date(data.expectedAvailableFrom).getTime();
  const until = new Date(data.expectedAvailableUntil).getTime();
  return until > from;
}, {
  message: "Eindtijd moet na begintijd liggen",
  path: ["expectedAvailableUntil"]
});

type SuggestionFormValues = z.infer<typeof suggestionSchema>;

interface Props {
  vessels: Vessel[];
  locations: PublicLocation[];
  onReviewSuggestion: (s: AvailabilitySuggestion) => void;
  onManualOffer: () => void;
}

export function CapacitySuggestions({ vessels, locations, onReviewSuggestion, onManualOffer }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  
  const queryClient = useQueryClient();
  
  const { data: suggestionsData, isLoading, error: suggestionsError } = useListMyAvailabilitySuggestions({ page, pageSize }, {
    query: {
      retry: false, // Don't retry so we can quickly catch 403
      staleTime: 10_000,
      refetchInterval: 30_000,
      queryKey: getListMyAvailabilitySuggestionsQueryKey({ page, pageSize })
    }
  });

  const createSuggestion = useCreateAvailabilitySuggestion();
  const dismissSuggestion = useDismissAvailabilitySuggestion();

  const { register, handleSubmit, reset, control, watch, formState: { errors } } = useForm<SuggestionFormValues>({
    resolver: zodResolver(suggestionSchema),
    defaultValues: {
      participationConfirmed: false,
      sourceUseConfirmed: false,
      uncertaintyAcknowledged: false,
    }
  });

  const selectedVesselId = watch("vesselId");

  const { data: aisIdentitiesData } = useListMyVesselAisIdentities(selectedVesselId || "", {
    query: {
       enabled: showCreate && !!selectedVesselId,
      queryKey: getListMyVesselAisIdentitiesQueryKey(selectedVesselId || "")
    }
  });

   const isVesselVerified = aisIdentitiesData?.items?.some(i => i.verified && i.verifiedAt) ?? false;
   const canManage = !!suggestionsData && !suggestionsError && !isLoading;

  const invalidateCaches = () => {
    void queryClient.invalidateQueries({ queryKey: getListMyAvailabilitySuggestionsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListMyCapacityQueryKey() });
  };

  const onSubmit = (data: SuggestionFormValues) => {
    setCreateError(null);
    if (!canManage || !isVesselVerified) {
      setCreateError("Een bevoegd account en geverifieerde scheepsidentiteit zijn vereist.");
      return;
    }
    createSuggestion.mutate({
      data: {
        vesselId: data.vesselId,
        locationId: data.locationId,
        expectedAvailableFrom: new Date(data.expectedAvailableFrom).toISOString(),
        expectedAvailableUntil: new Date(data.expectedAvailableUntil).toISOString(),
        sourceReference: data.sourceReference,
        sourceObservedAt: new Date(data.sourceObservedAt).toISOString(),
        participationConfirmed: true,
        sourceUseConfirmed: true,
        uncertaintyAcknowledged: true,
      }
    }, {
      onSuccess: () => {
        setPage(1); // Reset page on new creation
        invalidateCaches();
        setShowCreate(false);
        reset();
      },
      onError: (error: any) => {
        setCreateError(error?.message || t("error.save"));
      }
    });
  };

  const handleDismiss = (id: string) => {
    if (!confirm("Dismiss this suggestion?")) return;
    dismissSuggestion.mutate({ suggestionId: id }, {
      onSuccess: invalidateCaches,
      onError: () => alert(t("error.save"))
    });
  };

  // 403 means member role
  if (suggestionsError && (suggestionsError as any).status === 403) {
    return (
      <Card className="mb-8">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Info className="h-5 w-5" />
            <p>Alleen OWNER en ADMIN leden kunnen operationele suggesties beheren (alleen leesrechten voor dit account).</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Filter out deepsea vessels for the inland UI
  const inlandVessels = vessels.filter(v => v.transportMode === TransportMode.INLAND_WATERWAY);
  
  // Filter suggestions to inland vessels
  const suggestions = (suggestionsData?.items || []).filter(s => {
    const v = vessels.find(v => v.id === s.vesselId);
    // If we don't know the vessel or it is inland, show it.
    return !v || v.transportMode === TransportMode.INLAND_WATERWAY;
  });

  return (
    <div className="mb-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Operational Suggestions</h2>
          <p className="text-sm text-muted-foreground">Review and convert observed availability plans into commercial capacity drafts.</p>
        </div>
        <Button disabled={!canManage} onClick={() => { reset(); setCreateError(null); setShowCreate(true); }} variant="outline">
          <Plus className="h-4 w-4 mr-2" />
          Add Suggestion
        </Button>
      </div>
      <div className="rounded-md border p-3 text-sm text-muted-foreground">
        Suggesties gebruiken uitsluitend uw handmatig ingevoerde planning. Er worden geen AIS-aanroepen gedaan of providerkosten gemaakt.
        Ontbreken gegevens of is een provider uitgevallen? Het normale aanbodformulier blijft beschikbaar, ook zonder AIS-verificatie.
        <Button className="ml-2" variant="outline" size="sm" onClick={onManualOffer}>Handmatig aanbod maken</Button>
      </div>

      {suggestionsError && (suggestionsError as any).status !== 403 && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Error loading suggestions.</span>
        </div>
      )}

      {isLoading && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Loading suggestions...
          </CardContent>
        </Card>
      )}

      {!isLoading && suggestions.length === 0 && !suggestionsError && (
        <Card>
          <CardContent className="py-8 flex flex-col items-center justify-center text-center">
            <p className="text-muted-foreground">Nog geen operationele suggesties op deze pagina. Voeg een planning toe voor een geverifieerd schip of maak rechtstreeks een handmatig aanbod.</p>
          </CardContent>
        </Card>
      )}

      {suggestions.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vessel & Location</TableHead>
                <TableHead>Expected Window</TableHead>
                <TableHead>Source & Provenance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suggestions.map(s => {
                const vessel = vessels.find(v => v.id === s.vesselId)?.vesselName || "Unknown Vessel";
                const loc = locations.find(l => l.id === s.locationId)?.name || "Unknown Location";
                
                return (
                  <TableRow key={s.id} className={s.status !== AvailabilitySuggestionStatus.PENDING ? "opacity-60" : ""}>
                    <TableCell>
                      <div className="font-medium">{vessel}</div>
                      <div className="text-xs text-muted-foreground">at {loc}</div>
                    </TableCell>
    <TableCell className="text-xs">
      {formatDateTimeInput(s.expectedAvailableFrom).replace('T', ' ')} to<br/>
      {formatDateTimeInput(s.expectedAvailableUntil).replace('T', ' ')}
    </TableCell>
    <TableCell className="text-xs max-w-[200px]" title={s.sourceReference}>
      <span className="font-medium text-amber-600 mr-1">UNCERTAIN</span>
      <span className="text-muted-foreground whitespace-normal break-words">{s.sourceReference}</span>
      <div className="text-muted-foreground mt-0.5">Observed: {formatDateTimeInput(s.sourceObservedAt).replace('T', ' ')}</div>
      {s.explanation && <div className="text-muted-foreground mt-0.5 whitespace-normal break-words">{s.explanation}</div>}
      {s.unknowns && s.unknowns.length > 0 && (
        <div className="text-muted-foreground mt-0.5 text-[10px]">Unknowns: {s.unknowns.join(", ")}</div>
      )}
    </TableCell>
                    <TableCell>
                      <Badge variant={
                        s.status === AvailabilitySuggestionStatus.PENDING ? 'default' :
                        s.status === AvailabilitySuggestionStatus.CONVERTED ? 'outline' : 'secondary'
                      }>
                        {s.status}
                      </Badge>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Gen: {formatDateTimeInput(s.createdAt).replace('T', ' ')}<br/>
                        Exp: {formatDateTimeInput(s.expiresAt).replace('T', ' ')}
                      </div>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {canManage && s.canConfirm && new Date(s.expiresAt).getTime() > Date.now() && new Date(s.expectedAvailableFrom).getTime() > Date.now() && s.status === AvailabilitySuggestionStatus.PENDING && (
                        <Button variant="outline" size="sm" onClick={() => onReviewSuggestion(s)}>
                          <ArrowRightCircle className="h-4 w-4 mr-1" /> Review
                        </Button>
                      )}
                      {s.status === AvailabilitySuggestionStatus.PENDING && (
                        <Button variant="outline" size="sm" aria-label="Dismiss suggestion" disabled={!canManage || dismissSuggestion.isPending} onClick={() => handleDismiss(s.id)}>
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          
          {suggestionsData && suggestionsData.total > pageSize && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, suggestionsData.total)} of {suggestionsData.total}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
                <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * pageSize >= suggestionsData.total}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {showCreate && (
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Operational Suggestion</DialogTitle>
              <DialogDescription>
                Voer een geobserveerd operationeel plan in. Dit is geen verwachte ETA of commerciële beschikbaarheid; het is een hulpmiddel voor de planner.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="vesselId">Vessel</Label>
                  <Select id="vesselId" {...register("vesselId")}>
                    <option value="">Select vessel...</option>
                    {inlandVessels.map(v => <option key={v.id} value={v.id}>{v.vesselName}</option>)}
                  </Select>
                  {errors.vesselId && <span className="text-xs text-destructive">{errors.vesselId.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="locationId">Expected Location</Label>
                  <Select id="locationId" {...register("locationId")}>
                    <option value="">Select location...</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </Select>
                  {errors.locationId && <span className="text-xs text-destructive">{errors.locationId.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expectedAvailableFrom">Expected Available From</Label>
                  <Input id="expectedAvailableFrom" type="datetime-local" {...register("expectedAvailableFrom")} />
                  {errors.expectedAvailableFrom && <span className="text-xs text-destructive">{errors.expectedAvailableFrom.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expectedAvailableUntil">Expected Available Until</Label>
                  <Input id="expectedAvailableUntil" type="datetime-local" {...register("expectedAvailableUntil")} />
                  {errors.expectedAvailableUntil && <span className="text-xs text-destructive">{errors.expectedAvailableUntil.message}</span>}
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="sourceReference">Source Reference (max 300)</Label>
                  <Input id="sourceReference" {...register("sourceReference")} placeholder="e.g. Planning board XYZ / Port log" />
                  {errors.sourceReference && <span className="text-xs text-destructive">{errors.sourceReference.message}</span>}
                  <p className="text-[10px] text-muted-foreground mt-1">Geen provider kosten, en geen provider requests worden gemaakt. Deze functie voegt handmatige context toe.</p>
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="sourceObservedAt">Source Observed At</Label>
                  <Input id="sourceObservedAt" type="datetime-local" {...register("sourceObservedAt")} />
                  {errors.sourceObservedAt && <span className="text-xs text-destructive">{errors.sourceObservedAt.message}</span>}
                </div>
                
                <div className="col-span-2 space-y-3 pt-2">
                  <div className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                    <Controller
                      name="participationConfirmed"
                      control={control}
                      render={({ field }) => (
                        <Checkbox id="participationConfirmed" checked={field.value} onCheckedChange={field.onChange} />
                      )}
                    />
                    <div className="space-y-1 leading-none">
                      <Label htmlFor="participationConfirmed">Participation Confirmed</Label>
                      {errors.participationConfirmed && <p className="text-xs text-destructive mt-1">{errors.participationConfirmed.message}</p>}
                    </div>
                  </div>
                  
                  <div className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                    <Controller
                      name="sourceUseConfirmed"
                      control={control}
                      render={({ field }) => (
                        <Checkbox id="sourceUseConfirmed" checked={field.value} onCheckedChange={field.onChange} />
                      )}
                    />
                    <div className="space-y-1 leading-none">
                      <Label htmlFor="sourceUseConfirmed">Source Use Confirmed</Label>
                      {errors.sourceUseConfirmed && <p className="text-xs text-destructive mt-1">{errors.sourceUseConfirmed.message}</p>}
                    </div>
                  </div>
                  
                  <div className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                    <Controller
                      name="uncertaintyAcknowledged"
                      control={control}
                      render={({ field }) => (
                        <Checkbox id="uncertaintyAcknowledged" checked={field.value} onCheckedChange={field.onChange} />
                      )}
                    />
                    <div className="space-y-1 leading-none">
                      <Label htmlFor="uncertaintyAcknowledged">Acknowledge Uncertainty</Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Ik begrijp dat dit een handmatig operationeel plan is, en geen actuele ETA of toegezegde capaciteit.
                      </p>
                      {errors.uncertaintyAcknowledged && <p className="text-xs text-destructive mt-1">{errors.uncertaintyAcknowledged.message}</p>}
                    </div>
                  </div>
                </div>
              </div>

              {selectedVesselId && !isVesselVerified && (
                <div role="alert" className="flex items-start gap-2 text-sm text-destructive mt-2 p-3 border border-destructive/30 bg-destructive/10 rounded-md">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="flex flex-col">
                    <span>Voor dit schip is een geverifieerde AIS-identiteit vereist voordat operationele suggesties toegevoegd kunnen worden.</span>
                    <Link href="/vessels" className="underline mt-1 font-medium hover:text-destructive/80 transition-colors inline-block">Beheer AIS-identiteit voor schepen</Link>
                  </div>
                </div>
              )}

              {createError && (
                <div role="alert" className="flex items-start gap-2 text-sm text-destructive mt-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="flex flex-col">
                    <span>{createError}</span>
                    <Link href="/vessels" className="underline mt-1">Beheer AIS-identiteit voor schepen</Link>
                  </div>
                </div>
              )}

              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button type="submit" disabled={createSuggestion.isPending || !canManage || !isVesselVerified}>
                  {createSuggestion.isPending ? "Saving..." : "Save Suggestion"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
