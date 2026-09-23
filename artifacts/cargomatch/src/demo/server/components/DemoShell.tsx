import React from "react";
import { Ship, LayoutDashboard, Map, Package, Layers, Handshake, MessageSquare, Bell, Building2, Users, User, Settings, Plus, LogOut } from "lucide-react";
import { ContextSidebar, type NavGroup } from "@/components/layout/ContextSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Button, Select } from "@/components/ui/primitives";
import { useDemo } from "../DemoContext";
import type { Mode } from "../api";
import { useDemoRouting } from "./useDemoRouting";
import { assetLabels, capacityLabels, modeLabels, moduleEnabled } from "./demo-display";
import { DemoOverview } from "./DemoOverview";
import { DemoLists } from "./DemoLists";
import { DemoForms } from "./DemoForms";
import { DemoImport } from "./DemoImport";
import { DemoAdmin } from "./DemoAdmin";
import { DemoSettings } from "./DemoSettings";
import { DemoMap } from "./DemoMap";
import { DemoGuide } from "./DemoGuide";
import { DemoMatchDetail } from "./DemoMatchDetail";

function Content({ onExit }: { onExit: () => void }) {
  const { session } = useDemo();
  const sidebar = useSidebar();
  const expanded = sidebar.state === "expanded" || sidebar.isMobile;
  const { view, mode, entityId, navigate } = useDemoRouting();
  if (!session) return null;
  const { context, workspace } = session;
  const has = (permission: string) => context.permissions.includes(permission);
  const activeMode = (mode || context.user.primaryMode) as Mode;
  const admin = has("VIEW_ADMIN");
  const operational = has("VIEW_ASSIGNED_ASSET");
  const enabled = moduleEnabled(session, activeMode);
  const importAccess = moduleEnabled(session, "IMPORT") && (!!workspace.importControl?.modules.length || has("IMPORT_ADMIN"));
  const importControl = workspace.importControl;
  const isImportMode = activeMode === "IMPORT";
  
  const rules: Record<string, boolean> = {
    dashboard: true, map: !admin && activeMode !== "IMPORT", assets: has("MANAGE_ASSETS") || operational,
    cargos: has("CREATE_CARGO"), capacity: has("MANAGE_CAPACITY"), matches: has("VIEW_MATCHES"),
    messages: has("MESSAGE_CONNECTED"), notifications: true, profile: true, company: true, network: !admin, settings: true,
    import: importAccess, admin, form_cargo: has("CREATE_CARGO"), form_capacity: has("MANAGE_CAPACITY"),
    form_departure: has("MANAGE_CAPACITY") && activeMode === "LINER", form_asset: has("MANAGE_ASSETS"),
    match_detail: has("VIEW_MATCHES") && !!entityId && [...workspace.matches, ...workspace.opportunities].some(item => item.id === entityId && item.mode === activeMode),
    import_shipments: importAccess && !!importControl?.modules.includes("SHIPMENTS"),
    import_documents: importAccess && !!importControl?.modules.includes("DOCUMENTS"),
    import_customs: importAccess && !!importControl?.modules.includes("CUSTOMS"),
    import_charges: importAccess && !!importControl?.modules.includes("CHARGES"),
    import_release: importAccess && !!importControl?.modules.includes("RELEASE"),
    import_delivery: importAccess && !!importControl?.modules.includes("DELIVERY"),
    import_control: importAccess && !!importControl?.modules.includes("CONTROL"),
    import_partners: importAccess && !!importControl?.modules.includes("PARTNERS"),
    import_exceptions: importAccess && !!importControl?.modules.includes("EXCEPTIONS"),
    import_settings: importAccess,
  };
  const denied = !rules[view] || (!admin && !enabled);
  const go = (next: string) => navigate({ demoView: next, entityId: null });
  const item = (next: string, label: string, icon: React.ElementType, badge?: number) => ({ onClick: () => go(next), label, icon, isActive: view === next, badge: badge || undefined });
  
  const groups: NavGroup[] = [];
  
  if (isImportMode && importAccess) {
    groups.push({ title: "Overzicht", items: [item("import", "Import Dashboard", LayoutDashboard)] });
    
    const impItems = [];
    if (rules.import_control) impItems.push(item("import_control", "Control Tower", Map));
    if (rules.import_shipments) impItems.push(item("import_shipments", "Zendingen", Package));
    if (rules.import_documents) impItems.push(item("import_documents", "Documenten", Layers));
    if (rules.import_customs) impItems.push(item("import_customs", "Douane", Building2));
    if (rules.import_charges) impItems.push(item("import_charges", "Kosten", Layers));
    if (rules.import_release) impItems.push(item("import_release", "Vrijgave", Handshake));
    if (rules.import_delivery) impItems.push(item("import_delivery", "Achterland", Ship));
    if (rules.import_partners) impItems.push(item("import_partners", "Partners", Users));
    if (rules.import_exceptions) impItems.push(item("import_exceptions", "Uitzonderingen", Bell));
    if (rules.import_settings) impItems.push(item("import_settings", "Module-instellingen", Settings));
    
    if (impItems.length > 0) {
      groups.push({ title: "Import Modules", items: impItems });
    }
  } else {
    groups.push({ title: "Overzicht", items: [item("dashboard", "Dashboard", LayoutDashboard), ...(!admin && activeMode !== "IMPORT" ? [item("map", "Regiokaart", Map)] : [])] });
    if (!admin && activeMode !== "IMPORT") groups.push({ title: "Operatie & markt", items: [
      ...(rules.assets ? [item("assets", operational ? "Mijn toegewezen asset" : assetLabels[activeMode], Ship)] : []),
      ...(rules.cargos ? [item("cargos", activeMode === "DEEPSEA" ? "Cargo orders" : "Mijn lading", Package)] : []),
      ...(rules.capacity ? [item("capacity", capacityLabels[activeMode], Layers)] : []),
      ...(rules.matches ? [item("matches", operational ? "Passende kansen" : "Matches & kansen", Handshake)] : []),
    ] });
    if (importAccess) groups.push({ title: "Afzonderlijke module", items: [{ label: "CargoMatch Import", icon: Package, isActive: false, onClick: () => navigate({ demoView: "import", demoMode: "IMPORT", entityId: null }) }] });
  }

  groups.push({ title: "Communicatie", items: [
    ...(rules.messages ? [item("messages", "Gesprekken", MessageSquare)] : []),
    item("notifications", "Notificaties", Bell, workspace.notifications.filter(n => !n.read).length),
    ...(!admin && !isImportMode ? [item("network", "Demo-netwerk", Users)] : []),
  ] });
  groups.push({ title: "Context", items: [item("profile", "Mijn profiel", User), item("company", "Bedrijf", Building2), item("settings", "Instellingen", Settings), ...(admin ? [item("admin", "Demo-beheer", Settings)] : [])] });
  
  const actions = [
    ...(rules.form_cargo && !isImportMode ? [{ label: "Nieuwe lading", icon: Plus, onClick: () => navigate({ demoView: "form_cargo", entityId: "new" }) }] : []),
    ...(rules.form_capacity && !isImportMode ? [{ label: "Nieuwe capaciteit", icon: Plus, onClick: () => navigate({ demoView: "form_capacity", entityId: "new" }) }] : []),
    ...(rules.form_asset && !isImportMode ? [{ label: "Nieuwe asset", icon: Plus, onClick: () => navigate({ demoView: "form_asset", entityId: "new" }) }] : []),
  ];
  if (actions.length) groups.push({ title: "Acties", items: actions });
  return <>
    <ContextSidebar isDemo groups={groups}
      headerSlot={<div className="px-2 py-3 text-white"><div className="flex gap-2 items-center font-bold"><Ship className="h-5 w-5 shrink-0" />{expanded && "CargoMatch"}</div>{expanded && <div className="mt-3 text-xs text-slate-300 break-words">{context.company.name}</div>}</div>}
      modeSwitcher={!admin && expanded && <Select aria-label="Vervoersmodus" className="bg-slate-800 border-slate-600 text-white text-xs" value={activeMode} onChange={event => navigate({ demoMode: event.target.value, demoView: event.target.value === "IMPORT" ? "import" : "dashboard", entityId: null })}>
        <optgroup label="Maritime">{(["INLAND", "DEEPSEA", "LINER"] as Mode[]).filter(m => moduleEnabled(session, m)).map(m => <option key={m} value={m}>{modeLabels[m]}</option>)}</optgroup>
        <optgroup label="Andere modules">{(["ROAD", "RAIL", "AIR", "IMPORT"] as Mode[]).filter(m => moduleEnabled(session, m)).map(m => <option key={m} value={m}>{modeLabels[m]} · {context.modules[m]}</option>)}</optgroup>
      </Select>}
      footerSlot={<div className="text-white text-xs space-y-2"><button title={`${context.user.name} · Mijn profiel`} className="text-left w-full p-2" onClick={() => go("profile")}>{expanded ? <><strong className="block">{context.user.name}</strong><span className="block text-slate-300">{context.user.operationalProfile}</span></> : <User className="h-4 w-4" />}</button><Button aria-label="Demo afsluiten" title="Demo afsluiten" variant="ghost" className="text-white w-full justify-start" onClick={onExit}><LogOut className="h-4 w-4 shrink-0" />{expanded && <span className="ml-2">Afsluiten</span>}</Button></div>}
    />
    <SidebarInset className="min-w-0 bg-slate-50">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-white px-4"><SidebarTrigger /><span className="text-sm font-semibold flex-1">{admin ? "Demo-beheer" : modeLabels[activeMode] || "Onbekende modus"} · Gedeelde demo</span><Button aria-label="Notificaties bekijken" size="sm" variant="outline" onClick={() => go("notifications")}><Bell className="h-4 w-4 mr-1" />{workspace.notifications.filter(n => !n.read).length}</Button></header>
      <main className="p-4 sm:p-6 lg:p-8 min-w-0"><div className="max-w-6xl mx-auto space-y-6">
        {denied ? <section role="alert" className="bg-white p-6 rounded-lg border"><h1 className="text-xl font-semibold">Toegang geweigerd</h1><p className="my-3">Deze pagina, modus of record is niet beschikbaar voor jouw huidige bevoegdheden.</p><Button onClick={() => navigate({ demoView: "dashboard", demoMode: null, entityId: null })}>Terug naar dashboard</Button></section> : <>
          {view === "dashboard" && <DemoOverview />}
          {view === "map" && <DemoMap />}
          {(["assets", "cargos", "capacity", "matches", "messages", "notifications"] as string[]).includes(view) && <DemoLists type={view as "assets" | "cargos" | "capacity" | "matches" | "messages" | "notifications"} />}
          {view.startsWith("import") && <DemoImport view={view} />}
          {view === "admin" && <DemoAdmin />}
          {["profile", "company", "network", "settings"].includes(view) && <DemoSettings type={view as "profile" | "company" | "network" | "settings"} />}
          {["form_cargo", "form_capacity", "form_asset", "form_departure"].includes(view) && <DemoForms key={`${view}:${entityId}:${activeMode}`} type={view as "form_cargo" | "form_capacity" | "form_asset" | "form_departure"} entityId={entityId} onCancel={() => navigate({ demoView: view === "form_asset" ? "assets" : view === "form_cargo" ? "cargos" : "capacity", entityId: null })} />}
          {view === "match_detail" && entityId && <DemoMatchDetail matchId={entityId} onBack={() => navigate({ demoView: "matches", entityId: null })} />}
          {!admin && activeMode === "DEEPSEA" && <DemoGuide activeMode={activeMode} />}
        </>}
      </div></main>
    </SidebarInset>
  </>;
}
export function DemoShell({ onExit }: { onExit: () => void }) {
  const style = { "--sidebar-background": "222 47% 11%", "--sidebar-foreground": "210 40% 98%", "--sidebar-accent": "215 28% 17%", "--sidebar-accent-foreground": "210 40% 98%", "--sidebar-border": "215 28% 17%", "--sidebar-width": "16rem" } as React.CSSProperties;
  return <SidebarProvider style={style} className="flex-1"><Content onExit={onExit} /></SidebarProvider>;
}