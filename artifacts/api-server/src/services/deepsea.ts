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
  approximateMaxDistanceKm?: number | null;
  previousVoyageContext?: string | null;
};

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
    await tx.insert(deepseaCapacityExtensionsTable).values({
      capacityOfferId,
      manualPositioningDays: extension.manualPositioningDays ?? null,
      approximateMaxDistanceKm: extension.approximateMaxDistanceKm ?? null,
      previousVoyageContext: extension.previousVoyageContext ?? null,
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
