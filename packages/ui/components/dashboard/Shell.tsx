"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Contact as ContactIcon,
  GitBranch,
  Home,
  LifeBuoy,
  Link2,
  MessageCircle,
  MessageSquare,
  Phone,
  PhoneCall,
  Settings,
  Sparkles,
  UserRound,
  Users,
  Wrench
} from "lucide-react";
import { useLive } from "@/lib/live";
import { SERVER_URL } from "@/lib/api";
import { AppearancePreferences } from "@/components/dashboard/EnvironmentPreferences";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: "BETA" | "NEW";
}

interface NavSection {
  label?: string;
  items: NavItem[];
}

// Mirrors the AgentPhone console's sidebar, with the simulator's own tabs
// added as a DevTools section. Every entry is a real, working page.
const SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/", label: "Overview", icon: <Home size={18} /> },
      { href: "/agents", label: "Agents", icon: <Sparkles size={18} /> },
      { href: "/phone-numbers", label: "Phone Numbers", icon: <Phone size={18} /> },
      { href: "/contacts", label: "Contacts", icon: <ContactIcon size={18} /> },
      { href: "/messages", label: "Messages", icon: <MessageCircle size={18} /> },
      { href: "/voice-calls", label: "Voice Calls", icon: <PhoneCall size={18} /> }
    ]
  },
  {
    label: "Account",
    items: [
      { href: "/sub-accounts", label: "Sub-accounts", icon: <Users size={18} /> },
      { href: "/sip-trunks", label: "SIP Trunks", icon: <GitBranch size={18} />, badge: "BETA" },
      { href: "/whatsapp", label: "WhatsApp", icon: <MessageSquare size={18} />, badge: "BETA" },
      { href: "/webhooks", label: "Webhooks", icon: <Link2 size={18} /> },
      { href: "/usage", label: "Usage", icon: <BarChart3 size={18} /> }
    ]
  },
  {
    label: "DevTools",
    items: [
      { href: "/imessage", label: "iMessage", icon: <MessageCircle size={18} />, badge: "NEW" },
      { href: "/devtools", label: "Inspector", icon: <Wrench size={18} /> }
    ]
  },
  {
    label: "Resources",
    items: [
      { href: "/documentation", label: "Documentation", icon: <BookOpen size={18} /> },
      { href: "/support", label: "Support", icon: <LifeBuoy size={18} /> },
      { href: "/settings", label: "Settings", icon: <Settings size={18} /> }
    ]
  }
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { connected, session } = useLive();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem("agentphone-devtools.sidebar") === "collapsed");
    } catch {
      /* ignore */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("agentphone-devtools.sidebar", next ? "collapsed" : "open");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const targetHost = (() => {
    try {
      return session ? new URL(session.targetUrl).host : new URL(SERVER_URL).host;
    } catch {
      return session?.targetUrl ?? "";
    }
  })();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-ink">
      <AppearancePreferences />
      <aside className={`relative flex shrink-0 flex-col overflow-y-auto transition-[width] duration-150 ${collapsed ? "w-[76px]" : "w-[248px]"}`}>
        <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} px-5 pb-1 pt-4`}>
          <Link href="/" className="flex items-center gap-1 text-[26px] font-extrabold tracking-tight text-white" aria-label="AgentPhone DevTools">
            {collapsed ? (
              <Bot size={26} />
            ) : (
              <>
                <span>agent</span>
                <Bot size={26} className="mx-0.5" />
                <span>phone</span>
              </>
            )}
          </Link>
        </div>
        {!collapsed ? <div className="px-5 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fern">DevTools · local simulator</div> : null}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute -right-3 top-8 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-line bg-panel text-slate-500 hover:text-bright"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        <nav className="flex-1 px-3 pb-1">
          {SECTIONS.map((section, index) => (
            <div key={section.label ?? index} className={index > 0 ? "mt-2 border-t border-line pt-2" : ""}>
              {section.label && !collapsed ? (
                <div className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{section.label}</div>
              ) : null}
              <ul className="space-y-px">
                {section.items.map((item) => {
                  const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        className={`flex items-center gap-3 rounded-xl px-3 py-[7px] text-[14.5px] transition ${
                          active ? "bg-panel font-medium text-fern" : "text-slate-700 hover:bg-mist hover:text-bright"
                        } ${collapsed ? "justify-center" : ""}`}
                      >
                        <span className={active ? "text-fern" : "text-slate-600"}>{item.icon}</span>
                        {!collapsed ? <span className="truncate">{item.label}</span> : null}
                        {!collapsed && item.badge ? (
                          <span className="ml-1 rounded-md bg-[#173322] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-fern">{item.badge}</span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="px-3 pb-2 pt-2">
          {!collapsed ? (
            <div className="rounded-2xl border border-[#244a2c] bg-skyglass px-4 py-3">
              <div className="text-[12.5px] font-medium text-fern">Simulator</div>
              <div className="mt-0.5 flex items-center gap-2 text-[19px] font-bold leading-tight text-fern">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${connected ? "bg-fern" : "bg-danger"}`} />
                {connected ? "Connected" : "Offline"}
              </div>
              <div className="mt-0.5 truncate text-[11.5px] text-slate-500" title={session?.targetUrl}>
                {connected ? `webhook → ${targetHost}` : "start the devtools CLI"}
              </div>
            </div>
          ) : (
            <div className="flex justify-center py-2" title={connected ? "Connected" : "Offline"}>
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${connected ? "bg-fern" : "bg-danger"}`} />
            </div>
          )}
        </div>

        <div className={`flex items-center gap-3 border-t border-line px-4 py-3 ${collapsed ? "justify-center" : ""}`}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#5c4a42] text-white"><UserRound size={17} /></span>
          {!collapsed ? (
            <>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold text-bright">Atin · local</div>
                <div className="truncate text-[12px] text-slate-500">no account needed</div>
              </div>
              <ChevronDown size={16} className="text-slate-500" />
            </>
          ) : null}
        </div>
      </aside>

      <main className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line/60 bg-frame">
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}


