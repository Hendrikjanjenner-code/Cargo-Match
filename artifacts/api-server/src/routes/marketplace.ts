import {
  ListMarketplaceQueryParams,
  ListMarketplaceResponse,
} from "@workspace/api-zod";
import { and, eq, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Router, type IRouter } from "express";
import {
  capacityOffersTable,
  cargoListingsTable,
  companiesTable,
  db,
  locationsTable,
  vesselsTable,
} from "@workspace/db";

import { error, pageParams, requireMembership } from "../lib/http";
import {
  anonymousCapacity,
  anonymousCargo,
} from "../lib/privacy";

const router: IRouter = Router();

router.get("/marketplace", async (req, res) => {
  const current = await requireMembership(req, res);
  if (!current) return;
  const query = {
    ...req.query,
    availableFrom: req.query.availableFrom
      ? new Date(String(req.query.availableFrom))
      : undefined,
  };
  const parsed = ListMarketplaceQueryParams.safeParse(query);
  if (!parsed.success) {
    error(res, 400, "Invalid marketplace filters");
    return;
  }
  const loadingLocation = alias(locationsTable, "market_loading_location");
  const destinationLocation = alias(
    locationsTable,
    "market_destination_location",
  );
  const capacityLocation = alias(locationsTable, "market_capacity_location");
  const [cargoRows, capacityRows] = await Promise.all([
    db
      .select({
        cargo: cargoListingsTable,
        loading: loadingLocation,
        destination: destinationLocation,
      })
      .from(cargoListingsTable)
      .innerJoin(
        loadingLocation,
        eq(loadingLocation.id, cargoListingsTable.loadingLocationId),
      )
      .innerJoin(
        destinationLocation,
        eq(destinationLocation.id, cargoListingsTable.destinationLocationId),
      )
      .innerJoin(
        companiesTable,
        eq(companiesTable.id, cargoListingsTable.companyId),
      )
      .where(
        and(
          eq(cargoListingsTable.listingStatus, "ACTIVE"),
          eq(cargoListingsTable.visibility, "OPEN_NETWORK"),
          eq(companiesTable.status, "ACTIVE"),
          ne(companiesTable.id, current.company.id),
        ),
      ),
    db
      .select({
        capacity: capacityOffersTable,
        vessel: vesselsTable,
        location: capacityLocation,
      })
      .from(capacityOffersTable)
      .innerJoin(vesselsTable, eq(vesselsTable.id, capacityOffersTable.vesselId))
      .innerJoin(
        capacityLocation,
        eq(capacityLocation.id, capacityOffersTable.locationId),
      )
      .innerJoin(
        companiesTable,
        eq(companiesTable.id, capacityOffersTable.companyId),
      )
      .where(
        and(
          eq(capacityOffersTable.listingStatus, "ACTIVE"),
          eq(capacityOffersTable.visibility, "OPEN_NETWORK"),
          eq(companiesTable.status, "ACTIVE"),
          ne(companiesTable.id, current.company.id),
          eq(vesselsTable.active, true),
        ),
      ),
  ]);
  const items: Array<
    ReturnType<typeof anonymousCargo> | ReturnType<typeof anonymousCapacity>
  > = [];
  const seen = new Set<string>();
  for (const { cargo, loading, destination } of cargoRows) {
    if (
      parsed.data.listingType === "CAPACITY" ||
      (parsed.data.vesselType &&
        cargo.requiredVesselType !== parsed.data.vesselType) ||
      (parsed.data.cargoType &&
        !cargo.cargoType
          .toLowerCase()
          .includes(parsed.data.cargoType.toLowerCase()))
    ) {
      continue;
    }
    if (!seen.has(`cargo:${cargo.id}`)) {
      seen.add(`cargo:${cargo.id}`);
      items.push(anonymousCargo(cargo, loading, destination));
    }
  }
  for (const { capacity, vessel, location } of capacityRows) {
    if (
      parsed.data.listingType === "CARGO" ||
      (parsed.data.vesselType && vessel.vesselType !== parsed.data.vesselType) ||
      (parsed.data.availableFrom &&
        capacity.availableUntil < parsed.data.availableFrom)
    ) {
      continue;
    }
    if (!seen.has(`capacity:${capacity.id}`)) {
      seen.add(`capacity:${capacity.id}`);
      items.push(anonymousCapacity(capacity, vessel, location));
    }
  }
  const { page, pageSize, offset } = pageParams(
    parsed.data.page,
    parsed.data.pageSize,
  );
  res.json(
    ListMarketplaceResponse.parse({
      items: items.slice(offset, offset + pageSize),
      page,
      pageSize,
      total: items.length,
    }),
  );
});

export default router;