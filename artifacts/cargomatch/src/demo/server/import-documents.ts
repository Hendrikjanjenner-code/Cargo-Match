import type { DemoSession } from "./api";

export async function uploadImportDocument(file: File, shipmentId: string, documentType: string, session?: DemoSession) {
  const base = session ? "/api/demo/import" : "/api/import";
  const headers: Record<string, string> = {"Content-Type": "application/json"};
  if (session) Object.assign(headers, {"X-Demo-Request": "1", "X-Demo-CSRF": session.csrfToken, "X-Demo-Revision": String(session.revision)});
  const post = async (path: string, data: unknown) => {
    const response = await fetch(`${base}${path}`, {method: "POST", credentials: "same-origin", headers, body: JSON.stringify(data)});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Documentupload mislukt.");
    return body;
  };
  if (file.size > 2097152 || file.size === 0) throw new Error("Kies een bestand van maximaal 2 MB.");
  const {uploadURL, objectPath} = await post("/uploads/request-url", {shipmentId, name: file.name, mimeType: file.type || "text/plain", size: file.size});
  const uploaded = await fetch(uploadURL, {method: "PUT", headers: {"Content-Type": file.type || "text/plain"}, body: file});
  if (!uploaded.ok) throw new Error("Opslag heeft het bestand niet geaccepteerd.");
  await post("/uploads/complete", {shipmentId, documentType, objectPath});
}

export function importDocumentUrl(shipmentId: string, documentId: string, demo = true) {
  return `${demo ? "/api/demo/import" : "/api/import"}/documents/${encodeURIComponent(shipmentId)}/${encodeURIComponent(documentId)}`;
}