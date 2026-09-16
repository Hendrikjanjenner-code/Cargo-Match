import {
  DeleteMyVesselAisIdentityParams,
  ListMyVesselAisIdentitiesParams,
  ListMyVesselAisIdentitiesResponse,
  RegisterMyVesselAisIdentityBody,
  RegisterMyVesselAisIdentityParams,
  RegisterMyVesselAisIdentityResponse,
  UpdateMyVesselAisIdentityBody,
  UpdateMyVesselAisIdentityParams,
  UpdateMyVesselAisIdentityResponse,
} from "@workspace/api-zod";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";

import { db, vesselsTable } from "@workspace/db";

import { error, requireMembership } from "../lib/http";
import {
  AisIdentityError,
  deleteAisIdentity,
  listAisIdentities,
  registerAisIdentity,
  updateAisIdentity,
} from "../services/aisIdentity";

const router: IRouter = Router();

function noStore(res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Cookie, Authorization");
}

async function ownedVessel(companyId: string, vesselId: string) {
  const [vessel] = await db
    .select({ id: vesselsTable.id })
    .from(vesselsTable)
    .where(
      and(eq(vesselsTable.id, vesselId), eq(vesselsTable.companyId, companyId)),
    )
    .limit(1);
  return vessel;
}

function identityError(res: any, identity: unknown) {
  if (!(identity instanceof AisIdentityError)) {
    error(res, 500, "AIS identity operation failed");
    return;
  }
  if (identity.code === "IDENTITY_CONFLICT") {
    res.status(409).json({
      error: "AIS identifier conflict",
      code: identity.code,
    });
    return;
  }
  if (
    identity.code === "VESSEL_NOT_FOUND" ||
    identity.code === "IDENTITY_NOT_FOUND"
  ) {
    error(res, 404, "Vessel or AIS identity not found");
    return;
  }
  if (identity.code === "MUTATION_FORBIDDEN") {
    error(res, 403, "Company membership is no longer authorized");
    return;
  }
  if (identity.code === "INVALID_IDENTITY") {
    error(res, 400, identity.message);
    return;
  }
  error(res, 500, "AIS identity operation failed");
}

router.get("/vessels/:vesselId/ais-identities", async (req, res) => {
  noStore(res);
  const current = await requireMembership(req, res);
  if (!current) return;
  const params = ListMyVesselAisIdentitiesParams.safeParse(req.params);
  if (!params.success) {
    error(res, 400, "Invalid vessel id");
    return;
  }
  if (!(await ownedVessel(current.company.id, params.data.vesselId))) {
    error(res, 404, "Vessel not found");
    return;
  }
  const result = await listAisIdentities(
    current.company.id,
    params.data.vesselId,
  );
  res.json(
    ListMyVesselAisIdentitiesResponse.parse({
      items: result.items.map(identityResponse),
      conflicts: result.conflicts.map(conflictResponse),
      canManage: ["OWNER", "ADMIN"].includes(current.membership.role),
    }),
  );
});

router.post("/vessels/:vesselId/ais-identities", async (req, res) => {
  noStore(res);
  const current = await requireMembership(req, res, {
    roles: ["OWNER", "ADMIN"],
  });
  if (!current) return;
  const params = RegisterMyVesselAisIdentityParams.safeParse(req.params);
  const body = RegisterMyVesselAisIdentityBody.safeParse(req.body);
  if (!params.success || !body.success) {
    error(res, 400, "Invalid AIS identity data");
    return;
  }
  if (!(await ownedVessel(current.company.id, params.data.vesselId))) {
    error(res, 404, "Vessel not found");
    return;
  }
  try {
    const result = await registerAisIdentity({
      actorUserId: req.user!.id,
      companyId: current.company.id,
      vesselId: params.data.vesselId,
      ...body.data,
    });
    res
      .status(201)
      .json(
        RegisterMyVesselAisIdentityResponse.parse(identityResponse(result)),
      );
  } catch (identity) {
    identityError(res, identity);
  }
});

router.patch(
  "/vessels/:vesselId/ais-identities/:mappingId",
  async (req, res) => {
    noStore(res);
    const current = await requireMembership(req, res, {
      roles: ["OWNER", "ADMIN"],
    });
    if (!current) return;
    const params = UpdateMyVesselAisIdentityParams.safeParse(req.params);
    const body = UpdateMyVesselAisIdentityBody.safeParse(req.body);
    if (
      !params.success ||
      !body.success ||
      Object.keys(body.data).length === 0
    ) {
      error(res, 400, "Invalid AIS identity data");
      return;
    }
    if (!(await ownedVessel(current.company.id, params.data.vesselId))) {
      error(res, 404, "Vessel not found");
      return;
    }
    try {
      const result = await updateAisIdentity({
        actorUserId: req.user!.id,
        companyId: current.company.id,
        vesselId: params.data.vesselId,
        mappingId: params.data.mappingId,
        ...body.data,
      });
      res.json(
        UpdateMyVesselAisIdentityResponse.parse(identityResponse(result)),
      );
    } catch (identity) {
      identityError(res, identity);
    }
  },
);

router.delete(
  "/vessels/:vesselId/ais-identities/:mappingId",
  async (req, res) => {
    noStore(res);
    const current = await requireMembership(req, res, {
      roles: ["OWNER", "ADMIN"],
    });
    if (!current) return;
    const params = DeleteMyVesselAisIdentityParams.safeParse(req.params);
    if (!params.success) {
      error(res, 400, "Invalid AIS identity id");
      return;
    }
    if (!(await ownedVessel(current.company.id, params.data.vesselId))) {
      error(res, 404, "Vessel not found");
      return;
    }
    try {
      const deleted = await deleteAisIdentity({
        actorUserId: req.user!.id,
        companyId: current.company.id,
        vesselId: params.data.vesselId,
        mappingId: params.data.mappingId,
      });
      if (!deleted) {
        error(res, 404, "AIS identity not found");
        return;
      }
      res.status(204).end();
    } catch (identity) {
      identityError(res, identity);
    }
  },
);

function identityResponse(identity: {
  id: string;
  companyId: string;
  vesselId: string;
  identifierType: string;
  identifierValue: string;
  provider: string | null;
  verified: boolean;
  evidence: unknown;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: identity.id,
    companyId: identity.companyId,
    vesselId: identity.vesselId,
    identifierType: identity.identifierType,
    identifierValue: identity.identifierValue,
    provider: identity.provider,
    verified: identity.verified,
    evidence: identity.evidence,
    verifiedAt: identity.verifiedAt,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
  };
}

function conflictResponse(conflict: {
  id: string;
  vesselId: string;
  identifierType: string;
  identifierValue: string;
  provider: string | null;
  reason: string;
  status: "OPEN" | "RESOLVED";
  createdAt: Date;
}) {
  return {
    id: conflict.id,
    vesselId: conflict.vesselId,
    identifierType: conflict.identifierType,
    identifierValue: conflict.identifierValue,
    provider: conflict.provider,
    reason: conflict.reason,
    status: conflict.status,
    createdAt: conflict.createdAt,
  };
}

export default router;
