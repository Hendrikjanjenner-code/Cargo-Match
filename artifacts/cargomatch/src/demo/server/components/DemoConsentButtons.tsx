import React from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { consentControls } from "../consent-controls";

export function DemoConsentButtons({ controls, busy, onAction }: {
  controls: ReturnType<typeof consentControls>;
  busy: boolean;
  onAction: (type: "INTEREST" | "ACCEPT" | "DECLINE") => void;
}) {
  return <>
    {controls.waiting && <p className="text-sm text-amber-700 bg-amber-50 p-3 rounded-md border border-amber-100 w-full">Wachten op reactie van de andere partij...</p>}
    {controls.interest && <Button disabled={busy} onClick={() => onAction("INTEREST")} className="bg-green-600 hover:bg-green-700 text-white flex-1"><Check className="w-4 h-4 mr-2" />Toon interesse</Button>}
    {controls.accept && <Button disabled={busy} onClick={() => onAction("ACCEPT")} className="bg-green-600 hover:bg-green-700 text-white flex-1"><Check className="w-4 h-4 mr-2" />Accepteer verbinding</Button>}
    {controls.decline && <Button disabled={busy} variant="outline" onClick={() => onAction("DECLINE")} className="text-red-600 border-red-200 hover:bg-red-50 flex-1"><X className="w-4 h-4 mr-2" />Wijs af</Button>}
  </>;
}