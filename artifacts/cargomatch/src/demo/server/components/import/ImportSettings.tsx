import React, { useState } from "react";
import { ImportWorkspaceProps } from "./ImportWorkspace";
import { Button, Card, CardHeader, CardTitle, CardContent, Label } from "@/components/ui/primitives";
import { ImportAction, ImportModule } from "../../import-contract";

export function ImportSettings({ control, run, busy, manager, permissions }: ImportWorkspaceProps & { run: (a: ImportAction) => Promise<void> }) {
  const allModules: { key: ImportModule; label: string; desc: string }[] = [
    { key: "SHIPMENTS", label: "Zendingen", desc: "Beheer van hoofdzendingen, routes en master/house referenties." },
    { key: "DOCUMENTS", label: "Documenten", desc: "Upload, extractie en review van documenten (invoice, packing list, etc)." },
    { key: "CUSTOMS", label: "Douane", desc: "Douaneclassificatie, mock-aangifte simulatie en goedgekeurde versies." },
    { key: "CHARGES", label: "Kosten", desc: "Landed cost regels, valuta en betalingssimulatie." },
    { key: "RELEASE", label: "Vrijgave (Gates)", desc: "Verplichte voorwaarden (pincodes, betaling) voor terminal/ophalen." },
    { key: "DELIVERY", label: "Achterland & Aflevering", desc: "Vervoerders zoeken (CargoMatch integratie) en leveringskeuzes." },
    { key: "CONTROL", label: "Control Tower", desc: "Maritieme kaart, vessel tracking en kritieke overdrachten." },
    { key: "PARTNERS", label: "Partners", desc: "LCL-ontvangersportaal en toewijzing van specifieke taken." },
    { key: "EXCEPTIONS", label: "Uitzonderingen", desc: "Beheer van incidenten, prioriteiten en taaktoewijzing." }
  ];

  const toggle = async (mod: ImportModule, enable: boolean) => {
    await run({ type: "IMPORT_CONTROL", operation: "SET_MODULE", module: mod, enabled: enable });
  };

  if (!manager) {
    return <p className="text-slate-500">Alleen de Import Manager kan modules in- of uitschakelen.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Module-instellingen</h2>
        <p className="text-slate-600 mt-1">Schakel specifieke onderdelen van de import-keten in of uit. Afhankelijkheden worden automatisch beheerd (bijv. Customs vereist Documents).</p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {allModules.map(m => {
          const active = control.modules.includes(m.key);
          return (
             <Card key={m.key} className={active ? "border-blue-200 bg-blue-50/30" : "bg-slate-50/50 opacity-75"}>
               <CardContent className="p-4 flex gap-3 items-start">
                 <input 
                   type="checkbox"
                   id={`mod-${m.key}`} 
                   checked={active} 
                   onChange={(e) => toggle(m.key, e.target.checked)} 
                   disabled={busy || !permissions.includes("IMPORT_ADMIN") || (!active && control.dependencies[m.key].some(dependency => !control.modules.includes(dependency)))}
                   className="mt-1 w-4 h-4 rounded border-slate-300"
                 />
                 <div>
                   <Label htmlFor={`mod-${m.key}`} className="font-semibold text-base cursor-pointer">
                     {m.label}
                   </Label>
                   <p className="text-xs text-slate-500 mt-1 leading-relaxed">{m.desc}</p>
                   {control.dependencies[m.key].length > 0 && <p className="text-xs text-slate-500 mt-2">Vereist: {control.dependencies[m.key].join(", ")}</p>}
                   {m.key === "SHIPMENTS" && <p className="text-[10px] text-slate-400 mt-2 font-mono">Basismodule (verplicht)</p>}
                 </div>
               </CardContent>
             </Card>
          );
        })}
      </div>
    </div>
  );
}