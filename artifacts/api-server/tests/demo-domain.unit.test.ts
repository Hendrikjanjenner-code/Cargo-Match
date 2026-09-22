import assert from "node:assert/strict";
import test from "node:test";
import { seedDemo, PERSONAS } from "../src/services/demo/seed";
import { applyAction, eligible, LOCATIONS, projectSession, refreshMatches } from "../src/services/demo/domain";
import { coreEvaluation, corePair, linerPair } from "../src/services/demo/core-adapter";
import { evaluateEligibility, scoreEligiblePair, scoreRoadEligiblePair, scoreDeepseaEligiblePair } from "../src/services/matching";
import { evaluateLinerEligibility } from "../src/services/liner";
import { DemoError, type DemoState, type Listing, type Sandbox } from "../src/services/demo/types";

const now = new Date();
const box = (personaId = "andy"): Sandbox => ({csrfToken: "unit-test-only", revision: 1, personaId, state: seedDemo(now)});
function pair(state: DemoState, mode: string) {
  const cargo = state.listings.find(l => l.id === `cargo-${mode}`)!;
  const capacity = state.listings.find(l => l.id === `capacity-${mode}`)!;
  const asset = state.assets.find(a => a.id === capacity.assetId)!;
  return {cargo, capacity, asset};
}
test("all original and import personas, consistent owners and intentional positive/negative mode seeds", () => {
  const state = seedDemo(now);
  assert.equal(PERSONAS.length, 15);
  assert.equal(new Set(state.assets.map(a => a.id)).size, state.assets.length);
  for (const mode of ["inland", "deepsea", "road", "rail", "air", "liner"]) {
    const {cargo, capacity} = pair(state, mode);
    assert.equal(eligible(state, cargo, capacity, now), true, mode);
    assert.equal(eligible(state, state.listings.find(l => l.id === `cargo-${mode}-incompatible`)!, capacity, now), false, `${mode} overweight`);
    assert.equal(eligible(state, cargo, state.listings.find(l => l.id === `capacity-${mode}-private`)!, now), false, `${mode} private`);
  }
  for (const actor of PERSONAS) for (const id of actor.assignedAssetIds) assert.equal(state.assets.find(a => a.id === id)?.companyId, actor.companyId);
  assert.equal(state.matches.find(m => m.id === "match-deepsea")?.status, "NEW");
});

test("source-prompt module aliases and optional guide match actual demo availability", () => {
  const previous = process.env.DEMO_GUIDED_ENABLED;
  try {
    delete process.env.DEMO_GUIDED_ENABLED;
    const session = projectSession(box());
    assert.equal(session.context.modules.AIR_CARGO, session.context.modules.AIR);
    assert.equal(session.context.modules.CARGOMATCH_IMPORT, session.context.modules.IMPORT);
    assert.equal(session.context.modules.DEMO_MODE, "ACTIVE");
    assert.equal(session.context.modules.GUIDED_DEMO, "PILOT");
    process.env.DEMO_GUIDED_ENABLED = "false";
    assert.equal(projectSession(box()).context.modules.GUIDED_DEMO, "HIDDEN");
  } finally {
    if (previous === undefined) delete process.env.DEMO_GUIDED_ENABLED;
    else process.env.DEMO_GUIDED_ENABLED = previous;
  }
});

for (const mode of ["inland", "deepsea", "road"]) {
  test(`${mode}: adapter eligibility and numeric score are the original pure matcher result`, () => {
    const state = seedDemo(now), {cargo, capacity, asset} = pair(state, mode);
    const p = corePair(state, cargo, capacity, asset, LOCATIONS);
    const result = evaluateEligibility(p, now);
    assert.equal(result.eligible, true);
    if (!result.eligible) return;
    const productionScore = mode === "deepsea" ? scoreDeepseaEligiblePair(p, result.distanceKm, now) : mode === "road" ? scoreRoadEligiblePair(p, result.distanceKm) : scoreEligiblePair(p, result.distanceKm);
    assert.equal(coreEvaluation(state, cargo, capacity, asset, LOCATIONS, now).score, productionScore.totalScore);
    for (const mutate of [
      (c: Listing) => { c.quantity = 1e7; },
      (c: Listing) => { c.visibility = "PRIVATE"; },
      (c: Listing) => { c.status = "DRAFT"; },
      (c: Listing) => { c.availableUntil = new Date(now.getTime() - 1000).toISOString(); },
      (c: Listing) => { c.technical!.cargoType = "incompatible chemical"; },
    ]) {
      const c = structuredClone(cargo); mutate(c);
      assert.equal(eligible(state, c, capacity, now), evaluateEligibility(corePair(state, c, capacity, asset, LOCATIONS), now).eligible);
      assert.equal(eligible(state, c, capacity, now), false);
    }
  });
}
test("inland retains full window coverage, vessel type and positioning limits", () => {
  const state = seedDemo(now), {cargo, capacity, asset} = pair(state, "inland");
  const late = {...capacity, availableFrom: new Date(Date.parse(cargo.availableFrom) + 1000).toISOString()};
  assert.equal(eligible(state, cargo, late, now), false);
  assert.equal(eligible(state, {...cargo, technical: {...cargo.technical, requiredVesselType: "TANKER"}}, capacity, now), false);
  assert.equal(eligible(state, cargo, {...capacity, origin: "Singapore"}, now), false);
  assert.equal(coreEvaluation(state, cargo, {...capacity, origin: "Singapore"}, asset, LOCATIONS, now).eligible, false);
});
test("deepsea retains DWT/draft/gear/tolerance/manual timing and approximate positioning checks", () => {
  const state = seedDemo(now), {cargo, capacity} = pair(state, "deepsea");
  for (const technical of [{minimumDwt: 100000}, {maxDraft: 5}, {gear: "ship crane"}]) {
    assert.equal(eligible(state, {...cargo, technical: {...cargo.technical, ...technical}}, capacity, now), false);
  }
  assert.equal(eligible(state, cargo, {...capacity, technical: {...capacity.technical, manualPositioningDays: 20}}, now), false);
  assert.equal(eligible(state, cargo, {...capacity, origin: "Rotterdam"}, now), false);
  assert.equal(eligible(state, {...cargo, quantity: 85000, technical: {...cargo.technical, quantityTolerancePercent: 5}}, capacity, now), true);
  assert.equal(eligible(state, {...cargo, quantity: 85000, technical: {...cargo.technical, quantityTolerancePercent: 0}}, capacity, now), false);
});
test("road retains equipment, ADR, trailer, dimensions, uncertainty, current delivery and direction constraints", () => {
  const state = seedDemo(now), {cargo, capacity} = pair(state, "road");
  for (const technical of [{adrClasses: ["3"]}, {requiredTrailerType: "REEFER"}, {loadingMetres: 20}, {pallets: 50}, {temperatureMin: -20, temperatureMax: -10}]) {
    assert.equal(eligible(state, {...cargo, technical: {...cargo.technical, ...technical}}, capacity, now), false);
  }
  assert.equal(eligible(state, {...cargo, equipment: ["tail lift"]}, capacity, now), false);
  assert.equal(eligible(state, {...cargo, volume: 200}, capacity, now), false);
  assert.equal(eligible(state, cargo, {...capacity, technical: {...capacity.technical, preferredDirection: "Hamburg"}}, now), false);
  assert.equal(eligible(state, cargo, {...capacity, technical: {...capacity.technical, expectedAvailabilityAt: cargo.availableUntil}}, now), false);
  assert.equal(eligible(state, cargo, {...capacity, technical: {...capacity.technical, currentDeliveryExpectedAt: cargo.availableUntil}}, now), false);
});
test("liner adapter uses production rotation, readiness, cutoff, piece limits, lifting and stowage", () => {
  const state = seedDemo(now), {cargo, capacity, asset} = pair(state, "liner");
  assert.equal(evaluateLinerEligibility(linerPair(state, cargo, capacity, asset), now).eligible, true);
  for (const technical of [{pieceWeight: 200}, {pieceLength: 30}, {pieceWidth: 20}, {pieceHeight: 20}, {requiredLifting: 200}, {cargoType: "RORO"}]) {
    const c = {...cargo, technical: {...cargo.technical, ...technical}};
    assert.equal(eligible(state, c, capacity, now), evaluateLinerEligibility(linerPair(state, c, capacity, asset), now).eligible);
    assert.equal(eligible(state, c, capacity, now), false);
  }
  assert.equal(eligible(state, cargo, {...capacity, technical: {...capacity.technical, stowage: "DECK"}}, now), false);
  assert.equal(eligible(state, cargo, {...capacity, destination: "Antwerp"}, now), false);
  assert.equal(eligible(state, {...cargo, availableFrom: capacity.availableFrom}, capacity, now), false);
});
test("rail and air reject wrong technical requirements and late readiness, not just tonnage", () => {
  const state = seedDemo(now), rail = pair(state, "rail"), air = pair(state, "air");
  for (const technical of [{wagonType: "TANK"}, {wagonCount: 13}]) assert.equal(eligible(state, {...rail.cargo, technical: {...rail.cargo.technical, ...technical}}, rail.capacity, now), false);
  assert.equal(eligible(state, {...air.cargo, volume: 29}, air.capacity, now), false);
  assert.equal(eligible(state, {...air.cargo, destination: "AMS"}, air.capacity, now), false);
  assert.equal(eligible(state, {...air.cargo, availableFrom: air.capacity.availableFrom}, air.capacity, now), false);
});
test("primary consent, message, projection, and material edits invalidate only relevant context", () => {
  const sandbox = box();
  refreshMatches(sandbox.state, now);
  assert.equal(projectSession(sandbox).workspace.matches.find(m => m.id === "match-deepsea")?.counterpartyName, undefined);
  applyAction(sandbox, {type: "INTEREST", matchId: "match-deepsea"});
  sandbox.personaId = "sophie";
  applyAction(sandbox, {type: "ACCEPT", matchId: "match-deepsea"});
  applyAction(sandbox, {type: "MESSAGE", matchId: "match-deepsea", body: "Fictief akkoord voor overleg."});
  sandbox.personaId = "andy";
  assert.equal(projectSession(sandbox).workspace.matches.find(m => m.id === "match-deepsea")?.counterpartyName, "OceanBridge Bulk Demo");
  assert.equal(projectSession(sandbox).workspace.messages.length, 1);
  sandbox.personaId = "sarah";
  assert.equal(projectSession(sandbox).workspace.messages.length, 0);
  sandbox.personaId = "sophie";
  const own = pair(sandbox.state, "deepsea").capacity;
  applyAction(sandbox, {type: "SAVE_LISTING", listingId: own.id, listing: {...own, quantity: 81000}});
  assert.equal(sandbox.state.matches.find(m => m.id === "match-deepsea")?.leftConsent, false);
  assert.equal(sandbox.state.messages.some(m => m.matchId === "match-deepsea"), false);
  assert.equal(sandbox.state.matches.find(m => m.id === "match-inland-existing")?.status, "CONNECTED");
});
test("operational evidence/referrals never promote commercial publication or consent", () => {
  for (const [operator, planner, mode] of [["mark", "eva", "inland"], ["jan", "thomas", "road"]]) {
    const sandbox = box(operator), {capacity, asset} = pair(sandbox.state, mode!);
    const listing = JSON.stringify(capacity);
    applyAction(sandbox, {type: "CONFIRM_AVAILABILITY", assetId: asset.id, availableAt: asset.availableAt});
    applyAction(sandbox, {type: "SEND_TO_PLANNER", matchId: `match-${mode}`, note: "Beoordeel deze oefenkans"});
    assert.equal(JSON.stringify(capacity), listing);
    assert.equal(sandbox.state.matches.find(m => m.id === `match-${mode}`)?.leftConsent, false);
    assert.throws(() => applyAction(sandbox, {type: "INTEREST", matchId: `match-${mode}`}), (e: unknown) => e instanceof DemoError && e.status === 403);
    sandbox.personaId = planner!;
    assert.equal(projectSession(sandbox).workspace.referrals.length, 1);
    applyAction(sandbox, {type: "REVIEW_REFERRAL", referralId: sandbox.state.referrals[0]!.id});
    assert.equal(sandbox.state.referrals[0]?.status, "REVIEWED");
  }
});
test("CRUD creates owned draft assets/listings, rejects cross-company edits and physical overclaims", () => {
  const sandbox = box("sophie");
  applyAction(sandbox, {type: "SAVE_ASSET", mode: "DEEPSEA", name: "New fictional vessel", assetType: "PANAMAX", capacity: 70000, equipment: ["standard"], location: "Malaysia", availableAt: now.toISOString(), technical: {vesselType: "DRY_CARGO", vesselClass: "PANAMAX"}});
  assert.equal(sandbox.state.assets.at(-1)?.companyId, "oceanbridge");
  const own = pair(sandbox.state, "deepsea").capacity;
  applyAction(sandbox, {type: "SAVE_LISTING", listing: {...own, name: "New fictional open position", quantity: 75000}});
  assert.equal(sandbox.state.listings.at(-1)?.status, "DRAFT");
  assert.throws(() => applyAction(sandbox, {type: "SAVE_LISTING", listing: {...own, quantity: 1e7}}), (e: unknown) => e instanceof DemoError && e.status === 400);
  sandbox.personaId = "andy";
  assert.throws(() => applyAction(sandbox, {type: "SAVE_ASSET", assetId: "asset-deepsea", name: "Unauthorized"}), (e: unknown) => e instanceof DemoError && e.status === 403);
});
test("import receiver is read-only; prerequisites and module flag are authoritative", () => {
  const sandbox = box("laura");
  assert.equal(projectSession(sandbox).workspace.imports.length, 1);
  assert.throws(() => applyAction(sandbox, {type: "IMPORT_STEP", shipmentId: "import-lcl", step: "ARRIVED"}), DemoError);
  sandbox.personaId = "david";
  assert.throws(() => applyAction(sandbox, {type: "IMPORT_STEP", shipmentId: "import-lcl", step: "RELEASED"}), DemoError);
  for (const step of ["ARRIVED", "DOCUMENTS_READY", "PAYMENT_SIMULATED", "RELEASED", "PICKUP_READY"]) applyAction(sandbox, {type: "IMPORT_STEP", shipmentId: "import-lcl", step});
  assert.equal(sandbox.state.imports[0]?.pickupStatus, "SIMULATED_READY");
  const previous = process.env.DEMO_IMPORT_ENABLED;
  try {
    process.env.DEMO_IMPORT_ENABLED = "false";
    assert.deepEqual(projectSession(sandbox).workspace.imports, []);
    assert.equal(projectSession(sandbox).context.modules.IMPORT, "HIDDEN");
    assert.throws(() => applyAction(sandbox, {type: "IMPORT_STEP", shipmentId: "import-lcl", step: "ARRIVED"}), DemoError);
  } finally {
    if (previous === undefined) delete process.env.DEMO_IMPORT_ENABLED; else process.env.DEMO_IMPORT_ENABLED = previous;
  }
});

test("commercial transition matrix rejects all non-incoming accept/decline states without changing consent", () => {
  const states = [
    {status: "NEW" as const, leftConsent: false, rightConsent: false},
    {status: "INTEREST_SENT" as const, leftConsent: true, rightConsent: false},
    {status: "INTEREST_SENT" as const, leftConsent: false, rightConsent: false},
    {status: "INTEREST_SENT" as const, leftConsent: true, rightConsent: true},
    {status: "CONNECTED" as const, leftConsent: true, rightConsent: true},
    {status: "DECLINED" as const, leftConsent: false, rightConsent: false},
    {status: "STALE" as const, leftConsent: false, rightConsent: true},
  ];
  for (const state of states) for (const type of ["ACCEPT", "DECLINE"]) {
    const sandbox = box("andy");
    const match = sandbox.state.matches.find(m => m.id === "match-deepsea")!;
    Object.assign(match, state);
    const before = {...match};
    assert.throws(() => applyAction(sandbox, {type, matchId: match.id}), (e: unknown) => e instanceof DemoError && e.status === 409 && e.code === "INVALID_STATE", `${type} ${state.status}`);
    assert.deepEqual(match, before);
  }
  for (const state of states.filter(s => s.status !== "NEW")) {
    const sandbox = box("andy");
    const match = sandbox.state.matches.find(m => m.id === "match-deepsea")!;
    Object.assign(match, state);
    assert.throws(() => applyAction(sandbox, {type: "INTEREST", matchId: match.id}), (e: unknown) => e instanceof DemoError && e.status === 409);
  }
});

test("DECLINE_CONNECTION is independent from ACCEPT_CONNECTION and absent on operational/admin personas", () => {
  const commercial = ["andy", "sophie", "eva", "laura", "thomas", "anna", "sarah", "david", "michael"];
  for (const persona of PERSONAS) assert.equal(persona.permissions.includes("DECLINE_CONNECTION"), commercial.includes(persona.id), persona.id);
  const sandbox = box("andy");
  applyAction(sandbox, {type: "INTEREST", matchId: "match-deepsea"});
  sandbox.personaId = "sophie";
  const sophie = PERSONAS.find(p => p.id === "sophie")!;
  const original = sophie.permissions;
  try {
    sophie.permissions = original.filter(p => p !== "DECLINE_CONNECTION");
    assert.ok(sophie.permissions.includes("ACCEPT_CONNECTION"));
    assert.throws(() => applyAction(sandbox, {type: "DECLINE", matchId: "match-deepsea"}), (e: unknown) => e instanceof DemoError && e.status === 403);
    sophie.permissions = original.filter(p => p !== "ACCEPT_CONNECTION");
    assert.throws(() => applyAction(sandbox, {type: "ACCEPT", matchId: "match-deepsea"}), (e: unknown) => e instanceof DemoError && e.status === 403);
    applyAction(sandbox, {type: "DECLINE", matchId: "match-deepsea"});
    assert.equal(sandbox.state.matches.find(m => m.id === "match-deepsea")?.status, "DECLINED");
  } finally { sophie.permissions = original; }
});