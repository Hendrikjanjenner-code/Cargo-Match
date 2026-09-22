import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after, before, beforeEach } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, demoSandboxesTable } from "@workspace/db";
import { createTestIdentity, disposeTestIdentity } from "./support/testIdentity";

// Import the app after configuring its trusted origin. These are ordinary HTTP
// requests through all app middleware; no permission/service mocks are used.
const origin = "https://demo-http-test.example.invalid";
type Session = {
  csrfToken: string;
  revision: number;
  context: { user: { id: string; assignedAssetIds: string[] }; company: { id: string }; permissions: string[] };
  workspace: {
    assets: Array<Record<string, any>>;
    cargos: Array<Record<string, any>>;
    capacity: Array<Record<string, any>>;
    opportunities: Array<Record<string, any>>;
    matches: Array<Record<string, any>>;
    messages: Array<Record<string, any>>;
    notifications: Array<Record<string, any>>;
    referrals: Array<Record<string, any>>;
    imports: Array<Record<string, any>>;
    audit: Array<Record<string, any>>;
  };
};
type Jar = { cookie: string; session: Session };
type Reply = { status: number; body: any; cookies: string[] };
let server: import("node:http").Server;
let baseUrl = "";
let real: Awaited<ReturnType<typeof createTestIdentity>>;
const csrfTokens = new Set<string>();
const previousOrigin = process.env.APP_ORIGIN;
const previousEnabled = process.env.DEMO_ENABLED;
const previousEnvironment = process.env.NODE_ENV;
let clientNumber = 1;
beforeEach(() => { clientNumber += 1; });

async function request(path: string, options: {
  method?: string; cookie?: string; body?: unknown; session?: Session;
  headers?: Record<string, string>; noOrigin?: boolean;
} = {}): Promise<Reply> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.noOrigin ? {} : { origin }),
      "x-forwarded-proto": "https",
      "x-forwarded-host": "demo-http-test.example.invalid",
      // Separate test visitors still pass the real rate-limit middleware.
      "x-forwarded-for": `192.0.2.${clientNumber}`,
      "x-demo-request": "1",
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.session ? {
        "x-demo-csrf": options.session.csrfToken,
        "x-demo-revision": String(options.session.revision),
      } : {}),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (body?.csrfToken) csrfTokens.add(body.csrfToken);
  return { status: response.status, body, cookies: response.headers.getSetCookie() };
}

function success(reply: Reply): Session {
  assert.ok(reply.status >= 200 && reply.status < 300, JSON.stringify(reply.body));
  assert.equal(reply.body.demo, true);
  return reply.body;
}

async function start(personaId: string): Promise<Jar> {
  const reply = await request("/api/demo/start", { method: "POST", body: { personaId } });
  const session = success(reply);
  assert.equal(session.context.user.id, personaId);
  const cookies = reply.cookies.filter(value => !value.startsWith("sid="));
  assert.ok(cookies.length, "Start must issue a separate demo session cookie");
  assert.ok(cookies.some(value => /httponly/i.test(value)), "Demo cookie is HttpOnly");
  assert.ok(cookies.some(value => /samesite=(strict|lax)/i.test(value)), "Demo cookie limits cross-site requests");
  return { cookie: cookies.map(value => value.split(";")[0]).join("; "), session };
}

async function post(jar: Jar, path: string, body: unknown): Promise<Reply> {
  const reply = await request(`/api/demo/${path}`, {
    method: "POST", cookie: jar.cookie, session: jar.session, body,
  });
  if (reply.body?.context) jar.session = success(reply);
  if (reply.cookies.length) jar.cookie = reply.cookies.map(value => value.split(";")[0]).join("; ");
  return reply;
}

async function switchTo(jar: Jar, personaId: string) {
  success(await post(jar, "switch", { personaId }));
  assert.equal(jar.session.context.user.id, personaId);
}

async function action(jar: Jar, body: unknown) {
  return post(jar, "actions", body);
}

function match(jar: Jar, id: string) {
  const found = jar.session.workspace.matches.find(item => item.id === id);
  assert.ok(found, `Expected participant match ${id} for ${jar.session.context.user.id}`);
  return found;
}

test("import fixture downloads enforce sandbox, module and LCL house access; uploads cannot forge metadata", async () => {
  const jar = await start("michael");
  const url = "/api/demo/import/documents/china-fcl/china-fcl-doc-1";
  assert.equal((await fetch(`${baseUrl}${url}`)).status, 401);
  const fixture = await fetch(`${baseUrl}${url}`, { headers: {cookie: jar.cookie} });
  assert.equal(fixture.status, 200);
  assert.match(fixture.headers.get("content-disposition") ?? "", /attachment/);
  const content = await fixture.text();
  assert.match(content, /DEMO.*SYNTHETIC/);
  assert.match(content, /18420/);
  assert.equal((await action(jar, {type: "IMPORT_CONTROL", operation: "UPLOAD_DOCUMENT", shipmentId: "china-fcl",
    documentType: "INVOICE", name: "forged.pdf", objectPath: "/objects/forged", size: 100, mimeType: "application/pdf"})).status, 403);
  assert.equal((await post(jar, "import/uploads/request-url", {shipmentId: "china-fcl", name: "oversize.pdf", mimeType: "application/pdf", size: 2097153})).status, 400);
  assert.equal((await post(jar, "import/uploads/complete", {shipmentId: "china-fcl", documentType: "INVOICE", objectPath: "/objects/uploads/00000000-0000-0000-0000-000000000000"})).status, 403);
  await switchTo(jar, "laura");
  const download = (shipment: string, document: string) => fetch(`${baseUrl}/api/demo/import/documents/${shipment}/${document}`, {headers: {cookie: jar.cookie}});
  assert.equal((await download("india-house-1", "india-house-1-doc-1")).status, 200);
  assert.equal((await download("india-house-1", "india-house-1-doc-0")).status, 403);
  assert.equal((await download("india-house-2", "india-house-2-doc-1")).status, 403);
  assert.equal((await download("china-fcl", "china-fcl-doc-1")).status, 403);
  assert.equal((await post(jar, "import/uploads/request-url", {shipmentId: "india-house-2", name: "test.txt", mimeType: "text/plain", size: 10})).status, 403);
  await switchTo(jar, "michael");
  success(await action(jar, {type: "IMPORT_CONTROL", operation: "SET_MODULE", module: "DOCUMENTS", enabled: false}));
  assert.equal((await download("china-fcl", "china-fcl-doc-1")).status, 403);
});

async function connect(jar: Jar, id: string, counterpart: string) {
  success(await action(jar, { type: "INTEREST", matchId: id }));
  assert.equal(match(jar, id).status, "INTEREST_SENT");
  await switchTo(jar, counterpart);
  success(await action(jar, { type: "ACCEPT", matchId: id }));
  assert.equal(match(jar, id).status, "CONNECTED");
}

before(async () => {
  process.env.APP_ORIGIN = origin;
  process.env.NODE_ENV = "test";
  delete process.env.DEMO_ENABLED;
  const { default: app } = await import("../src/app");
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  real = await createTestIdentity({ withCompany: false });
});

after(async () => {
  if (csrfTokens.size) await db.delete(demoSandboxesTable).where(inArray(demoSandboxesTable.csrfToken, [...csrfTokens]));
  if (real) await disposeTestIdentity(real);
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  for (const [key, value] of Object.entries({
    APP_ORIGIN: previousOrigin, DEMO_ENABLED: previousEnabled, NODE_ENV: previousEnvironment,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("HTTP demo session requires trusted origin, CSRF and a server principal", async () => {
  assert.equal((await request("/api/demo/session")).status, 401);
  assert.equal((await request("/api/demo/start", {
    method: "POST", body: { personaId: "andy" }, noOrigin: true,
  })).status, 403);
  assert.equal((await request("/api/demo/start", {
    method: "POST", body: { personaId: "andy" }, headers: { origin: "https://attacker.invalid" },
  })).status, 403);
  const jar = await start("andy");
  const missingCsrf = await request("/api/demo/switch", {
    method: "POST", cookie: jar.cookie, body: { personaId: "emma" },
    headers: { "x-demo-revision": String(jar.session.revision) },
  });
  assert.equal(missingCsrf.status, 403);
  const wrongCsrf = await request("/api/demo/actions", {
    method: "POST", cookie: jar.cookie, session: jar.session,
    headers: { "x-demo-csrf": "forged" }, body: { type: "RESET", confirmation: "RESET DEMO" },
  });
  assert.equal(wrongCsrf.status, 403);
  const restored = success(await request("/api/demo/session", { cookie: jar.cookie }));
  assert.equal(restored.context.user.id, "andy");
});

test("HTTP authorization denies operational/commercial and foreign-owner escalation", async () => {
  const jar = await start("mark");
  assert.equal(jar.session.workspace.audit.length, 0);
  assert.equal((await action(jar, { type: "RESET", confirmation: "RESET DEMO" })).status, 403);
  for (const type of ["INTEREST", "ACCEPT", "DECLINE"]) {
    assert.equal((await action(jar, { type, matchId: "match-inland" })).status, 403);
  }
  await switchTo(jar, "thomas");
  const unassigned = jar.session.workspace.assets.find(asset => !jar.session.context.user.assignedAssetIds.includes(asset.id));
  assert.ok(unassigned, "Road planner sees fleet assets for authorization fixture");
  const fleet = jar.session.workspace.assets.map(asset => ({ ...asset }));
  await switchTo(jar, "jan");
  const foreignTruck = fleet.find(asset => !jar.session.context.user.assignedAssetIds.includes(asset.id));
  assert.ok(foreignTruck, "Road seed includes another truck");
  assert.ok(!jar.session.workspace.assets.some(asset => asset.id === foreignTruck.id));
  assert.equal((await action(jar, {
    type: "CONFIRM_AVAILABILITY", assetId: foreignTruck.id, availableAt: foreignTruck.availableAt,
  })).status, 403);
  assert.equal((await action(jar, { type: "ACCEPT", matchId: "match-road" })).status, 403);
  await switchTo(jar, "sophie");
  const ship = jar.session.workspace.assets[0];
  assert.ok(ship);
  await switchTo(jar, "andy");
  assert.equal((await action(jar, { type: "SAVE_ASSET", assetId: ship.id, name: "Unauthorized rename" })).status, 403);
  await switchTo(jar, "anna");
  const railAsset = jar.session.workspace.assets[0];
  assert.ok(railAsset);
  await switchTo(jar, "sarah");
  assert.ok(!jar.session.workspace.assets.some(asset => asset.id === railAsset.id));
  assert.ok(jar.session.workspace.capacity.every(listing => listing.companyId === jar.session.context.company.id));
  assert.equal((await action(jar, { type: "SAVE_ASSET", assetId: railAsset.id, name: "Foreign rail asset" })).status, 403);
});

test("HTTP real and demo authentication cookies never authorize each other's APIs", async () => {
  const jar = await start("emma");
  assert.equal((await request("/api/company", { cookie: jar.cookie })).status, 401);
  assert.equal((await request("/api/demo/session", { cookie: real.cookie })).status, 401);
  assert.equal((await request("/api/demo/actions", {
    method: "POST", cookie: real.cookie, session: jar.session,
    body: { type: "RESET", confirmation: "RESET DEMO" },
  })).status, 401);
});

test("HTTP serialized pre-consent projections conceal protected listing and asset details", async () => {
  const jar = await start("sophie");
  const ship = jar.session.workspace.assets.find(asset => asset.name.includes("Atlas"));
  assert.ok(ship);
  const protectedNames = jar.session.workspace.assets.map(asset => asset.name);
  const protectedListings = jar.session.workspace.capacity.map(listing => listing.name);
  await switchTo(jar, "andy");
  const wire = JSON.stringify(jar.session);
  for (const name of [...protectedNames, ...protectedListings]) {
    assert.ok(!wire.includes(name), `Pre-consent response leaked ${name}`);
  }
  const opportunity = match(jar, "match-deepsea");
  for (const property of ["counterpartyName", "assetName", "contact", "latitude", "longitude", "location"]) {
    assert.equal(opportunity[property], undefined, `Protected property ${property}`);
  }
  assert.equal(jar.session.workspace.capacity.length, 0);
  assert.equal(jar.session.workspace.messages.length, 0);
  assert.ok(jar.session.workspace.cargos.every(listing => listing.companyId === jar.session.context.company.id));
  assert.equal((await action(jar, { type: "MESSAGE", matchId: "match-deepsea", body: "Before consent" })).status, 403);
});

test("HTTP Andy and Sophie share one connected match and private conversation after switching/reload", async () => {
  const jar = await start("andy");
  await connect(jar, "match-deepsea", "sophie");
  const connected = match(jar, "match-deepsea");
  assert.ok(connected.counterpartyName);
  assert.ok(connected.contact);
  success(await action(jar, { type: "MESSAGE", matchId: "match-deepsea", body: "Private acceptance message" }));
  await switchTo(jar, "andy");
  assert.equal(match(jar, "match-deepsea").status, "CONNECTED");
  assert.ok(match(jar, "match-deepsea").assetName.includes("Atlas"));
  success(await action(jar, { type: "MESSAGE", matchId: "match-deepsea", body: "Private acceptance reply" }));
  jar.session = success(await request("/api/demo/session", { cookie: jar.cookie }));
  assert.equal(jar.session.workspace.matches.filter(item => item.id === "match-deepsea").length, 1);
  assert.equal(jar.session.workspace.messages.filter(item => item.matchId === "match-deepsea" && item.body.startsWith("Private acceptance")).length, 2);
  await switchTo(jar, "laura");
  assert.ok(!jar.session.workspace.messages.some(item => item.matchId === "match-deepsea"));
  assert.ok(!JSON.stringify(jar.session).includes("Private acceptance message"));
  assert.equal((await action(jar, { type: "MESSAGE", matchId: "match-deepsea", body: "Third-party injection" })).status, 403);
});

test("HTTP skipper and driver referrals reach only their planners without commercial consent", async () => {
  for (const [operator, planner, matchId] of [
    ["mark", "eva", "match-inland"], ["jan", "thomas", "match-road"],
  ]) {
    const jar = await start(operator);
    const asset = jar.session.workspace.assets.find(item => jar.session.context.user.assignedAssetIds.includes(item.id));
    assert.ok(asset);
    success(await action(jar, { type: "CONFIRM_AVAILABILITY", assetId: asset.id, availableAt: asset.availableAt }));
    assert.notEqual(match(jar, matchId).status, "CONNECTED");
    success(await action(jar, { type: "SEND_TO_PLANNER", matchId, note: `${operator} handoff` }));
    await switchTo(jar, planner);
    const referral = jar.session.workspace.referrals.find(item => item.fromUserId === operator && item.note === `${operator} handoff`);
    assert.ok(referral);
    assert.equal(referral.toUserId, planner);
    success(await action(jar, { type: "REVIEW_REFERRAL", referralId: referral.id }));
    assert.equal(jar.session.workspace.referrals.find(item => item.id === referral.id)?.status, "REVIEWED");
    await connect(jar, matchId, "laura");
  }
});

test("HTTP rail and air pilots connect to authorized counterparties without cross-mode private records", async () => {
  for (const [operator, id, counterpart] of [["anna", "match-rail", "laura"], ["sarah", "match-air", "david"]]) {
    const jar = await start(operator);
    assert.equal(match(jar, id).provisional, true);
    await connect(jar, id, counterpart);
    await switchTo(jar, operator);
    assert.equal(match(jar, id).status, "CONNECTED");
    assert.ok(jar.session.workspace.assets.every(item => item.companyId === jar.session.context.company.id));
  }
});

test("HTTP Import enforces ordered simulation steps and receiver-only Laura access", async () => {
  const jar = await start("david");
  const shipment = jar.session.workspace.imports[0];
  assert.ok(shipment);
  assert.equal((await action(jar, { type: "IMPORT_STEP", shipmentId: shipment.id, step: "RELEASED" })).status, 409);
  for (const step of ["ARRIVED", "DOCUMENTS_READY", "PAYMENT_SIMULATED", "RELEASED", "PICKUP_READY"]) {
    success(await action(jar, { type: "IMPORT_STEP", shipmentId: shipment.id, step }));
  }
  await switchTo(jar, "laura");
  const receiverView = jar.session.workspace.imports.find(item => item.id === shipment.id);
  assert.ok(receiverView);
  assert.equal(receiverView.paymentStatus, "SIMULATED_PAID");
  assert.equal(receiverView.pickupStatus, "SIMULATED_READY");
  assert.equal((await action(jar, { type: "IMPORT_STEP", shipmentId: shipment.id, step: "PAYMENT_SIMULATED" })).status, 403);
  await switchTo(jar, "sarah");
  assert.equal(jar.session.workspace.imports.length, 0);
  assert.equal((await action(jar, { type: "IMPORT_STEP", shipmentId: shipment.id, step: "ARRIVED" })).status, 403);
});

test("HTTP simultaneous withdrawal and acceptance cannot leave stale disclosure", async () => {
  const jar = await start("andy");
  success(await action(jar, { type: "INTEREST", matchId: "match-deepsea" }));
  await switchTo(jar, "sophie");
  const capacityId = match(jar, "match-deepsea").capacityId;
  const replies = await Promise.all([
    { type: "ACCEPT", matchId: "match-deepsea" },
    { type: "WITHDRAW_LISTING", listingId: capacityId },
  ].map(body => request("/api/demo/actions", {
    method: "POST", cookie: jar.cookie, session: jar.session, body,
  })));
  assert.ok(replies.every(reply => [200, 409].includes(reply.status)), JSON.stringify(replies.map(reply => reply.body)));
  assert.equal(replies[1].status, 200, "Owned withdrawal commits independently of concurrent acceptance");
  await switchTo(jar, "andy");
  const staleMatch = match(jar, "match-deepsea");
  assert.notEqual(staleMatch.status, "CONNECTED");
  assert.equal(staleMatch.contact, undefined);
  assert.equal(staleMatch.assetName, undefined);
  assert.ok(!jar.session.workspace.messages.some(item => item.matchId === "match-deepsea"));
});

test("HTTP separate visitor sandboxes reject body-forged actors and retain isolated edits/reset", async () => {
  const left = await start("andy");
  const right = await start("andy");
  assert.notEqual(left.cookie, right.cookie);
  const cargo = left.session.workspace.cargos[0];
  const original = right.session.workspace.cargos.find(item => item.id === cargo.id);
  assert.ok(original);
  const edited: Record<string, any> = { ...cargo, name: "Visitor A private cargo edit" };
  // Ownership/status fields are server-owned: do not submit them from a form.
  const { id: _id, companyId: _company, status: _status, demo: _demo, ...listing } = edited;
  success(await action(left, { type: "SAVE_LISTING", listingId: cargo.id, listing }));
  const rightReload = success(await request("/api/demo/session", { cookie: right.cookie }));
  assert.equal(rightReload.workspace.cargos.find(item => item.id === cargo.id)?.name, original.name);
  const forged = await action(right, {
    type: "RESET", confirmation: "RESET DEMO", actorId: "emma", personaId: "emma",
    sandboxId: left.cookie, companyId: left.session.context.company.id,
  });
  assert.ok([400, 403].includes(forged.status), JSON.stringify(forged.body));
  await switchTo(right, "emma");
  success(await action(right, { type: "RESET", confirmation: "RESET DEMO" }));
  const leftReload = success(await request("/api/demo/session", { cookie: left.cookie }));
  assert.equal(leftReload.workspace.cargos.find(item => item.id === cargo.id)?.name, edited.name);
});

test("HTTP decline is an explicit incoming-recipient permission, not sender cancellation", async () => {
  for (const [sender, recipient] of [["andy", "sophie"], ["sophie", "andy"]]) {
    const jar = await start(sender!);
    assert.ok(jar.session.context.permissions.includes("DECLINE_CONNECTION"));
    for (const type of ["ACCEPT", "DECLINE"]) {
      const reply = await action(jar, { type, matchId: "match-deepsea" });
      assert.equal(reply.status, 409, `${type} cannot act on NEW`);
      assert.equal(reply.body.code, "INVALID_STATE");
    }
    success(await action(jar, { type: "INTEREST", matchId: "match-deepsea" }));
    for (const type of ["INTEREST", "ACCEPT", "DECLINE"]) {
      assert.equal((await action(jar, { type, matchId: "match-deepsea" })).status, 409, `${type} cannot respond to own sent interest`);
    }
    await switchTo(jar, recipient!);
    assert.equal(match(jar, "match-deepsea").status, "INTEREST_SENT");
    assert.ok(jar.session.context.permissions.includes("DECLINE_CONNECTION"));
    assert.equal((await action(jar, { type: "INTEREST", matchId: "match-deepsea" })).status, 409, "INTEREST cannot bypass ACCEPT");
    success(await action(jar, { type: "DECLINE", matchId: "match-deepsea" }));
    assert.equal(match(jar, "match-deepsea").status, "DECLINED");
    assert.equal(match(jar, "match-deepsea").leftConsent, false);
    assert.equal(match(jar, "match-deepsea").rightConsent, false);
    for (const type of ["INTEREST", "ACCEPT", "DECLINE"]) {
      assert.equal((await action(jar, { type, matchId: "match-deepsea" })).status, 409, `${type} cannot reopen DECLINED`);
    }
    await switchTo(jar, sender!);
    assert.equal(match(jar, "match-deepsea").status, "DECLINED", "Decline persists for both parties");
  }
});

test("HTTP connected matches cannot be declined or re-consented", async () => {
  const jar = await start("andy");
  await connect(jar, "match-deepsea", "sophie");
  success(await action(jar, {type: "MESSAGE", matchId: "match-deepsea", body: "Existing connected conversation"}));
  for (const persona of ["sophie", "andy"]) {
    await switchTo(jar, persona);
    for (const type of ["INTEREST", "ACCEPT", "DECLINE"]) {
      const reply = await action(jar, {type, matchId: "match-deepsea"});
      assert.equal(reply.status, 409);
      assert.equal(reply.body.code, "INVALID_STATE");
    }
    jar.session = success(await request("/api/demo/session", {cookie: jar.cookie}));
    assert.equal(match(jar, "match-deepsea").status, "CONNECTED");
    assert.ok(jar.session.workspace.messages.some(message => message.body === "Existing connected conversation"));
  }
});

test("HTTP operational recipients cannot decline incoming commercial interest", async () => {
  for (const [operator, mode] of [["mark", "inland"], ["jan", "road"]]) {
    const jar = await start("laura");
    success(await action(jar, {type: "INTEREST", matchId: `match-${mode}`}));
    await switchTo(jar, operator!);
    assert.ok(!jar.session.context.permissions.includes("DECLINE_CONNECTION"));
    const reply = await action(jar, {type: "DECLINE", matchId: `match-${mode}`});
    assert.equal(reply.status, 403);
    assert.equal(reply.body.code, "FORBIDDEN");
    jar.session = success(await request("/api/demo/session", {cookie: jar.cookie}));
    assert.equal(match(jar, `match-${mode}`).status, "INTEREST_SENT");
  }
});

test("HTTP stale tabs and simultaneous switches cannot mutate under a changed principal", async () => {
  const jar = await start("andy");
  const stale = { cookie: jar.cookie, session: structuredClone(jar.session) };
  const switches = await Promise.all(["sophie", "emma"].map(personaId => request("/api/demo/switch", {
    method: "POST", cookie: stale.cookie, session: stale.session, body: { personaId },
  })));
  assert.equal(switches.filter(reply => reply.status === 200).length, 1);
  assert.equal(switches.filter(reply => reply.status === 409).length, 1);
  const staleAction = await request("/api/demo/actions", {
    method: "POST", cookie: stale.cookie, session: stale.session,
    body: { type: "INTEREST", matchId: "match-deepsea" },
  });
  assert.equal(staleAction.status, 409);
  assert.equal(staleAction.body.code, "STALE_DEMO_PRINCIPAL");
  jar.session = success(await request("/api/demo/session", { cookie: jar.cookie }));
  await switchTo(jar, "emma");
  const beforeReset = structuredClone(jar.session);
  success(await action(jar, { type: "RESET", confirmation: "RESET DEMO" }));
  assert.ok(jar.session.revision > beforeReset.revision);
  assert.equal((await request("/api/demo/actions", {
    method: "POST", cookie: jar.cookie, session: beforeReset,
    body: { type: "RESET", confirmation: "RESET DEMO" },
  })).status, 409);
});

test("HTTP expired sessions and logout stop reads and writes", async () => {
  const jar = await start("andy");
  await db.update(demoSandboxesTable).set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(demoSandboxesTable.csrfToken, jar.session.csrfToken));
  assert.equal((await request("/api/demo/session", { cookie: jar.cookie })).status, 401);
  assert.equal((await action(jar, { type: "INTEREST", matchId: "match-deepsea" })).status, 401);
  const live = await start("andy");
  const cookie = live.cookie;
  assert.equal((await post(live, "logout", {})).status, 204);
  assert.equal((await request("/api/demo/session", { cookie })).status, 401);
});

test("HTTP demo endpoints are unavailable in production and when explicitly disabled", async () => {
  const jar = await start("emma");
  for (const gate of ["production", "disabled"]) {
    process.env.NODE_ENV = gate === "production" ? "production" : "test";
    process.env.DEMO_ENABLED = gate === "disabled" ? "false" : "true";
    try {
      assert.equal((await request("/api/demo/session", { cookie: jar.cookie })).status, 404);
      assert.equal((await request("/api/demo/start", { method: "POST", body: { personaId: "emma" } })).status, 404);
      assert.equal((await action(jar, { type: "RESET", confirmation: "RESET DEMO" })).status, 404);
    } finally {
      process.env.NODE_ENV = "test";
      delete process.env.DEMO_ENABLED;
    }
  }
});