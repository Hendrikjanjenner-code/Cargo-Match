import assert from "node:assert/strict";
import test from "node:test";
import {
  WORLD_PERSONAS,
  applyWorldConsent,
  createAsset,
  createCargo,
  createOffer,
  confirmRoadAvailability,
  createWorldState,
  discoverWorld,
  editAsset,
  editCargo,
  listWorldMessages,
  refreshWorldMatches,
  sendWorldMessage,
  startDemo,
  worldPermissions,
  worldProjections,
} from "./world";
import { loadWorldState, saveWorldState, type WorldStorage } from "./world-storage";

const now = new Date("2030-01-01T00:00:00.000Z");
const storage = (): WorldStorage => {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};

test("seeds six fictional companies and a positive match for every mode", () => {
  const state = createWorldState(now);
  assert.equal(state.companies.length, 6);
  assert.ok(state.companies.every((company) => company.fictional));
  const matches = refreshWorldMatches(state, now);
  for (const mode of ["INLAND", "DEEPSEA", "LINER", "ROAD"] as const) assert.ok(matches.some((match) => match.mode === mode), mode);
});

test("anonymous discovery is independent and strips identity/private records", () => {
  const state = createWorldState(now);
  const discovered = discoverWorld(state, now);
  assert.ok(discovered.some((item) => item.kind === "CARGO"));
  assert.ok(discovered.some((item) => item.kind === "OFFER"));
  assert.ok(discovered.some((item) => item.kind === "DEPARTURE"));
  assert.ok(!discovered.some((item) => item.id === "cargo-private-negative" || item.id === "offer-road-draft-negative"));
  assert.ok(discovered.every((item) => item.anonymous && item.companyName === undefined && item.detailsVisible === false));
});

test("owner and connected projections differ from anonymous projections", () => {
  const state = createWorldState(now);
  refreshWorldMatches(state, now);
  const owner = worldProjections(state, WORLD_PERSONAS.andy, now);
  assert.ok(owner.some((item) => item.id === "cargo-andy-inland" && item.detailsVisible));
  const first = state.matches.find((match) => match.mode === "INLAND");
  assert.ok(first);
  assert.equal(applyWorldConsent(state, WORLD_PERSONAS.andy, first.id, "INTEREST", now).ok, true);
  assert.equal(applyWorldConsent(state, WORLD_PERSONAS.inland, first.id, "ACCEPT", now).ok, true);
  assert.ok(worldProjections(state, WORLD_PERSONAS.inland, now).some((item) => item.id === first.cargoId && item.detailsVisible));
});

test("consent supports either initiator, idempotence, withdrawal and stale revalidation", () => {
  const state = createWorldState(now);
  refreshWorldMatches(state, now);
  const match = state.matches.find((item) => item.mode === "ROAD");
  assert.ok(match);
  assert.equal(applyWorldConsent(state, WORLD_PERSONAS.shipper, match.id, "INTEREST", now).ok, true);
  assert.equal(applyWorldConsent(state, WORLD_PERSONAS.shipper, match.id, "INTEREST", now).value?.status, "INTEREST_SENT");
  assert.equal(applyWorldConsent(state, WORLD_PERSONAS.shipper, match.id, "WITHDRAW", now).value?.status, "WITHDRAWN");
  const second = state.matches.find((item) => item.mode === "DEEPSEA");
  assert.ok(second);
  assert.equal(applyWorldConsent(state, WORLD_PERSONAS.deepsea, second.id, "INTEREST", now).ok, true);
  const cargo = state.cargos.find((item) => item.id === second.cargoId);
  assert.ok(cargo);
  cargo.readyUntil = "2029-01-01T00:00:00.000Z";
  assert.equal(applyWorldConsent(state, WORLD_PERSONAS.shipper, second.id, "ACCEPT", now).code, "STALE_OFFER");
});

test("messages are available only to connected commercial parties", () => {
  const state = createWorldState(now);
  refreshWorldMatches(state, now);
  const match = state.matches.find((item) => item.mode === "INLAND");
  assert.ok(match);
  assert.equal(applyWorldConsent(state, WORLD_PERSONAS.andy, match.id, "INTEREST", now).ok, true);
  assert.equal(applyWorldConsent(state, WORLD_PERSONAS.inland, match.id, "ACCEPT", now).ok, true);
  assert.equal(sendWorldMessage(state, WORLD_PERSONAS.andy, match.id, "hello", now).ok, true);
  assert.equal(listWorldMessages(state, WORLD_PERSONAS.shipper, match.id).length, 0);
  assert.equal(listWorldMessages(state, WORLD_PERSONAS.inland, match.id).length, 1);
});

test("road drivers only have assigned operational rights", () => {
  const state = createWorldState(now);
  const permissions = worldPermissions(state, WORLD_PERSONAS.roadDriver);
  assert.equal(permissions.canViewCommercialRoad, false);
  assert.equal(permissions.canConsent, false);
  assert.equal(permissions.canConfirmRoadOperations, true);
  assert.equal(worldProjections(state, WORLD_PERSONAS.roadDriver, now).length, 0);
  assert.equal(confirmRoadAvailability(state, WORLD_PERSONAS.roadDriver, "offer-road", "seen", now).ok, true);
});

test("storage reports unavailable, legacy and corrupt data explicitly", () => {
  const local = storage();
  assert.equal(loadWorldState(local).status, "EMPTY");
  const state = createWorldState(now);
  assert.equal(saveWorldState(state, local).ok, true);
  assert.equal(loadWorldState(local).status, "LOADED");
  local.setItem("cargomatch.demo.world.v2", "{broken");
  assert.equal(loadWorldState(local).status, "CORRUPT");
});

test("permissions follow company activity, ownership and road planner/driver boundary", () => {
  const state = createWorldState(now);
  assert.equal(worldPermissions(state, WORLD_PERSONAS.shipper).canCreateCargo, true);
  assert.equal(worldPermissions(state, WORLD_PERSONAS.shipper).canCreateOffer, false);
  assert.equal(worldPermissions(state, WORLD_PERSONAS.inland).canCreateOffer, true);
  assert.equal(worldPermissions(state, WORLD_PERSONAS.roadPlanner).canCreateOffer, true);
  assert.equal(worldPermissions(state, WORLD_PERSONAS.roadDriver).canCreateOffer, false);
  const company = state.companies.find((item) => item.id === "company-inland");
  assert.ok(company);
  company.status = "INACTIVE";
  assert.equal(worldPermissions(state, WORLD_PERSONAS.inland).canCreateOffer, false);
  assert.equal(discoverWorld(state, now).some((item) => item.id === "offer-inland"), false);
});

test("form CRUD rejects mode changes and capacity/linkage inconsistencies", () => {
  const state = createWorldState(now);
  const cargo = state.cargos.find((item) => item.id === "cargo-shipper-inland");
  assert.ok(cargo);
  const badCargo = editCargo(state, WORLD_PERSONAS.shipper, cargo.id, {
    mode: "ROAD", name: cargo.name, cargoType: cargo.cargoType, weightTonnes: cargo.weightTonnes,
    originId: cargo.origin.id, destinationId: cargo.destination.id, readyFrom: cargo.readyFrom, readyUntil: cargo.readyUntil,
  }, now);
  assert.equal(badCargo.ok, false);
  const badAsset = editAsset(state, WORLD_PERSONAS.inland, "asset-delta-barge", {
    mode: "INLAND", name: "too small", type: "DRY_CARGO", capacityTonnes: 10,
  }, now);
  assert.equal(badAsset.ok, false);
  const badOffer = createOffer(state, WORLD_PERSONAS.inland, {
    mode: "DEEPSEA", assetId: "asset-delta-barge", locationId: "loc-rotterdam",
    availableFrom: "2030-01-02T00:00:00.000Z", availableUntil: "2030-01-03T00:00:00.000Z", capacityTonnes: 10, cargoTypes: "dry bulk",
  }, now);
  assert.equal(badOffer.ok, false);
  const created = createCargo(state, WORLD_PERSONAS.shipper, {
    mode: "ROAD", name: "road cargo", cargoType: "general cargo", weightTonnes: 5,
    originId: "loc-utrecht", destinationId: "loc-eindhoven", readyFrom: "2030-01-02", readyUntil: "2030-01-03",
    roadRequirements: { volumeCubicMetres: 10, loadingMetres: 2, palletPositions: 5, requiredEquipment: ["curtainsider"] },
  }, now);
  assert.equal(created.ok, true);
  assert.equal(createAsset(state, WORLD_PERSONAS.shipper, {
    mode: "ROAD", name: "not a carrier asset", type: "TRUCK", capacityTonnes: 10,
  }, now).ok, false);
});

test("each mode has a public unsuitable seed that never becomes a match", () => {
  const state = createWorldState(now);
  const matches = refreshWorldMatches(state, now);
  assert.equal(matches.some((item) => item.offerId === "offer-inland-negative"), false);
  assert.equal(matches.some((item) => item.offerId === "offer-deepsea-negative"), false);
  assert.equal(matches.some((item) => item.offerId === "offer-road-negative"), false);
  assert.equal(matches.some((item) => item.departureId === "departure-liner-negative"), false);
  assert.ok(discoverWorld(state, now).some((item) => item.id === "offer-road-negative"), "public incompatible listings remain independently discoverable");
});

test("changed pending listing invalidates consent and requires renewed interest", () => {
  const state = createWorldState(now);
  refreshWorldMatches(state, now);
  const match = state.matches.find((item) => item.mode === "ROAD" && item.cargoId === "cargo-road");
  assert.ok(match);
  assert.equal(applyWorldConsent(state, WORLD_PERSONAS.shipper, match.id, "INTEREST", now).ok, true);
  const offer = state.offers.find((item) => item.id === match.offerId);
  assert.ok(offer);
  offer.capacityTonnes = 23;
  refreshWorldMatches(state, now);
  assert.equal(match.status, "STALE");
  assert.equal(applyWorldConsent(state, WORLD_PERSONAS.shipper, match.id, "INTEREST", now).ok, true);
  assert.equal(applyWorldConsent(state, WORLD_PERSONAS.roadPlanner, match.id, "ACCEPT", now).ok, true);
});

test("active persona and sender user survive persistence", () => {
  const state = startDemo(WORLD_PERSONAS.shipper, now);
  assert.equal(state.activePersonaId, WORLD_PERSONAS.shipper);
  const local = storage();
  assert.equal(saveWorldState(state, local).ok, true);
  const loaded = loadWorldState(local);
  assert.equal(loaded.status, "LOADED");
  if (loaded.status === "LOADED") assert.equal((loaded.state as typeof state).activePersonaId, WORLD_PERSONAS.shipper);
});