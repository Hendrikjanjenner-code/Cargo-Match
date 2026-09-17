import { useDemoEntry } from "@/demo/entry";
import { Button, Card, CardHeader, CardTitle, CardContent } from "@/components/ui/primitives";
import { t } from "@/lib/i18n";
import { Ship, Lock, Globe, ShieldCheck, User, Building, LogIn, ArrowRight } from "lucide-react";
import { WORLD_PERSONAS } from "@/demo/world";

const DEMO_CARDS = [
  {
    id: WORLD_PERSONAS.andy,
    company: "Demo Transportplanning",
    name: "Andy Kers",
    role: "Transportorganisator / charteraar",
    desc: "Maak oefenlading aan, zoek passend vervoer en verbind met een vervoerder.",
  },
  {
    id: WORLD_PERSONAS.shipper,
    company: "Northstar Materials",
    name: "Nora Northstar",
    role: "Verlader",
    desc: "Zoek capaciteit voor binnenvaart, deepsea, breakbulk en wegtransport.",
  },
  {
    id: WORLD_PERSONAS.inland,
    company: "Delta Barge Logistics",
    name: "Ivo Delta",
    role: "Binnenvaart Vervoerder",
    desc: "Beheert schepen en biedt capaciteit aan op de rivier.",
  },
  {
    id: WORLD_PERSONAS.deepsea,
    company: "BlueHarbor Bulk",
    name: "Dani BlueHarbor",
    role: "Deepsea Vervoerder",
    desc: "Beheert zeeschepen voor grote volumes.",
  },
  {
    id: WORLD_PERSONAS.liner,
    company: "Atlas Conventional Lines",
    name: "Lina Atlas",
    role: "Breakbulk / lijndienstvervoerder",
    desc: "Pas een afvaart en breakbulkcapaciteit aan en ontvang interesse.",
  },
  {
    id: WORLD_PERSONAS.roadPlanner,
    company: "Rijnland Road Freight",
    name: "Ruben Planner",
    role: "Wegtransport Planner",
    desc: "Plant trucks en chauffeurs. (Rosa is chauffeur)",
  },
];

export default function Landing() {
  const { startDemo, loginReal } = useDemoEntry();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-6 h-16 flex items-center border-b">
        <div className="flex items-center gap-2 text-primary font-bold text-lg">
          <Ship className="h-6 w-6 text-accent" />
          {t("app.name")}
        </div>
        <div className="ml-auto flex items-center gap-4">
          <Button variant="outline" onClick={loginReal} className="gap-2">
            <LogIn className="w-4 h-4" />
            {t("landing.login")}
          </Button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-start px-4 py-12 md:py-24 bg-gradient-to-b from-background to-muted/30">
        <div className="max-w-4xl text-center space-y-6 mb-16">
          <Badge className="bg-accent/10 text-accent hover:bg-accent/20 border-accent/20 inline-flex">
            Proberen met demobedrijf
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">
            Ontdek CargoMatch vanuit elk perspectief
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Kies een fictieve rol om het platform te ervaren. Schakel tussen bedrijven om te zien hoe matches, interesse en verbindingen aan beide kanten werken. Alles blijft lokaal in deze browser.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl w-full mx-auto">
          {DEMO_CARDS.map((card) => (
            <Card key={card.id} className="flex flex-col hover:border-primary/50 transition-colors">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-xl flex items-center gap-2">
                      <Building className="w-5 h-5 text-muted-foreground" />
                      {card.company}
                    </CardTitle>
                    <div className="flex items-center gap-2 text-sm font-medium text-primary">
                      <User className="w-4 h-4" />
                      {card.name} ({card.role})
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <p className="text-sm text-muted-foreground mb-6 flex-1">
                  {card.desc}
                </p>
                <p className="text-xs text-muted-foreground mb-3">{card.id}@example.com · fictief contact</p>
                <Button onClick={() => startDemo(card.id)} className="w-full gap-2">
                  Speel als {card.name} <ArrowRight className="w-4 h-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
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
