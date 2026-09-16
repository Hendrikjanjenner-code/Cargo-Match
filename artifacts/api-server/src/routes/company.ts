import {
  CreateMyCompanyBody,
  CreateMyCompanyResponse,
  GetMyCompanyResponse,
  UpdateMyCompanyBody,
  UpdateMyCompanyResponse,
} from "@workspace/api-zod";
import { companyMembersTable, companiesTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";

import {
  error,
  getMembership,
  getMembershipWithin,
  requireAuth,
  requireMembership,
} from "../lib/http";
import { companyResponse } from "../lib/privacy";
import { lockDomain } from "../services/matching";

const router: IRouter = Router();

router.get("/company", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const current = await getMembership(userId);
  if (!current || !current.membership.active) {
    error(res, 404, "Company not found");
    return;
  }
  res.json(GetMyCompanyResponse.parse(companyResponse(current.company)));
});

router.post("/company", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const parsed = CreateMyCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    error(res, 400, "Invalid company data");
    return;
  }
  if (parsed.data.termsAccepted === false || parsed.data.privacyAccepted === false) {
    error(res, 400, "Terms and privacy acceptance are required");
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      await lockDomain(tx);
      if (await getMembershipWithin(tx, userId, true)) {
        return { kind: "existing-membership" as const };
      }
      const [created] = await tx
        .insert(companiesTable)
        .values({
          name: parsed.data.name,
          country: parsed.data.country.toUpperCase(),
          activities: parsed.data.activities,
          primaryContactName: parsed.data.primaryContactName,
          email: parsed.data.email,
          phone: parsed.data.phone,
          vatRegistrationNumber: parsed.data.vatRegistrationNumber,
        })
        .returning();
      await tx.insert(companyMembersTable).values({
        companyId: created.id,
        userId,
        role: "OWNER",
      });
      return { kind: "created" as const, company: created };
    });
    if (result.kind === "existing-membership") {
      error(res, 409, "User already belongs to a company");
      return;
    }
    res
      .status(201)
      .json(CreateMyCompanyResponse.parse(companyResponse(result.company)));
  } catch {
    error(res, 409, "Company could not be created");
  }
});

router.patch("/company", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const current = await requireMembership(req, res, {
    roles: ["OWNER", "ADMIN"],
    active: false,
  });
  if (!current) return;
  const parsed = UpdateMyCompanyBody.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    error(res, 400, "Invalid company data");
    return;
  }
  const result = await db.transaction(async (tx) => {
    await lockDomain(tx);
    const writeMembership = await getMembershipWithin(tx, userId, true);
    if (
      !writeMembership ||
      !writeMembership.membership.active ||
      !["OWNER", "ADMIN"].includes(writeMembership.membership.role)
    ) {
      return { kind: "forbidden" as const };
    }
    const [updated] = await tx
      .update(companiesTable)
      .set({
        ...parsed.data,
        country: parsed.data.country?.toUpperCase(),
        updatedAt: new Date(),
      })
      .where(eq(companiesTable.id, writeMembership.company.id))
      .returning();
    return updated
      ? { kind: "updated" as const, company: updated }
      : { kind: "missing" as const };
  });
  if (result.kind === "forbidden") {
    error(res, 403, "Company membership is no longer authorized");
    return;
  }
  if (result.kind === "missing") {
    error(res, 404, "Company not found");
    return;
  }
  res.json(
    UpdateMyCompanyResponse.parse(companyResponse(result.company)),
  );
});

export default router;