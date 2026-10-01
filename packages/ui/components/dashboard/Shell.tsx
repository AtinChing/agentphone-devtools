"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  AddressBook,
  BookOpen,
  CaretLeft,
  ChartBar,
  ChatCircle,
  ChatCircleDots,
  Gear,
  House,
  Lifebuoy,
  Link as LinkIcon,
  Phone,
  PhoneCall,
  Sparkle,
  TreeStructure,
  UsersThree,
  WhatsappLogo,
  Wrench,
  type Icon as PhosphorIcon
} from "@phosphor-icons/react";
import { useLive } from "@/lib/live";
import { AppearancePreferences } from "@/components/dashboard/EnvironmentPreferences";

interface NavItem {
  href: string;
  label: string;
  Icon: PhosphorIcon;
  tag?: "Beta" | "New";
}

interface NavSection {
  label?: string;
  items: NavItem[];
}

// The AgentPhone console's sidebar, item for item, plus a DevTools section
// for the simulator's own tabs. Every entry is a working page.
const SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/", label: "Overview", Icon: House },
      { href: "/agents", label: "Agents", Icon: Sparkle },
      { href: "/phone-numbers", label: "Phone Numbers", Icon: Phone },
      { href: "/contacts", label: "Contacts", Icon: AddressBook },
      { href: "/messages", label: "Messages", Icon: ChatCircle },
      { href: "/voice-calls", label: "Voice Calls", Icon: PhoneCall }
    ]
  },
  {
    label: "Account",
    items: [
      { href: "/sub-accounts", label: "Sub-accounts", Icon: UsersThree },
      { href: "/sip-trunks", label: "SIP Trunks", Icon: TreeStructure, tag: "Beta" },
      { href: "/whatsapp", label: "WhatsApp", Icon: WhatsappLogo, tag: "Beta" },
      { href: "/webhooks", label: "Webhooks", Icon: LinkIcon },
      { href: "/usage", label: "Usage", Icon: ChartBar }
    ]
  },
  {
    label: "DevTools",
    items: [
      { href: "/imessage", label: "iMessage", Icon: ChatCircleDots, tag: "New" },
      { href: "/devtools", label: "Inspector", Icon: Wrench }
    ]
  },
  {
    label: "Resources",
    items: [
      { href: "/documentation", label: "Documentation", Icon: BookOpen },
      { href: "/support", label: "Support", Icon: Lifebuoy },
      { href: "/settings", label: "Settings", Icon: Gear }
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

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  const targetHost = (() => {
    try {
      return session ? new URL(session.targetUrl).host : "";
    } catch {
      return session?.targetUrl ?? "";
    }
  })();

  return (
    <div className="app-dashboard flex h-screen overflow-hidden bg-background text-foreground">
      <AppearancePreferences />
      <aside className={`relative flex shrink-0 flex-col gap-3 overflow-y-auto p-4 transition-[width] duration-300 ${collapsed ? "w-[76px]" : "w-64"}`}>
        <div className={`flex items-center ${collapsed ? "justify-center" : "px-4"}`}>
          <Link href="/" className="flex items-center transition-opacity hover:opacity-80" aria-label="AgentPhone DevTools">
            {collapsed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/brand/logo.png" alt="AgentPhone" className="h-9 w-9" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/brand/wordmark.png" alt="AgentPhone" className="h-8" />
            )}
          </Link>
        </div>
        {!collapsed ? (
          <div className="-mt-1.5 px-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary/70">DevTools · local simulator</div>
        ) : null}

        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute right-0 top-7 z-50 flex h-6 w-6 translate-x-1/2 items-center justify-center rounded-full border border-white/[0.08] bg-[#0e0e0e] text-white/40 transition-colors hover:bg-white/[0.1] hover:text-white"
        >
          <CaretLeft size={12} weight="bold" className={`transition-transform ${collapsed ? "rotate-180" : ""}`} />
        </button>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {SECTIONS.map((section, index) => (
            <div key={section.label ?? index} className="contents">
              {section.label ? (
                collapsed ? (
                  <div className="mx-3 my-2 h-px shrink-0 bg-white/[0.07]" aria-hidden="true" />
                ) : (
                  <div className="mt-1.5 shrink-0 border-t border-white/[0.06] px-4 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/35">
                    {section.label}
                  </div>
                )
              ) : null}
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={`focus-ring group relative flex items-center ${collapsed ? "justify-center" : "gap-2.5"} px-4 py-2 text-[14px] leading-tight transition-[transform,background-color,color] duration-200 active:scale-[0.98] ${
                      active
                        ? "rounded-[12px] bg-[rgba(175,182,177,0.1)] font-semibold text-primary"
                        : "rounded-full font-medium text-white/70 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <item.Icon size={18} weight={active ? "fill" : "regular"} className="shrink-0" />
                    {!collapsed ? (
                      <span className="flex flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
                        <span>{item.label}</span>
                        {item.tag ? (
                          <span className="rounded-full bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-400">{item.tag}</span>
                        ) : null}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Where the console shows Credits, the simulator shows its link to your handler. */}
        {collapsed ? (
          <Link
            href="/support"
            title={connected ? "Simulator connected" : "Simulator offline"}
            className={`focus-ring flex items-center justify-center rounded-[14px] p-3 transition-colors ${
              connected ? "bg-[rgba(38,182,90,0.1)] hover:bg-[rgba(38,182,90,0.16)]" : "bg-red-500/10 hover:bg-red-500/15"
            }`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-primary" : "bg-red-400"}`} />
          </Link>
        ) : (
          <Link
            href="/support"
            className={`focus-ring group flex h-[68px] shrink-0 flex-col justify-between rounded-[16px] px-4 py-3 transition-colors ${
              connected ? "bg-[rgba(38,182,90,0.1)] hover:bg-[rgba(38,182,90,0.16)]" : "bg-red-500/10 hover:bg-red-500/15"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-[12px] font-medium leading-tight ${connected ? "text-[rgba(38,182,90,0.8)]" : "text-red-400/80"}`}>Simulator</span>
              <span
                className={`flex items-center gap-0.5 text-[12px] font-medium transition-opacity ${connected ? "text-[rgba(38,182,90,0.65)]" : "text-red-400/60"} opacity-0 group-hover:opacity-100`}
                title={session?.targetUrl}
              >
                {connected ? targetHost : "Diagnostics"}
                <CaretLeft size={12} weight="bold" className="rotate-180" />
              </span>
            </div>
            <span className={`font-heading text-[22px] font-bold leading-none tracking-[-0.44px] ${connected ? "text-primary" : "text-red-400"}`}>
              {connected ? "Connected" : "Offline"}
            </span>
          </Link>
        )}

        <div className="relative">
          <button
            type="button"
            className={`focus-ring flex w-full items-center ${collapsed ? "justify-center px-0 py-2" : "gap-3 px-2 py-2"} rounded-[12px] transition-colors hover:bg-white/[0.05]`}
            title="Local developer"
          >
            <div className={`flex shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/70 ${collapsed ? "h-7 w-7 text-xs" : "h-8 w-8"}`}>D</div>
            {!collapsed ? (
              <>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-[14px] font-medium text-white">Developer</div>
                  <div className="truncate text-[12px] text-white/45">local · no sign-in needed</div>
                </div>
                <CaretLeft size={14} weight="bold" className="-rotate-90 text-white/40" />
              </>
            ) : null}
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col p-4 pl-0">
        <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.03)] bg-frame">
          {children}
        </div>
      </main>
    </div>
  );
}
