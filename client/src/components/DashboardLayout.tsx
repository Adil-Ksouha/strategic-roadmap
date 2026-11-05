import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { startLogin } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { trpc } from "@/lib/trpc";
import { AreaChart, Boxes, GitFork, LayoutDashboard, LogIn, LogOut, PanelLeft, Route, ShieldCheck, WalletCards } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import SignInScreen from "./SignInScreen";

const menuItems = [
  { icon: LayoutDashboard, label: "Executive view", path: "/" },
  { icon: Boxes, label: "Portfolio", path: "/portfolio" },
  { icon: GitFork, label: "Relationship map", path: "/relationships" },
  { icon: Route, label: "Execution roadmap", path: "/roadmap" },
  { icon: WalletCards, label: "Financial roadmap", path: "/financials" },
];

const SIDEBAR_WIDTH_KEY = "northstar-sidebar-width";
const DEFAULT_WIDTH = 268;
const MIN_WIDTH = 220;
const MAX_WIDTH = 350;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user, error } = useAuth();

  useEffect(() => localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString()), [sidebarWidth]);
  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) return <SignInScreen error={error instanceof Error ? error : null} />;

  return (
    <SidebarProvider style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>{children}</DashboardLayoutContent>
    </SidebarProvider>
  );
}

function DashboardLayoutContent({ children, setSidebarWidth }: { children: React.ReactNode; setSidebarWidth: (width: number) => void }) {
  const { user, logout } = useAuth();
  const { data: access } = trpc.portfolio.access.useQuery(undefined, { enabled: Boolean(user) });
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const visibleMenuItems = access?.isExecutive ? [...menuItems, { icon: ShieldCheck, label: "Team access", path: "/teams" }] : menuItems;
  const activeMenuItem = visibleMenuItems.find(item => item.path === location);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!isResizing) return;
      const left = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const width = event.clientX - left;
      if (width >= MIN_WIDTH && width <= MAX_WIDTH) setSidebarWidth(width);
    };
    const up = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar/90 backdrop-blur-xl" disableTransition={isResizing}>
          <SidebarHeader className="h-[84px] justify-center px-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="stc-wordmark shrink-0" aria-label="stc">stc</span>
              <button onClick={toggleSidebar} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[.035] text-cyan-100 transition hover:bg-white/[.09] focus-visible:ring-2 focus-visible:ring-primary" aria-label="Toggle navigation">
                <PanelLeft className="h-4 w-4" />
              </button>
              {!isCollapsed && <div className="min-w-0"><p className="eyebrow leading-none">Strategic planning</p><p className="mt-1 text-[.88rem] font-semibold leading-tight tracking-tight text-white">Strategic Roadmap</p></div>}
            </div>
          </SidebarHeader>
          <SidebarContent className="px-3 pt-3">
            {!isCollapsed && <p className="px-2 pb-2 text-[.64rem] font-medium uppercase tracking-[.17em] text-slate-500">Portfolio workspace</p>}
            <SidebarMenu className="gap-1">
              {visibleMenuItems.map(item => {
                const active = location === item.path;
                return <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton isActive={active} onClick={() => setLocation(item.path)} tooltip={item.label} className="h-11 rounded-xl px-3 text-[.86rem] text-slate-300 transition hover:bg-white/[.06] hover:text-white data-[active=true]:bg-cyan-300/[.13] data-[active=true]:text-cyan-100 data-[active=true]:shadow-[inset_2px_0_0_0_#5eead4]">
                    <item.icon className="h-4 w-4" /><span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>;
              })}
            </SidebarMenu>
            {!isCollapsed && <div className="mx-2 mt-7 rounded-2xl border border-cyan-300/10 bg-gradient-to-br from-cyan-300/[.09] to-transparent p-3.5"><p className="eyebrow">Planning horizon</p><p className="mt-2 text-sm font-medium text-slate-100">2026–2030 portfolio</p><p className="mt-1 text-xs leading-relaxed text-slate-400">Connect strategic intent to the architecture investments that make it real.</p></div>}
          </SidebarContent>
          <SidebarFooter className="p-3">
            {user ? <div className="flex w-full items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.025] p-1.5"><Avatar className="h-8 w-8 shrink-0 border border-cyan-100/20"><AvatarFallback className="bg-cyan-200/10 text-xs text-cyan-100">{user.name?.charAt(0).toUpperCase() ?? "P"}</AvatarFallback></Avatar><div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"><p className="truncate text-xs font-medium text-slate-200">{user.name ?? "Portfolio planner"}</p><p className="mt-0.5 truncate text-[.67rem] text-slate-500">Signed in</p></div><Button onClick={logout} variant="ghost" aria-label="Log out" title="Log out" className="h-8 shrink-0 gap-1.5 rounded-lg border border-rose-200/20 px-2 text-[.7rem] text-rose-100 hover:border-rose-200/40 hover:bg-rose-300/10 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:px-0"><LogOut className="h-3.5 w-3.5" /><span className="group-data-[collapsible=icon]:hidden">Log out</span></Button></div> : <Button onClick={() => startLogin()} variant="ghost" className="h-10 w-full justify-start gap-3 rounded-xl text-slate-400 hover:bg-white/[.06] hover:text-white group-data-[collapsible=icon]:justify-center"><LogIn className="h-4 w-4" /><span className="group-data-[collapsible=icon]:hidden">Sign in to edit</span></Button>}
          </SidebarFooter>
        </Sidebar>
        <div className={`absolute right-0 top-0 z-50 h-full w-1 cursor-col-resize transition hover:bg-cyan-300/30 ${isCollapsed ? "hidden" : ""}`} onMouseDown={() => setIsResizing(true)} />
      </div>
      <SidebarInset className="app-canvas">
        {isMobile && <div className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/10 bg-[#111a2d]/90 px-3 backdrop-blur-xl"><div className="flex items-center gap-2"><SidebarTrigger className="rounded-xl border border-white/10 bg-white/[.04]" /><span className="stc-wordmark text-base" aria-label="stc">stc</span><span className="text-sm font-medium text-slate-100">{activeMenuItem?.label ?? "Strategic Roadmap"}</span></div><span className="eyebrow">2026–30</span></div>}
        <main className="min-h-screen p-4 sm:p-6 lg:p-8">{children}</main>
      </SidebarInset>
    </>
  );
}
