"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock3, PhoneOff, Play, RotateCcw, Send, Square } from "lucide-react";
import type { InspectorDelivery, InspectorSession } from "@/lib/types";

const SERVER_URL = process.env.NEXT_PUBLIC_AGENTPHONE_DEVTOOLS_SERVER_URL ?? "http://127.0.0.1:4318";

export function Inspector() {
  const [session, setSession] = useState<InspectorSession | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<"sms" | "voice">("voice");
  const [connected, setConnected] = useState(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/state`)
      .then((response) => response.json())
      .then((state: InspectorSession) => {
        setSession(state);
        setChannel(state.channel);
        setSelectedId(state.deliveries.at(-1)?.id ?? null);
      })
      .catch(() => setConnected(false));

    const source = new EventSource(`${SERVER_URL}/api/events`);
    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("error", () => setConnected(false));
    source.addEventListener("state", (event) => {
      const state = JSON.parse((event as MessageEvent).data) as InspectorSession;
      setSession(state);
      setChannel(state.channel);
      setSelectedId((current) => current ?? state.deliveries.at(-1)?.id ?? null);
    });
    source.addEventListener("delivery", (event) => {
      const delivery = JSON.parse((event as MessageEvent).data) as InspectorDelivery;
      setSelectedId(delivery.id);
    });

    return () => source.close();
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [session?.transcript.length]);

  const selected = useMemo(() => {
    if (!session) return null;
    return session.deliveries.find((delivery) => delivery.id === selectedId) ?? session.deliveries.at(-1) ?? null;
  }, [selectedId, session]);

  async function sendTurn() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    await fetch(`${SERVER_URL}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: trimmed, channel })
    });
  }

  async function endCall() {
    await fetch(`${SERVER_URL}/api/end-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disconnectionReason: "agent_hangup" })
    });
  }

  async function reset() {
    const response = await fetch(`${SERVER_URL}/api/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel })
    });
    const state = (await response.json()) as InspectorSession;
    setSession(state);
    setSelectedId(null);
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-md border border-line bg-skyglass text-fern">
              <Activity size={18} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-normal text-ink">AgentPhone DevTools</h1>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <span className="truncate">{session?.targetUrl ?? "waiting for simulator"}</span>
                <span>{session?.secretPreview ?? ""}</span>
                <span className={connected ? "text-fern" : "text-caution"}>{connected ? "live" : "offline"}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={channel}
              onChange={(event) => setChannel(event.target.value as "sms" | "voice")}
              className="h-9 rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-fern"
              aria-label="Channel"
            >
              <option value="voice">voice</option>
              <option value="sms">sms</option>
            </select>
            <button
              onClick={reset}
              className="grid h-9 w-9 place-items-center rounded-md border border-line bg-white text-slate-600 hover:border-slate-400"
              title="Reset session"
              aria-label="Reset session"
            >
              <RotateCcw size={16} />
            </button>
            <button
              onClick={endCall}
              className="grid h-9 w-9 place-items-center rounded-md border border-line bg-white text-slate-600 hover:border-slate-400"
              title="End call"
              aria-label="End call"
            >
              <PhoneOff size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-4 px-5 py-5 xl:grid-cols-[320px_minmax(0,1fr)_420px]">
        <section className="min-h-[520px] rounded-lg border border-line bg-white shadow-soft">
          <PanelHeader icon={<Clock3 size={16} />} title="Timeline" meta={`${session?.deliveries.length ?? 0} deliveries`} />
          <div className="max-h-[calc(100vh-170px)] overflow-auto px-3 pb-3">
            {session?.deliveries.length ? (
              session.deliveries.map((delivery) => (
                <button
                  key={delivery.id}
                  onClick={() => setSelectedId(delivery.id)}
                  className={`mb-2 grid w-full grid-cols-[1fr_auto] gap-2 rounded-md border px-3 py-2 text-left transition ${
                    selected?.id === delivery.id ? "border-fern bg-emerald-50" : "border-line bg-white hover:border-slate-400"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{delivery.event}</span>
                    <span className="mt-1 block truncate text-xs text-slate-500">
                      {delivery.channel} / {delivery.webhookId}
                    </span>
                  </span>
                  <span className={`self-center text-xs font-medium ${delivery.timedOut || !delivery.ok ? "text-danger" : "text-fern"}`}>
                    {delivery.latencyMs}ms
                  </span>
                </button>
              ))
            ) : (
              <EmptyLine label="No deliveries yet" />
            )}
          </div>
        </section>

        <section className="min-h-[520px] rounded-lg border border-line bg-white shadow-soft">
          <PanelHeader icon={<Play size={16} />} title="Transcript" meta={session?.status ?? "idle"} />
          <div ref={transcriptRef} className="h-[calc(100vh-245px)] min-h-[360px] overflow-auto px-4 py-4">
            {session?.transcript.length ? (
              <div className="space-y-3">
                {session.transcript.map((turn, index) => (
                  <div key={`${turn.role}-${index}`} className={`flex ${turn.role === "agent" ? "justify-start" : "justify-end"}`}>
                    <div
                      className={`max-w-[78%] rounded-lg border px-4 py-3 text-sm leading-6 ${
                        turn.role === "agent" ? "border-line bg-mist text-ink" : "border-fern bg-fern text-white"
                      }`}
                    >
                      {turn.content}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyLine label="Transcript will appear here" />
            )}
          </div>

          <div className="border-t border-line p-3">
            <div className="flex gap-2">
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void sendTurn();
                }}
                className="h-10 min-w-0 flex-1 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-fern"
                placeholder="Type caller turn"
                aria-label="Caller turn"
              />
              <button
                onClick={sendTurn}
                className="grid h-10 w-10 place-items-center rounded-md bg-ink text-white hover:bg-slate-700"
                title="Send turn"
                aria-label="Send turn"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-line bg-white shadow-soft">
            <PanelHeader icon={<Square size={16} />} title="Request" meta={selected?.event ?? ""} />
            <PayloadBlock value={selected ? { headers: selected.request.headers, body: selected.request.body } : null} />
          </section>

          <section className="rounded-lg border border-line bg-white shadow-soft">
            <PanelHeader icon={<CheckCircle2 size={16} />} title="Response" meta={selected ? String(selected.response.status) : ""} />
            <PayloadBlock value={selected ? { status: selected.response.status, headers: selected.response.headers, parsed: selected.response.parsed, rawBody: selected.response.rawBody } : null} />
          </section>

          {session?.callEnded ? (
            <section className="rounded-lg border border-line bg-white shadow-soft">
              <PanelHeader icon={<PhoneOff size={16} />} title="Call Ended" meta={`${session.callEnded.durationSeconds}s`} />
              <div className="space-y-2 px-4 pb-4 text-sm">
                <KeyValue name="summary" value={session.callEnded.summary} />
                <KeyValue name="sentiment" value={session.callEnded.userSentiment} />
                <KeyValue name="successful" value={String(session.callEnded.callSuccessful)} />
                <KeyValue name="reason" value={session.callEnded.disconnectionReason} />
              </div>
            </section>
          ) : null}

          {session?.evalResult ? <EvalCard result={session.evalResult} /> : null}

          {session?.warnings.length ? (
            <section className="rounded-lg border border-amber-200 bg-amber-50">
              <PanelHeader icon={<AlertTriangle size={16} />} title="Warnings" meta={String(session.warnings.length)} />
              <ul className="space-y-2 px-4 pb-4 text-sm text-caution">
                {session.warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function PanelHeader({ icon, title, meta }: { icon: React.ReactNode; title: string; meta?: string }) {
  return (
    <div className="flex h-12 items-center justify-between border-b border-line px-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="text-slate-500">{icon}</span>
        {title}
      </div>
      {meta ? <span className="max-w-[170px] truncate text-xs text-slate-500">{meta}</span> : null}
    </div>
  );
}

function PayloadBlock({ value }: { value: unknown | null }) {
  return (
    <pre className="max-h-[270px] min-h-[150px] overflow-auto px-4 py-3 text-xs leading-5 text-slate-700">
      {value ? JSON.stringify(value, null, 2) : "null"}
    </pre>
  );
}

function EvalCard({ result }: { result: NonNullable<InspectorSession["evalResult"]> }) {
  const color = result.outcome === "resolved" ? "text-fern" : result.outcome === "handed_off" ? "text-caution" : "text-danger";
  return (
    <section className="rounded-lg border border-line bg-white shadow-soft">
      <PanelHeader icon={<CheckCircle2 size={16} />} title="Eval" meta={`${result.score}/100`} />
      <div className="space-y-3 px-4 pb-4 text-sm">
        <div className={`text-base font-semibold ${color}`}>{result.outcome}</div>
        <div className="grid grid-cols-2 gap-2">
          <KeyValue name="on task" value={String(result.stayedOnTask)} />
          <KeyValue name="actions" value={result.correctActions === null ? "n/a" : String(result.correctActions)} />
          <KeyValue name="turns" value={String(result.metrics.turnCount)} />
          <KeyValue name="dead air" value={String(result.metrics.deadAirTurns)} />
        </div>
        {result.reasons.length ? (
          <ul className="space-y-1 text-xs leading-5 text-slate-600">
            {result.reasons.map((reason, index) => (
              <li key={`${reason}-${index}`}>{reason}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function KeyValue({ name, value }: { name: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-mist px-3 py-2">
      <div className="text-[11px] uppercase text-slate-500">{name}</div>
      <div className="mt-1 break-words text-sm text-ink">{value}</div>
    </div>
  );
}

function EmptyLine({ label }: { label: string }) {
  return <div className="grid min-h-[160px] place-items-center text-sm text-slate-400">{label}</div>;
}
