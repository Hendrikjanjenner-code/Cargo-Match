import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { configuredOrigins } from "../lib/origins";
import { applyAction, projectSession, refreshMatches } from "../services/demo/domain";
import { getPersona, seedDemo } from "../services/demo/seed";
import { postgresDemoStore, type DemoStore } from "../services/demo/store";
import { DemoError, type Sandbox } from "../services/demo/types";

export const DEMO_COOKIE = "cargomatch_demo";
const cookieOptions = { httpOnly: true, secure: true, sameSite: "strict" as const, path: "/api/demo", maxAge: 14 * 86_400_000 };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const demoEnabled = () => ["development", "test"].includes(process.env.NODE_ENV ?? "") && process.env.DEMO_ENABLED !== "false";
function sameSecret(value: string | undefined, expected: string) {
  return !!value && /^[a-f0-9]{64}$/.test(value) && value.length === expected.length && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
function cookie(req: Request) {
  const value: unknown = req.cookies?.[DEMO_COOKIE];
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
function checkWrite(req: Request, sandbox: Sandbox) {
  if (req.get("X-Demo-Revision") !== String(sandbox.revision)) throw new DemoError(409, "STALE_DEMO_PRINCIPAL", "Het demoprofiel is in een ander tabblad gewijzigd. Vernieuw eerst de sessie.");
  if (!sameSecret(req.get("X-Demo-CSRF"), sandbox.csrfToken)) throw new DemoError(403, "DEMO_CSRF", "De demobeveiliging is verlopen. Vernieuw de sessie.");
}
export function createDemoRouter(store: DemoStore = postgresDemoStore) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store, private");
    res.set("Pragma", "no-cache");
    res.set("Vary", "Cookie, Origin");
    if (!demoEnabled()) { res.status(404).json({error: "Demo is in deze omgeving niet beschikbaar.", code: "DEMO_DISABLED"}); return; }
    next();
  });
  router.use(rateLimit({windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false,
    message: {error: "Te veel demoverzoeken. Probeer het straks opnieuw.", code: "RATE_LIMITED"}}));
  router.use((req, _res, next) => {
    if (req.method === "GET" || req.method === "HEAD") { next(); return; }
    const origin = req.get("Origin");
    // Never derive trusted origins from Host or forwarding headers.
    if (!origin || !configuredOrigins().has(origin) || req.get("X-Demo-Request") !== "1" || req.get("Sec-Fetch-Site") === "cross-site") {
      next(new DemoError(403, "DEMO_ORIGIN", "Alleen een expliciet verzoek uit dezelfde demo-app is toegestaan.")); return;
    }
    // Also require request target and trusted origin to agree. The configured
    // allowlist above prevents forged Host/forwarding headers granting trust.
    const host = req.get("X-Forwarded-Host") ?? req.get("Host");
    const protocol = req.get("X-Forwarded-Proto") ?? (req.secure ? "https" : "http");
    if (!host || origin !== `${protocol}://${host}`) { next(new DemoError(403, "DEMO_ORIGIN", "Cross-origin demoverzoek geweigerd.")); return; }
    next();
  });
  const load = async (req: Request, write: boolean, operation: (sandbox: Sandbox) => unknown, remove = false) => {
    const token = cookie(req); if (!token) throw new DemoError(401, "NO_DEMO_SESSION", "Start eerst een aparte demo.");
    return store.transact(hash(token), sandbox => {
      if (write) checkWrite(req, sandbox);
      refreshMatches(sandbox.state);
      return operation(sandbox);
    }, remove);
  };
  router.get("/session", async (req, res) => { res.json(await load(req, false, projectSession)); });
  router.post("/start", async (req, res) => {
    if (cookie(req)) {
      // Existing valid sessions resume unchanged, never switch through start.
      // Expired/missing row is not silently replaced with a new sandbox.
      res.json(await load(req, false, projectSession)); return;
    }
    const id = req.body?.personaId ?? "andy";
    if (typeof id !== "string" || !getPersona(id)) throw new DemoError(400, "UNKNOWN_PERSONA", "Onbekend demoprofiel.");
    const token = randomBytes(32).toString("hex");
    const sandbox: Sandbox = {csrfToken: randomBytes(32).toString("hex"), personaId: id, revision: 1, state: seedDemo()};
    refreshMatches(sandbox.state);
    await store.create(hash(token), sandbox);
    res.cookie(DEMO_COOKIE, token, cookieOptions);
    res.status(201).json(projectSession(sandbox));
  });
  router.post("/switch", async (req, res) => {
    res.json(await load(req, true, sandbox => {
      const id = req.body?.personaId;
      if (typeof id !== "string" || !getPersona(id)) throw new DemoError(400, "UNKNOWN_PERSONA", "Onbekend demoprofiel.");
      sandbox.personaId = id;
      sandbox.revision += 1;
      sandbox.csrfToken = randomBytes(32).toString("hex");
      return projectSession(sandbox);
    }));
  });
  router.post("/actions", async (req, res) => {
    res.json(await load(req, true, sandbox => { applyAction(sandbox, req.body); return projectSession(sandbox); }));
  });
  router.post("/logout", async (req, res) => {
    await load(req, true, () => undefined, true);
    res.clearCookie(DEMO_COOKIE, {httpOnly: true, secure: true, sameSite: "strict", path: "/api/demo"});
    res.status(204).end();
  });
  router.use((_req, res) => { res.status(404).json({error: "Onbekende demoroute.", code: "NOT_FOUND"}); });
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof DemoError) {
      // Expired rows cannot be revived or silently replaced. Clear only the
      // unusable demo cookie so the visitor can explicitly start a fresh demo.
      if (error.status === 401) res.clearCookie(DEMO_COOKIE, {httpOnly: true, secure: true, sameSite: "strict", path: "/api/demo"});
      res.status(error.status).json({error: error.message, code: error.code}); return;
    }
    res.status(503).json({error: "Demo-opslag is tijdelijk niet beschikbaar. Probeer het opnieuw; je echte account is niet gewijzigd.", code: "DEMO_UNAVAILABLE"});
  });
  return router;
}
export default createDemoRouter();