import assert from "node:assert/strict";
import test from "node:test";
import { inspectLegacyDemo, keepLegacyDemo, deleteLegacyDemo, LEGACY_DEMO_KEYS } from "./legacy-transition";
function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
test("all actual old demo keys require explicit choice; preserving never imports or deletes", () => {
  for (const key of LEGACY_DEMO_KEYS) {
    const local = storage(); local.setItem(key, "old exercise");
    assert.equal(inspectLegacyDemo(local).needsChoice, true);
    keepLegacyDemo(local);
    assert.equal(inspectLegacyDemo(local).needsChoice, false);
    assert.equal(local.getItem(key), "old exercise");
  }
});
test("confirmed removal affects demo storage only", () => {
  const local = storage(); LEGACY_DEMO_KEYS.forEach(key => local.setItem(key, "old"));
  local.setItem("other-app-data", "keep");
  deleteLegacyDemo(local);
  assert.equal(inspectLegacyDemo(local).needsChoice, false);
  assert.equal(local.getItem("other-app-data"), "keep");
});
test("blocked local storage does not prevent server demo", () => {
  assert.equal(inspectLegacyDemo(null).needsChoice, false);
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(inspectLegacyDemo(blocked).needsChoice, false);
  assert.doesNotThrow(() => keepLegacyDemo(blocked));
});