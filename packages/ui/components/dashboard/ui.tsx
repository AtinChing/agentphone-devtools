"use client";

import Link from "next/link";
import { type ReactNode } from "react";
import { CircleNotch, Plus, X } from "@phosphor-icons/react";

/**
 * Dashboard primitives with the AgentPhone console's own recipes: the
 * rounded content frame, Alte Haas Grotesk page titles, translucent
 * rounded-[18px] cards, green primary buttons, tiny status badges.
 */

export function Page({ children, className = "", wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  void wide;
  return <div className={`flex min-h-0 w-full flex-1 flex-col overflow-y-auto p-4 md:p-7 ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-[22px] font-bold leading-tight text-white md:text-[28px]">{title}</h1>
          {subtitle ? <p className="mt-2 text-[14px] leading-snug text-white/50">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Wraps page sections below the header with the console's spacing and entrance. */
export function PageBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`stagger-enter mt-6 flex w-full flex-col gap-8 ${className}`}>{children}</div>;
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
  const hasHeader = Boolean(title || actions);
  return (
    <section className={`overflow-hidden rounded-[18px] bg-card shadow-card backdrop-blur-[2px] ${className}`}>
      {hasHeader ? (
        <header className={`flex flex-wrap items-center justify-between gap-3 px-6 py-4 ${children ? "border-b border-surface-border" : ""}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              {title ? <h2 className="text-lg font-semibold text-text">{title}</h2> : null}
              {badge}
            </div>
            {subtitle ? <p className="mt-0.5 text-sm text-text-dim">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children ? <div className={padded ? "p-6" : ""}>{children}</div> : null}
    </section>
  );
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`text-xs font-semibold uppercase tracking-wider text-text-secondary ${className}`}>{children}</div>;
}

/** The Usage page's tile: label + icon well, big number, dim sub-line. */
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
  const valueTone = tone === "good" ? "text-primary" : tone === "bad" ? "text-red-400" : "text-text";
  return (
    <div className="rounded-[18px] bg-card p-5 shadow-card backdrop-blur-[2px]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">{label}</p>
        {icon ? <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.05] text-text-secondary">{icon}</div> : null}
      </div>
      <p className={`text-3xl font-bold tracking-tight tabular-nums ${valueTone}`}>{value}</p>
      {hint ? <p className="mt-1.5 text-xs text-text-dim">{hint}</p> : null}
    </div>
  );
}

/** The Overview page's tile: label top-left, big heading-face number bottom-left. */
export function OverviewTile({ label, value, descriptor, href, className = "" }: { label: string; value: ReactNode; descriptor?: string; href?: string; className?: string }) {
  const classes = `relative h-40 flex-1 overflow-hidden rounded-[18px] bg-card shadow-card backdrop-blur-[2px] ${href ? "cursor-pointer transition-colors hover:bg-card-hover" : ""} ${className}`;
  const body = (
    <>
      <p className="absolute left-4 top-4 text-[14px] font-medium leading-[1.3] text-white/90 md:left-6 md:top-6 md:text-[16px]">{label}</p>
      <div className="absolute bottom-4 left-4 flex items-end gap-2 md:bottom-6 md:left-6">
        <span className="font-heading text-[26px] font-bold leading-none tracking-[-0.64px] tabular-nums text-white md:text-[32px]">{value}</span>
        {descriptor ? <span className="text-[14px] font-medium leading-[1.3] text-white/70">{descriptor}</span> : null}
      </div>
    </>
  );
  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className = ""
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "blue" | "purple" | "amber" | "red" | "cyan";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-white/[0.08] bg-white/[0.05] text-white/60",
    green: "border-emerald-500/20 bg-emerald-500/15 text-emerald-400",
    blue: "border-blue-500/20 bg-blue-500/15 text-blue-400",
    purple: "border-purple-500/20 bg-purple-500/15 text-purple-400",
    amber: "border-amber-500/20 bg-amber-500/15 text-amber-400",
    red: "border-red-500/20 bg-red-500/15 text-red-400",
    cyan: "border-cyan-500/20 bg-cyan-500/15 text-cyan-400"
  };
  return <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium leading-4 ${tones[tone]} ${className}`}>{children}</span>;
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
  title,
  plus
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "bright" | "submit";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  busy?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
  /** Prefix the console's bold plus icon (header "+ New …" actions). */
  plus?: boolean;
}) {
  const sizes = { sm: "h-8 px-3 text-[13px]", md: "h-9 px-3.5 text-[14px]", lg: "h-11 px-5 text-[15px]" };
  const variants: Record<string, string> = {
    primary: "rounded-[8px] bg-primary text-white hover:bg-primary/90 disabled:opacity-50",
    bright: "rounded-[8px] bg-primary text-white hover:bg-primary/90 disabled:opacity-50",
    submit: "rounded-[10px] bg-primary text-primary-foreground-strong hover:brightness-110 disabled:opacity-50",
    secondary: "rounded-[10px] border border-surface-border bg-white/[0.03] text-white hover:bg-white/[0.06] disabled:opacity-50",
    ghost: "rounded-[10px] text-text-dim hover:text-white disabled:opacity-50",
    danger: "rounded-[10px] border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/15 disabled:opacity-50"
  };
  const classes = `focus-ring inline-flex shrink-0 items-center justify-center gap-1.5 font-medium leading-none transition-[transform,background-color,color,filter] duration-200 active:scale-[0.96] ${sizes[size]} ${variants[variant]} ${className}`;
  const content = (
    <>
      {busy ? <CircleNotch size={15} className="animate-spin" /> : plus ? <Plus size={16} weight="bold" /> : null}
      {children}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={classes} title={title}>
        {content}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled || busy} className={classes} title={title}>
      {content}
    </button>
  );
}

export function Field({ label, hint, children, className = "" }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <div className="mb-2 block text-sm text-text-dim">{label}</div>
      {children}
      {hint ? <div className="mt-1.5 text-xs text-text-dim">{hint}</div> : null}
    </label>
  );
}

export const inputClass = "focus-ring h-10 w-full rounded-[10px] bg-input px-3 py-2 text-sm text-white placeholder:text-white/30";
export const textareaClass = "focus-ring w-full rounded-[10px] bg-input px-3 py-2 text-sm text-white placeholder:text-white/30";

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {icon ? <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.04] text-text-dim [&>svg]:h-6 [&>svg]:w-6">{icon}</div> : null}
      <p className="mt-4 text-sm font-medium text-white">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-text-dim">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Table({ head, children, className = "" }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index} className="border-b border-surface-border px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-dim">
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
    <tr onClick={onClick} className={`border-b border-white/[0.04] last:border-b-0 ${onClick ? "cursor-pointer transition-colors hover:bg-white/[0.02]" : ""} ${className}`}>
      {children}
    </tr>
  );
}

export function Cell({ children, className = "", mono }: { children: ReactNode; className?: string; mono?: boolean }) {
  return <td className={`px-4 py-3 align-middle text-text ${mono ? "font-mono text-xs" : ""} ${className}`}>{children}</td>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label?: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="focus-ring flex items-center gap-3 rounded-full" aria-pressed={checked}>
      <span className={`relative h-6 w-11 rounded-full transition-colors ${checked ? "bg-primary" : "bg-white/[0.1]"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-[left] ${checked ? "left-[22px]" : "left-0.5"}`} />
      </span>
      {label ? <span className="text-sm text-text">{label}</span> : null}
    </button>
  );
}

export function Modal({ title, onClose, children, footer, width = "max-w-lg" }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative z-10 mx-4 w-full ${width} rounded-[20px] border border-surface-border bg-surface p-6 text-foreground shadow-modal`}>
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text">{title}</h3>
          <button type="button" onClick={onClose} className="focus-ring rounded-full p-1 text-white/40 hover:text-white" aria-label="Close">
            <X size={16} weight="bold" />
          </button>
        </header>
        <div>{children}</div>
        {footer ? <footer className="mt-6 flex justify-end gap-2">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "good"; children: ReactNode }) {
  const tones = {
    info: "border-white/[0.06] bg-white/[0.03] text-text-secondary",
    warn: "border-amber-500/20 bg-amber-500/10 text-amber-400",
    error: "border-red-500/20 bg-red-500/10 text-red-400",
    good: "border-primary/20 bg-primary/10 text-primary"
  };
  return <div className={`rounded-[12px] border px-4 py-2.5 text-sm ${tones[tone]}`}>{children}</div>;
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
  const color = ok === null ? "bg-white/30" : ok ? "bg-primary" : "bg-red-400";
  return <span className={`inline-block h-2 w-2 rounded-full ${color} ${className}`} />;
}

/** Initials avatar. `plain` gives the console's gray circle; the default keeps Messages-style hues for contacts. */
export function Avatar({ name, size = 40, className = "", plain }: { name: string; size?: number; className?: string; plain?: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const hue = [...name].reduce((total, char) => total + char.charCodeAt(0), 0) % 360;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium ${plain ? "bg-white/[0.06] text-white/50" : "text-white"} ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        ...(plain ? {} : { background: `linear-gradient(180deg, hsl(${hue} 30% 55%), hsl(${hue} 30% 40%))` })
      }}
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
