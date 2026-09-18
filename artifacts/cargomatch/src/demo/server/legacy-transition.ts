export const LEGACY_DEMO_KEYS = ["cargomatch.demo.world.v2", "cargomatch.demo.v1", "cargomatch.demo"] as const;
const TRANSITION_KEY = "cargomatch.demo.server-transition";
type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function inspectLegacyDemo(storage: StorageAccess | null) {
  try {
    const keys = LEGACY_DEMO_KEYS.filter(key => storage?.getItem(key) != null);
    return { keys, needsChoice: keys.length > 0 && storage?.getItem(TRANSITION_KEY) !== "KEEP_LOCAL_COPY" };
  } catch { return { keys: [], needsChoice: false }; }
}
export function keepLegacyDemo(storage: StorageAccess | null) {
  try { storage?.setItem(TRANSITION_KEY, "KEEP_LOCAL_COPY"); } catch { /* No server authority is stored here. */ }
}
export function deleteLegacyDemo(storage: StorageAccess) {
  for (const key of LEGACY_DEMO_KEYS) storage.removeItem(key);
  storage.removeItem(TRANSITION_KEY);
}