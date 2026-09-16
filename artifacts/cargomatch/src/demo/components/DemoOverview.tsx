import React from "react";
import { format, parseISO } from "date-fns";
import { Button, Card, CardContent } from "@/components/ui/primitives";
import { MapPin, Calendar, Scale } from "lucide-react";
import { evaluateDemo, type DemoCargo, type DemoState, type DemoEvaluation } from "../model";

export function DemoOverview({ 
  state, onCreate, onEdit, onViewMatches 
}: { 
  state: DemoState,
  onCreate: () => void, onEdit: (c: DemoCargo) => void, onViewMatches: (c: DemoCargo) => void 
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Mijn Ladingen</h2>
        <Button onClick={onCreate}>Nieuwe lading</Button>
      </div>

      <div className="grid gap-4">
        {state.cargos.map(cargo => {
          const report = evaluateDemo(state, cargo.id);
          const matchesCount = report?.matches?.length || 0;

          return (
            <Card key={cargo.id} className="hover:border-primary/50 transition-colors">
              <CardContent className="p-0">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-medium text-lg">
                      {cargo.origin} <span className="text-muted-foreground">→</span> {cargo.destination}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Scale className="w-4 h-4" /> {cargo.weightTonnes || cargo.weight} ton
                      </div>
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" /> {format(parseISO(cargo.loadingFrom || cargo.startDate), "dd-MM-yyyy")}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <div className="text-sm text-right hidden sm:block">
                      <div className="font-semibold text-primary">{matchesCount} schepen</div>
                      <div className="text-muted-foreground text-xs">beschikbaar</div>
                    </div>
                    <Button variant="outline" onClick={() => onEdit(cargo)}>Wijzig</Button>
                    <Button onClick={() => onViewMatches(cargo)}>Bekijk matches</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {state.cargos.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              Geen ladingen gevonden. Maak er een aan om te beginnen.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
