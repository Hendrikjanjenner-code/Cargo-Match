import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_STORAGE_KEY,
  DEMO_STATE_VERSION,
  createDemoState,
  evaluateDemo,
  isDemoState,
  loadDemoState,
  normalizeDemoCargo,
  saveDemoState,
  clearDemoState,
  type DemoState,
} from "./model";

const now = new Date("2030-01-01T00:00:00.000Z");

test("seeds Andy, three cargos and six internally consistent ship offers", () => {
  const state = createDemoState(now);

  assert.equal(state.profile.name, "Andy Kers");
  assert.equal(state.profile.role, "Transportorganisator / charteraar");
  assert.equal(state.company.name, "Demo Transportplanning");
  assert.deepEqual(state.company.activities, ["CHARTERER"]);
  assert.equal(state.cargos.length, 3);
  assert.equal(state.ships.length, 6);
  assert.equal(state.offers.length, 6);
  for (const ship of state.ships) {
    const offer = state.offers.find((item) => item.id === ship.capacityOfferId);
    assert.ok(offer);
    assert.equal(offer.vesselId, ship.id);
    assert.ok(offer.availableCapacityTonnes <= ship.totalCapacityTonnes);
  }
  assert.equal(state.cargos[0]?.weightTonnes, 1_200);
  assert.equal(state.cargos[0]?.loadingLocation?.name, "Dordrecht");
  assert.equal(state.cargos[0]?.destination, "Duisburg");
});

test("the 1,200 tonne main scenario includes the three suitable offers", () => {
  const state = createDemoState(now);
  const evaluation = evaluateDemo(state, "cargo-dordrecht-duisburg", now);

  assert.equal(evaluation.status, "ACTIVE");
  assert.deepEqual(
    evaluation.matches.map((item) => item.offerId),
    [
      "offer-moerdijk-dry-empty",
      "offer-rotterdam-dry-half",
      "offer-antwerpen-dry-empty",
    ],
  );
  assert.deepEqual(
    evaluation.exclusions.map((item) => [item.offerId, item.reason]),
    [
      ["offer-dordrecht-dry-half", "insufficient_capacity"],
      ["offer-moerdijk-tanker-empty", "vessel_type_incompatible"],
      ["offer-nijmegen-dry-empty", "outside_positioning_distance"],
    ],
  );
});

test("normalizing a seeded edit synchronizes aliases and date-only form fields", () => {
  const state = createDemoState(now);
  const seeded = state.cargos[0];
  assert.ok(seeded);
  const edited = normalizeDemoCargo(
    {
      ...seeded,
      weight: 1_400,
      weightTonnes: 1_400,
      loadingFrom: "2030-01-10T00:00:00.000Z",
      loadingUntil: "2030-01-12T00:00:00.000Z",
      startDate: "2030-01-02",
      endDate: "2030-01-05",
    },
    state,
  );

  assert.equal(edited.weight, 1_400);
  assert.equal(edited.weightTonnes, 1_400);
  assert.equal(edited.startDate, "2030-01-10");
  assert.equal(edited.endDate, "2030-01-12");
  assert.equal(edited.loadingFrom, "2030-01-10T00:00:00.000Z");
  assert.equal(edited.loadingLocation?.name, edited.origin);
  assert.equal(edited.destinationLocation?.name, edited.destination);
});

test("normalizes a new Rotterdam–Nijmegen cargo and evaluates it against Dordrecht capacity", () => {
  const state = createDemoState(now);
  const cargo = normalizeDemoCargo(
    {
      id: "cargo-new-rotterdam-nijmegen",
      origin: "Rotterdam",
      destination: "Nijmegen",
      weight: 800,
      weightTonnes: 800,
      startDate: "2030-01-03",
      endDate: "2030-01-05",
      cargoType: "dry bulk",
    },
    state,
  );
  const evaluation = evaluateDemo(
    { ...state, cargos: [cargo] },
    cargo.id,
    now,
  );

  assert.equal(cargo.loadingLocation?.name, "Rotterdam");
  assert.equal(cargo.destinationLocation?.name, "Nijmegen");
  assert.equal(cargo.startDate, "2030-01-03");
  assert.equal(cargo.loadingUntil, "2030-01-05T00:00:00.000Z");
  assert.ok(
    evaluation.matches.some(
      (match) => match.shipId === "ship-dordrecht-dry-half",
    ),
  );
});

test("changing the main cargo to 1,400 tonnes excludes Rotterdam's 1,300 free tonnes", () => {
  const state = createDemoState(now);
  const cargo = state.cargos.find((item) => item.id === "cargo-dordrecht-duisburg");
  assert.ok(cargo);
  state.cargos[0] = normalizeDemoCargo(
    { ...cargo, weight: 1_400, weightTonnes: 1_400 },
    state,
  );
  const evaluation = evaluateDemo(state, cargo.id, now);

  assert.equal(
    evaluation.matches.some((item) => item.offerId === "offer-rotterdam-dry-half"),
    false,
  );
  assert.equal(
    evaluation.exclusions.find(
      (item) => item.offerId === "offer-rotterdam-dry-half",
    )?.reason,
    "insufficient_capacity",
  );
  assert.equal(evaluation.matches.length, 2);
});

test("rejects an unknown demo location instead of crashing during normalization", () => {
  const state = createDemoState(now);
  assert.throws(
    () =>
      normalizeDemoCargo(
        {
          ...state.cargos[0],
          origin: "Unknown terminal",
        },
        state,
      ),
    /Unknown demo location: Unknown terminal/,
  );
});

test("all seeded exclusion reasons remain explicit", () => {
  const state = createDemoState(now);
  const evaluation = evaluateDemo(state, "cargo-dordrecht-duisburg", now);
  const reasons = new Map(
    evaluation.exclusions.map((item) => [item.offerId, item.reason]),
  );

  assert.equal(reasons.get("offer-dordrecht-dry-half"), "insufficient_capacity");
  assert.equal(
    reasons.get("offer-moerdijk-tanker-empty"),
    "vessel_type_incompatible",
  );
  assert.equal(
    reasons.get("offer-nijmegen-dry-empty"),
    "outside_positioning_distance",
  );
});

test("expired cargo and offers are reported rather than silently matched", () => {
  const state = createDemoState(now);
  const evaluation = evaluateDemo(
    state,
    "cargo-dordrecht-duisburg",
    new Date("2030-01-06T00:00:00.000Z"),
  );

  assert.equal(evaluation.expired, true);
  assert.equal(evaluation.status, "EXPIRED");
  assert.equal(evaluation.matches.length, 0);
  assert.equal(
    evaluation.exclusions.every((item) => item.reason === "expired"),
    true,
  );
});

test("scores use the same bounded weighted components as the core matcher", () => {
  const state = createDemoState(now);
  const evaluation = evaluateDemo(state, "cargo-dordrecht-duisburg", now);
  const match = evaluation.matches.find(
    (item) => item.offerId === "offer-rotterdam-dry-half",
  );
  assert.ok(match);
  const { score } = match;
  const weightedTotal =
    score.distanceScore * 0.3 +
    score.timingScore * 0.25 +
    score.capacityScore * 0.2 +
    score.vesselTypeScore * 0.1 +
    score.directionScore * 0.1 +
    score.cargoCompatibilityScore * 0.05;

  assert.equal(score.totalScore, weightedTotal);
  for (const component of [
    score.distanceScore,
    score.timingScore,
    score.capacityScore,
    score.vesselTypeScore,
    score.directionScore,
    score.cargoCompatibilityScore,
    score.totalScore,
  ]) {
    assert.ok(component >= 0 && component <= 100);
  }
  assert.equal(evaluation.calculationVersion, "v1");
});

test("demo storage is versioned and never shifts windows on reload", () => {
  const state = createDemoState(now);
  const storageData = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string) => storageData.get(key) ?? null,
    setItem: (key: string, value: string) => storageData.set(key, value),
    removeItem: (key: string) => storageData.delete(key),
    clear: () => storageData.clear(),
    key: (_index: number) => null,
    length: 0,
  } as unknown as Storage;
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: fakeStorage,
  });

  try {
    saveDemoState(state);
    const loaded = loadDemoState();
    assert.ok(loaded);
    assert.equal(loaded.version, DEMO_STATE_VERSION);
    assert.equal(loaded.createdAt, state.createdAt);
    assert.equal(loaded.cargos[0]?.loadingFrom, state.cargos[0]?.loadingFrom);
    assert.equal(isDemoState(loaded), true);

    storageData.set(DEMO_STORAGE_KEY, JSON.stringify({ version: 999 }));
    assert.throws(() => loadDemoState(), /beschadigd/);
    storageData.set("unrelated", "keep");
    clearDemoState();
    assert.equal(storageData.has(DEMO_STORAGE_KEY), false);
    assert.equal(storageData.get("unrelated"), "keep");
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previousStorage,
    });
  }
});

test("invalid state cannot be persisted", () => {
  assert.throws(
    () => saveDemoState({ version: 999 } as unknown as DemoState),
    /Invalid CargoMatch demo state/,
  );
});