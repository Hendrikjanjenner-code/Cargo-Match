import React, { useState, useEffect, useCallback } from "react";

export function useDemoRouting() {
  const [params, setParams] = useState(() => new URLSearchParams(window.location.search));

  useEffect(() => {
    const handlePopState = () => setParams(new URLSearchParams(window.location.search));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback((updates: Record<string, string | null>) => {
    const url = new URL(window.location.href);
    let changed = false;
    
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        if (url.searchParams.has(key)) {
          url.searchParams.delete(key);
          changed = true;
        }
      } else {
        if (url.searchParams.get(key) !== value) {
          url.searchParams.set(key, value);
          changed = true;
        }
      }
    }

    if (changed) {
      window.history.pushState({}, "", url);
      setParams(new URLSearchParams(url.search));
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, []);

  const view = params.get("demoView") || "dashboard";
  const mode = params.get("demoMode") || null;
  const entityId = params.get("entityId") || null;

  return { view, mode, entityId, navigate };
}
