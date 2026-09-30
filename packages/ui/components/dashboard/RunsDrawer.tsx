"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Download, FileCode2, MessageCircle, Trash2, Wrench, X } from "lucide-react";
import { api, errorMessage, serverUrl } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { InspectorDelivery, InspectorSession, InspectorSessionSummary, SessionChannel } from "@/lib/types";
import { Avatar, Badge, Button, ChannelBadge, Eyebrow, Modal, Notice, formatDateTime, formatPhone } from "./ui";
import {
  ActionChip,
  SentimentBadge,
  SuccessMark,
  callDurationSeconds,
  deliveryActions,
  formatDuration,
  formatLatency,
  isFailedDelivery,
  runVersion
} from "./RunsShared";

/**
 * Right-side detail panel for one run: transcript, call summary (voice),
 * scenario verdict, every webhook delivery, and the run's downloads.
 */
export function RunsDrawer({
  runId,
  run,
  onClose,
  onOpenRun
}: {
  runId: string;
  /** The run's live summary; when it changes the full session is refetched. */
  run?: InspectorSessionSummary;
  onClose: () => void;
  /** Open another run in this drawer (fork lineage links). */
  onOpenRun: (sessionId: string) => void;
}) {
  const live = useLive();
  const [loaded, setLoaded] = useState<InspectorSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const version = run ? runVersion(run) : "";

  useEffect(() => {
    let cancelled = false;
    api
      .get<InspectorSession>(`/api/history/${encodeURIComponent(runId)}`)
      .then((session) => {
        if (cancelled) return;
        setLoaded(session);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [runId, version]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirmingDelete) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirmingDelete]);

  const session = loaded?.id === runId ? loaded : null;
  const contact = session?.contact ?? run?.contact;
  const name = contact?.name ?? "Caller";
  const channel = session?.channel ?? run?.channel;
  const isLive = live.session?.id === runId;
  const encodedId = encodeURIComponent(runId);

  async function deleteRun() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/api/history/${encodedId}`);
      await live.refreshRuns();
      setConfirmingDelete(false);
      onClose();
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
        <aside
          className="flex h-full w-full max-w-[580px] flex-col border-l border-line bg-panel shadow-soft"
          onClick={(event) => event.stopPropagation()}
          aria-label="Run detail"
        >
          <header className="flex items-start gap-3 border-b border-line px-6 py-5">
            <Avatar name={name} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[17px] font-semibold text-bright">{name}</h2>
                {channel ? <ChannelBadge channel={channel} /> : null}
                {isLive ? <Badge tone="green">Live</Badge> : null}
              </div>
              <div className="mt-0.5 truncate text-[12.5px] text-slate-500">
                {contact ? `${formatPhone(contact.number)} · ` : ""}
                <span className="data">{runId}</span>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-mist hover:text-bright">
              <X size={18} />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {error ? <Notice tone="error">{error}</Notice> : null}
            {!session && !error ? <p className="text-[14px] text-slate-500">Loading…</p> : null}
            {session ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {session.channel === "voice" ? (
                    <Button href={`/devtools?session=${encodedId}`} size="sm">
                      <Wrench size={14} /> Open in Inspector
                    </Button>
                  ) : (
                    <Button href={`/imessage?session=${encodedId}`} size="sm">
                      <MessageCircle size={14} /> Open in iMessage
                    </Button>
                  )}
                  <Button href={serverUrl(`/api/history/${encodedId}/report.md`)} size="sm" variant="secondary">
                    <Download size={14} /> Download report
                  </Button>
                  {session.transcript.some((turn) => turn.role === "user") ? (
                    <Button href={serverUrl(`/api/history/${encodedId}/scenario.yaml?assertions=1`)} size="sm" variant="secondary">
                      <FileCode2 size={14} /> Export scenario
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" disabled title="This run has no customer turns to export">
                      <FileCode2 size={14} /> Export scenario
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={isLive}
                    title={isLive ? "The live session can't be deleted; start a new conversation first" : undefined}
                  >
                    <Trash2 size={14} /> Delete run
                  </Button>
                </div>

                <RunFacts session={session} onOpenRun={onOpenRun} />
                {session.scenarioResult ? <ScenarioVerdict session={session} /> : null}
                {session.channel === "voice" ? <CallSummary session={session} /> : null}

                <section>
                  <Eyebrow className="mb-3">Transcript</Eyebrow>
                  <Transcript session={session} customerName={name} />
                </section>

                <section>
                  <Eyebrow className="mb-3">Deliveries · {session.deliveries.length}</Eyebrow>
                  <DeliveryList deliveries={session.deliveries} />
                </section>
              </>
            ) : null}
          </div>
        </aside>
      </div>

      {confirmingDelete ? (
        <Modal
          title="Delete this run?"
          onClose={() => setConfirmingDelete(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={deleteRun} busy={deleting}>
                Delete run
              </Button>
            </>
          }
        >
          <p className="text-[14px] text-slate-600">
            The transcript and every delivery for <span className="data text-bright">{runId}</span> are removed from local history. Branches forked from it
            keep their own copies.
          </p>
          {deleteError ? (
            <div className="mt-4">
              <Notice tone="error">{deleteError}</Notice>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-raised px-3.5 py-2.5">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1 text-[14px] text-bright">{children}</div>
    </div>
  );
}

function RunFacts({ session, onOpenRun }: { session: InspectorSession; onOpenRun: (sessionId: string) => void }) {
  const counted = session.deliveries.filter((delivery) => !delivery.inheritedFrom);
  const average = counted.length ? counted.reduce((total, delivery) => total + delivery.latencyMs, 0) / counted.length : undefined;
  const fork = session.forkedFrom;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Fact label="Started">{formatDateTime(session.startedAt)}</Fact>
        <Fact label="Status">{session.status === "running" ? "Running" : session.status === "ended" ? "Ended" : "Idle"}</Fact>
        <Fact label="Turns">{session.transcript.length}</Fact>
        <Fact label="Avg latency">{formatLatency(average)}</Fact>
      </div>
      {fork ? (
        <div className="text-[13px] text-slate-500">
          <Badge tone="purple">Branch</Badge> forked from{" "}
          <button type="button" onClick={() => onOpenRun(fork.sessionId)} className="data text-badgepurple hover:underline">
            {fork.sessionId}
          </button>{" "}
          after caller turn {fork.turnIndex}
        </div>
      ) : null}
    </div>
  );
}

function ScenarioVerdict({ session }: { session: InspectorSession }) {
  const result = session.scenarioResult!;
  const failures = result.assertions.filter((assertion) => !assertion.passed);
  return (
    <section>
      <Eyebrow className="mb-3">Scenario</Eyebrow>
      <Notice tone={result.passed ? "good" : "error"}>
        <div className="font-medium">
          {result.passed ? "All assertions passed" : "Assertions failed"} · {result.passedCount}/{result.passedCount + result.failedCount}
        </div>
        {failures.length ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px]">
            {failures.map((assertion, index) => (
              <li key={index}>{assertion.message}</li>
            ))}
          </ul>
        ) : null}
      </Notice>
    </section>
  );
}

function CallSummary({ session }: { session: InspectorSession }) {
  const ended = session.callEnded;
  return (
    <section>
      <Eyebrow className="mb-3">Call summary</Eyebrow>
      {ended ? (
        <div className="space-y-3">
          {ended.summary ? <p className="text-[14px] leading-relaxed text-slate-700">{ended.summary}</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <Fact label="Duration">{formatDuration(callDurationSeconds(session))}</Fact>
            <Fact label="Sentiment">
              <SentimentBadge sentiment={ended.userSentiment} />
            </Fact>
            <Fact label="Successful">
              <SuccessMark value={ended.callSuccessful} />
            </Fact>
            <Fact label="Disconnection">
              <span className="data text-[13px]">{ended.disconnectionReason || "—"}</span>
            </Fact>
          </div>
        </div>
      ) : (
        <p className="text-[14px] text-slate-500">
          {session.status === "running" ? "The call is still open; its summary arrives with agent.call_ended." : "No agent.call_ended event was recorded for this call."}
        </p>
      )}
    </section>
  );
}

const CUSTOMER_BUBBLE: Record<SessionChannel, string> = {
  imessage: "bg-imessage text-white",
  sms: "bg-smsgreen text-white",
  whatsapp: "bg-[#005c4b] text-white",
  voice: "bg-[#2a1f40] text-bright"
};

function Transcript({ session, customerName }: { session: InspectorSession; customerName: string }) {
  if (!session.transcript.length) return <p className="text-[14px] text-slate-500">No messages yet.</p>;
  const seeded = new Set(session.outboundSeeds ?? []);
  return (
    <div className="space-y-2.5">
      {session.transcript.map((turn, index) => {
        const customer = turn.role === "user";
        const at = session.turnTimes?.[index];
        return (
          <div key={index} className={`flex flex-col ${customer ? "items-end" : "items-start"}`}>
            <div
              className={`max-w-[82%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[13px] leading-snug ${
                customer ? CUSTOMER_BUBBLE[session.channel] : "bg-raised text-bright"
              }`}
            >
              {turn.content}
            </div>
            <div className="mt-0.5 px-1 text-[11px] text-slate-500">
              {customer ? customerName : "Agent"}
              {seeded.has(index) ? " · sent via API" : ""}
              {at ? ` · ${formatDateTime(at)}` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DeliveryList({ deliveries }: { deliveries: InspectorDelivery[] }) {
  if (!deliveries.length) return <p className="text-[14px] text-slate-500">No webhook deliveries yet.</p>;
  return (
    <ul className="space-y-2">
      {deliveries.map((delivery) => {
        const failed = isFailedDelivery(delivery);
        const actions = deliveryActions([delivery]);
        return (
          <li key={delivery.id} className="rounded-xl border border-line bg-frame px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="data truncate text-[12.5px] text-bright">{delivery.event}</span>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={failed ? "red" : "green"}>{delivery.timedOut ? "timeout" : delivery.response.status || "no response"}</Badge>
                <span className="data text-[12px] text-slate-500">{formatLatency(delivery.latencyMs)}</span>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {actions.map((action) => (
                <ActionChip key={action} action={action} />
              ))}
              {delivery.retries ? <Badge tone="amber">{delivery.retries} retries</Badge> : null}
              {delivery.faults?.length ? <Badge tone="amber">fault: {delivery.faults.join(", ")}</Badge> : null}
              {delivery.replayOf ? <Badge>replay</Badge> : null}
              {delivery.inheritedFrom ? <Badge tone="purple">inherited</Badge> : null}
              <span className="ml-auto text-[11.5px] text-slate-500">{formatDateTime(delivery.timestamp)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
