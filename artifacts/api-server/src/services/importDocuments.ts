import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { pool } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import { DemoError } from "./demo/types";

const storage = new ObjectStorageService();
const mimeTypes = new Set(["text/plain", "application/json", "application/pdf", "image/png", "image/jpeg"]);
export const MAX_IMPORT_DOCUMENT_BYTES = 2 * 1024 * 1024;
export interface VerifiedImportUpload { objectPath: string; name: string; mimeType: string; size: number }
export async function requestImportUpload(owner: string, shipmentId: string, name: string, mimeType: string, size: number) {
  if (typeof name !== "string" || !name.trim() || name.length > 180 ||
      !mimeTypes.has(mimeType) || !Number.isInteger(size) || size <= 0 || size > MAX_IMPORT_DOCUMENT_BYTES) {
    throw new DemoError(400, "INVALID_UPLOAD", "Kies een TXT, JSON, PDF, PNG of JPEG van maximaal 2 MB.");
  }
  const uploadURL = await storage.getObjectEntityUploadURL();
  const objectPath = storage.normalizeObjectEntityPath(uploadURL);
  await pool.query(`INSERT INTO import_uploads(object_path,owner_scope,shipment_id,name,mime_type,size) VALUES($1,$2,$3,$4,$5,$6)`,
    [objectPath, owner, shipmentId, name.trim(), mimeType, size]);
  return { uploadURL, objectPath };
}

/** Client supplies only an opaque path. Ownership, size and filename are server receipts,
 * not client assertions. Freeze a completed upload outside the signed PUT target so
 * a still-valid upload URL cannot alter evidence after customs approval. */
export async function verifyImportUpload(owner: string, shipmentId: string, objectPath: string): Promise<VerifiedImportUpload> {
  if (typeof objectPath !== "string" || !/^\/objects\/uploads\/[a-f0-9-]{36}$/.test(objectPath))
    throw new DemoError(403, "UPLOAD_FORBIDDEN", "Onbekende documentupload.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT * FROM import_uploads WHERE object_path=$1 AND owner_scope=$2 AND shipment_id=$3 AND expires_at>now() FOR UPDATE`, [objectPath, owner, shipmentId]);
    const row = rows[0];
    if (!row) throw new DemoError(403, "UPLOAD_FORBIDDEN", "Upload hoort niet bij deze zending of is verlopen.");
    if (!row.immutable_path) {
      const file = await storage.getObjectEntityFile(objectPath);
      const [metadata] = await file.getMetadata();
      if (Number(metadata.size) !== row.size || Number(metadata.size) > MAX_IMPORT_DOCUMENT_BYTES)
        throw new DemoError(400, "UPLOAD_SIZE", "Bestandsgrootte wijkt af van de aangevraagde upload.");
      const immutablePath = `/objects/import-documents/${randomUUID()}`;
      // The source generation prevents a concurrent signed-URL overwrite from changing
      // the bytes copied after the size check.
      const source = file.bucket.file(file.name, { generation: metadata.generation });
      const privateDir = storage.getPrivateObjectDir().replace(/\/$/, "");
      const targetName = `${privateDir.split("/").filter(Boolean).slice(1).join("/")}/${immutablePath.slice("/objects/".length)}`;
      await source.copy(file.bucket.file(targetName));
      await client.query("UPDATE import_uploads SET immutable_path=$2 WHERE object_path=$1", [objectPath, immutablePath]);
      row.immutable_path = immutablePath;
    }
    await client.query("COMMIT");
    return { objectPath: row.immutable_path, name: row.name, mimeType: row.mime_type, size: row.size };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function serveImportDocument(res: Response, document: {objectPath?: string; name: string; mimeType?: string}, fixture?: string) {
  res.set("Cache-Control", "no-store, private");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`);
  if (fixture !== undefined) { res.type("text/plain").send(fixture); return; }
  if (!document.objectPath?.startsWith("/objects/import-documents/"))
    throw new DemoError(404, "DOCUMENT_NOT_FOUND", "Geen documentbestand beschikbaar.");
  const file = await storage.getObjectEntityFile(document.objectPath);
  res.type("application/octet-stream");
  await new Promise<void>((resolve, reject) => {
    const stream = file.createReadStream();
    stream.on("error", reject);
    res.on("finish", resolve);
    res.on("close", () => { stream.destroy(); resolve(); });
    stream.pipe(res);
  });
}