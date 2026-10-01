"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LinkSimple } from "@phosphor-icons/react";
import { useLive } from "@/lib/live";
import type { InspectorDelivery } from "@/lib/types";
import {
  Badge,
  Button,
  Cell,
  ChannelBadge,
  EmptyState,
  Notice,
  Page,
  PageBody,
  PageHeader,
  Row,
  StatusDot,
  Table,
  formatDateTime
} from "@/components/dashboard/ui";
import { EnvironmentOffline, useServerOffline } from "@/components/dashboard/EnvironmentOffline";
import { ContextLimitField, RuntimeResultNotice, TimeoutField, useRuntimeSettings } from "@/components/dashboard/EnvironmentRuntime";
import { WebhookPayloadCard } from "@/components/dashboard/WebhookPayload";
import { deliveryActions, deliverySucceeded, useRunDetails } from "@/components/dashboard/WebhookSessions";

const EXAMPLE_HANDLER_URL = "http://localhost:3000/webhook";
const URL_INPUT = "focus-ring w-full rounded-[10px] bg-input px-4 py-3 font-mono text-sm text-white transition-all placeholder:text-text-dim";

export default function WebhooksPage() {
  const { session, runs, lastDelivery } = useLive();
  const offline = useServerOffline();
  const form = useRuntimeSettings();
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");

  const liveTarget = session?.targetUrl;
  useEffect(() => {
    if (!form.dirty && liveTarget) setUrl(liveTarget);
  }, [form.dirty, liveTarget]);

  const recentRuns = useMemo(() => runs.slice(0, 10), [runs]);
  const { sessions, loading, error } = useRunDetails(recentRuns);
  const deliveries = useMemo(
    () =>
      sessions
        .flatMap((run) => run.deliveries.filter((delivery) => !delivery.inheritedFrom).map((delivery) => ({ run: run.id, delivery })))
        .sort((a, b) => b.delivery.timestamp.localeCompare(a.delivery.timestamp))
        .slice(0, 25),
    [sessions]
  );

  const latestDelivery: InspectorDelivery | null = lastDelivery ?? session?.deliveries.at(-1) ?? null;
  const failing = latestDelivery ? !deliverySucceeded(latestDelivery) : false;

  async function saveWebhook(event?: FormEvent) {
    event?.preventDefault();
    const saved = await form.save({ targetUrl: url.trim(), ...(secret.trim() ? { secret: secret.trim() } : {}) });
    if (saved) setSecret("");
  }

  return (
    <Page>
      <PageHeader
        title="Webhooks"
        subtitle="Receive real-time events for SMS and voice calls. Configure a project default for all agents, or set per-agent webhooks on each agent's detail page."
      />

      {offline ? (
        <PageBody>
          <EnvironmentOffline />
        </PageBody>
      ) : (
        <PageBody>
          <div className="rounded-[18px] bg-card p-4 shadow-card backdrop-blur-[2px]">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">How webhook routing works</h3>
            <div className="flex flex-wrap items-center gap-2 text-sm text-text-dim">
              <span className="rounded border border-blue-500/20 bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                Agent webhook
              </span>
              <span>takes priority if configured</span>
              <span className="text-[#3a3a4a]">→</span>
              <span>otherwise falls back to</span>
              <span className="rounded border border-purple-500/20 bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-medium text-purple-400">
                Project default
              </span>
            </div>
            <p className="mt-2 text-xs text-text-dim">
              In the simulator, the project default is the target the CLI was started with; sub-accounts switch it.
            </p>
          </div>

          <div className="rounded-[18px] bg-card p-6 shadow-card backdrop-blur-[2px]">
            <div className="mb-4 flex items-center gap-3">
              <h2 className="text-lg font-semibold text-text">Project Default Webhook</h2>
              <Badge tone="purple">Catches all agents</Badge>
            </div>
            <p className="mb-4 text-sm text-text-dim">
              This endpoint receives events for all agents that don&apos;t have their own webhook configured.
            </p>

            <form noValidate onSubmit={(event) => void saveWebhook(event)} className="space-y-4">
              <div>
                <label htmlFor="webhook-url" className="mb-2 block text-sm text-text-dim">
                  URL
                </label>
                <input
                  id="webhook-url"
                  type="url"
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    form.touch();
                  }}
                  placeholder="https://your-server.com/webhooks/sms"
                  className={URL_INPUT}
                />
                <div className="mt-2 flex items-center gap-1.5 text-xs text-text-dim">
                  <span>Configure an endpoint or point it at the</span>
                  <button
                    type="button"
                    onClick={() => {
                      setUrl(EXAMPLE_HANDLER_URL);
                      form.touch();
                    }}
                    className="inline-flex items-center gap-1 text-primary underline underline-offset-2 transition-colors hover:text-primary"
                  >
                    example handler
                  </button>
                  <span
                    className="inline-flex items-center"
                    title="npm --workspace examples/handler-express start serves a signature-verifying handler at http://localhost:3000/webhook."
                  >
                    <svg
                      className="h-3.5 w-3.5 cursor-help text-text-dim transition-colors hover:text-text-secondary"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </span>
                </div>
              </div>

              <div>
                <label htmlFor="webhook-secret" className="mb-2 block text-sm text-text-dim">
                  Signing secret
                </label>
                <input
                  id="webhook-secret"
                  type="password"
                  value={secret}
                  onChange={(event) => {
                    setSecret(event.target.value);
                    form.touch();
                  }}
                  placeholder={session?.secretPreview ?? "whsec_…"}
                  autoComplete="new-password"
                  className={URL_INPUT}
                />
                {session ? <p className="mt-2 text-xs text-text-dim">Leave blank to keep the current secret ({session.secretPreview}).</p> : null}
              </div>

              <ContextLimitField form={form} slider />

              <div className="max-w-[240px]">
                <TimeoutField form={form} />
              </div>

              <RuntimeResultNotice result={form.result} />

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={form.saving || !session || !url.trim()}
                  className="focus-ring rounded-[10px] bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground-strong transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {form.saving ? "Saving..." : session ? "Update Webhook" : "Save Webhook"}
                </button>
                <span className="text-xs text-text-dim">
                  Saving starts a fresh session with the new target; the current conversation stays in history.
                </span>
              </div>
            </form>

            {session ? (
              <div className="mt-6 border-t border-surface-border pt-6">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-sm text-text-dim">Signing Secret</span>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                      failing ? "border-red-500/20 bg-red-500/15 text-red-400" : "border-primary/20 bg-primary/[0.12] text-primary"
                    }`}
                  >
                    {failing ? "failing" : "active"}
                  </span>
                </div>
                <code className="block break-all rounded-[12px] bg-card-content px-4 py-3 font-mono text-sm text-primary">
                  {session.secretPreview}
                </code>
                <p className="mt-2 text-xs text-text-dim">Use this secret to verify webhook signatures. See Documentation for implementation.</p>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span>
                    <span className="text-text-dim">Context limit: </span>
                    <span className="font-mono text-text">{session.runSettings?.contextLimit ?? form.contextLimit} messages</span>
                  </span>
                  {session.runSettings?.timeoutSeconds !== undefined ? (
                    <span>
                      <span className="text-text-dim">Timeout: </span>
                      <span className="font-mono text-text">{session.runSettings.timeoutSeconds}s</span>
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <WebhookPayloadCard delivery={latestDelivery} />

          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-text">Recent Deliveries</h2>
              <span className="text-xs text-text-dim">
                {deliveries.length} deliveries · last {recentRuns.length} run{recentRuns.length === 1 ? "" : "s"}
              </span>
            </div>
            <section className="overflow-hidden rounded-[18px] bg-card shadow-card backdrop-blur-[2px]">
              {error ? (
                <div className="px-6 pt-4">
                  <Notice tone="error">Could not load deliveries: {error}</Notice>
                </div>
              ) : null}
              {loading && recentRuns.length ? (
                <div className="px-6 py-4 text-sm text-text-dim">Loading...</div>
              ) : deliveries.length === 0 ? (
                <EmptyState
                  icon={<LinkSimple size={24} />}
                  title="No deliveries yet"
                  description="Send a message from Messages or run a scenario; every signed request to your webhook shows up here."
                  action={
                    <Button href="/imessage" plus>
                      Send a message
                    </Button>
                  }
                />
              ) : (
                <Table head={["Time", "Event", "Channel", "Status", "Latency", "Retries", "Faults", "Actions", ""]}>
                  {deliveries.map(({ run, delivery }) => {
                    const ok = deliverySucceeded(delivery);
                    const actions = deliveryActions(delivery);
                    return (
                      <Row key={`${run}:${delivery.id}`}>
                        <Cell className="whitespace-nowrap text-text-secondary">{formatDateTime(delivery.timestamp)}</Cell>
                        <Cell mono>
                          {delivery.event}
                          {delivery.replayOf ? <span className="ml-1.5 text-text-dim">(replay)</span> : null}
                        </Cell>
                        <Cell>
                          <ChannelBadge channel={delivery.channel} />
                        </Cell>
                        <Cell>
                          <span className={`inline-flex items-center gap-2 font-mono text-xs font-medium ${ok ? "text-primary" : "text-red-400"}`}>
                            <StatusDot ok={ok} />
                            {delivery.timedOut ? "timeout" : delivery.response.status || "error"}
                          </span>
                        </Cell>
                        <Cell mono className="text-text-secondary">
                          {delivery.latencyMs} ms
                        </Cell>
                        <Cell mono className="text-text-secondary">
                          {delivery.retries}
                        </Cell>
                        <Cell>
                          <div className="flex flex-wrap gap-1">
                            {(delivery.faults ?? []).length ? (
                              delivery.faults?.map((fault) => (
                                <Badge key={fault} tone="amber">
                                  {fault}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-text-dim">—</span>
                            )}
                          </div>
                        </Cell>
                        <Cell>
                          <div className="flex flex-wrap gap-1">
                            {actions.length ? (
                              actions.map((action) => <Badge key={action}>{action}</Badge>)
                            ) : (
                              <span className="text-text-dim">—</span>
                            )}
                          </div>
                        </Cell>
                        <Cell className="text-right">
                          <Button variant="ghost" size="sm" className="!h-7 !px-2" href={`/devtools?session=${encodeURIComponent(run)}`}>
                            Inspect
                          </Button>
                        </Cell>
                      </Row>
                    );
                  })}
                </Table>
              )}
            </section>
          </div>
        </PageBody>
      )}
    </Page>
  );
}
