"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChatCircle, Key, Power, Trash, WebhooksLogo, Wrench } from "@phosphor-icons/react";
import type { InspectorSession, InspectorSessionSummary, SessionChannel } from "@/lib/types";
import { Badge, Button, Eyebrow, formatNumber, formatRelative } from "./ui";
import { ActionChip, deliveryActions, formatLatency, isFailedDelivery } from "./RunsShared";

/** A webhook handler the simulator knows about: the live target or a saved environment. */
export interface AgentProfile {
  key: string;
  name: string;
  description: string;
  targetUrl: string;
  secretPreview: string;
  channel?: SessionChannel;
  active: boolean;
  environmentId?: string;
}

const CHANNEL_LABEL: Record<SessionChannel, string> = { imessage: "iMessage", sms: "SMS", whatsapp: "WhatsApp", voice: "Voice" };

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[12px] bg-white/[0.04] p-3">
      <div className="text-xs text-text-dim">{label}</div>
      <div className="mt-1 flex min-w-0 items-center gap-2 text-lg font-semibold tabular-nums text-text">{children}</div>
    </div>
  );
}

export function AgentCard({
  agent,
  runs,
  details,
  detailsLoading,
  busy,
  onActivate,
  onOpen,
  onRemove
}: {
  agent: AgentProfile;
  /** Runs with traffic, newest first (all of them, for counts and latency). */
  runs: InspectorSessionSummary[];
  /** Full sessions for the most recent runs (deliveries and actions). */
  details: Map<string, InspectorSession>;
  detailsLoading: boolean;
  busy: boolean;
  onActivate: () => void;
  /** Navigate to a tool, activating this agent first when it isn't the target. */
  onOpen: (path: string) => void;
  onRemove: () => void;
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  useEffect(() => {
    if (!confirmingRemove) return;
    const timer = window.setTimeout(() => setConfirmingRemove(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmingRemove]);

  const targetRuns = runs.filter((run) => run.targetUrl === agent.targetUrl);
  const deliveryCount = targetRuns.reduce((total, run) => total + run.deliveries, 0);
  const averageLatency = deliveryCount
    ? targetRuns.reduce((total, run) => total + (run.averageLatencyMs ?? 0) * run.deliveries, 0) / deliveryCount
    : undefined;
  // Forks carry copies of their source's deliveries; count each delivery once.
  const deliveries = targetRuns.flatMap((run) => details.get(run.id)?.deliveries.filter((delivery) => !delivery.inheritedFrom) ?? []);
  const lastDelivery = deliveries.reduce<(typeof deliveries)[number] | undefined>(
    (latest, delivery) => (!latest || delivery.timestamp > latest.timestamp ? delivery : latest),
    undefined
  );
  const failed = deliveries.filter(isFailedDelivery).length;
  const capabilities = deliveryActions(deliveries);
  const sampledRuns = targetRuns.filter((run) => details.has(run.id)).length;

  return (
    <article className="rounded-[18px] bg-card p-6 shadow-card backdrop-blur-[2px]">
      <div className="flex items-start gap-3.5">
        <div className="grid size-[42px] shrink-0 place-items-center rounded-[12px] bg-primary/15 text-[14px] font-semibold text-primary">
          {agent.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-[19px] font-semibold tracking-[-0.2px] text-white">{agent.name}</h2>
            {agent.active ? <Badge tone="green">Active</Badge> : null}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">{agent.description}</p>
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-text-secondary sm:ml-14">
        <span className="flex min-w-0 items-center gap-[7px]">
          <WebhooksLogo size={16} className="shrink-0 text-primary" />
          Webhook: <span className="break-all font-mono text-text">{agent.targetUrl}</span>
        </span>
        {agent.channel ? (
          <span className="flex items-center gap-[7px]">
            <ChatCircle size={16} className="shrink-0" />
            Default channel: <span className="text-text">{CHANNEL_LABEL[agent.channel]}</span>
          </span>
        ) : null}
        <span className="flex items-center gap-[7px]">
          <Key size={15} className="shrink-0" />
          Secret <span className="font-mono text-text">{agent.secretPreview}</span>
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Runs">{formatNumber(targetRuns.length)}</Metric>
        <Metric label="Avg latency">{formatLatency(averageLatency)}</Metric>
        <Metric label="Last delivery">
          {lastDelivery ? (
            <>
              <Badge tone={isFailedDelivery(lastDelivery) ? "red" : "green"}>
                {lastDelivery.timedOut ? "timeout" : lastDelivery.response.status || "no response"}
              </Badge>
              <span className="truncate text-[13px] font-normal text-text-secondary">{formatRelative(lastDelivery.timestamp)}</span>
            </>
          ) : (
            <span className="text-text-dim">{detailsLoading ? "…" : "—"}</span>
          )}
        </Metric>
        <Metric label="Failed">
          <span className={failed ? "text-red-400" : ""}>{sampledRuns || !detailsLoading ? formatNumber(failed) : "…"}</span>
        </Metric>
      </div>

      <div className="mt-5">
        <Eyebrow className="mb-2">Capabilities</Eyebrow>
        {capabilities.length ? (
          <div className="flex flex-wrap gap-1.5">
            {capabilities.map((action) => (
              <ActionChip key={action} action={action} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-dim">
            {detailsLoading ? "Loading…" : "No actions observed yet. Send this handler a message to see what it can do."}
          </p>
        )}
        {!detailsLoading && sampledRuns < targetRuns.length ? (
          <p className="mt-2 text-xs text-text-dim">Delivery health and capabilities are from the {sampledRuns} most recent runs.</p>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
        {agent.active ? null : (
          <Button size="sm" onClick={onActivate} busy={busy}>
            <Power size={14} weight="bold" /> Activate
          </Button>
        )}
        <Button
          size="sm"
          variant={agent.active ? "primary" : "secondary"}
          onClick={() => onOpen("/imessage")}
          disabled={busy}
          title={agent.active ? undefined : "Activates this agent, then opens iMessage"}
        >
          <ChatCircle size={14} weight="bold" /> Test in iMessage
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onOpen("/devtools")}
          disabled={busy}
          title={agent.active ? undefined : "Activates this agent, then opens the Inspector"}
        >
          <Wrench size={14} /> Inspect
        </Button>
        {agent.environmentId && !agent.active ? (
          <Button
            size="sm"
            variant={confirmingRemove ? "danger" : "ghost"}
            className="ml-auto"
            disabled={busy}
            onClick={() => (confirmingRemove ? onRemove() : setConfirmingRemove(true))}
          >
            <Trash size={14} /> {confirmingRemove ? "Confirm remove" : "Remove"}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
