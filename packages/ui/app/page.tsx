"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MessageCircle, PhoneCall, ShieldCheck, Webhook, Wrench } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { UsageStats } from "@/lib/types";
import {
  Button,
  Card,
  ChannelBadge,
  EmptyState,
  Notice,
  Page,
  PageHeader,
  StatTile,
  StatusDot,
  formatNumber,
  formatRelative
} from "@/components/dashboard/ui";
import { ComplianceResults, useComplianceSuite } from "@/components/dashboard/OverviewCompliance";
import { ServerOffline, hasTraffic, runHref, useServerOffline } from "@/components/dashboard/RunsShared";

export default function OverviewPage() {
  const { connected, session, runs } = useLive();
  const offline = useServerOffline();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const suite = useComplianceSuite();
  const recent = useMemo(() => runs.filter(hasTraffic).slice(0, 8), [runs]);

  // Stats aren't pushed; recompute whenever the run history changes (debounced for bursts).
  useEffect(() => {
    if (!connected) return;
    const timer = window.setTimeout(() => {
      api
        .get<UsageStats>("/api/stats")
        .then((next) => {
          setStats(next);
          setStatsError(null);
        })
        .catch((err) => setStatsError(errorMessage(err)));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [connected, runs]);

  if (offline && !session) {
    return (
      <Page>
        <PageHeader title="Overview" subtitle="Your local AgentPhone simulator at a glance." />
        <Card>
          <ServerOffline />
        </Card>
        <GettingStarted className="mt-4" />
      </Page>
    );
  }

  const totals = stats?.totals;
  const settings = session?.runSettings;

  return (
    <Page>
      <PageHeader title="Overview" subtitle="Your local AgentPhone simulator at a glance." />
      {statsError ? (
        <div className="mb-4">
          <Notice tone="error">Couldn&apos;t load usage stats: {statsError}</Notice>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Messages"
          value={totals ? formatNumber(totals.messages) : "—"}
          hint={stats ? `${formatNumber(stats.windows.last7d.messages)} in the last 7 days` : "Loading…"}
          icon={<MessageCircle size={20} />}
        />
        <StatTile
          label="Voice Calls"
          value={totals ? formatNumber(totals.calls) : "—"}
          hint={stats ? `${formatNumber(stats.windows.last7d.calls)} in the last 7 days` : "Loading…"}
          icon={<PhoneCall size={20} />}
        />
        <StatTile
          label="Webhook Deliveries"
          value={totals ? formatNumber(totals.deliveries) : "—"}
          hint={
            totals
              ? `avg latency ${formatNumber(totals.averageLatencyMs)} ms${totals.failedDeliveries ? ` · ${formatNumber(totals.failedDeliveries)} failed` : ""}`
              : "Loading…"
          }
          icon={<Webhook size={20} />}
        />
        <StatTile
          label="Scenario pass rate"
          value={totals?.scenarioRuns ? `${totals.scenarioPassRate}%` : "—"}
          hint={totals ? `${formatNumber(totals.scenarioRuns)} ${totals.scenarioRuns === 1 ? "run" : "runs"}` : "Loading…"}
          icon={<ShieldCheck size={20} />}
          tone={totals?.scenarioRuns ? (totals.scenarioPassRate === 100 ? "good" : "bad") : "default"}
        />
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <Card
          title="Simulator"
          subtitle="Where every simulated event is delivered."
          badge={
            <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${connected ? "text-fern" : "text-danger"}`}>
              <StatusDot ok={connected} />
              {connected ? "Connected" : "Offline"}
            </span>
          }
        >
          {session ? (
            <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[14px]">
              <Detail label="Webhook URL">
                <span className="data break-all text-bright">{session.targetUrl}</span>
              </Detail>
              <Detail label="Signing secret">
                <span className="data text-bright">{session.secretPreview}</span>
              </Detail>
              <Detail label="Channel">
                <ChannelBadge channel={session.channel} />
              </Detail>
              <Detail label="Context limit">{settings ? `${settings.contextLimit} recentHistory turns` : "—"}</Detail>
              <Detail label="Timeout">{settings ? `${settings.timeoutSeconds}s per delivery` : "—"}</Detail>
              <Detail label="Live session">
                <span className="data text-slate-600">{session.id}</span>
                <span className="ml-2 text-slate-500">· {session.status}</span>
              </Detail>
            </dl>
          ) : (
            <p className="text-[14px] text-slate-500">Loading…</p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button href="/imessage">
              <MessageCircle size={15} /> Open iMessage
            </Button>
            <Button href="/devtools" variant="secondary">
              <Wrench size={15} /> Step a scenario
            </Button>
            <Button variant="secondary" onClick={() => void suite.run()} busy={suite.running} disabled={!connected}>
              {suite.running ? null : <ShieldCheck size={15} />} Run compliance suite
            </Button>
          </div>
          {suite.rows.length || suite.error ? (
            <div className="mt-5">
              <ComplianceResults suite={suite} />
            </div>
          ) : null}
        </Card>

        <Card
          title="Recent runs"
          subtitle="Latest conversations and calls, newest first."
          padded={false}
          actions={
            <Button href="/messages" variant="ghost" size="sm">
              View all
            </Button>
          }
        >
          {recent.length ? (
            <ul className="border-t border-line">
              {recent.map((run) => (
                <li key={run.id}>
                  <Link href={runHref(run)} className="flex items-center gap-3 border-b border-line/70 px-6 py-3 text-[14px] transition last:border-b-0 hover:bg-mist">
                    <span className="w-[74px] shrink-0">
                      <ChannelBadge channel={run.channel} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-bright">{run.contact?.name ?? "Caller"}</span>
                      <span className="block truncate text-[12.5px] text-slate-500">{run.lastMessage ?? "—"}</span>
                    </span>
                    <span className="data shrink-0 text-[12.5px] text-slate-500">
                      {run.transcriptTurns} {run.transcriptTurns === 1 ? "turn" : "turns"}
                    </span>
                    <span
                      className="shrink-0"
                      title={
                        run.scenarioPassed !== undefined
                          ? run.scenarioPassed
                            ? "Scenario passed"
                            : "Scenario failed"
                          : run.status === "running"
                            ? "Running"
                            : "Ended"
                      }
                    >
                      <StatusDot
                        ok={run.scenarioPassed ?? (run.status === "running" ? true : null)}
                        className={run.status === "running" && run.scenarioPassed === undefined ? "animate-pulse" : ""}
                      />
                    </span>
                    <span className="w-[72px] shrink-0 text-right text-[12.5px] text-slate-500">{formatRelative(run.lastActivityAt ?? run.startedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<MessageCircle size={24} />}
              title="No runs yet"
              description="Send a message from the iMessage tab or run the compliance suite to see runs here."
            />
          )}
        </Card>
      </div>

      <GettingStarted className="mt-4" />
    </Page>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-700">{children}</dd>
    </>
  );
}

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "Start your handler",
    body: (
      <>
        Run your webhook server locally, or the bundled example with <code className="data text-bright">npm run start:example</code>.
      </>
    )
  },
  {
    title: "Point the webhook at it",
    body: (
      <>
        Launch with <code className="data text-bright">npx agentphone-devtools --target &lt;url&gt; --secret &lt;secret&gt;</code>, or add it on the{" "}
        <Link href="/agents" className="text-fern hover:underline">
          Agents
        </Link>{" "}
        tab.
      </>
    )
  },
  {
    title: "Message it from the iMessage tab",
    body: (
      <>
        Every text becomes a signed <code className="data text-bright">agent.message</code> delivery you can inspect, fork and replay.
      </>
    )
  }
];

function GettingStarted({ className = "" }: { className?: string }) {
  return (
    <Card title="Getting started" className={className}>
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-raised text-[13px] font-semibold text-fern">{index + 1}</span>
            <div className="min-w-0 text-[13.5px] leading-relaxed text-slate-500">
              <div className="font-medium text-bright">{step.title}</div>
              {step.body}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
