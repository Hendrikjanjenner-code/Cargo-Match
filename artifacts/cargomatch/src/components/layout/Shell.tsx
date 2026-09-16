import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { useQueryClient } from "@tanstack/react-query";
import { 
  LogOut, LayoutDashboard, Ship, Package, Layers, Globe, 
  Handshake, MessageSquare, Building2, Bell 
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

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 border-r bg-card flex-col hidden md:flex">
          <nav className="grid gap-1 px-3 py-4">
            {navItems.map((item) => (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  location === item.href || (item.href !== "/" && location.startsWith(item.href))
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

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
