"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MessageSquare, PhoneCall, Smartphone, Webhook } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { UsageStats } from "@/lib/types";
import { Badge, Card, Notice, Page, PageHeader, StatTile, formatNumber, formatRelative } from "@/components/dashboard/ui";
import { EnvironmentOffline, useServerOffline } from "@/components/dashboard/EnvironmentOffline";
import { USAGE_SERIES, UsageChart } from "@/components/dashboard/UsageChart";

const [MESSAGES_SERIES, CALLS_SERIES] = USAGE_SERIES;

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

function WindowCard({ title, counts }: { title: string; counts: { messages: number; calls: number } }) {
  return (
    <Card title={title}>
      <div className="space-y-3 text-[14px]">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2.5 text-slate-600">
            <Dot color={MESSAGES_SERIES.color} />
            Messages
          </span>
          <span className="text-[16px] font-bold text-bright">{formatNumber(counts.messages)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2.5 text-slate-600">
            <Dot color={CALLS_SERIES.color} />
            Calls
          </span>
          <span className="text-[16px] font-bold text-bright">{formatNumber(counts.calls)}</span>
        </div>
      </div>
    </Card>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-raised px-4 py-3.5">
      <div className="text-[13px] text-slate-500">{label}</div>
      <div className="mt-1 text-[24px] font-bold leading-tight text-bright">{value}</div>
      {hint ? <div className="mt-1 text-[12.5px] text-slate-500">{hint}</div> : null}
    </div>
  );
}

export default function UsagePage() {
  const { runs, contacts } = useLive();
  const offline = useServerOffline();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<7 | 30>(30);

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

  return (
    <Page>
      <PageHeader title="Usage" subtitle="Your activity across messages, calls, and webhooks" />

      {offline && !stats ? (
        <EnvironmentOffline />
      ) : !stats || !totals || !health ? (
        error ? <Notice tone="error">Could not load usage: {error}</Notice> : <div className="text-[14px] text-slate-500">Loading…</div>
      ) : (
        <div className="space-y-6">
          {error ? <Notice tone="error">Showing the last loaded numbers; refresh failed: {error}</Notice> : null}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Messages"
              value={formatNumber(totals.messages)}
              icon={<MessageSquare size={20} />}
              hint={`${formatNumber(stats.windows.last30d.messages)} in the last 30 days`}
            />
            <StatTile
              label="Voice Calls"
              value={formatNumber(totals.calls)}
              icon={<PhoneCall size={20} />}
              hint={`${formatNumber(stats.windows.last30d.calls)} in the last 30 days`}
            />
            <StatTile
              label="Webhook Deliveries"
              value={formatNumber(totals.deliveries)}
              icon={<Webhook size={20} />}
              hint={totals.deliveries === 0 ? "No deliveries yet" : `${formatNumber(totals.failedDeliveries)} failed`}
            />
            <StatTile label="Phone Numbers" value={formatNumber(contacts.length + 1)} icon={<Smartphone size={20} />} hint="active numbers" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <WindowCard title="Last 24 Hours" counts={stats.windows.last24h} />
            <WindowCard title="Last 7 Days" counts={stats.windows.last7d} />
            <WindowCard title="Last 30 Days" counts={stats.windows.last30d} />
            <Card title="Webhook Health">
              {totals.deliveries === 0 ? (
                <div className="space-y-2 text-[14px]">
                  <div className="text-slate-500">No deliveries yet</div>
                  <Link href="/webhooks" className="font-medium text-fern hover:underline">
                    Configure webhook →
                  </Link>
                </div>
              ) : (
                <div className="space-y-3 text-[14px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Success rate</span>
                    <span className={`text-[16px] font-bold ${health.successRate >= 95 ? "text-fern" : health.successRate >= 80 ? "text-caution" : "text-danger"}`}>
                      {health.successRate}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Timeouts</span>
                    <span className="text-[16px] font-bold text-bright">{formatNumber(health.timeouts)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-600">Last delivery</span>
                    <span className="flex items-center gap-2">
                      <span className="text-slate-500">{formatRelative(health.lastDeliveryAt)}</span>
                      {health.lastStatus !== undefined ? (
                        <Badge tone={health.lastStatus >= 200 && health.lastStatus < 300 ? "green" : "red"}>
                          {health.lastStatus || "no response"}
                        </Badge>
                      ) : null}
                    </span>
                  </div>
                </div>
              )}
            </Card>
          </div>

          <Card
            title="Activity"
            subtitle={`Daily usage over the last ${range} days`}
            actions={
              <div className="flex rounded-lg border border-line bg-raised p-0.5">
                {([7, 30] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setRange(option)}
                    aria-pressed={range === option}
                    className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
                      range === option ? "bg-panel text-bright" : "text-slate-500 hover:text-bright"
                    }`}
                  >
                    {option} days
                  </button>
                ))}
              </div>
            }
          >
            <div className="mb-4 flex flex-wrap items-center gap-5 text-[13px] text-slate-600">
              {USAGE_SERIES.map((series) => (
                <span key={series.key} className="flex items-center gap-2">
                  <Dot color={series.color} />
                  {series.label}
                </span>
              ))}
            </div>
            <UsageChart days={stats.byDay.slice(-range)} />
          </Card>

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
            <div className="mt-4 text-[13px] text-slate-500">
              Average webhook latency <span className="data text-slate-700">{formatNumber(totals.averageLatencyMs)} ms</span> across{" "}
              {formatNumber(totals.deliveries)} deliveries.
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}
