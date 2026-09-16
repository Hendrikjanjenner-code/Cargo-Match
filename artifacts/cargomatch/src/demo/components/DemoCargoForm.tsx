import React, { useState } from "react";
import { format, parseISO, isValid } from "date-fns";
import { 
  Button, Card, CardHeader, CardTitle, CardContent, 
  Input, Label 
} from "@/components/ui/primitives";
import {
  normalizeDemoCargo,
  type DemoCargo,
  type DemoState,
} from "../model";

const KNOWN_LOCATIONS = [
  "Dordrecht", "Duisburg", "Rotterdam", "Nijmegen", "Moerdijk", "Antwerpen"
];

function findLocation(name: string, state: DemoState) {
  const normalizedName = name.trim().toLowerCase();
  if (!normalizedName) return null;
  // Search in existing cargos
  for (const c of state.cargos) {
    if (c.loadingLocation?.name.toLowerCase() === normalizedName) return c.loadingLocation;
    if (c.destinationLocation?.name.toLowerCase() === normalizedName) return c.destinationLocation;
  }
  // Search in ships
  for (const o of state.capacityOffers) {
    if (o.location?.name.toLowerCase() === normalizedName) return o.location;
  }
  return null;
}

function dateOnly(value: string | undefined) {
  if (!value) return "";
  try {
    const parsed = parseISO(value);
    return isValid(parsed) ? format(parsed, "yyyy-MM-dd") : "";
  } catch {
    return "";
  }
}

export function DemoCargoForm({ 
  initialData, state, onSave, onCancel 
}: { 
  initialData?: DemoCargo, state: DemoState, onSave: (c: DemoCargo) => void, onCancel: () => void 
}) {
  const [formData, setFormData] = useState<Partial<DemoCargo>>(initialData || {
    id: `cargo-new-${Date.now()}`,
    origin: "",
    destination: "",
    weightTonnes: 1000,
    loadingFrom: format(new Date(), "yyyy-MM-dd"),
    loadingUntil: format(new Date(Date.now() + 86400000 * 2), "yyyy-MM-dd"),
    cargoType: "dry bulk",
    requiredVesselType: "DRY_CARGO",
  });
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.origin || !formData.destination) {
      setError("Vul herkomst en bestemming in.");
      return;
    }
    
    const locOrigin = findLocation(formData.origin, state);
    const locDest = findLocation(formData.destination, state);
    
    if (!locOrigin) {
      setError(`Onbekende herkomst in demo. Kies uit: ${KNOWN_LOCATIONS.join(", ")}`);
      return;
    }
    if (!locDest) {
      setError(`Onbekende bestemming in demo. Kies uit: ${KNOWN_LOCATIONS.join(", ")}`);
      return;
    }

    if (!formData.weightTonnes || formData.weightTonnes <= 0) {
      setError("Gewicht moet groter dan 0 zijn.");
      return;
    }
    if (!formData.loadingFrom || !formData.loadingUntil) {
      setError("Vul beide datums in.");
      return;
    }
    const start = parseISO(formData.loadingFrom);
    const end = parseISO(formData.loadingUntil);
    if (!isValid(start) || !isValid(end)) {
      setError("Ongeldige datum.");
      return;
    }
    if (end < start) {
      setError("Einddatum mag niet voor startdatum liggen.");
      return;
    }
    
    // Create new cargo based on template
    const template = state.cargos[0] || {
      id: `cargo-template-${Date.now()}`,
      origin: locOrigin.name,
      destination: locDest.name,
      weight: 1000,
      startDate: formData.loadingFrom,
      endDate: formData.loadingUntil,
    };
    let fullCargo: DemoCargo;
    try {
      fullCargo = normalizeDemoCargo({
        ...(initialData || template),
      ...formData,
      origin: locOrigin.name,
      destination: locDest.name,
        loadingLocation: locOrigin,
        destinationLocation: locDest,
        cargoType: "dry bulk",
        weight: formData.weightTonnes,
        weightTonnes: formData.weightTonnes,
        startDate: formData.loadingFrom,
        endDate: formData.loadingUntil,
      }, state);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Ongeldige lading.");
      return;
    }
    
    onSave(fullCargo);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{initialData ? "Lading wijzigen" : "Nieuwe lading toevoegen"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md">{error}</div>}
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="origin">Van (Herkomst)</Label>
              <select
                id="origin"
                value={formData.origin || ""}
                onChange={e => setFormData({...formData, origin: e.target.value})}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Kies een locatie</option>
                {KNOWN_LOCATIONS.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="destination">Naar (Bestemming)</Label>
              <select
                id="destination"
                value={formData.destination || ""}
                onChange={e => setFormData({...formData, destination: e.target.value})}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Kies een locatie</option>
                {KNOWN_LOCATIONS.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="weightTonnes">Gewicht (tonnen)</Label>
            <Input id="weightTonnes" type="number" value={formData.weightTonnes || 0} onChange={e => setFormData({...formData, weightTonnes: parseInt(e.target.value) || 0})} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="loadingFrom">Startdatum</Label>
              <Input 
                id="loadingFrom" 
                type="date" 
                 value={dateOnly(formData.loadingFrom)} 
                onChange={e => {
                   setFormData({...formData, loadingFrom: e.target.value});
                }} 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loadingUntil">Einddatum (uiterlijk)</Label>
              <Input 
                id="loadingUntil" 
                type="date" 
                 value={dateOnly(formData.loadingUntil)} 
                onChange={e => {
                   setFormData({...formData, loadingUntil: e.target.value});
                }} 
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="ghost" onClick={onCancel}>Annuleren</Button>
            <Button type="submit">Opslaan</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
