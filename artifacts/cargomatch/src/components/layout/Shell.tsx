import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { useQueryClient } from "@tanstack/react-query";
import { 
  LogOut, LayoutDashboard, Ship, Package, Layers, Globe, 
  Handshake, MessageSquare, Building2, Bell, Menu, ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { t } from "@/lib/i18n";
import { useGetMyCompany, getGetMyCompanyQueryKey } from "@workspace/api-client-react";

export default function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { logout, user } = useAuth();
  const queryClient = useQueryClient();

  const handleLogout = async () => {
    await logout();
    queryClient.clear();
  };
  
  const { data: company } = useGetMyCompany({
    query: {
      enabled: !!user,
      queryKey: getGetMyCompanyQueryKey()
    }
  });

  const navItems = [
    { href: "/", label: t("nav.overview"), icon: LayoutDashboard },
    { href: "/vessels", label: t("nav.vessels"), icon: Ship },
    { href: "/cargo", label: t("nav.cargo"), icon: Package },
    { href: "/capacity", label: t("nav.capacity"), icon: Layers },
    { href: "/marketplace", label: t("nav.marketplace"), icon: Globe },
    { href: "/matches", label: t("nav.matches"), icon: Handshake },
    { href: "/messages", label: t("nav.messages"), icon: MessageSquare },
    { href: "/company", label: t("nav.company"), icon: Building2 },
    { href: "/notifications", label: t("nav.notifications"), icon: Bell },
  ];

  const deepseaNavItems = [
    { href: "/deepsea/vessels", label: t("deepsea.vessels.title"), icon: Ship },
    { href: "/deepsea/cargo", label: t("deepsea.cargo.title"), icon: Package },
    { href: "/deepsea/capacity", label: t("deepsea.capacity.title"), icon: Layers },
    { href: "/deepsea/marketplace", label: t("deepsea.marketplace.title"), icon: Globe },
    { href: "/deepsea/matches", label: t("deepsea.matches.title"), icon: Handshake },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-primary px-4 sm:px-6 shadow-sm">
        <div className="flex items-center gap-2 text-primary-foreground font-semibold">
          <Ship className="h-5 w-5 text-accent" />
          <span className="tracking-tight">{t("app.name")}</span>
        </div>
        <div className="ml-auto flex items-center space-x-4">
          <div className="text-xs text-primary-foreground/80 hidden sm:block">
            {company?.name || user?.email}
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="text-primary-foreground hover:text-white hover:bg-primary/80">
            <LogOut className="h-4 w-4 mr-2" />
            {t("auth.logout")}
          </Button>
        </div>
      </header>

      <details className="group border-b bg-card md:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 font-medium focus-visible:outline focus-visible:outline-2">
          <Menu className="h-5 w-5" aria-hidden="true" />
          {t("nav.menu")}
          <ChevronDown className="ml-auto h-4 w-4 group-open:rotate-180" aria-hidden="true" />
        </summary>
        <nav aria-label={t("nav.menu")} className="px-3 pb-4">
          {[
            { title: t("nav.inland"), items: navItems },
            { title: t("nav.deepsea"), items: deepseaNavItems },
          ].map((group) => <section key={group.title} className="mb-3">
            <h2 className="px-2 py-2 text-xs font-semibold uppercase text-muted-foreground">{group.title}</h2>
            <div className="grid grid-cols-2 gap-1">
              {group.items.map((item) => <Link
                key={item.href}
                href={item.href}
                aria-current={location === item.href ? "page" : undefined}
                onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
                className={`flex min-h-11 items-center gap-2 rounded-md px-2 py-2 text-sm ${location === item.href ? "bg-accent/10 text-accent" : "hover:bg-muted"}`}
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>)}
            </div>
          </section>)}
        </nav>
      </details>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 shrink-0 border-r bg-card flex-col hidden md:flex overflow-y-auto">
          <nav className="grid gap-1 px-3 py-4">
            <div className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-2">
              {t("nav.inland")}
            </div>
            {navItems.map((item) => (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  location === item.href || (item.href !== "/" && location.startsWith(item.href) && !location.startsWith('/deepsea'))
                    ? "bg-accent/10 text-accent"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}

            <div className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-6">
              {t("nav.deepsea")}
            </div>
            {deepseaNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  location === item.href || location.startsWith(item.href)
                    ? "bg-accent/10 text-accent"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
