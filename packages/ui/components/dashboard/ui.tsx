"use client";

import Link from "next/link";
import { type ReactNode } from "react";
import { Loader2 } from "lucide-react";

/**
 * Dashboard primitives, styled after the AgentPhone console: page title +
 * subtitle, dark rounded cards with hairline borders, green primary
 * buttons, stat tiles with an icon well, tiny uppercase eyebrow labels.
 */

export function Page({ children, className = "", wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={`mx-auto w-full ${wide ? "" : "max-w-[1400px]"} px-8 py-8 ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[30px] font-bold leading-tight tracking-tight text-bright">{title}</h1>
        {subtitle ? <p className="mt-1.5 text-[15px] text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  padded = true,
  badge
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  padded?: boolean;
  badge?: ReactNode;
}) {
  return (
    <section className={`rounded-2xl border border-line bg-panel ${className}`}>
      {title || actions ? (
        <header className={`flex flex-wrap items-start justify-between gap-3 ${padded ? "px-6 pt-6" : "px-6 pt-5"} ${children ? "pb-4" : "pb-6"}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              {title ? <h2 className="text-[19px] font-semibold text-bright">{title}</h2> : null}
              {badge}
            </div>
            {subtitle ? <p className="mt-1 text-[14px] text-slate-500">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children ? <div className={padded ? `px-6 pb-6 ${title ? "" : "pt-6"}` : ""}>{children}</div> : null}
    </section>
  );
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 ${className}`}>{children}</div>;
}

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "default"
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "good" | "bad";
}) {
  const valueTone = tone === "good" ? "text-fern" : tone === "bad" ? "text-danger" : "text-bright";
  return (
    <div className="rounded-2xl border border-line bg-panel px-6 py-5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[15px] text-slate-600">{label}</div>
        {icon ? <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-raised text-slate-600">{icon}</div> : null}
      </div>
      <div className={`mt-2 text-[34px] font-bold leading-none tracking-tight ${valueTone}`}>{value}</div>
      {hint ? <div className="mt-3 text-[13px] text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className = ""
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "blue" | "purple" | "amber" | "red";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-line bg-raised text-slate-600",
    green: "border-[#2e5a37] bg-[#173322] text-fern",
    blue: "border-[#2f4a86] bg-[#1a2540] text-badgeblue",
    purple: "border-[#5a3b8a] bg-[#2a1f40] text-badgepurple",
    amber: "border-amber-200 bg-amber-50 text-amber-300",
    red: "border-[#6b2a2a] bg-red-50 text-[#f08080]"
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11.5px] font-medium leading-4 ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  href,
  variant = "primary",
  size = "md",
  disabled,
  busy,
  type = "button",
  className = "",
  title
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "bright";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  busy?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
}) {
  const sizes = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-[14px]", lg: "h-12 px-6 text-[15px]" };
  const variants: Record<string, string> = {
    primary: "bg-cta text-white hover:bg-[#478f52] disabled:opacity-50",
    bright: "bg-[#4caf50] text-white hover:bg-[#5bbf5f] disabled:opacity-50",
    secondary: "border border-line bg-raised text-bright hover:border-slate-400 disabled:opacity-50",
    ghost: "text-slate-600 hover:bg-mist hover:text-bright disabled:opacity-50",
    danger: "border border-[#6b2a2a] bg-red-50 text-[#f08080] hover:bg-[#4a2020] disabled:opacity-50"
  };
  const classes = `inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition ${sizes[size]} ${variants[variant]} ${className}`;
  if (href) {
    return (
      <Link href={href} className={classes} title={title}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled || busy} className={classes} title={title}>
      {busy ? <Loader2 size={15} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, children, className = "" }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <div className="mb-1.5 text-[14px] text-slate-600">{label}</div>
      {children}
      {hint ? <div className="mt-1.5 text-[13px] text-slate-500">{hint}</div> : null}
    </label>
  );
}

export const inputClass =
  "h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-[14px] text-bright outline-none placeholder:text-slate-400 focus:border-fern";
export const textareaClass =
  "w-full rounded-xl border border-line bg-raised px-3.5 py-2.5 text-[14px] text-bright outline-none placeholder:text-slate-400 focus:border-fern";

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon ? <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-raised text-slate-500">{icon}</div> : null}
      <div className="text-[17px] font-semibold text-bright">{title}</div>
      {description ? <div className="mt-2 max-w-md text-[15px] text-slate-500">{description}</div> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function Table({ head, children, className = "" }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-left text-[14px]">
        <thead>
          <tr className="border-b border-line">
            {head.map((cell, index) => (
              <th key={index} className="px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children, onClick, className = "" }: { children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-line/70 last:border-b-0 ${onClick ? "cursor-pointer hover:bg-mist" : ""} ${className}`}
    >
      {children}
    </tr>
  );
}

export function Cell({ children, className = "", mono }: { children: ReactNode; className?: string; mono?: boolean }) {
  return <td className={`px-4 py-3 align-middle text-slate-700 ${mono ? "data" : ""} ${className}`}>{children}</td>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label?: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-3" aria-pressed={checked}>
      <span className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-cta" : "bg-raised border border-line"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? "left-[22px]" : "left-0.5"}`} />
      </span>
      {label ? <span className="text-[14px] text-slate-700">{label}</span> : null}
    </button>
  );
}

export function Modal({ title, onClose, children, footer, width = "max-w-lg" }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className={`w-full ${width} rounded-2xl border border-line bg-panel shadow-soft`} onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h3 className="text-[17px] font-semibold text-bright">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-bright" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="px-6 py-5">{children}</div>
        {footer ? <footer className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "good"; children: ReactNode }) {
  const tones = {
    info: "border-line bg-raised text-slate-700",
    warn: "border-amber-200 bg-amber-50 text-amber-300",
    error: "border-[#6b2a2a] bg-red-50 text-[#f08080]",
    good: "border-[#2e5a37] bg-skyglass text-fern"
  };
  return <div className={`rounded-xl border px-4 py-3 text-[14px] ${tones[tone]}`}>{children}</div>;
}

export function ChannelBadge({ channel }: { channel: string }) {
  const map: Record<string, { label: string; tone: "blue" | "green" | "purple" | "neutral" }> = {
    imessage: { label: "iMessage", tone: "blue" },
    sms: { label: "SMS", tone: "green" },
    mms: { label: "MMS", tone: "green" },
    whatsapp: { label: "WhatsApp", tone: "green" },
    voice: { label: "Voice", tone: "purple" }
  };
  const entry = map[channel] ?? { label: channel, tone: "neutral" as const };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

export function StatusDot({ ok, className = "" }: { ok: boolean | null; className?: string }) {
  const color = ok === null ? "bg-slate-400" : ok ? "bg-fern" : "bg-danger";
  return <span className={`inline-block h-2 w-2 rounded-full ${color} ${className}`} />;
}

/** Initials avatar, like the contact circles in Messages. */
export function Avatar({ name, size = 40, className = "" }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const hue = [...name].reduce((total, char) => total + char.charCodeAt(0), 0) % 360;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: `linear-gradient(180deg, hsl(${hue} 30% 55%), hsl(${hue} 30% 40%))` }}
    >
      {initials || "?"}
    </span>
  );
}

export function formatRelative(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "—";
  const diff = now - at;
  // Simulated clocks put runs in the future; a date reads better than "10d from now".
  if (diff < -60_000) return formatDateTime(iso);
  const abs = Math.abs(diff);
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ago`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ago`;
  if (abs < 30 * 86_400_000) return `${Math.round(abs / 86_400_000)}d ago`;
  return new Date(at).toLocaleDateString();
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatPhone(number: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(number);
  return match ? `+1 (${match[1]}) ${match[2]}-${match[3]}` : number;
}
