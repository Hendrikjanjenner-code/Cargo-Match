import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { type DemoSession, demoApi, type DemoAction, DemoApiError } from "./api";

type Status = "LOADING" | "ERROR" | "READY" | "STALE" | "IDLE";
interface DemoContextValue {
  session: DemoSession | null;
  status: Status;
  busy: boolean;
  errorMsg: string | null;
  startDemo: (personaId?: string) => Promise<void>;
  switchPersona: (personaId: string) => Promise<void>;
  logout: () => Promise<void>;
  executeAction: (action: DemoAction) => Promise<void>;
  reloadSession: () => Promise<void>;
}
const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children, onExit }: { children: React.ReactNode; onExit: () => void }) {
  const [session, setSession] = useState<DemoSession | null>(null);
  const [status, setStatus] = useState<Status>("LOADING");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const current = useRef<DemoSession | null>(null);
  const pending = useRef(false);
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);

  const clearPrivate = useCallback(() => { current.current = null; setSession(null); }, []);
  const apply = useCallback((data: DemoSession) => {
    current.current = data;
    setSession(data);
    setStatus("READY");
    setErrorMsg(null);
  }, []);
  const fail = useCallback((error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (error instanceof DemoApiError && error.status === 401) {
      clearPrivate(); setStatus("IDLE"); return;
    }
    if (error instanceof DemoApiError && ["STALE_DEMO_PRINCIPAL", "DEMO_CSRF"].includes(error.code)) {
      clearPrivate(); setStatus("STALE");
      setErrorMsg("Het profiel is in een ander tabblad gewijzigd. Herlaad de context voordat je verdergaat; je actie is niet opnieuw uitgevoerd.");
      return;
    }
    setStatus("ERROR");
    setErrorMsg(error instanceof DemoApiError ? error.message : "Geen verbinding met de demoserver. Controleer je verbinding en probeer opnieuw.");
  }, [clearPrivate]);

  const reload = useCallback(async (background = false) => {
    if (pending.current) return;
    const token = ++epoch.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    if (!background) { clearPrivate(); setStatus("LOADING"); }
    try {
      const data = await demoApi.getSession(request.signal);
      if (token === epoch.current) apply(data);
    } catch (error) { if (token === epoch.current) fail(error); }
  }, [apply, clearPrivate, fail]);
  const reloadSession = useCallback(() => reload(false), [reload]);

  useEffect(() => {
    void reload();
    // The channel carries no identity, records, session cookie or CSRF token.
    try {
      channel.current = new BroadcastChannel("cargomatch-demo-context");
      channel.current.onmessage = () => {
        ++epoch.current;
        controller.current?.abort();
        clearPrivate();
        setStatus("STALE");
        setErrorMsg("De demo is gewijzigd in een ander tabblad. Herlaad om de actuele, bevoegde context te gebruiken.");
      };
    } catch { /* Focus refresh and server revision checks also protect unsupported browsers. */ }
    const refresh = () => { if (document.visibilityState === "visible") void reload(true); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 20_000);
    return () => {
      ++epoch.current; controller.current?.abort(); channel.current?.close();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(interval);
    };
  }, [reload, clearPrivate]);

  const write = useCallback(async (
    operation: (snapshot: DemoSession | null, signal: AbortSignal) => Promise<DemoSession | void>,
    replacePrincipal = false,
    rethrow = false,
    resetRoute = false,
  ) => {
    if (pending.current) {
      if (rethrow) throw new DemoApiError("BUSY", "Wacht tot de vorige actie klaar is.");
      return;
    }
    const snapshot = current.current;
    pending.current = true; setBusy(true);
    const token = ++epoch.current;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setErrorMsg(null);
    if (replacePrincipal) {
      clearPrivate(); setStatus("LOADING");
      channel.current?.postMessage("context-changing");
    }
    try {
      const data = await operation(snapshot, request.signal);
      if (token !== epoch.current) return;
      if (resetRoute) {
        const url = new URL(window.location.href);
        ["demoView", "demoMode", "entityId"].forEach(key => url.searchParams.delete(key));
        window.history.replaceState(null, "", url);
      }
      if (data) apply(data);
      else { clearPrivate(); setStatus("IDLE"); onExit(); }
      channel.current?.postMessage("context-changed");
    } catch (error) {
      if (token === epoch.current) fail(error);
      if (rethrow) throw error;
    } finally {
      pending.current = false; setBusy(false);
    }
  }, [apply, clearPrivate, fail, onExit]);

  const requireSession = (value: DemoSession | null) => {
    if (!value) throw new DemoApiError("NO_SESSION", "Herlaad de demosessie.", 401);
    return value;
  };
  const startDemo = useCallback((personaId?: string) => write((_, signal) => demoApi.start(personaId, signal), true), [write]);
  const switchPersona = useCallback((personaId: string) => write((snapshot, signal) => {
    const s = requireSession(snapshot);
    return demoApi.switchPersona(personaId, s.csrfToken, s.revision, signal);
  }, true, false, true), [write]);
  const logout = useCallback(() => write((snapshot, signal) => {
    const s = requireSession(snapshot);
    return demoApi.logout(s.csrfToken, s.revision, signal);
  }, true), [write]);
  const executeAction = useCallback((action: DemoAction) => write((snapshot, signal) => {
    const s = requireSession(snapshot);
    return demoApi.executeAction(action, s.csrfToken, s.revision, signal);
  }, action.type === "RESET", true, action.type === "RESET"), [write]);

  return <DemoContext.Provider value={{ session, status, busy, errorMsg, startDemo, switchPersona, logout, executeAction, reloadSession }}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error("DemoProvider ontbreekt.");
  return context;
}