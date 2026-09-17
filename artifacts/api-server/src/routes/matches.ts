import {
  ActOnMatchBody,
  ActOnMatchParams,
  ActOnMatchResponse,
  GetMyMatchParams,
  GetMyMatchResponse,
  ListMyMatchesQueryParams,
  ListMyMatchesResponse,
} from "@workspace/api-zod";
import { and, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  companyMembersTable,
  conversationsTable,
  interestsTable,
  matchesTable,
  notificationsTable,
  db,
} from "@workspace/db";

import { error, getMembershipWithin, pageParams, requireMembership } from "../lib/http";
import {
  matchDetail,
  matchSummary,
  type MatchBundle,
} from "../lib/privacy";
import {
  evaluateEligibility,
  listPairRows,
  lockDomain,
} from "../services/matching";
import { applyMatchConsent } from "../services/consent";

const router: IRouter = Router();

async function accessibleBundles(companyId: string) {
  const [matches, pairs] = await Promise.all([
    db.select().from(matchesTable),
    listPairRows(),
  ]);
  const interests = await db.select().from(interestsTable);
  const initiatedByMatch = new Map(
    interests
      .filter((interest) => interest.status === "PENDING" || interest.status === "ACCEPTED")
      .map((interest) => [interest.matchId, interest.companyId]),
  );
  const pairMap = new Map(
    pairs.map((pair) => [`${pair.cargo.id}:${pair.capacity.id}`, pair]),
  );
  return matches
    .map((match) => {
      const pair = pairMap.get(
        `${match.cargoListingId}:${match.capacityOfferId}`,
      );
      if (!pair) return null;
      if (
        pair.cargoCompany.id !== companyId &&
        pair.capacityCompany.id !== companyId
      ) {
        return null;
      }
      if (
        pair.cargo.visibility !== "OPEN_NETWORK" ||
        pair.capacity.visibility !== "OPEN_NETWORK"
      ) {
        return null;
      }
      return {
        match,
        initiatedByCompanyId: initiatedByMatch.get(match.id) ?? null,
        ...pair,
      } as MatchBundle;
    })
    .filter((bundle): bundle is MatchBundle => bundle !== null);
}

router.get("/matches", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = ListMyMatchesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    error(res, 400, "Invalid match filters");
    return;
  }
  const bundles = (await accessibleBundles(current.company.id)).filter(
    (bundle) =>
      (!bundle.match.isStale || bundle.match.status === "CONNECTED") &&
      (!parsed.data.status || bundle.match.status === parsed.data.status) &&
      (bundle.cargo.transportMode ===
        (parsed.data.transportMode ?? "INLAND_WATERWAY")),
  );
  const { page, pageSize, offset } = pageParams(
    parsed.data.page,
    parsed.data.pageSize,
  );
  res.json(
    ListMyMatchesResponse.parse({
      items: bundles
        .slice(offset, offset + pageSize)
        .map((bundle) => matchSummary(bundle, current.company.id)),
      page,
      pageSize,
      total: bundles.length,
    }),
  );
});

router.get("/matches/:matchId", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const parsed = GetMyMatchParams.safeParse(req.params);
  if (!parsed.success) {
    error(res, 400, "Invalid match id");
    return;
  }
  const bundle = (await accessibleBundles(current.company.id)).find(
    (candidate) => candidate.match.id === parsed.data.matchId,
  );
  if (!bundle || (bundle.match.isStale && bundle.match.status !== "CONNECTED")) {
    error(res, 404, "Match not found");
    return;
  }
  res.json(GetMyMatchResponse.parse(matchDetail(bundle, current.company.id)));
});

router.post("/matches/:matchId/actions", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const params = ActOnMatchParams.safeParse(req.params);
  const body = ActOnMatchBody.safeParse(req.body);
  if (!params.success || !body.success) {
    error(res, 400, "Invalid match action");
    return;
  }
  const bundle = (await accessibleBundles(current.company.id)).find(
    (candidate) => candidate.match.id === params.data.matchId,
  );
  if (!bundle) {
    error(res, 404, "Match not found");
    return;
  }
  if (bundle.match.isStale || bundle.match.status === "EXPIRED") {
    error(res, 409, "This match is stale or expired");
    return;
  }
  if (
    bundle.cargoCompany.status !== "ACTIVE" ||
    bundle.capacityCompany.status !== "ACTIVE"
  ) {
    error(res, 403, "Both companies must remain active");
    return;
  }

  let transactionBundle = bundle;
  try {
    await db.transaction(async (tx) => {
      await lockDomain(tx);
      const freshMembership = await getMembershipWithin(tx, req.user!.id, true);
      if (
        !freshMembership ||
        !freshMembership.membership.active ||
        freshMembership.company.status !== "ACTIVE" ||
        freshMembership.company.id !== current.company.id
      ) {
        throw new Error("FORBIDDEN");
      }
      const [locked] = await tx
        .select()
        .from(matchesTable)
        .where(eq(matchesTable.id, params.data.matchId))
        .for("update");
      if (!locked || locked.isStale || locked.status === "EXPIRED") {
        throw new Error("STALE_MATCH");
      }
      const [freshPair] = (await listPairRows(tx)).filter(
        (pair) =>
          pair.cargo.id === locked.cargoListingId &&
          pair.capacity.id === locked.capacityOfferId,
      );
      if (
        !freshPair ||
        !evaluateEligibility(freshPair).eligible ||
        freshPair.cargoCompany.status !== "ACTIVE" ||
        freshPair.capacityCompany.status !== "ACTIVE" ||
        (freshPair.cargoCompany.id !== current.company.id &&
          freshPair.capacityCompany.id !== current.company.id)
      ) {
        throw new Error("STALE_MATCH");
      }
      const [initiatedInterest] = await tx
        .select()
        .from(interestsTable)
        .where(
          and(
            eq(interestsTable.matchId, locked.id),
            eq(interestsTable.status, "PENDING"),
          ),
        );
      transactionBundle = {
        match: locked,
        initiatedByCompanyId: initiatedInterest?.companyId ?? null,
        ...freshPair,
      };
      await applyMatchConsent(tx, {
        match: locked,
        actorCompanyId: current.company.id,
        action: body.data.action,
        participantCompanyIds: [
          transactionBundle.cargoCompany.id,
          transactionBundle.capacityCompany.id,
        ],
        notificationDomain: "marketplace",
      });
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "";
    error(
      res,
      reason === "STALE_MATCH" ? 409 : reason === "FORBIDDEN" ? 403 : 422,
      reason === "STALE_MATCH"
        ? "This match is stale or expired"
        : reason === "FORBIDDEN"
          ? "Company membership is no longer authorized"
        : "Match action is not valid for the current state",
    );
    return;
  }

  const updated = (await accessibleBundles(current.company.id)).find(
    (candidate) => candidate.match.id === params.data.matchId,
  );
  if (!updated) {
    error(res, 500, "Match state could not be loaded");
    return;
  }
  res.json(ActOnMatchResponse.parse(matchDetail(updated, current.company.id)));
});

export default router;
