"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bot, MessageCircle, Power, Trash2, Wrench } from "lucide-react";
import type { InspectorSession, InspectorSessionSummary, SessionChannel } from "@/lib/types";
import { Badge, Button, Card, ChannelBadge, Eyebrow, formatNumber, formatRelative } from "./ui";
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

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-raised px-3.5 py-3">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5 flex items-center gap-2 text-[16px] font-semibold text-bright">{children}</div>
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
    <Card>
      <div className="flex items-start gap-4">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${agent.active ? "bg-[#173322] text-fern" : "bg-raised text-slate-600"}`}>
          <Bot size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[19px] font-semibold text-bright">{agent.name}</h2>
            {agent.active ? <Badge tone="green">Active</Badge> : null}
            {agent.channel ? <ChannelBadge channel={agent.channel} /> : null}
          </div>
          <div className="data mt-1 break-all text-[13px] text-slate-600">{agent.targetUrl}</div>
          <div className="mt-0.5 text-[12.5px] text-slate-500">
            {agent.description} · secret <span className="data">{agent.secretPreview}</span>
          </div>
        </div>
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
              <span className="truncate text-[13px] font-normal text-slate-500">{formatRelative(lastDelivery.timestamp)}</span>
            </>
          ) : (
            <span className="text-slate-500">{detailsLoading ? "…" : "—"}</span>
          )}
        </Metric>
        <Metric label="Failed">
          <span className={failed ? "text-danger" : ""}>{sampledRuns || !detailsLoading ? formatNumber(failed) : "…"}</span>
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
          <p className="text-[13px] text-slate-500">
            {detailsLoading ? "Loading…" : "No actions observed yet. Send this handler a message to see what it can do."}
          </p>
        )}
        {!detailsLoading && sampledRuns < targetRuns.length ? (
          <p className="mt-2 text-[12px] text-slate-500">Delivery health and capabilities are from the {sampledRuns} most recent runs.</p>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {agent.active ? null : (
          <Button size="sm" onClick={onActivate} busy={busy}>
            <Power size={14} /> Activate
          </Button>
        )}
        <Button
          size="sm"
          variant={agent.active ? "primary" : "secondary"}
          onClick={() => onOpen("/imessage")}
          disabled={busy}
          title={agent.active ? undefined : "Activates this agent, then opens iMessage"}
        >
          <MessageCircle size={14} /> Test in iMessage
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
            <Trash2 size={14} /> {confirmingRemove ? "Confirm remove" : "Remove"}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
