import React, { useState } from "react";
import { Button, Card, CardContent, Badge, Input, Label } from "@/components/ui/primitives";
import { ArrowRight, Anchor, Package, Ship as ShipIcon, Truck, Clock, Check, AlertTriangle } from "lucide-react";
import {
  type WorldCargo,
  type WorldDeparture,
  type WorldMode,
  type WorldOffer,
  type WorldProjection,
  type WorldState,
  confirmRoadAvailability,
  discoverWorld,
  evaluateWorldDeparture,
  evaluateWorldOffer,
  flagRoadAvailability,
  publishAsset,
  publishCargo,
  publishDeparture,
  publishOffer,
  withdrawAsset,
  withdrawCargo,
  withdrawDeparture,
  withdrawOffer,
  worldPermissions,
} from "../world";

interface Props {
  state: WorldState;
  activeUserId: string;
  updateState: (s: WorldState) => void;
  now: Date;
  onEdit: (id: string, type: "CARGO" | "OFFER" | "DEPARTURE" | "ASSET") => void;
  onViewMatches: (id: string) => void;
}

const modes: WorldMode[] = ["INLAND", "DEEPSEA", "LINER", "ROAD"];

const modeLabel: Record<WorldMode, string> = {
  INLAND: "Binnenvaart",
  DEEPSEA: "Deepsea",
  LINER: "Lijndienst",
  ROAD: "Wegtransport",
};

const publicExplanation: Record<string, string> = {
  temperature_capability_overclaimed: "De opgegeven koelcapaciteit is niet onderbouwd door het geregistreerde voertuigprofiel.",
  temperature_incompatible: "Het geregistreerde temperatuurbereik voldoet niet aan de ladingseis.",
  insufficient_capacity: "De aangeboden capaciteit is te klein voor deze lading.",
  insufficient_tonnage: "De openbare capaciteitsband is te klein voor deze openbare vraag.",
  insufficient_cargo_tonnage: "De openbare capaciteitsband past niet bij de gevraagde hoeveelheid.",
  cargo_incompatible: "Het openbare ladingstype past niet bij de gepubliceerde compatibiliteit.",
  mode_incompatible: "Deze kans hoort bij een andere vervoersmodus.",
  rotation_does_not_serve_ready_origin_before_destination: "De gepubliceerde dienstregeling bedient deze openbare route niet op tijd.",
  cutoff_or_readiness_incompatible: "De openbare tijdvensters sluiten niet op elkaar aan.",
  equipment_incompatible: "De openbaar opgegeven uitrustingscategorie sluit niet aan.",
  insufficient_road_dimensions: "De openbare ruimtecategorie sluit niet aan.",
  direction_incompatible: "De gepubliceerde richting sluit niet aan.",
  outside_positioning_distance: "De positie ligt buiten de openbare positioneringsgrens.",
  laycan_incompatible_with_positioning: "De handmatig opgegeven beschikbaarheid valt buiten het laadvenster.",
  not_discoverable: "Deze kans is niet langer openbaar beschikbaar.",
};

const reasonText = (reason?: string) =>
  (reason && publicExplanation[reason]) || "Deze openbare kans voldoet niet aan een compatibiliteitsvoorwaarde.";

function statusBadge(status: string) {
  switch (status) {
    case "ACTIVE":
      return <Badge className="bg-green-100 text-green-800 border-green-200">Gepubliceerd</Badge>;
    case "DRAFT":
      return <Badge variant="outline" className="text-muted-foreground">Concept</Badge>;
    case "WITHDRAWN":
    case "CLOSED":
      return <Badge variant="secondary">Ingetrokken</Badge>;
    case "EXPIRED":
      return <Badge variant="destructive">Verlopen</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function listingKindIcon(kind: WorldProjection["kind"]) {
  return kind === "CARGO" ? <Package className="w-5 h-5" /> : kind === "DEPARTURE" ? <Anchor className="w-5 h-5" /> : <ShipIcon className="w-5 h-5" />;
}

/**
 * The driver screen intentionally does not render cargo, counterparties, or
 * commercial capacity. It only exposes the operational acknowledgement that
 * the road pilot gives to the assigned driver.
 */
function DriverOverview({ state, activeUserId, updateState, now }: Pick<Props, "state" | "activeUserId" | "updateState" | "now">) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const asset = state.assets.find((item) => item.assignedDriverId === activeUserId && item.mode === "ROAD");
  const operationalOffers = asset
    ? state.offers.filter((item) => item.mode === "ROAD" && item.assetId === asset.id && item.listingStatus === "ACTIVE" && Boolean(item.roadAvailability))
    : [];
  const evidence = state.operationalEvidence
    .filter((item) => item.driverUserId === activeUserId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  const confirm = (offerId: string, flagged: boolean) => {
    setError("");
    const next = structuredClone(state);
    const result = flagged
      ? flagRoadAvailability(next, activeUserId, offerId, note, now)
      : confirmRoadAvailability(next, activeUserId, offerId, note, now);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    updateState(next);
    setNote("");
  };

  return (
    <div className="space-y-6" data-testid="driver-operational-overview">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Mijn operationele beschikbaarheid</h2>
        <p className="text-sm text-muted-foreground mt-1">Alleen voor uw toegewezen voertuig. Commerciële lading- en klantgegevens zijn hier niet zichtbaar.</p>
      </div>
      {error && <div role="alert" className="p-3 bg-destructive/10 text-destructive text-sm rounded-md">{error}</div>}
      {!asset && <p className="text-muted-foreground">Er is geen wegvoertuig aan uw profiel toegewezen.</p>}
      {asset && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="bg-blue-100 p-3 rounded-full text-blue-700"><Truck className="w-5 h-5" /></div>
              <div><h3 className="font-medium">{asset.name}</h3><p className="text-xs text-muted-foreground">Toegewezen voertuig</p></div>
            </div>
            {operationalOffers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Er staat geen actieve operationele beschikbaarheid klaar om te bevestigen.</p>
            ) : operationalOffers.map((offer, index) => {
              const saved = evidence.find((item) => item.offerId === offer.id);
              return (
                <div key={offer.id} className="border rounded-md p-4 space-y-3" data-testid={`driver-offer-${index + 1}`}>
                  <div className="flex justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">Beschikbaarheid {index + 1}</div>
                      <p className="text-xs text-muted-foreground">Verwacht beschikbaar: {offer.roadAvailability?.expectedAvailabilityAt.slice(0, 16).replace("T", " ")}</p>
                    </div>
                    {saved && <Badge variant="outline">{saved.status === "CONFIRMED" ? "Bevestigd" : "Gemarkeerd"}</Badge>}
                  </div>
                  {saved ? (
                    <p className="text-sm bg-muted rounded p-3">
                      <Check className="inline w-4 h-4 mr-1 text-green-700" />
                      Vastgelegd op {saved.createdAt.slice(0, 16).replace("T", " ")}{saved.note ? ` — ${saved.note}` : ""}.
                    </p>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <Label htmlFor={`driver-note-${offer.id}`}>Korte operationele notitie (optioneel)</Label>
                        <Input id={`driver-note-${offer.id}`} value={note} maxLength={240} onChange={(event) => setNote(event.target.value)} placeholder="Bijv. voertuig leeg en gecontroleerd" />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => confirm(offer.id, false)}>Beschikbaarheid bevestigen</Button>
                        <Button size="sm" variant="outline" onClick={() => confirm(offer.id, true)}>Afwijking markeren</Button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-5">
          <h3 className="font-medium mb-2">Opgeslagen operationele meldingen</h3>
          {evidence.length ? <ul className="space-y-2 text-sm">{evidence.map((item) => <li key={item.id} className="border rounded p-3"><strong>{item.status === "CONFIRMED" ? "Bevestigd" : "Gemarkeerd"}</strong> · {item.createdAt.slice(0, 16).replace("T", " ")}{item.note ? ` · ${item.note}` : ""}</li>)}</ul> : <p className="text-sm text-muted-foreground">Nog geen meldingen opgeslagen.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

export function DemoOverview({ state, activeUserId, updateState, now, onEdit, onViewMatches }: Props) {
  const permissions = worldPermissions(state, activeUserId);
  const user = state.users.find((item) => item.id === activeUserId);
  const companyId = user?.companyId;
  const publicListings = discoverWorld(state, now);
  const ownCargos = state.cargos.filter((item) => item.companyId === companyId);
  const ownOffers = state.offers.filter((item) => item.companyId === companyId);
  const ownDepartures = state.departures.filter((item) => item.companyId === companyId);
  const ownAssets = state.assets.filter((item) => item.companyId === companyId);
  const ownListingIds = new Set([...ownCargos, ...ownOffers, ...ownDepartures].map((item) => item.id));
  const marketListings = publicListings.filter((item) => !ownListingIds.has(item.id));

  const activeMatchesCount = (entityId: string) => state.matches.filter((item) =>
    (item.cargoId === entityId || item.offerId === entityId || item.departureId === entityId)
    && !["REJECTED", "WITHDRAWN", "STALE"].includes(item.status),
  ).length;

  const changeAssetActivity = (assetId: string, active: boolean) => {
    const next = structuredClone(state);
    if (!permissions.canCreateAsset) return;
    const result = active
      ? publishAsset(next, activeUserId, assetId, now)
      : withdrawAsset(next, activeUserId, assetId, now);
    if (!result.ok) return;
    updateState(next);
  };

  const updateListingStatus = (kind: "CARGO" | "OFFER" | "DEPARTURE", id: string, publish: boolean) => {
    const next = structuredClone(state);
    const result = kind === "CARGO"
      ? publishCargo(next, activeUserId, id, now)
      : kind === "OFFER"
        ? publishOffer(next, activeUserId, id, now)
        : publishDeparture(next, activeUserId, id, now);
    if (!result.ok) return;
    updateState(next);
  };

  const withdrawListing = (kind: "CARGO" | "OFFER" | "DEPARTURE", id: string) => {
    const next = structuredClone(state);
    const result = kind === "CARGO"
      ? withdrawCargo(next, activeUserId, id, now)
      : kind === "OFFER"
        ? withdrawOffer(next, activeUserId, id, now)
        : withdrawDeparture(next, activeUserId, id, now);
    if (!result.ok) return;
    updateState(next);
  };

  if (permissions.isRoadDriver) return <DriverOverview state={state} activeUserId={activeUserId} updateState={updateState} now={now} />;

  const marketIds = new Set(publicListings.map((item) => item.id));
  const publicCargos = state.cargos.filter((item) => marketIds.has(item.id));
  const publicOffers = state.offers.filter((item) => marketIds.has(item.id));
  const publicDepartures = state.departures.filter((item) => marketIds.has(item.id));
  const publicInsights = modes.map((mode) => {
    const cargoes = publicCargos.filter((item) => item.mode === mode);
    const counterparts = mode === "LINER" ? publicDepartures : publicOffers.filter((item) => item.mode === mode);
    const evaluations = cargoes.flatMap((cargo) => counterparts
      .filter((candidate) => candidate.companyId !== cargo.companyId)
      .map((candidate) => (
        mode === "LINER"
          ? evaluateWorldDeparture(cargo, candidate as WorldDeparture, state, now)
          : evaluateWorldOffer(cargo, candidate as WorldOffer, state, now)
      )));
    return { mode, positive: evaluations.find((item) => item.eligible), unsuitable: evaluations.find((item) => !item.eligible) };
  }).filter((item) => item.positive || item.unsuitable);

  const ListingActions = ({ id, kind, status, editable }: { id: string; kind: "CARGO" | "OFFER" | "DEPARTURE"; status: string; editable: boolean }) => (
    <div className="flex flex-wrap items-center gap-2">
      {statusBadge(status)}
      {status !== "DRAFT" && <Badge variant="outline">{activeMatchesCount(id)} matches</Badge>}
      {editable && <Button variant="ghost" size="sm" onClick={() => onEdit(id, kind)}>Bewerk</Button>}
      {status === "DRAFT" && <Button size="sm" onClick={() => updateListingStatus(kind, id, true)}>Publiceer</Button>}
      {status === "ACTIVE" && <Button variant="outline" size="sm" onClick={() => withdrawListing(kind, id)}>Trek in</Button>}
      <Button size="sm" variant="outline" onClick={() => onViewMatches(id)}>Matches</Button>
    </div>
  );

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center justify-between mb-4"><h2 className="text-2xl font-semibold tracking-tight">Mijn aanbod, vraag en assets</h2></div>
        <div className="grid gap-4">
          {ownCargos.map((cargo) => (
            <Card key={cargo.id} data-testid={`own-cargo-${cargo.id}`}>
              <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4"><div className="bg-primary/10 p-3 rounded-full text-primary"><Package className="w-5 h-5" /></div><div><div className="font-semibold">{cargo.name}</div><div className="font-medium">{cargo.origin.name} <ArrowRight className="inline w-4 h-4" /> {cargo.destination.name}</div><div className="text-sm text-muted-foreground">{modeLabel[cargo.mode]} · {cargo.weightTonnes}t {cargo.cargoType} · {cargo.readyFrom.slice(0, 10)}</div></div></div>
                <ListingActions id={cargo.id} kind="CARGO" status={cargo.listingStatus} editable={permissions.canCreateCargo} />
              </CardContent>
            </Card>
          ))}
          {ownOffers.map((offer) => {
            const asset = state.assets.find((item) => item.id === offer.assetId);
            return <Card key={offer.id} data-testid={`own-offer-${offer.id}`}><CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4"><div className="flex items-center gap-4"><div className="bg-blue-100 p-3 rounded-full text-blue-600"><ShipIcon className="w-5 h-5" /></div><div><div className="font-medium">{asset?.name ?? "Onbekend asset"} <span className="font-normal text-muted-foreground">({offer.location.name})</span></div><div className="text-sm text-muted-foreground">{modeLabel[offer.mode]} · {offer.capacityTonnes}t · beschikbaar {offer.availableFrom.slice(0, 10)}</div></div></div><ListingActions id={offer.id} kind="OFFER" status={offer.listingStatus} editable={permissions.canCreateOffer} /></CardContent></Card>;
          })}
          {ownDepartures.map((departure) => (
            <Card key={departure.id} data-testid={`own-departure-${departure.id}`}><CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4"><div className="flex items-center gap-4"><div className="bg-indigo-100 p-3 rounded-full text-indigo-600"><Anchor className="w-5 h-5" /></div><div><div className="font-medium">{departure.serviceName}</div><div className="text-sm text-muted-foreground">{departure.origin.name} <ArrowRight className="inline w-3 h-3" /> {departure.destination.name} · vertrek {departure.departureAt.slice(0, 10)}</div></div></div><ListingActions id={departure.id} kind="DEPARTURE" status={departure.listingStatus} editable={permissions.canManageDepartures} /></CardContent></Card>
          ))}
          {ownAssets.map((asset) => (
            <Card key={asset.id} data-testid={`own-asset-${asset.id}`}><CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4"><div className="flex items-center gap-4"><div className="bg-amber-100 p-3 rounded-full text-amber-700">{asset.mode === "ROAD" ? <Truck className="w-5 h-5" /> : <ShipIcon className="w-5 h-5" />}</div><div><div className="font-medium">{asset.name}</div><div className="text-sm text-muted-foreground">{modeLabel[asset.mode]} · {asset.type} · {asset.capacityTonnes}t</div></div></div><div className="flex flex-wrap items-center gap-2">{asset.active ? <Badge className="bg-green-100 text-green-800">Actief asset</Badge> : <Badge variant="secondary">Inactief asset</Badge>}{permissions.canCreateAsset && <><Button variant="ghost" size="sm" onClick={() => onEdit(asset.id, "ASSET")}>Bewerk</Button><Button size="sm" variant="outline" onClick={() => changeAssetActivity(asset.id, !asset.active)}>{asset.active ? "Deactiveer" : "Activeer"}</Button></>}</div></CardContent></Card>
          ))}
          {!ownCargos.length && !ownOffers.length && !ownDepartures.length && !ownAssets.length && <div className="text-center p-8 bg-card border rounded-lg text-muted-foreground text-sm">U heeft nog geen oefenrecords.</div>}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight mb-1">Marktoverzicht (anoniem)</h2>
        <p className="text-sm text-muted-foreground mb-4">Alleen onafhankelijk gepubliceerde openbare vermeldingen. Bedrijfsnamen, contacten en commerciële details blijven verborgen tot wederzijdse toestemming.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {marketListings.map((item) => (
            <Card key={item.id} className="bg-muted/30" data-testid={`public-listing-${item.id}`}>
              <CardContent className="p-4 space-y-2"><div className="flex justify-between items-start"><Badge variant="secondary" className="text-[10px]">{item.kind}</Badge><span className="text-xs text-muted-foreground">{modeLabel[item.mode]}</span></div><div className="font-medium text-sm flex items-center gap-2">{listingKindIcon(item.kind)} {item.origin} <ArrowRight className="w-3 h-3 text-muted-foreground" /> {item.destination}</div><div className="text-xs text-muted-foreground space-y-1"><div className="flex items-center gap-1"><Clock className="w-3 h-3" />{item.timeBand}</div><div className="flex items-center gap-1"><Package className="w-3 h-3" />{item.capacityBand}</div></div></CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight mb-1">Openbare compatibiliteitssignalen</h2>
        <p className="text-sm text-muted-foreground mb-4">Deze toelichting gebruikt uitsluitend openbaar gepubliceerde categorieën; het is geen boeking of routebevestiging.</p>
        <div className="grid md:grid-cols-2 gap-4">
          {publicInsights.map(({ mode, positive, unsuitable }) => <Card key={mode}><CardContent className="p-4 space-y-3"><div className="font-medium">{modeLabel[mode]}</div>{positive && <p className="text-sm text-green-800 bg-green-50 rounded p-3"><Check className="inline w-4 h-4 mr-1" />Er is een geschikte openbare kans binnen deze modus.</p>}{unsuitable && <p className="text-sm text-muted-foreground bg-muted rounded p-3"><AlertTriangle className="inline w-4 h-4 mr-1" />Niet passend: {reasonText(unsuitable.reason)}</p>}</CardContent></Card>)}
          {!publicInsights.length && <p className="text-sm text-muted-foreground">Er zijn momenteel geen openbare signalen.</p>}
        </div>
      </section>
    </div>
  );
}