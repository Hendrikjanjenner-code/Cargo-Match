import {
  GetMyVesselAisParams,
  GetMyVesselAisResponse,
} from "@workspace/api-zod";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";

import { db, vesselsTable } from "@workspace/db";

import { error, requireMembership } from "../lib/http";
import { aisProviderManager } from "../services/ais";
import { getVerifiedAisIdentity } from "../services/ais/identity";

const router: IRouter = Router();

/**
 * AIS is a private enhancement to the owned-vessel view. Keep the response
 * explicitly uncacheable even for anonymous requests (requireMembership sets
 * this header after authentication has been established).
 */
router.get("/vessels/:vesselId/ais", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Cookie, Authorization");

  const current = await requireMembership(req, res);
  if (!current) return;

  const parsed = GetMyVesselAisParams.safeParse(req.params);
  if (!parsed.success) {
    error(res, 400, "Invalid vessel id");
    return;
  }

  // The tenant predicate is part of the lookup rather than a post-query
  // filter. A vessel belonging to another company is indistinguishable from
  // an unknown vessel and never reaches the AIS layer.
  const [vessel] = await db
    .select({ id: vesselsTable.id })
    .from(vesselsTable)
    .where(
      and(
        eq(vesselsTable.id, parsed.data.vesselId),
        eq(vesselsTable.companyId, current.company.id),
      ),
    );
  if (!vessel) {
    error(res, 404, "Vessel not found");
    return;
  }

  const identity = await getVerifiedAisIdentity(current.company.id, vessel.id);
  const response = await aisProviderManager.getLatestTelemetry(
    identity ?? { vesselId: vessel.id, tenantId: current.company.id },
  );
  // Provider requests can be slow. Do not disclose exact data after membership,
  // ownership, or a verified link has been withdrawn during the request.
  const latestMembership = await requireMembership(req, res);
  if (!latestMembership) return;
  if (latestMembership.company.id !== current.company.id) {
    error(res, 404, "Vessel not found");
    return;
  }
  const [stillOwned] = await db.select({ id: vesselsTable.id }).from(vesselsTable)
    .where(and(eq(vesselsTable.id, vessel.id), eq(vesselsTable.companyId, current.company.id)));
  if (!stillOwned) {
    error(res, 404, "Vessel not found");
    return;
  }
  const latestIdentity = await getVerifiedAisIdentity(current.company.id, vessel.id);
  if (identity?.mappingRevision !== latestIdentity?.mappingRevision) {
    res.json(GetMyVesselAisResponse.parse({
      ...response, status: "UNAVAILABLE", telemetry: null, cacheHit: false,
      attempts: [{ provider: "identity", outcome: "IDENTITY_REVOKED" }],
    }));
    return;
  }
  res.json(GetMyVesselAisResponse.parse(response));
});

export default router;