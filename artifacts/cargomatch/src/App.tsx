import { Route, Switch, Redirect, Router } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { useGetMyCompany, getGetMyCompanyQueryKey } from "@workspace/api-client-react";

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

function ProtectedRoute({ component: Component, requireCompany = true }: { component: React.ComponentType, requireCompany?: boolean }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const { data: company, isLoading: companyLoading, error } = useGetMyCompany({
    query: {
      enabled: isAuthenticated,
      queryKey: getGetMyCompanyQueryKey(),
      retry: false
    }
  });

  if (authLoading || (isAuthenticated && companyLoading && !error)) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Landing />;
  }

  if (requireCompany && !company) {
    if (error && (error as { status?: number }).status !== 404) {
      return <div role="alert" className="p-8">Unable to load company. Please reload to try again.</div>;
    }
    return <Redirect to="/onboarding" />;
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

function AppRouter() {
  return (
    <Switch>
      {/* Public / Entry route */}
      <Route path="/">
        {() => {
          const { isAuthenticated } = useAuth();
          if (isAuthenticated) {
            return <ProtectedRoute component={Overview} />;
          }
          return <Landing />;
        }}
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

      <Route>
        <div className="flex items-center justify-center min-h-screen">404 Not Found</div>
      </Route>
    </Switch>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 10_000 } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AppRouter />
      </Router>
    </QueryClientProvider>
  );
}
