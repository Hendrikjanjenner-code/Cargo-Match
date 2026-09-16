import { useDemoEntry } from "@/demo/entry";
import { Button } from "@/components/ui/primitives";
import { t } from "@/lib/i18n";
import { Ship, Lock, Globe, ShieldCheck } from "lucide-react";

export default function Landing() {
  const { startDemo, loginReal } = useDemoEntry();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-6 h-16 flex items-center border-b">
        <div className="flex items-center gap-2 text-primary font-bold text-lg">
          <Ship className="h-6 w-6 text-accent" />
          {t("app.name")}
        </div>
        <div className="ml-auto">
           <Button variant="outline" onClick={loginReal}>{t("landing.login")}</Button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-24 bg-gradient-to-b from-background to-muted">
        <div className="max-w-3xl text-center space-y-8">
          <Badge className="bg-accent/10 text-accent hover:bg-accent/20 border-accent/20 mb-4 inline-flex">
             {t("landing.badge")}
          </Badge>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground">
            {t("app.tagline")}
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            {t("app.description")}
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-8">
            <Button size="lg" onClick={startDemo} className="text-base px-8">
              Start demo als Andy Kers
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Geen account nodig. Probeer CargoMatch met fictieve ladingen en schepen.
            Alles blijft lokaal in deze browser; er worden geen echte berichten of boekingen verstuurd.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto mt-24">
          <Feature 
            icon={<Lock className="h-6 w-6 text-accent" />}
             title={t("landing.privacy_title")}
             description={t("landing.privacy_description")}
          />
          <Feature 
            icon={<Globe className="h-6 w-6 text-accent" />}
             title={t("landing.network_title")}
             description={t("landing.network_description")}
          />
          <Feature 
            icon={<ShieldCheck className="h-6 w-6 text-accent" />}
             title={t("landing.connection_title")}
             description={t("landing.connection_description")}
          />
        </div>
      </main>
      
      <footer className="py-6 border-t text-center text-sm text-muted-foreground">
         &copy; {new Date().getFullYear()} {t("landing.footer_brand")}. {t("landing.footer")}
      </footer>
    </div>
  );
}

function Feature({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="flex flex-col items-center text-center p-6 bg-card rounded-lg border shadow-sm">
      <div className="h-12 w-12 rounded-full bg-accent/10 flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="font-semibold text-lg mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode, className?: string }) {
  return <span className={`px-3 py-1 rounded-full text-sm font-medium border ${className}`}>{children}</span>;
}
