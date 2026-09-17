import { eq } from "drizzle-orm";
import {
  deepseaCapacityExtensionsTable,
  deepseaCargoRequirementsTable,
  deepseaVesselProfilesTable,
} from "@workspace/db";

export type DeepseaVesselProfileInput = {
  vesselClass:
    | "HANDYSIZE"
    | "HANDYMAX"
    | "SUPRAMAX"
    | "ULTRAMAX"
    | "PANAMAX"
    | "KAMSARMAX"
    | "POST_PANAMAX"
    | "CAPESIZE"
    | "NEWCASTLEMAX"
    | "OTHER";
  dwtTonnes: number;
  summerDraftMetres?: number | null;
  gearConfiguration?: string | null;
};
export type DeepseaCargoRequirementInput = {
  quantityTolerancePercent?: number;
  minimumVesselDwtTonnes?: number | null;
  maximumVesselDwtTonnes?: number | null;
  maximumDraftMetres?: number | null;
  requiredGear?: string | null;
  preferredVesselClass?: DeepseaVesselProfileInput["vesselClass"] | null;
};
export type DeepseaCapacityExtensionInput = {
  manualPositioningDays?: number | null;
  routeChoice?:
    | "UNSPECIFIED"
    | "DIRECT"
    | "SUEZ"
    | "PANAMA"
    | "CAPE_GOOD_HOPE"
    | "OTHER";
  routeNotes?: string | null;
  departureUncertaintyDays?: number | null;
  positioningBufferDays?: number | null;
  approximateMaxDistanceKm?: number | null;
  previousVoyageContext?: string | null;
};

export type DeepseaRouteChoice =
  NonNullable<DeepseaCapacityExtensionInput["routeChoice"]>;

export type DeepseaReachability = {
  earliestDeparture: Date;
  latestDeparture: Date | null;
  earliestArrival: Date | null;
  latestArrival: Date | null;
  earliestLoadingReadyLowerBound: Date;
  reachabilityStatus: "UNKNOWN" | "USER_ESTIMATED";
  laycanAssessment: "UNKNOWN" | "WITHIN_WINDOW" | "UNCERTAIN" | "TOO_LATE";
  availabilityHorizonAssessment: "WITHIN_HORIZON" | "UNCERTAIN" | "TOO_LATE";
  definitelyLate: boolean;
};

const DAY_MS = 86_400_000;

/**
 * Pure, deliberately conservative manual reachability calculation. Dates are
 * advanced in milliseconds so fractional user estimates are never truncated.
 * An early arrival is valid: cargo can wait until laycan opens. No result is
 * independently verified, even when every input is present.
 */
export function evaluateDeepseaReachability(input: {
  availableFrom: Date;
  availableUntil: Date;
  laycanFrom: Date;
  laycanUntil: Date;
  now: Date;
  manualPositioningDays?: number | null;
  departureUncertaintyDays?: number | null;
  positioningBufferDays?: number | null;
}): DeepseaReachability {
  const earliestDeparture = new Date(
    Math.max(input.availableFrom.getTime(), input.now.getTime()),
  );
  const latestDeparture =
    input.departureUncertaintyDays == null
      ? null
      : new Date(
          earliestDeparture.getTime() +
            input.departureUncertaintyDays * DAY_MS,
        );
  // The legacy manual estimate gives the conservative earliest bound. A
  // missing new buffer cannot make an arrival later for optimistic matching,
  // but it does keep the latest bound unknown and therefore provisional.
  const earliestTravelDays =
    input.manualPositioningDays == null
      ? null
      : input.manualPositioningDays + (input.positioningBufferDays ?? 0);
  const latestTravelDays =
    input.manualPositioningDays == null ||
    input.positioningBufferDays == null
      ? null
      : input.manualPositioningDays + input.positioningBufferDays;
  const earliestArrival =
    earliestTravelDays == null
      ? null
      : new Date(earliestDeparture.getTime() + earliestTravelDays * DAY_MS);
  const latestArrival =
    latestDeparture == null || latestTravelDays == null
      ? null
      : new Date(latestDeparture.getTime() + latestTravelDays * DAY_MS);
  const reachabilityStatus =
    input.manualPositioningDays != null ||
    input.departureUncertaintyDays != null ||
    input.positioningBufferDays != null
      ? "USER_ESTIMATED"
      : "UNKNOWN";
  // A vessel may arrive before laycan and wait. For unknown travel duration
  // the departure itself is the nonnegative lower bound, not a fabricated ETA.
  const earliestLoadingReadyLowerBound = new Date(
    Math.max(
      earliestDeparture.getTime() +
        (input.manualPositioningDays ?? 0) * DAY_MS +
        (input.positioningBufferDays ?? 0) * DAY_MS,
      input.laycanFrom.getTime(),
    ),
  );
  const latestLoadingReady =
    latestArrival == null
      ? null
      : new Date(
          Math.max(latestArrival.getTime(), input.laycanFrom.getTime()),
        );
  const availabilityHorizonAssessment =
    input.availableUntil < input.laycanFrom ||
    earliestLoadingReadyLowerBound > input.availableUntil
      ? "TOO_LATE"
      : latestLoadingReady != null &&
          latestLoadingReady > input.availableUntil
        ? "UNCERTAIN"
        : "WITHIN_HORIZON";
  let laycanAssessment: DeepseaReachability["laycanAssessment"] = "UNKNOWN";
  if (earliestLoadingReadyLowerBound > input.laycanUntil) {
    laycanAssessment = "TOO_LATE";
  } else if (latestLoadingReady != null) {
    laycanAssessment =
      latestLoadingReady <= input.laycanUntil ? "WITHIN_WINDOW" : "UNCERTAIN";
  }
  if (
    availabilityHorizonAssessment === "UNCERTAIN" &&
    laycanAssessment === "WITHIN_WINDOW"
  ) {
    laycanAssessment = "UNCERTAIN";
  }
  return {
    earliestDeparture,
    latestDeparture,
    earliestArrival,
    latestArrival,
    earliestLoadingReadyLowerBound,
    reachabilityStatus,
    laycanAssessment,
    availabilityHorizonAssessment,
    definitelyLate:
      availabilityHorizonAssessment === "TOO_LATE" ||
      laycanAssessment === "TOO_LATE",
  };
}

export function validateDeepseaCapacityExtension(
  extension: DeepseaCapacityExtensionInput | null | undefined,
) {
  if (extension == null) return true;
  const routeChoice = extension.routeChoice ?? "UNSPECIFIED";
  const validRouteChoice = [
    "UNSPECIFIED",
    "DIRECT",
    "SUEZ",
    "PANAMA",
    "CAPE_GOOD_HOPE",
    "OTHER",
  ].includes(routeChoice);
  const bounded = (value: number | null | undefined) =>
    value == null ||
    (Number.isFinite(value) && value >= 0 && value <= 365);
  const manual =
    extension.manualPositioningDays == null ||
    (Number.isFinite(extension.manualPositioningDays) &&
      extension.manualPositioningDays >= 0 &&
      extension.manualPositioningDays <= 365);
  const distance =
    extension.approximateMaxDistanceKm == null ||
    (Number.isFinite(extension.approximateMaxDistanceKm) &&
      extension.approximateMaxDistanceKm > 0);
  const routeNotes =
    extension.routeNotes == null || extension.routeNotes.trim().length <= 500;
  return validRouteChoice && manual && bounded(extension.departureUncertaintyDays) &&
    bounded(extension.positioningBufferDays) &&
    distance && routeNotes;
}

export function normalizeDeepseaCapacityExtension(
  extension: DeepseaCapacityExtensionInput,
) {
  return {
    manualPositioningDays: extension.manualPositioningDays ?? null,
    routeChoice: extension.routeChoice ?? "UNSPECIFIED",
    routeNotes:
      extension.routeNotes == null ? null : extension.routeNotes.trim(),
    departureUncertaintyDays: extension.departureUncertaintyDays ?? null,
    positioningBufferDays: extension.positioningBufferDays ?? null,
    approximateMaxDistanceKm: extension.approximateMaxDistanceKm ?? null,
    previousVoyageContext: extension.previousVoyageContext ?? null,
  };
}

export function isDeepsea(mode: string | undefined | null) {
  return mode === "DEEPSEA_BULK";
}

export function validateDeepseaCargoRequirement(
  requirement: DeepseaCargoRequirementInput | null | undefined,
) {
  if (!requirement) return false;
  const tolerance = requirement.quantityTolerancePercent ?? 0;
  return (
    Number.isFinite(tolerance) &&
    tolerance >= 0 &&
    tolerance < 100 &&
    (requirement.minimumVesselDwtTonnes == null ||
      requirement.maximumVesselDwtTonnes == null ||
      requirement.minimumVesselDwtTonnes <= requirement.maximumVesselDwtTonnes)
  );
}

export async function replaceDeepseaVesselProfile(
  tx: any,
  vesselId: string,
  profile: DeepseaVesselProfileInput | null | undefined,
) {
  await tx
    .delete(deepseaVesselProfilesTable)
    .where(eq(deepseaVesselProfilesTable.vesselId, vesselId));
  if (profile) {
    await tx.insert(deepseaVesselProfilesTable).values({
      vesselId,
      vesselClass: profile.vesselClass,
      dwtTonnes: profile.dwtTonnes,
      summerDraftMetres: profile.summerDraftMetres ?? null,
      gearConfiguration: profile.gearConfiguration ?? null,
    });
  }
}

export async function replaceDeepseaCargoRequirement(
  tx: any,
  cargoListingId: string,
  requirement: DeepseaCargoRequirementInput | null | undefined,
) {
  await tx
    .delete(deepseaCargoRequirementsTable)
    .where(eq(deepseaCargoRequirementsTable.cargoListingId, cargoListingId));
  if (requirement) {
    await tx.insert(deepseaCargoRequirementsTable).values({
      cargoListingId,
      quantityTolerancePercent: requirement.quantityTolerancePercent ?? 0,
      minimumVesselDwtTonnes: requirement.minimumVesselDwtTonnes ?? null,
      maximumVesselDwtTonnes: requirement.maximumVesselDwtTonnes ?? null,
      maximumDraftMetres: requirement.maximumDraftMetres ?? null,
      requiredGear: requirement.requiredGear ?? null,
      preferredVesselClass: requirement.preferredVesselClass ?? null,
    });
  }
}

export async function replaceDeepseaCapacityExtension(
  tx: any,
  capacityOfferId: string,
  extension: DeepseaCapacityExtensionInput | null | undefined,
) {
  await tx
    .delete(deepseaCapacityExtensionsTable)
    .where(eq(deepseaCapacityExtensionsTable.capacityOfferId, capacityOfferId));
  if (extension) {
    const normalized = normalizeDeepseaCapacityExtension(extension);
    await tx.insert(deepseaCapacityExtensionsTable).values({
      capacityOfferId,
      ...normalized,
    });
  }
}

export async function deepseaDetailsForVessel(executor: any, vesselId: string) {
  const [profile] = await executor
    .select()
    .from(deepseaVesselProfilesTable)
    .where(eq(deepseaVesselProfilesTable.vesselId, vesselId));
  return profile ?? null;
}

export async function deepseaDetailsForCargo(executor: any, cargoId: string) {
  const [requirement] = await executor
    .select()
    .from(deepseaCargoRequirementsTable)
    .where(eq(deepseaCargoRequirementsTable.cargoListingId, cargoId));
  return requirement ?? null;
}

export async function deepseaDetailsForCapacity(
  executor: any,
  capacityId: string,
) {
  const [extension] = await executor
    .select()
    .from(deepseaCapacityExtensionsTable)
    .where(eq(deepseaCapacityExtensionsTable.capacityOfferId, capacityId));
  return extension ?? null;
}

export function stripDeepseaFields<T extends Record<string, unknown>>(value: T) {
  const {
    deepseaProfile: _profile,
    deepseaRequirement: _requirement,
    deepseaExtension: _extension,
    ...base
  } = value;
  return base;
}
