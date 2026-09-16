export * from "./model";
export * from "./config";
export * from "./normalize";
export * from "./mock";
export * from "./vesselFinder";
export * from "./marineTraffic";
export * from "./manager";
export * from "../aisIdentity";

import { AISProviderManager } from "./manager";
import { EnvironmentAisLicenseGate } from "./license";
import { getVerifiedAisIdentity } from "./identity";

/**
 * A single request-scoped-independent manager is safe because it only keeps a
 * bounded short-lived cache and in-flight requests. It performs no polling.
 */
export const aisProviderManager = new AISProviderManager({
  licenseGate: new EnvironmentAisLicenseGate(),
  identityRevalidator: async (identity) => {
    // Simulation fixtures deliberately have no commercial mapping.
    if (!identity.mappingRevision && process.env.AIS_MODE === "simulation" &&
      (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")) {
      return { allowed: true };
    }
    if (!identity.tenantId) return { allowed: false };
    const current = await getVerifiedAisIdentity(identity.tenantId, identity.vesselId);
    return {
      allowed: !!current && current.mappingRevision === identity.mappingRevision,
      mappingRevision: current?.mappingRevision,
    };
  },
});