export type EntryMode = "landing" | "demo" | "real";
export const ENTRY_STORAGE_KEY = "cargomatch.entry";

export function resolveEntryMode(
  url: URL,
  basePath: string,
  readSavedMode: () => string | null,
  demoEnabled = true,
): EntryMode {
  const explicit = url.searchParams.get("entry");
  if (explicit === "demo") return demoEnabled ? "demo" : "landing";
  if (explicit === "landing") return explicit;
  try {
    const saved = readSavedMode();
    if (saved === "demo") return demoEnabled ? "demo" : "landing";
    if (saved === "real" || saved === "landing") return saved;
  } catch { /* A blocked browser store is not permission to authenticate. */ }
  return url.pathname === basePath ? "landing" : "real";
}

export function entryUrl(basePath: string, mode: EntryMode) {
  return `${basePath}${mode === "real" ? "" : `?entry=${mode}`}`;
}