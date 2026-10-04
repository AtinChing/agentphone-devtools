"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChatCircle, ShieldCheck, Wrench } from "@phosphor-icons/react";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { UsageStats } from "@/lib/types";
import {
  Avatar,
  Button,
  Card,
  ChannelBadge,
  EmptyState,
  Notice,
  OverviewTile,
  Page,
  PageBody,
  PageHeader,
  StatusDot,
  formatNumber,
  formatRelative
} from "@/components/dashboard/ui";
import { ComplianceResults, useComplianceSuite } from "@/components/dashboard/OverviewCompliance";
import { OverviewActivity } from "@/components/dashboard/OverviewActivity";
import { OverviewSteps, type OverviewStep } from "@/components/dashboard/OverviewSteps";
import { ServerOffline, hasTraffic, runHref, useServerOffline } from "@/components/dashboard/RunsShared";

const SUBTITLE = "Your local AgentPhone simulator at a glance";

export default function OverviewPage() {
  const { connected, session, runs } = useLive();
  const offline = useServerOffline();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const suite = useComplianceSuite();
  const recent = useMemo(() => runs.filter(hasTraffic).slice(0, 8), [runs]);
  const threads = useMemo(() => runs.filter((run) => run.channel !== "voice" && hasTraffic(run)).length, [runs]);
  const calls = useMemo(() => runs.filter((run) => run.channel === "voice" && hasTraffic(run)).length, [runs]);

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

  const totals = stats?.totals;
  const steps: OverviewStep[] = [
    {
      id: "handler",
      title: "Start your handler",
      description: "Run your webhook server, or npm run start:example",
      href: "/documentation",
      done: Boolean(totals && totals.deliveries > totals.failedDeliveries)
    },
    {
      id: "webhook",
      title: "Point the webhook at it",
      description: "Set the target URL and signing secret",
      href: "/webhooks",
      done: Boolean(session?.targetUrl)
    },
    {
      id: "message",
      title: "Message it from the iMessage tab",
      description: "Every text becomes a signed agent.message delivery",
      href: "/imessage",
      done: threads > 0
    },
    {
      id: "scenario",
      title: "Run a scenario suite",
      description: "Step a scenario, or run the compliance suite below",
      href: "/devtools",
      done: Boolean(totals?.scenarioRuns) || runs.some((run) => run.scenarioPassed !== undefined)
    }
  ];

  if (offline && !session) {
    return (
      <Page>
        <PageHeader title="Overview" subtitle={SUBTITLE} />
        <PageBody>
          <div className="flex flex-col gap-3 xl:flex-row">
            <Card className="min-w-0 xl:flex-1">
              <ServerOffline />
            </Card>
            <OverviewSteps steps={steps} className="shrink-0 xl:w-[360px]" />
          </div>
        </PageBody>
      </Page>
    );
  }

  const settings = session?.runSettings;
  const live = (value: number) => (connected || runs.length ? formatNumber(value) : "—");

  return (
    <Page>
      <PageHeader title="Overview" subtitle={SUBTITLE} />
      <PageBody>
        {statsError ? <Notice tone="error">Couldn&apos;t load usage stats: {statsError}</Notice> : null}

        <div className="stagger-enter flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <OverviewTile label="Messages" value={live(threads)} descriptor="threads" href="/messages" />
            <OverviewTile label="Voice Calls" value={live(calls)} descriptor="calls" href="/voice-calls" />
            <OverviewTile label="Webhook Deliveries" value={totals ? formatNumber(totals.deliveries) : "—"} href="/webhooks" />
            <OverviewTile
              label="Scenario pass rate"
              value={totals?.scenarioRuns ? `${totals.scenarioPassRate}%` : "—"}
              descriptor={totals ? `of ${formatNumber(totals.scenarioRuns)} ${totals.scenarioRuns === 1 ? "run" : "runs"}` : undefined}
              href="/devtools"
            />
          </div>

          <div className="flex flex-col gap-3 xl:h-[440px] xl:flex-row">
            <OverviewActivity days={stats?.byDay ?? null} className="h-[400px] min-w-0 xl:h-full xl:flex-1" />
            <OverviewSteps steps={steps} className="shrink-0 xl:h-full xl:w-[360px]" />
          </div>

          <div className="grid items-start gap-3 lg:grid-cols-2">
            <Card
              title="Simulator"
              subtitle="Where every simulated event is delivered"
              badge={
                <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${connected ? "text-primary" : "text-red-400"}`}>
                  <StatusDot ok={connected} />
                  {connected ? "Connected" : "Offline"}
                </span>
              }
            >
              {session ? (
                <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
                  <Detail label="Webhook URL">
                    <span className="break-all font-mono text-[13px] text-text">{session.targetUrl}</span>
                  </Detail>
                  <Detail label="Signing secret">
                    <span className="font-mono text-[13px] text-text">{session.secretPreview}</span>
                  </Detail>
                  <Detail label="Channel">
                    <ChannelBadge channel={session.channel} />
                  </Detail>
                  <Detail label="Context limit">
                    {settings ? (
                      <>
                        <span className="tabular-nums">{settings.contextLimit}</span> recentHistory turns
                      </>
                    ) : (
                      "—"
                    )}
                  </Detail>
                  <Detail label="Timeout">{settings ? <span className="tabular-nums">{settings.timeoutSeconds}s per delivery</span> : "—"}</Detail>
                  <Detail label="Live session">
                    <span className="font-mono text-xs text-text-dim">{session.id}</span>
                    <span className="ml-2 text-xs text-text-secondary">· {session.status}</span>
                  </Detail>
                </dl>
              ) : (
                <p className="text-sm text-text-dim">Loading…</p>
              )}
              <div className="mt-6 flex flex-wrap gap-2 border-t border-white/[0.06] pt-5">
                <Button href="/imessage">
                  <ChatCircle size={16} weight="bold" /> Open iMessage
                </Button>
                <Button href="/devtools" variant="secondary">
                  <Wrench size={16} /> Step a scenario
                </Button>
                <Button variant="secondary" onClick={() => void suite.run()} busy={suite.running} disabled={!connected}>
                  {suite.running ? null : <ShieldCheck size={16} />} Run compliance suite
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
              subtitle="Latest conversations and calls, newest first"
              padded={false}
              actions={
                <Button href="/messages" variant="ghost" size="sm">
                  View all
                </Button>
              }
            >
              {recent.length ? (
                <ul className="flex flex-col p-2">
                  {recent.map((run) => {
                    const name = run.contact?.name ?? "Caller";
                    return (
                      <li key={run.id}>
                        <Link
                          href={runHref(run)}
                          className="focus-ring flex items-center justify-between gap-3 rounded-[12px] px-4 py-3 transition-colors hover:bg-card-hover"
                        >
                          <Avatar name={name} size={36} plain />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-white">{name}</span>
                              <ChannelBadge channel={run.channel} />
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-text-dim">{run.lastMessage ?? "—"}</span>
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-text-secondary">
                            {run.transcriptTurns} {run.transcriptTurns === 1 ? "turn" : "turns"}
                          </span>
                          <span
                            className="flex shrink-0 items-center"
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
                          <span className="min-w-[64px] shrink-0 whitespace-nowrap text-right text-xs text-text-dim">{formatRelative(run.lastActivityAt ?? run.startedAt)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState
                  icon={<ChatCircle size={24} />}
                  title="No runs yet"
                  description="Send a message from the iMessage tab or run the compliance suite to see runs here."
                />
              )}
            </Card>
          </div>
        </div>
      </PageBody>
    </Page>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-text-secondary">{label}</dt>
      <dd className="min-w-0 text-text">{children}</dd>
    </>
  );
}
