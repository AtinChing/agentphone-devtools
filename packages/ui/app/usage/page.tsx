"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { UsageStats } from "@/lib/types";
import { Card, Notice, Page, PageBody, PageHeader, StatTile, formatNumber, formatRelative } from "@/components/dashboard/ui";
import { EnvironmentOffline, useServerOffline } from "@/components/dashboard/EnvironmentOffline";
import { ActivityCard } from "@/components/dashboard/UsageChart";

/** The console's 24px outline icons (stroke 1.5), drawn at w-5 h-5. */
function LineIcon({ d }: { d: string }) {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={d} />
    </svg>
  );
}

const ICONS = {
  messages:
    "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  calls:
    "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
  webhooks: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1",
  numbers: "M7 20l4-16m2 16l4-16M6 9h14M4 15h14"
};

function WindowCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[18px] bg-card p-5 shadow-card backdrop-blur-[2px]">
      <h3 className="mb-4 text-sm font-medium text-text-secondary">{title}</h3>
      {children}
    </div>
  );
}

function WindowRow({ dot, label, value }: { dot: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="text-sm text-text-secondary">{label}</span>
      </div>
      <span className="text-lg font-semibold tabular-nums text-text">{formatNumber(value)}</span>
    </div>
  );
}

function WindowCounts({ title, counts }: { title: string; counts: { messages: number; calls: number } }) {
  return (
    <WindowCard title={title}>
      <div className="space-y-4">
        <WindowRow dot="bg-primary" label="Messages" value={counts.messages} />
        <WindowRow dot="bg-blue-500" label="Calls" value={counts.calls} />
      </div>
    </WindowCard>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[12px] bg-white/[0.04] px-4 py-3.5">
      <div className="text-sm text-text-secondary">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight tabular-nums text-text">{value}</div>
      {hint ? <div className="mt-1 text-xs text-text-dim">{hint}</div> : null}
    </div>
  );
}

export default function UsagePage() {
  const { runs, contacts } = useLive();
  const offline = useServerOffline();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-aggregate whenever run history changes (SSE pushes it on every delivery).
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .get<UsageStats>("/api/stats")
        .then((next) => {
          if (cancelled) return;
          setStats(next);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (!cancelled) setError(errorMessage(reason));
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [runs]);

  const totals = stats?.totals;
  const health = stats?.webhookHealth;
  const rate = health?.successRate ?? 0;
  const rateText = rate >= 99 ? "text-primary" : rate >= 90 ? "text-amber-400" : "text-red-400";
  const rateBar = rate >= 99 ? "bg-primary" : rate >= 90 ? "bg-amber-500" : "bg-red-500";

  return (
    <Page>
      <PageHeader title="Usage" subtitle="Your activity across messages, calls, and webhooks" />

      {offline && !stats ? (
        <PageBody>
          <EnvironmentOffline />
        </PageBody>
      ) : !stats || !totals || !health ? (
        <PageBody>
          {error ? (
            <Notice tone="error">Could not load usage: {error}</Notice>
          ) : (
            <div className="flex items-center justify-center py-24 text-text-dim">
              <CircleNotch size={20} className="animate-spin" />
            </div>
          )}
        </PageBody>
      ) : (
        <PageBody>
          {error ? <Notice tone="error">Showing the last loaded numbers; refresh failed: {error}</Notice> : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Messages"
              value={formatNumber(totals.messages)}
              icon={<LineIcon d={ICONS.messages} />}
              hint={`${formatNumber(stats.windows.last30d.messages)} in the last 30 days`}
            />
            <StatTile
              label="Voice Calls"
              value={formatNumber(totals.calls)}
              icon={<LineIcon d={ICONS.calls} />}
              hint={`${formatNumber(stats.windows.last30d.calls)} in the last 30 days`}
            />
            <StatTile
              label="Webhook Deliveries"
              value={formatNumber(totals.deliveries)}
              icon={<LineIcon d={ICONS.webhooks} />}
              hint={totals.deliveries === 0 ? "No deliveries yet" : `${rate.toFixed(1)}% success rate`}
            />
            <StatTile label="Phone Numbers" value={formatNumber(contacts.length + 1)} icon={<LineIcon d={ICONS.numbers} />} hint="active numbers" />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <WindowCounts title="Last 24 Hours" counts={stats.windows.last24h} />
            <WindowCounts title="Last 7 Days" counts={stats.windows.last7d} />
            <WindowCounts title="Last 30 Days" counts={stats.windows.last30d} />
            <WindowCard title="Webhook Health">
              {totals.deliveries === 0 ? (
                <div className="flex flex-col items-center justify-center py-2">
                  <p className="text-sm text-text-dim">No deliveries yet</p>
                  <Link href="/webhooks" className="mt-1 text-xs text-primary hover:text-primary">
                    Configure webhook →
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">Success rate</span>
                    <span className={`text-lg font-semibold tabular-nums ${rateText}`}>{rate.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${rateBar}`}
                      style={{ width: `${Math.min(100, Math.max(0, rate))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-primary">{formatNumber(totals.deliveries - totals.failedDeliveries)} succeeded</span>
                    {totals.failedDeliveries > 0 ? <span className="text-red-400">{formatNumber(totals.failedDeliveries)} failed</span> : null}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-text-dim">
                    <span className="truncate" title="Last delivery">
                      Last {formatRelative(health.lastDeliveryAt)}
                      {health.lastStatus !== undefined ? (
                        <span className={health.lastStatus >= 200 && health.lastStatus < 300 ? "text-text-secondary" : "text-red-400"}>
                          {" "}
                          · {health.lastStatus || "no response"}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0">
                      {formatNumber(health.timeouts)} timeout{health.timeouts === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              )}
            </WindowCard>
          </div>

          <ActivityCard days={stats.byDay} height={260} />

          <Card title="Scenarios" subtitle="Regression runs, branches, and compliance signals from your history.">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Scenario runs" value={formatNumber(totals.scenarioRuns)} hint={`of ${formatNumber(totals.runs)} saved runs`} />
              <Metric
                label="Pass rate"
                value={totals.scenarioRuns ? `${totals.scenarioPassRate}%` : "—"}
                hint={totals.scenarioRuns ? "runs with every assertion passing" : "run a scenario to see this"}
              />
              <Metric label="Forks" value={formatNumber(totals.forks)} hint="branches explored from a checkpoint" />
              <Metric label="Opt-outs" value={formatNumber(totals.optOuts)} hint="replies carrying the opt_out action" />
            </div>
            <p className="mt-4 text-sm text-text-dim">
              Average webhook latency <span className="font-mono text-text-secondary">{formatNumber(totals.averageLatencyMs)} ms</span> across{" "}
              {formatNumber(totals.deliveries)} deliveries.
            </p>
          </Card>
        </PageBody>
      )}
    </Page>
  );
}
