/**
 * Navigation policy for real company context, not demo personas.
 * The API remains authoritative for membership, ownership and driver assignment.
 * /company supplies membershipRole only for the caller's own active membership.
 */
export type StandardModule = "inland" | "deepsea" | "liner" | "road";
export type ModuleState = "ACTIVE" | "PILOT" | "COMING_LATER" | "HIDDEN";
export interface StandardCompanyContext {
  activities: readonly string[];
  membershipRole?: string;
  status: string;
}
export const STANDARD_MODULE_STATES: Readonly<Record<string, ModuleState>> = {
  inland: "ACTIVE", deepsea: "ACTIVE", liner: "ACTIVE", road: "PILOT",
  rail: "HIDDEN", air: "HIDDEN", import: "HIDDEN",
};
const modules: StandardModule[] = ["inland", "deepsea", "liner", "road"];
const enabled = (state: ModuleState | undefined) => state === "ACTIVE" || state === "PILOT";
export function standardModuleForPath(path: string): StandardModule {
  if (/^\/deepsea(?:\/|$)/.test(path)) return "deepsea";
  if (/^\/liner(?:\/|$)/.test(path)) return "liner";
  if (/^\/road(?:\/|$)/.test(path)) return "road";
  return "inland";
}
export function standardAuthority(
  company: StandardCompanyContext | null | undefined,
  states: Readonly<Record<string, ModuleState>> = STANDARD_MODULE_STATES,
) {
  const member = !!company && ["OWNER", "ADMIN", "MEMBER"].includes(company.membershipRole ?? "");
  const active = member && company?.status === "ACTIVE";
  const carrier = !!company?.activities.includes("CARRIER");
  const cargo = !!company?.activities.some(activity => ["SHIPPER", "CHARTERER"].includes(activity));
  const commercial = active && ["OWNER", "ADMIN"].includes(company?.membershipRole ?? "");
  // MEMBER is not assumed to have a driver assignment. The road API returns
  // assigned-only projections (or empty results); no commercial right is added.
  const operational = active && company?.membershipRole === "MEMBER";
  const allowedModules = modules.filter(mode => active && enabled(states[mode]) &&
    (carrier || cargo || (mode === "road" && operational)));
  const canVisit = (input: string): boolean => {
    const path = input.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
    if (path === "/company") return !!company; // Keep own context accessible when suspended.
    if (path === "/notifications") return member;
    if (!active) return false;
    if (path === "/messages" || /^\/messages\/[^/]+$/.test(path)) return true;
    const mode = standardModuleForPath(path);
    if (!allowedModules.includes(mode)) return false;
    const suffix = mode === "inland" ? path : path.slice(mode.length + 1) || "/";
    if (mode === "road") {
      if (suffix === "/cargo") return commercial && cargo;
      if (suffix === "/assets" || suffix === "/capacity" || suffix === "/") return carrier || operational;
      return /^\/(?:opportunities|matches)(?:\/[^/]+)?$/.test(suffix);
    }
    if (suffix === "/cargo") return cargo;
    if (suffix === "/vessels" || suffix === "/capacity" || suffix === "/services") {
      if (suffix === "/services" && mode !== "liner") return false;
      if (mode === "liner" && suffix !== "/services") return false;
      return carrier;
    }
    return (mode === "inland" && suffix === "/") ||
      suffix === "/marketplace" || /^\/matches(?:\/[^/]+)?$/.test(suffix);
  };
  const moduleHome = (mode: StandardModule) => {
    const candidates = mode === "inland" ? ["/"] :
      mode === "liner" ? ["/liner/services", "/liner/cargo", "/liner/marketplace"] :
      mode === "road" ? ["/road/assets", "/road/cargo", "/road/opportunities"] :
      ["/deepsea/vessels", "/deepsea/cargo", "/deepsea/marketplace"];
    return candidates.find(canVisit) ?? "/company";
  };
  return { member, active, carrier, cargo, commercial, operational, allowedModules, canVisit, moduleHome };
}