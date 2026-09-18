import { Route, Switch, Redirect, Router } from "wouter";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";

import Landing from "./pages/public/Landing";
import Onboarding from "./pages/onboarding/Onboarding";
import Shell from "./components/layout/Shell";
import Overview from "./pages/dashboard/Overview";
import Vessels from "./pages/vessels/Vessels";
import Cargo from "./pages/cargo/Cargo";
import Capacity from "./pages/capacity/Capacity";
import Marketplace from "./pages/marketplace/Marketplace";
import Matches from "./pages/matches/Matches";
import MatchDetail from "./pages/matches/MatchDetail";
import Messages from "./pages/messages/Messages";
import MessageDetail from "./pages/messages/MessageDetail";
import CompanyProfile from "./pages/company/CompanyProfile";
import Notifications from "./pages/notifications/Notifications";

import DeepseaVessels from "./pages/deepsea/DeepseaVessels";
import DeepseaCargo from "./pages/deepsea/DeepseaCargo";
import DeepseaCapacity from "./pages/deepsea/DeepseaCapacity";
import DeepseaMarketplace from "./pages/deepsea/DeepseaMarketplace";
import DeepseaMatches from "./pages/deepsea/DeepseaMatches";
import DeepseaMatchDetail from "./pages/deepsea/DeepseaMatchDetail";

import DemoApp from "./demo/DemoApp";
import { DemoEntryContext } from "./demo/entry";
import { ENTRY_STORAGE_KEY, resolveEntryMode, entryUrl } from "./demo/entry-mode";
import { DEMO_UI_ENABLED } from "./demo/demo-availability";
import { t } from "./lib/i18n";
import { useGetMyCompany, getGetMyCompanyQueryKey, CompanyActivity } from "@workspace/api-client-react";
import LinerServices from "./pages/liner/LinerServices";
import LinerCargo from "./pages/liner/LinerCargo";
import LinerMarketplace from "./pages/liner/LinerMarketplace";
import LinerMatches from "./pages/liner/LinerMatches";
import LinerMatchDetail from "./pages/liner/LinerMatchDetail";
import RoadPilot from "./pages/road/RoadPilot";

function ProtectedRoute({ component: Component, requireCompany = true, allowedActivities = [] }: { component: React.ComponentType, requireCompany?: boolean, allowedActivities?: CompanyActivity[] }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const { data: company, isLoading: companyLoading, error } = useGetMyCompany({
    query: {
      enabled: isAuthenticated,
      queryKey: getGetMyCompanyQueryKey(),
      retry: false
    }
  });

  if (authLoading || (isAuthenticated && companyLoading && !error)) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">{t("common.loading")}</div>;
  }

  if (!isAuthenticated) {
    return <Landing />;
  }

  if (requireCompany && !company) {
    if (error && (error as { status?: number }).status !== 404) {
      return <div role="alert" className="p-8">{t("error.load_company")}</div>;
    }
    return <Redirect to="/onboarding" />;
  }

  if (requireCompany && company && allowedActivities.length > 0) {
    const hasAllowedActivity = company.activities.some(a => allowedActivities.includes(a));
    if (!hasAllowedActivity) {
      return (
        <Shell>
          <div className="p-12 text-center">
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground">Your company profile does not have the required role to access this section.</p>
          </div>
        </Shell>
      );
    }
  }

  if (!requireCompany && company) {
    return <Redirect to="/" />;
  }

  if (!requireCompany) {
    return <Component />;
  }

  return (
    <Shell>
      <Component />
    </Shell>
  );
}

function HomeRoute() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <ProtectedRoute component={Overview} /> : <Landing />;
}

function AppRouter() {
  return (
    <Switch>
      {/* Public / Entry route */}
      <Route path="/">
        <HomeRoute />
      </Route>

      <Route path="/onboarding">
        {() => <ProtectedRoute component={Onboarding} requireCompany={false} />}
      </Route>

      {/* Dashboard Routes */}
      <Route path="/vessels">{() => <ProtectedRoute component={Vessels} />}</Route>
      <Route path="/cargo">{() => <ProtectedRoute component={Cargo} />}</Route>
      <Route path="/capacity">{() => <ProtectedRoute component={Capacity} />}</Route>
      <Route path="/marketplace">{() => <ProtectedRoute component={Marketplace} />}</Route>
      <Route path="/matches">{() => <ProtectedRoute component={Matches} />}</Route>
      <Route path="/matches/:id">{() => <ProtectedRoute component={MatchDetail} />}</Route>
      <Route path="/messages">{() => <ProtectedRoute component={Messages} />}</Route>
      <Route path="/messages/:id">{() => <ProtectedRoute component={MessageDetail} />}</Route>
      <Route path="/company">{() => <ProtectedRoute component={CompanyProfile} />}</Route>
      <Route path="/notifications">{() => <ProtectedRoute component={Notifications} />}</Route>

      {/* Deepsea Routes */}
      <Route path="/deepsea/vessels">{() => <ProtectedRoute component={DeepseaVessels} />}</Route>
      <Route path="/deepsea/cargo">{() => <ProtectedRoute component={DeepseaCargo} />}</Route>
      <Route path="/deepsea/capacity">{() => <ProtectedRoute component={DeepseaCapacity} />}</Route>
      <Route path="/deepsea/marketplace">{() => <ProtectedRoute component={DeepseaMarketplace} />}</Route>
      <Route path="/deepsea/matches">{() => <ProtectedRoute component={DeepseaMatches} />}</Route>
      <Route path="/deepsea/matches/:id">{() => <ProtectedRoute component={DeepseaMatchDetail} />}</Route>

      {/* Liner Routes */}
      <Route path="/liner/services">{() => <ProtectedRoute component={LinerServices} allowedActivities={[CompanyActivity.CARRIER]} />}</Route>
      <Route path="/liner/cargo">{() => <ProtectedRoute component={LinerCargo} allowedActivities={[CompanyActivity.SHIPPER, CompanyActivity.CHARTERER]} />}</Route>
      <Route path="/liner/marketplace">{() => <ProtectedRoute component={LinerMarketplace} />}</Route>
      <Route path="/liner/matches">{() => <ProtectedRoute component={LinerMatches} />}</Route>
      <Route path="/liner/matches/:id">{() => <ProtectedRoute component={LinerMatchDetail} />}</Route>

      {/* Road freight pilot routes */}
      <Route path="/road">{() => <Redirect to="/road/assets" />}</Route>
      <Route path="/road/assets">{() => <ProtectedRoute component={RoadPilot} />}</Route>
      <Route path="/road/capacity">{() => <ProtectedRoute component={RoadPilot} />}</Route>
      <Route path="/road/cargo">{() => <ProtectedRoute component={RoadPilot} />}</Route>
      <Route path="/road/opportunities">{() => <ProtectedRoute component={RoadPilot} />}</Route>
      <Route path="/road/matches">{() => <ProtectedRoute component={RoadPilot} />}</Route>
      <Route path="/road/matches/:id">{({ id }) => <ProtectedRoute component={() => <RoadPilot matchId={id} />} />}</Route>

      <Route>
        <div className="flex items-center justify-center min-h-screen">{t("not_found.title")}</div>
      </Route>
    </Switch>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 10_000 } },
});

export default function App() {
  const [mode, setMode] = useState<"landing" | "demo" | "real">(() => {
    // The URL marker also preserves the local entry choice when session storage
    // is unavailable. It never represents authentication as a real account.
    return resolveEntryMode(new URL(window.location.href), import.meta.env.BASE_URL,
      () => sessionStorage.getItem(ENTRY_STORAGE_KEY), DEMO_UI_ENABLED);
  });
  const [demoPersonaId, setDemoPersonaId] = useState<string>();
  const [entryError, setEntryError] = useState("");
  const changeMode = (next: "landing" | "demo" | "real", personaId?: string) => {
    if (next === "demo" && !DEMO_UI_ENABLED) {
      setEntryError("De demo is in deze omgeving uitgeschakeld. Gebruik standaard inloggen.");
      return;
    }
    let warning = "";
    try {
      sessionStorage.setItem(ENTRY_STORAGE_KEY, next);
    } catch {
      warning = "Sessieopslag is niet beschikbaar. De demokeuze blijft in dit tabblad via de URL behouden.";
      try { sessionStorage.removeItem(ENTRY_STORAGE_KEY); } catch { /* Unavailable storage. */ }
    }
    // Unmount real consumers immediately; no auth hook is mounted in the demo.
    void queryClient.cancelQueries();
    queryClient.clear();
    window.history.replaceState(null, "", entryUrl(import.meta.env.BASE_URL, next));
    setDemoPersonaId(next === "demo" ? personaId : undefined);
    setMode(next);
    setEntryError(warning);
    if (next === "real") {
      window.location.assign(`/api/login?returnTo=${encodeURIComponent(import.meta.env.BASE_URL)}`);
    }
  };
  return (
    <QueryClientProvider client={queryClient}>
      <DemoEntryContext.Provider value={{
        startDemo: (personaId?: string) => { changeMode("demo", personaId); },
        loginReal: () => { void changeMode("real"); },
      }}>
        {entryError && <div role="alert" className="p-4 bg-destructive/10 text-destructive">{entryError}</div>}
        {mode === "demo" && DEMO_UI_ENABLED ? <DemoApp initialPersonaId={demoPersonaId} onLoginReal={() => changeMode("real")} onExit={() => { changeMode("landing"); }} /> :
          <Router base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            {mode === "landing" ? <Landing /> : <AppRouter />}
          </Router>}
      </DemoEntryContext.Provider>
    </QueryClientProvider>
  );
}
