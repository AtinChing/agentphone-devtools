"use client";

import Link from "next/link";
import { ArrowRight, Check } from "@phosphor-icons/react";

export interface OverviewStep {
  id: string;
  title: string;
  description: string;
  href: string;
  done: boolean;
}

/** The console Overview's "Get started" checklist: progress bar, numbered steps, the next one highlighted. */
export function OverviewSteps({
  steps,
  title = "Getting started",
  subtitle = "Wire your handler into the simulator",
  helpHref = "/documentation",
  className = ""
}: {
  steps: OverviewStep[];
  title?: string;
  subtitle?: string;
  helpHref?: string;
  className?: string;
}) {
  const done = steps.filter((step) => step.done).length;
  const percent = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const nextId = steps.find((step) => !step.done)?.id;

  return (
    <div className={`relative flex min-h-0 flex-col overflow-hidden rounded-[18px] bg-card p-6 shadow-card backdrop-blur-[2px] ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-[18px] font-bold leading-tight text-white">{title}</h2>
          <p className="mt-1.5 text-[13px] leading-snug text-white/50">{nextId ? subtitle : "You're all set. Every step is done."}</p>
        </div>
        <span className="shrink-0 text-[13px] font-medium tabular-nums text-white/60">
          {done}/{steps.length}
        </span>
      </div>
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }} />
      </div>

      <div className="mt-5 flex flex-col gap-1">
        {steps.map((step, index) => {
          const next = step.id === nextId;
          return (
            <Link
              key={step.id}
              href={step.href}
              className={`focus-ring group flex items-center gap-3 rounded-[14px] p-3 transition-[transform,background-color,opacity] duration-200 active:scale-[0.98] ${
                step.done ? "opacity-55 hover:opacity-80" : next ? "bg-white/[0.05] hover:bg-white/[0.07]" : "hover:bg-white/[0.03]"
              }`}
            >
              <span
                className={`grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors ${
                  step.done
                    ? "border-primary bg-primary text-primary-foreground-strong"
                    : next
                      ? "border-primary text-primary"
                      : "border-white/20 text-white/40 group-hover:border-white/40"
                }`}
              >
                {step.done ? <Check size={13} weight="bold" /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[14px] font-medium leading-tight ${step.done ? "text-white/55 line-through" : "text-white"}`}>{step.title}</span>
                <span className="mt-0.5 block truncate text-[13px] leading-tight text-white/45">{step.description}</span>
              </span>
              {step.done ? null : next ? (
                <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-[12px] font-medium leading-none text-primary-foreground-strong">Start</span>
              ) : (
                <ArrowRight size={16} className="shrink-0 text-white/25 transition-colors group-hover:text-white/50" />
              )}
            </Link>
          );
        })}
      </div>

      <Link href={helpHref} className="focus-ring mt-auto flex items-center gap-1.5 rounded-lg pt-5 text-[13px] text-white/45 transition-colors hover:text-white/70">
        Need a hand? Read the setup guide
        <ArrowRight size={13} weight="bold" />
      </Link>
    </div>
  );
}
