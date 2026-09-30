"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Link2, Save } from "lucide-react";
import { useLive } from "@/lib/live";
import type { InspectorDelivery } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  Cell,
  ChannelBadge,
  EmptyState,
  Eyebrow,
  Field,
  Notice,
  Page,
  PageHeader,
  Row,
  StatusDot,
  Table,
  formatDateTime,
  inputClass
} from "@/components/dashboard/ui";
import { EnvironmentOffline, useServerOffline } from "@/components/dashboard/EnvironmentOffline";
import { ContextLimitField, RuntimeResultNotice, TimeoutField, useRuntimeSettings } from "@/components/dashboard/EnvironmentRuntime";
import { WebhookPayloadCard } from "@/components/dashboard/WebhookPayload";
import { deliveryActions, deliverySucceeded, useRunDetails } from "@/components/dashboard/WebhookSessions";

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

  async function saveWebhook() {
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
        <EnvironmentOffline />
      ) : (
        <div className="space-y-6">
          <Card>
            <Eyebrow>How webhook routing works</Eyebrow>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[14px] text-slate-600">
              <Badge tone="blue">Agent webhook</Badge>
              <span>takes priority if configured</span>
              <ArrowRight size={15} className="text-slate-500" />
              <span>otherwise falls back to</span>
              <Badge tone="purple">Project default</Badge>
            </div>
            <p className="mt-3 text-[14px] text-slate-500">
              In the simulator, the project default is the target the CLI was started with; sub-accounts switch it.
            </p>
          </Card>

          <Card title="Project Default Webhook" badge={<Badge tone="purple">Catches all agents</Badge>}>
            <p className="-mt-1 mb-5 text-[14px] text-slate-500">This endpoint receives events for all agents that don&apos;t have their own webhook configured.</p>
            <div className="space-y-5">
              <Field label="URL">
                <input
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    form.touch();
                  }}
                  placeholder="http://localhost:3000/webhook"
                  className={`${inputClass} data`}
                />
              </Field>
              <Field label="Signing secret" hint={session ? `Leave blank to keep the current secret (${session.secretPreview}).` : undefined}>
                <input
                  type="password"
                  value={secret}
                  onChange={(event) => {
                    setSecret(event.target.value);
                    form.touch();
                  }}
                  placeholder={session?.secretPreview ?? "whsec_…"}
                  autoComplete="new-password"
                  className={`${inputClass} data`}
                />
              </Field>
              <ContextLimitField form={form} slider />
              <div className="max-w-[240px]">
                <TimeoutField form={form} />
              </div>
              <Notice>Saving starts a fresh session with the new target and settings; the current conversation stays in history.</Notice>
              <RuntimeResultNotice result={form.result} />
              <div className="flex justify-end">
                <Button onClick={() => void saveWebhook()} busy={form.saving} disabled={!session || !url.trim()}>
                  {form.saving ? null : <Save size={15} />}
                  Save Webhook
                </Button>
              </div>
            </div>
          </Card>

          <WebhookPayloadCard delivery={latestDelivery} />

          <Card title="Recent deliveries" subtitle="The last 25 deliveries across your 10 most recent runs." padded={false}>
            {error ? (
              <div className="px-6 pb-4">
                <Notice tone="error">Could not load deliveries: {error}</Notice>
              </div>
            ) : null}
            {loading && recentRuns.length ? (
              <div className="px-6 pb-6 text-[14px] text-slate-500">Loading…</div>
            ) : deliveries.length === 0 ? (
              <EmptyState
                icon={<Link2 size={26} />}
                title="No deliveries yet"
                description="Send a message from Messages or run a scenario; every signed request to your webhook shows up here."
                action={
                  <Button variant="bright" href="/imessage">
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
                      <Cell className="whitespace-nowrap text-slate-500">{formatDateTime(delivery.timestamp)}</Cell>
                      <Cell mono className="text-[13px]">
                        {delivery.event}
                        {delivery.replayOf ? <span className="ml-1.5 text-slate-500">(replay)</span> : null}
                      </Cell>
                      <Cell>
                        <ChannelBadge channel={delivery.channel} />
                      </Cell>
                      <Cell>
                        <span className={`inline-flex items-center gap-2 font-medium ${ok ? "text-fern" : "text-danger"}`}>
                          <StatusDot ok={ok} />
                          <span className="data">{delivery.timedOut ? "timeout" : delivery.response.status || "error"}</span>
                        </span>
                      </Cell>
                      <Cell mono>{delivery.latencyMs} ms</Cell>
                      <Cell mono>{delivery.retries}</Cell>
                      <Cell>
                        <div className="flex flex-wrap gap-1">
                          {(delivery.faults ?? []).length ? (
                            delivery.faults?.map((fault) => (
                              <Badge key={fault} tone="amber">
                                {fault}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </div>
                      </Cell>
                      <Cell>
                        <div className="flex flex-wrap gap-1">
                          {actions.length ? actions.map((action) => <Badge key={action}>{action}</Badge>) : <span className="text-slate-500">—</span>}
                        </div>
                      </Cell>
                      <Cell className="text-right">
                        <Button variant="ghost" size="sm" href={`/devtools?session=${encodeURIComponent(run)}`}>
                          Inspect
                        </Button>
                      </Cell>
                    </Row>
                  );
                })}
              </Table>
            )}
          </Card>
        </div>
      )}
    </Page>
  );
}
