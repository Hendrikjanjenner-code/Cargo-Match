import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../lib/http";
import { DemoError } from "../services/demo/types";
import { assertDocumentAccess, shipmentModules } from "../services/imports/domain";
import { withCompanyImport, importSession, mutateImport } from "../services/imports-auth/store";
import { requestImportUpload, verifyImportUpload, serveImportDocument } from "../services/importDocuments";
import { ExecuteImportActionBody, GetImportSessionResponse, RequestImportUploadBody, CompleteImportUploadBody } from "@workspace/api-zod";

const router: IRouter = Router();
function handler(run: (req: Request, res: Response, userId: string) => Promise<void>) {
  return async (req: Request, res: Response): Promise<void> => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    try { await run(req, res, userId); }
    catch (e) {
      if (e instanceof DemoError) { res.status(e.status).json({ error: e.message }); return; }
      throw e;
    }
  };
}
router.get("/import/session", handler(async (_req, res, userId) => {
  res.json(GetImportSessionResponse.parse(await withCompanyImport(userId, false, (state, actor, integration) => importSession(state, actor, integration.members))));
}));
router.post("/import/actions", handler(async (req, res, userId) => {
  const parsed = ExecuteImportActionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid import action" }); return; }
  res.json(GetImportSessionResponse.parse(await withCompanyImport(userId, true, (state, actor, integration) =>
    mutateImport(state, actor, integration, parsed.data).session)));
}));
router.post("/import/uploads/request-url", handler(async (req, res, userId) => {
  const parsed = RequestImportUploadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid upload metadata" }); return; }
  const a = parsed.data;
  res.json(await withCompanyImport(userId, false, async (state, actor) => {
    const shipment = state.shipments.find(s => s.id === a.shipmentId);
    if (!shipment || !shipmentModules(state, actor, shipment).includes("DOCUMENTS")) throw new DemoError(403, "FORBIDDEN", "No document access");
    return requestImportUpload(`company:${actor.companyId}`, shipment.id, a.name, a.mimeType, a.size);
  }));
}));
router.post("/import/uploads/complete", handler(async (req, res, userId) => {
  const parsed = CompleteImportUploadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid document metadata" }); return; }
  const a = parsed.data;
  res.json(GetImportSessionResponse.parse(await withCompanyImport(userId, true, async (state, actor, integration) => {
    const shipment = state.shipments.find(s => s.id === a.shipmentId);
    if (!shipment || !shipmentModules(state, actor, shipment).includes("DOCUMENTS")) throw new DemoError(403, "FORBIDDEN", "No document access");
    const metadata = await verifyImportUpload(`company:${actor.companyId}`, shipment.id, a.objectPath);
    if (shipment.documents.some(d => d.objectPath === metadata.objectPath)) return importSession(state, actor, integration.members);
    return mutateImport(state, actor, integration, { ...a, objectPath: metadata.objectPath, operation: "UPLOAD_DOCUMENT" }, metadata).session;
  })));
}));
router.get("/import/documents/:shipmentId/:documentId", handler(async (req, res, userId) => {
  const shipmentId = String(req.params.shipmentId), documentId = String(req.params.documentId);
  const document = await withCompanyImport(userId, false, (state, actor) => assertDocumentAccess(state, actor, shipmentId, documentId));
  await serveImportDocument(res, document);
}));
export default router;