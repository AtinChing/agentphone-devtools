"use client";

import { useState, type ReactNode } from "react";
import { BracketsCurly, Copy, Info, Lightning, ShieldCheck, ShieldWarning, Timer, Warning, type Icon as PhosphorIcon } from "@phosphor-icons/react";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { DeliveryFault, InspectorDelivery } from "@/lib/types";
import { Badge, Button, Cell, Eyebrow, Notice, Row, Table, formatDateTime } from "@/components/dashboard/ui";

type FaultKind = "security" | "malformed" | "duplicate" | "timeout";

interface FaultSpec {
  id: keyof DeliveryFault;
  /** Name the server records in delivery.faults once applied. */
  applied: string;
  label: string;
  description: string;
  fault: DeliveryFault;
  kind: FaultKind;
}

const FAULTS: FaultSpec[] = [
  {
    id: "invalidSignature",
    applied: "invalid_signature",
    label: "Invalid signature",
    description: "X-Webhook-Signature replaced with a same-length HMAC that doesn't match. The handler must reject with 401/403.",
    fault: { invalidSignature: true },
    kind: "security"
  },
  {
    id: "omitSignature",
    applied: "missing_signature",
    label: "Missing signature",
    description: "X-Webhook-Signature header removed entirely. An unsigned request must never reach agent logic.",
    fault: { omitSignature: true },
    kind: "security"
  },
  {
    id: "staleTimestampSeconds",
    applied: "stale_timestamp",
    label: "Stale timestamp",
    description: "Validly re-signed with a timestamp 15 minutes old. Replay protection (5-minute tolerance) must reject it.",
    fault: { staleTimestampSeconds: 900 },
    kind: "security"
  },
  {
    id: "tamperBody",
    applied: "tampered_body",
    label: "Tampered body",
    description: "Body altered after signing, so the HMAC no longer matches the bytes received. The handler must reject.",
    fault: { tamperBody: true },
    kind: "security"
  },
  {
    id: "malformedJson",
    applied: "malformed_json",
    label: "Malformed JSON",
    description: "A correctly signed body that isn't valid JSON. The handler should answer 400, not crash with a 500.",
    fault: { malformedJson: true },
    kind: "malformed"
  },
  {
    id: "duplicateWebhookId",
    applied: "duplicate_webhook_id",
    label: "Duplicate webhook ID",
    description: "Reuses the previous delivery's X-Webhook-ID, as a carrier retry would. Idempotent handlers must not act twice.",
    fault: { duplicateWebhookId: true },
    kind: "duplicate"
  },
  {
    id: "simulateTimeout",
    applied: "simulated_timeout",
    label: "Handler timeout",
    description: "The handler takes longer than the configured timeout. Deterministic: no request is sent to your target.",
    fault: { simulateTimeout: true },
    kind: "timeout"
  }
];

type VerdictTone = "good" | "bad" | "warn" | "info";

interface Verdict {
  tone: VerdictTone;
  text: string;
}

function verdictFor(kind: FaultKind, delivery: InspectorDelivery): Verdict {
  const status = delivery.response.status;
  if (kind === "timeout") {
    return delivery.timedOut ? { tone: "good", text: "Timed out as expected" } : { tone: "bad", text: `Did not time out (HTTP ${status})` };
  }
  if (status === 0) return { tone: "warn", text: delivery.timedOut ? "Handler timed out" : `No response: ${delivery.response.statusText}` };
  const accepted = status >= 200 && status < 300;
  if (kind === "security") {
    if ([400, 401, 403].includes(status)) return { tone: "good", text: "Rejected as expected" };
    if (accepted) return { tone: "bad", text: "Accepted a tampered request!" };
    return { tone: "warn", text: `Unexpected HTTP ${status}; expected 401/403` };
  }
  if (kind === "malformed") {
    if (status >= 400 && status < 500) return { tone: "good", text: "Rejected as expected" };
    if (accepted) return { tone: "bad", text: "Accepted malformed JSON!" };
    return { tone: "warn", text: `Handler crashed (HTTP ${status}); answer 400 instead` };
  }
  if (status === 409) return { tone: "good", text: "Duplicate rejected" };
  if (accepted) return { tone: "info", text: "Delivered again; confirm the handler didn't act twice" };
  return { tone: "warn", text: `Unexpected HTTP ${status}` };
}

const VERDICT_BADGE: Record<VerdictTone, { tone: "green" | "red" | "amber" | "blue"; icon: ReactNode }> = {
  good: { tone: "green", icon: <ShieldCheck size={12} weight="bold" /> },
  bad: { tone: "red", icon: <ShieldWarning size={12} weight="bold" /> },
  warn: { tone: "amber", icon: <Warning size={12} weight="bold" /> },
  info: { tone: "blue", icon: <Info size={12} weight="bold" /> }
};

const KIND_ICON: Record<FaultKind, PhosphorIcon> = {
  security: ShieldWarning,
  malformed: BracketsCurly,
  duplicate: Copy,
  timeout: Timer
};

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const style = VERDICT_BADGE[verdict.tone];
  return (
    <Badge tone={style.tone}>
      {style.icon}
      {verdict.text}
    </Badge>
  );
}

function specFor(delivery: InspectorDelivery): FaultSpec | undefined {
  return FAULTS.find((spec) => delivery.faults?.includes(spec.applied));
}

function statusLabel(delivery: InspectorDelivery): string {
  if (delivery.timedOut) return "timeout";
  return delivery.response.status ? `HTTP ${delivery.response.status}` : "no response";
}

/**
 * Fire one faulted caller turn per click through POST /api/send. Results
 * come from the live session's own deliveries, so the log survives
 * navigation and matches what the Inspector shows.
 */
export function FaultsPanel() {
  const { session, refreshSession } = useLive();
  const [firing, setFiring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const probes = (session?.deliveries ?? []).filter((delivery) => specFor(delivery)).reverse();
  const latestBySpec = new Map<string, InspectorDelivery>();
  for (const delivery of probes) {
    const spec = specFor(delivery);
    if (spec && !latestBySpec.has(spec.id)) latestBySpec.set(spec.id, delivery);
  }

  async function fire(spec: FaultSpec) {
    if (!session) return;
    setFiring(spec.id);
    setError(null);
    try {
      await api.post<InspectorDelivery>("/api/send", {
        text: `Fault probe: ${spec.label}`,
        channel: session.channel,
        fault: spec.fault
      });
      await refreshSession();
    } catch (reason) {
      setError(`${spec.label}: ${errorMessage(reason)}`);
    } finally {
      setFiring(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-[18px] bg-card shadow-card backdrop-blur-[2px]">
      <div className="border-b border-surface-border px-6 py-4">
        <h2 className="text-lg font-semibold text-text">Fault injection</h2>
        <p className="text-sm text-text-dim">Send a deliberately broken delivery to your handler and check it fails safely.</p>
      </div>
      <div className="space-y-1 p-4">
        <div className="space-y-2 px-2 pb-3">
          <p className="text-xs text-text-dim">
            Each probe is a real delivery: it adds a caller turn to the live{" "}
            {session ? <span className="font-mono text-text-secondary">{session.channel}</span> : null} session against{" "}
            <span className="font-mono text-text-secondary">{session?.targetUrl ?? "your target"}</span> and appears in the Inspector.
          </p>
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
        {FAULTS.map((spec) => {
          const latest = latestBySpec.get(spec.id);
          const KindIcon = KIND_ICON[spec.kind];
          return (
            <div key={spec.id} className="flex items-start justify-between gap-4 rounded-[12px] px-4 py-3 transition-colors hover:bg-card-hover">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/50">
                  <KindIcon size={16} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">{spec.label}</span>
                    <code className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">
                      {spec.id}: {String(spec.fault[spec.id])}
                    </code>
                  </div>
                  <p className="mt-0.5 text-xs text-text-dim">{spec.description}</p>
                  {latest ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                      <VerdictBadge verdict={verdictFor(spec.kind, latest)} />
                      <span className="font-mono">{statusLabel(latest)}</span>
                      <span className="text-[#3a3a4a]">·</span>
                      <span className="font-mono">{latest.latencyMs} ms</span>
                      {latest.retries ? (
                        <>
                          <span className="text-[#3a3a4a]">·</span>
                          <span>{latest.retries} retries</span>
                        </>
                      ) : null}
                      <span className="text-[#3a3a4a]">·</span>
                      {(latest.faults ?? []).map((fault) => (
                        <Badge key={fault}>{fault}</Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void fire(spec)}
                busy={firing === spec.id}
                disabled={!session || (firing !== null && firing !== spec.id)}
              >
                {firing === spec.id ? null : <Lightning size={14} weight="bold" />}
                Fire
              </Button>
            </div>
          );
        })}
      </div>
      {probes.length ? (
        <div className="border-t border-surface-border">
          <Eyebrow className="px-6 pb-1 pt-4">Recent probes · this session</Eyebrow>
          <Table head={["Time", "Fault", "Result", "Latency", "Retries", "Verdict", ""]}>
            {probes.slice(0, 8).map((delivery) => {
              const spec = specFor(delivery);
              if (!spec) return null;
              return (
                <Row key={delivery.id}>
                  <Cell className="whitespace-nowrap text-text-secondary">{formatDateTime(delivery.timestamp)}</Cell>
                  <Cell>{spec.label}</Cell>
                  <Cell mono>{statusLabel(delivery)}</Cell>
                  <Cell mono className="text-text-secondary">
                    {delivery.latencyMs} ms
                  </Cell>
                  <Cell mono className="text-text-secondary">
                    {delivery.retries}
                  </Cell>
                  <Cell>
                    <VerdictBadge verdict={verdictFor(spec.kind, delivery)} />
                  </Cell>
                  <Cell className="text-right">
                    <Button variant="ghost" size="sm" className="!h-7 !px-2" href={`/devtools?session=${session?.id ?? ""}`}>
                      Inspect
                    </Button>
                  </Cell>
                </Row>
              );
            })}
          </Table>
        </div>
      ) : null}
    </section>
  );
}
