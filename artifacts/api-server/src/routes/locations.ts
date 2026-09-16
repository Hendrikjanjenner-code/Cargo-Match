import {
  ListLocationsQueryParams,
  ListLocationsResponse,
} from "@workspace/api-zod";
import { and, count, eq, ilike } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, locationsTable } from "@workspace/db";

import { error, pageParams } from "../lib/http";
import { locationResponse } from "../lib/privacy";

const router: IRouter = Router();

router.get("/locations", async (req, res) => {
  const parsed = ListLocationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    error(res, 400, "Invalid location filters");
    return;
  }
  const { page, pageSize, offset } = pageParams(
    parsed.data.page,
    parsed.data.pageSize,
  );
  const filters = [
    eq(locationsTable.active, true),
    parsed.data.country
      ? eq(locationsTable.country, parsed.data.country.toUpperCase())
      : undefined,
    parsed.data.locationType
      ? eq(locationsTable.locationType, parsed.data.locationType)
      : undefined,
    parsed.data.search
      ? ilike(locationsTable.name, `%${parsed.data.search}%`)
      : undefined,
  ].filter(Boolean);
  const where = and(...filters);
  const [items, [{ total }]] = await Promise.all([
    db.select().from(locationsTable).where(where).limit(pageSize).offset(offset),
    db.select({ total: count() }).from(locationsTable).where(where),
  ]);
  res.json(
    ListLocationsResponse.parse({
      items: items.map(locationResponse),
      page,
      pageSize,
      total,
    }),
  );
});

export default router;