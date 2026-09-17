export type EntryMode = "landing" | "demo" | "real";
export const ENTRY_STORAGE_KEY = "cargomatch.entry";

export function resolveEntryMode(
  url: URL,
  basePath: string,
  readSavedMode: () => string | null,
): EntryMode {
  const explicit = url.searchParams.get("entry");
  if (explicit === "demo" || explicit === "landing") return explicit;
  try {
    const saved = readSavedMode();
    if (saved === "demo" || saved === "real" || saved === "landing") return saved;
  } catch { /* A blocked browser store is not permission to authenticate. */ }
  return url.pathname === basePath ? "landing" : "real";
}

export function entryUrl(basePath: string, mode: EntryMode) {
  return `${basePath}${mode === "real" ? "" : `?entry=${mode}`}`;
}