import { useDemoEntry } from "@/demo/entry";
import { Button, Card, CardHeader, CardTitle, CardContent } from "@/components/ui/primitives";
import { t } from "@/lib/i18n";
import { Ship, Lock, Globe, ShieldCheck, User, Building, LogIn, ArrowRight } from "lucide-react";
import React, { useState } from "react";
import { DEMO_UI_ENABLED } from "@/demo/demo-availability";

const DEMO_CARDS = [
  {
    id: "andy",
    company: "NorthSea Chartering Demo",
    name: "Andy Kers",
    role: "Transportorganisator / charteraar",
    desc: "Zoek voor 75.000 mt Indonesia–China passende deepsea-capaciteit en oefen wederzijdse toestemming.",
  },
  {
    id: "laura",
    company: "EuroCommodities Demo",
    name: "Laura Peters",
    role: "Verlader",
    desc: "Behandel lading in meerdere vervoersmodi en bekijk als bevoegde ontvanger de Import-demo.",
  },
  {
    id: "mark",
    company: "RhineFlow Shipping Demo",
    name: "Mark de Jong",
    role: "Schipper",
    desc: "Bekijk MS RhineFlow One, bevestig operationele beschikbaarheid en stuur een kans naar Eva.",
  },
  {
    id: "sophie",
    company: "OceanBridge Bulk Demo",
    name: "Sophie van Dijk",
    role: "Deepsea redervertegenwoordiger",
    desc: "Beheer de vloot en ontvang Andy’s interesse voor de Kamsarmax MV OceanBridge Atlas.",
  },
  {
    id: "eva",
    company: "RhineFlow Shipping Demo",
    name: "Eva Jansen",
    role: "Binnenvaartplanner",
    desc: "Beoordeel de kansen van Mark en handel de commerciële interesse en verbinding af.",
  },
  {
    id: "thomas",
    company: "TransRoute Logistics Demo",
    name: "Thomas Becker",
    role: "Wegtransport Planner",
    desc: "Plan de volgende lading voor Truck 42 en beoordeel de kansen die Jan doorstuurt.",
  },
  { id: "jan", company: "TransRoute Logistics Demo", name: "Jan Müller", role: "Chauffeur", desc: "Bekijk Truck 42, verwacht beschikbaar in Eindhoven om 14:00. Stuur een volgende lading naar Thomas." },
  { id: "anna", company: "EuroRail Cargo Demo", name: "Anna Schmidt", role: "Spooroperator · demo-pilot", desc: "Beoordeel technische geschiktheid en tijdvensters voor twaalf wagons bij Duisburg." },
  { id: "sarah", company: "SkyFreight Demo", name: "Sarah Williams", role: "Luchtvrachtoperator · demo-pilot", desc: "Behandel een zending van 3.600 kg binnen de resterende 4.800 kg en 28 m³ op AMS–DXB." },
  { id: "david", company: "GlobalLine Logistics Demo", name: "David Chen", role: "Forwarder / liner", desc: "Verken afvaarten en de aparte LCL Import-pilot met fictieve documenten en gesimuleerde afhandeling." },
  { id: "emma", company: "CargoMatch demo-beheer", name: "Emma de Vries", role: "Beheerder van jouw demo-omgeving", desc: "Bekijk uitsluitend deze geïsoleerde oefenomgeving en reset haar na bevestiging. Geen productietoegang." },
];

export default function Landing() {
  const { startDemo, loginReal } = useDemoEntry();
  const [explore, setExplore] = useState(false);

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
            Standaard inloggen
          </Button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-start px-4 py-12 md:py-24 bg-gradient-to-b from-background to-muted/30">
        <div className="max-w-4xl text-center space-y-6 mb-16">
          <Badge className="bg-accent/10 text-accent hover:bg-accent/20 border-accent/20 inline-flex">
            {DEMO_UI_ENABLED ? "Proberen met demobedrijf" : "Logistieke samenwerking"}
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">
            Ontdek CargoMatch vanuit elk perspectief
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {DEMO_UI_ENABLED ? "Verken beide kanten van de markt met elf fictieve profielen. Je oefent in een eigen, beveiligde demo-omgeving op de server. Profielwissels behouden je oefeningen; echte klanten, sessies en bedrijfsgegevens blijven gescheiden." : "Breng lading en beschikbare transportcapaciteit samen. Log in om vanuit je bedrijf en bevoegdheden passende kansen te bekijken en veilig contact te leggen."}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {DEMO_UI_ENABLED && <Button onClick={() => setExplore(true)} aria-expanded={explore} aria-controls="demo-personas" className="gap-2">Explore Demo <ArrowRight className="h-4 w-4" /></Button>}
            <Button variant="outline" onClick={loginReal}>Standaard inloggen</Button>
          </div>
          <p className="text-xs text-muted-foreground">{DEMO_UI_ENABLED ? "Demo’s zijn uitsluitend beschikbaar in de ontwikkel-/demo-omgeving. " : ""}Verbonden zijn is geen boeking.</p>
        </div>

        {DEMO_UI_ENABLED && explore && <div id="demo-personas" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl w-full mx-auto">
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
                <p className="text-xs text-muted-foreground mb-3">Fictief profiel · eigen demo-omgeving</p>
                <Button onClick={() => startDemo(card.id)} className="w-full gap-2">
                  Speel als {card.name} <ArrowRight className="w-4 h-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>}

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
