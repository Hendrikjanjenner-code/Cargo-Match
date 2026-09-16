import {
  AIS_CAPABILITIES,
  AIS_LICENSE_SCOPES,
  type AisLicenseGate,
  type AisLicenseRequest,
  type AisLicenseDecision,
} from "./model";

/**
 * Operator-reviewed contract metadata, never credentials. Re-read on every
 * decision so expiry/revocation applies to in-flight requests too.
 * A plan or API key alone is deliberately not proof of display/reuse rights.
 */
export class EnvironmentAisLicenseGate implements AisLicenseGate {
  constructor(private readonly readGrants: () => string | undefined = () => process.env.AIS_LICENSE_GRANTS) {}

  authorize(request: AisLicenseRequest): AisLicenseDecision {
    const deny = { allowed: false, reason: "LICENSE_NOT_APPROVED" };
    let grants: unknown;
    try {
      grants = JSON.parse(this.readGrants() ?? "[]");
    } catch {
      return deny;
    }
    if (!Array.isArray(grants) || !request.tenantId) return deny;
    const matching = grants.filter((grant) => grant && typeof grant === "object" &&
      grant.tenantId === request.tenantId && grant.provider === request.provider);
    // Ambiguous duplicate policies fail closed rather than selecting the most
    // permissive one.
    if (matching.length !== 1) return deny;
    const grant = matching[0];
    const text = (value: unknown) => typeof value === "string" && value.trim().length > 0;
    const now = request.now.getTime();
    const approvedAt = typeof grant.approvedAt === "string" ? Date.parse(grant.approvedAt) : NaN;
    const expiresAt = typeof grant.expiresAt === "string" ? Date.parse(grant.expiresAt) : NaN;
    if (grant.enabled !== true ||
      !["vesselfinder", "marinetraffic"].includes(grant.provider) ||
      !text(grant.agreementReference) || !text(grant.reviewedBy) ||
      !text(grant.documentedProduct) ||
      !Number.isFinite(now) || !Number.isFinite(approvedAt) || approvedAt > now ||
      !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt <= approvedAt ||
      grant.retentionMode !== "TRANSIENT_ONLY" ||
      grant.redistribution !== "DENIED" ||
      grant.areaMonitoring !== false || grant.historicalStorage !== false ||
      !Array.isArray(grant.scopes) ||
      grant.scopes.some((scope: unknown) => !AIS_LICENSE_SCOPES.includes(scope as never)) ||
      request.scopes.some((scope) => !grant.scopes.includes(scope)) ||
      !Array.isArray(grant.capabilities) ||
      grant.capabilities.some((capability: unknown) => !AIS_CAPABILITIES.includes(capability as never)) ||
      !["LIVE_POSITION", "VESSEL_LOOKUP"].every((capability) => grant.capabilities.includes(capability))
    ) return deny;
    const capabilities = request.capabilities ?? [];
    if (capabilities.some((capability) => !grant.capabilities.includes(capability))) return deny;
    return { allowed: true };
  }
}