import React from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { useQueryClient } from "@tanstack/react-query";
import { 
  LogOut, LayoutDashboard, Ship, Package, Layers, Globe, Truck,
  Handshake, MessageSquare, Building2, Bell, PackageOpen
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { useGetMyCompany, getGetMyCompanyQueryKey } from "@workspace/api-client-react";
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { ContextSidebar, NavGroup } from "./ContextSidebar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { standardAuthority, standardModuleForPath, type StandardModule } from "./standard-authority";

function ShellContent({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { logout, user } = useAuth();
  const queryClient = useQueryClient();

  const handleLogout = async () => {
    await logout();
    queryClient.clear();
  };
  
  const { data: company, isLoading: companyLoading, error: companyError, refetch: reloadCompany } = useGetMyCompany({
    query: {
      enabled: !!user,
      queryKey: getGetMyCompanyQueryKey()
    }
  });

  const authority = standardAuthority(company);
  const currentModule = standardModuleForPath(location);

  const handleModuleChange = (val: string) => {
    if (authority.allowedModules.includes(val as StandardModule)) {
      setLocation(authority.moduleHome(val as StandardModule));
    }
  };

  const navItems = [
    { href: "/", label: t("nav.overview"), icon: LayoutDashboard },
    { href: "/vessels", label: t("nav.vessels"), icon: Ship },
    { href: "/cargo", label: t("nav.cargo"), icon: Package },
    { href: "/capacity", label: t("nav.capacity"), icon: Layers },
    { href: "/marketplace", label: t("nav.marketplace"), icon: Globe },
    { href: "/matches", label: t("nav.matches"), icon: Handshake },
    { href: "/messages", label: t("nav.messages"), icon: MessageSquare },
  ];

  const deepseaNavItems = [
    { href: "/deepsea/vessels", label: t("deepsea.vessels.title"), icon: Ship },
    { href: "/deepsea/cargo", label: t("deepsea.cargo.title"), icon: Package },
    { href: "/deepsea/capacity", label: t("deepsea.capacity.title"), icon: Layers },
    { href: "/deepsea/marketplace", label: t("deepsea.marketplace.title"), icon: Globe },
    { href: "/deepsea/matches", label: t("deepsea.matches.title"), icon: Handshake },
  ];

  const linerNavItems = [
    { href: "/liner/services", label: "Services & Sailings", icon: Ship },
    { href: "/liner/cargo", label: "Breakbulk Cargo", icon: Package },
    { href: "/liner/marketplace", label: "Marketplace", icon: Globe },
    { href: "/liner/matches", label: "Matches", icon: Handshake },
  ];

  const roadNavItems = [
    { href: "/road/assets", label: authority.operational ? "Assigned road assets" : "Road assets", icon: Truck },
    { href: "/road/capacity", label: authority.operational ? "Assigned availability" : "Future capacity", icon: Layers },
    { href: "/road/cargo", label: "Road cargo", icon: Package },
    { href: "/road/opportunities", label: "Next-load opportunities", icon: Globe },
    { href: "/road/matches", label: "Road matches", icon: Handshake },
  ];

  let activeGroups: NavGroup[] = [];

  if (currentModule === "inland") {
    activeGroups.push({ title: t("nav.inland"), items: navItems });
  } else if (currentModule === "deepsea") {
    activeGroups.push({ title: t("nav.deepsea"), items: deepseaNavItems });
  } else if (currentModule === "liner") {
    activeGroups.push({ title: "Liner Breakbulk", items: linerNavItems });
  } else if (currentModule === "road") {
    activeGroups.push({ title: "Road Pilot", items: roadNavItems });
  }

  if (company) {
    activeGroups.push({
      title: "Import",
      items: [{ href: "/import", label: "Import & Control", icon: PackageOpen }],
    });
  }

  activeGroups.push({
    title: "Account",
    items: [
      { href: "/company", label: t("nav.company"), icon: Building2 },
      { href: "/notifications", label: t("nav.notifications"), icon: Bell },
    ]
  });
  // The same predicate also gates the actual page below, not just its link.
  activeGroups = activeGroups.map(group => ({
    ...group, items: group.items.filter(item => !!item.href && (item.href === "/import" ? !!company : authority.canVisit(item.href))),
  })).filter(group => group.items.length > 0);

  const { state, isMobile } = useSidebar();

  const modeSwitcher = (
    <Select value={authority.allowedModules.includes(currentModule) ? currentModule : ""} onValueChange={handleModuleChange} disabled={!authority.allowedModules.length}>
      <SelectTrigger aria-label="Transport module" className="w-full bg-slate-800/50 border-slate-700 text-slate-200 h-9">
        <SelectValue placeholder="No available modules" />
      </SelectTrigger>
      <SelectContent className="bg-slate-800 border-slate-700 text-slate-200">
        {authority.allowedModules.map(mode => <SelectItem key={mode} value={mode}>{{
          inland: t("nav.inland"), deepsea: t("nav.deepsea"), liner: "Liner Breakbulk", road: "Road Pilot",
        }[mode]}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  const headerSlot = (
    <Link href="/" className="flex items-center gap-2 px-2 py-2 mb-2 text-white font-semibold">
      <Ship className="h-6 w-6 text-blue-400" />
      {(state === "expanded" || isMobile) && <span className="tracking-tight">{t("app.name")}</span>}
    </Link>
  );

  const footerSlot = (
    <div className="flex flex-col gap-2">
      {(state === "expanded" || isMobile) && (
        <div className="px-2 py-1 text-xs text-slate-400 overflow-hidden">
          <div className="font-medium text-slate-200 truncate">{company?.name || "No Company"}</div>
          <div className="truncate mb-1">{user?.email}</div>
          <div className="text-[10px]">Membership: {company?.membershipRole || "Unavailable"}</div>
          {company?.activities && company.activities.length > 0 && (
            <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold flex flex-wrap gap-x-1 gap-y-0.5 mt-2">
              {company.activities.map(a => (
                <span key={a} className="bg-slate-800 px-1 py-0.5 rounded">{a.replace(/_/g, ' ')}</span>
              ))}
            </div>
          )}
        </div>
      )}
      <Button
        variant="ghost"
        size={state === "collapsed" && !isMobile ? "icon" : "sm"}
        aria-label={t("auth.logout")}
        title={t("auth.logout")}
        onClick={handleLogout}
        className="w-full justify-start text-slate-300 hover:text-white hover:bg-slate-800"
      >
        <LogOut className={state === "expanded" ? "h-4 w-4 mr-2" : "h-4 w-4"} />
        {(state === "expanded" || isMobile) && t("auth.logout")}
      </Button>
    </div>
  );

  return (
    <>
      <ContextSidebar
        groups={activeGroups}
        headerSlot={headerSlot}
        footerSlot={footerSlot}
        modeSwitcher={state === "expanded" || isMobile ? modeSwitcher : null}
      />
      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-4 border-b bg-background px-4 sm:px-6 shadow-sm">
          <SidebarTrigger className="-ml-1" />
          <div className="flex items-center gap-2 text-foreground font-semibold md:hidden">
            <Ship className="h-5 w-5 text-primary" />
            <span className="tracking-tight">{t("app.name")}</span>
          </div>
          <div className="ml-auto flex items-center space-x-4">
            <div className="text-xs text-muted-foreground hidden sm:block">
              {company?.name || user?.email}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl">
            {companyLoading ? <p role="status">{t("common.loading")}</p> :
              companyError ? <section role="alert"><h1 className="text-xl font-semibold">Company context unavailable</h1><p className="my-3">Your current company permissions could not be verified.</p><Button onClick={() => { void reloadCompany(); }}>Try again</Button></section> :
              location !== "/import" && !authority.canVisit(location) ? <section role="alert" className="rounded-lg border bg-card p-6">
                <h1 className="text-xl font-semibold">{authority.allowedModules.length ? "Access unavailable" : "No available transport modules"}</h1>
                <p className="my-3 text-muted-foreground">This page is not available for your company activities, membership or module settings. No changes have been made.</p>
                <Button onClick={() => setLocation(authority.allowedModules.length ? authority.moduleHome(authority.allowedModules[0]) : "/company")}>{authority.allowedModules.length ? "Open available workspace" : "View company context"}</Button>
              </section> : <>
                {authority.operational && <p className="mb-4 rounded-md border bg-muted/30 p-3 text-sm">Membership: MEMBER. Company activities do not grant commercial management rights. Road information is restricted by the server to your assignments.</p>}
                {children}
              </>}
          </div>
        </div>
      </SidebarInset>
    </>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  // Marine/navy color scheme configuration for the sidebar
  const sidebarStyles = {
    "--sidebar-background": "222 47% 11%", // slate-900
    "--sidebar-foreground": "210 40% 98%", // slate-50
    "--sidebar-primary": "217 91% 60%", // blue-600
    "--sidebar-primary-foreground": "0 0% 100%",
    "--sidebar-accent": "215 28% 17%", // slate-800
    "--sidebar-accent-foreground": "210 40% 98%",
    "--sidebar-border": "215 28% 17%",
    "--sidebar-ring": "217 91% 60%",
    "--sidebar-width": "16rem", // 256px, fits 240-280px requirement
  } as React.CSSProperties;

  return (
    <SidebarProvider style={sidebarStyles}>
      <div className="flex min-h-screen w-full bg-background">
        <ShellContent>{children}</ShellContent>
      </div>
    </SidebarProvider>
  );
}
