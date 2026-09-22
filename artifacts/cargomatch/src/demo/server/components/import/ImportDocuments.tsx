import React, { useState, useRef } from "react";
import { ImportWorkspaceProps } from "./ImportWorkspace";
import { Button, Badge, Card, CardHeader, CardTitle, CardContent, Input, Label, Select } from "@/components/ui/primitives";
import { ImportAction, ImportDocument, ImportShipmentView } from "../../import-contract";

export function ImportDocuments({ control, entityId, onNavigate, run, busy, manager, isCustoms, isReceiver, onUploadDocument, getDocumentUrl }: ImportWorkspaceProps & { run: (a: ImportAction) => Promise<void> }) {
  const [selectedShipment, setSelectedShipment] = useState<string>(entityId || "");
  const [docType, setDocType] = useState(isReceiver && !manager ? "OTHER" : "INVOICE");
  const fileInput = useRef<HTMLInputElement>(null);
  
  const handleUpload = async () => {
    if (!fileInput.current?.files?.[0] || !selectedShipment) return;
    try {
      await onUploadDocument(fileInput.current.files[0], selectedShipment, docType);
      if (fileInput.current) fileInput.current.value = "";
    } catch (e) {
      alert("Upload failed: " + e);
    }
  };

  const shipment = control.shipments.find(s => s.id === selectedShipment);
  const documents = shipment ? shipment.documents : control.shipments.flatMap(s => s.documents);

  const confirmField = async (shipmentId: string, docId: string, field: string, value: string | number) => {
    await run({ type: "IMPORT_CONTROL", operation: "CONFIRM_FIELD", shipmentId, documentId: docId, field, value });
  };
  
  const extract = async (shipmentId: string, docId: string) => {
    await run({ type: "IMPORT_CONTROL", operation: "EXTRACT_DOCUMENT", shipmentId, documentId: docId });
  };
  
  const review = async (shipmentId: string, docId: string, accepted: boolean) => {
    await run({ type: "IMPORT_CONTROL", operation: "REVIEW_DOCUMENT", shipmentId, documentId: docId, accepted });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Documenten</h2>
        <div className="flex gap-2">
          <Select value={selectedShipment} onChange={e => setSelectedShipment(e.target.value)}>
            <option value="">Alle zendingen</option>
            {control.shipments.map(s => <option key={s.id} value={s.id}>{s.reference} - {s.name}</option>)}
          </Select>
        </div>
      </div>
      
      {selectedShipment && (manager || isReceiver) && (
        <Card className="bg-slate-50">
          <CardContent className="p-4 flex gap-4 items-end">
            <div className="space-y-1">
              <Label>Type document</Label>
              <Select value={docType} onChange={e => setDocType(e.target.value)}>
                {(!isReceiver || manager) && <option value="INVOICE">Factuur</option>}
                <option value="PACKING_LIST">Paklijst</option>
                <option value="BILL_OF_LADING">Bill of Lading</option>
                <option value="ORIGIN">Oorsprongscertificaat</option>
                <option value="REPRESENTATION">Vertegenwoordigingsreview</option>
                <option value="OTHER">Overig document</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Bestand</Label>
              <Input type="file" ref={fileInput} className="bg-white" />
            </div>
            <Button onClick={handleUpload} disabled={busy}>Uploaden</Button>
          </CardContent>
        </Card>
      )}
      
      <div className="space-y-4">
        {documents.map(doc => {
          const sId = shipment ? shipment.id : control.shipments.find(s => s.documents.some(d => d.id === doc.id))?.id;
          if (!sId) return null;
          
          return (
            <Card key={doc.id}>
              <CardHeader className="py-3">
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      {doc.name}
                      <Badge variant={doc.status === "ACCEPTED" ? "default" : doc.status === "REJECTED" ? "destructive" : "secondary"}>
                        {doc.status}
                      </Badge>
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Type: {doc.type} | Versie: {doc.version}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <a href={getDocumentUrl(sId, doc.id)} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-8 px-3">
                      Download
                    </a>
                    {(manager || isCustoms) && doc.status === "PENDING" && (
                      <Button size="sm" onClick={() => extract(sId, doc.id)} disabled={busy}>Extract data</Button>
                    )}
                    {(manager || isCustoms) && doc.status === "REVIEW_REQUIRED" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => review(sId, doc.id, false)} disabled={busy}>Afkeuren</Button>
                        <Button size="sm" onClick={() => review(sId, doc.id, true)} disabled={busy}>Goedkeuren</Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              {(Object.keys(doc.fields).length > 0 || doc.proposals.length > 0) && (
                <CardContent className="pt-0 border-t">
                  <div className="grid md:grid-cols-2 gap-4 pt-3 text-sm">
                    {Object.entries(doc.fields).map(([key, val]) => (
                      <div key={key} className="flex justify-between border-b pb-1">
                        <span className="text-slate-500">{key}</span>
                        <span className="font-medium">{val}</span>
                      </div>
                    ))}
                    {doc.proposals.length > 0 && (
                      <div className="col-span-full mt-2">
                        <h4 className="font-semibold text-xs text-slate-500 mb-2 uppercase">Voorstellen (Verschillen)</h4>
                        {doc.proposals.map((prop, i) => (
                          <div key={i} className="flex justify-between items-center border-b pb-1 mb-1">
                            <div>
                              <span className="text-slate-500 mr-2">{prop.field}:</span>
                              <span className="font-bold text-amber-600">{prop.value}</span>
                              <span className="text-xs text-slate-400 ml-2">(Bron: {prop.sourceDocumentId})</span>
                            </div>
                            {(manager || isCustoms) && prop.status === "PROPOSED" && (
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => confirmField(sId, doc.id, prop.field, prop.value)}>Bevestig wijziging</Button>
                            )}
                            {prop.status === "CONFIRMED" && <Badge variant="outline" className="text-xs text-green-600">Bevestigd</Badge>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
        {documents.length === 0 && <p className="text-slate-500">Geen documenten gevonden.</p>}
      </div>
    </div>
  );
}