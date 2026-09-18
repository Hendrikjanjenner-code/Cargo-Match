import * as React from "react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarRail,
  SidebarMenuBadge,
  useSidebar
} from "@/components/ui/sidebar";

export interface NavItem {
  href?: string;
  onClick?: () => void;
  label: string;
  icon: React.ElementType;
  badge?: React.ReactNode;
  isActive?: boolean;
}

export interface NavGroup {
  title?: string;
  items: NavItem[];
}

export interface ContextSidebarProps {
  groups: NavGroup[];
  isDemo?: boolean;
  headerSlot?: React.ReactNode;
  footerSlot?: React.ReactNode;
  modeSwitcher?: React.ReactNode;
  className?: string;
}

export function ContextSidebar({
  groups,
  isDemo,
  headerSlot,
  footerSlot,
  modeSwitcher,
  className
}: ContextSidebarProps) {
  const [location] = useLocation();
  const { state, isMobile, setOpenMobile } = useSidebar();

  const handleLinkClick = (item: NavItem) => {
    if (isMobile) {
      setOpenMobile(false);
    }
    if (item.onClick) {
      item.onClick();
    }
  };

  return (
    <Sidebar 
      collapsible="icon" 
      className={className}
    >
      <SidebarHeader>
        {headerSlot}
        {isDemo && (state === "expanded" || isMobile) && (
          <div className="mt-1 px-2 py-1 mx-2 text-[10px] font-bold bg-amber-500/10 text-amber-600 rounded uppercase tracking-wider flex items-center w-fit border border-amber-500/20">
            Demo Environment
          </div>
        )}
        {modeSwitcher && (
          <div className="mt-2 mb-1 px-2">
            {modeSwitcher}
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group, i) => (
          <SidebarGroup key={i}>
            {group.title && (
              <SidebarGroupLabel>
                {group.title}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item, j) => {
                  const isActive = item.isActive !== undefined 
                    ? item.isActive 
                    : item.href 
                      ? location === item.href || (item.href !== "/" && location.startsWith(item.href))
                      : false;

                  return (
                    <SidebarMenuItem key={j}>
                      <SidebarMenuButton 
                        asChild
                        isActive={isActive}
                        aria-current={isActive ? "page" : undefined}
                        tooltip={item.label}
                        onClick={() => handleLinkClick(item)}
                      >
                        {item.href ? (
                          <Link href={item.href} className="flex items-center w-full">
                            <item.icon className="h-4 w-4" />
                            <span>{item.label}</span>
                          </Link>
                        ) : (
                          <button className="flex items-center w-full text-left">
                            <item.icon className="h-4 w-4" />
                            <span>{item.label}</span>
                          </button>
                        )}
                      </SidebarMenuButton>
                      {item.badge && (
                        <SidebarMenuBadge>
                          {item.badge}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {footerSlot && (
        <SidebarFooter>
          {footerSlot}
        </SidebarFooter>
      )}

      <SidebarRail />
    </Sidebar>
  );
}
