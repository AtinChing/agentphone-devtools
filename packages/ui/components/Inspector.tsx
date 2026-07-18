"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, Bookmark, CheckCircle2, Clock3, FileCode2, FileJson, FileText, History, PhoneOff, Play, Radio, RefreshCw, RotateCcw, Scale, Send, Square, Trash2 } from "lucide-react";
import type { InspectorDelivery, InspectorSession, InspectorSessionSummary, RunComparison } from "@/lib/types";

const SERVER_URL = process.env.NEXT_PUBLIC_AGENTPHONE_DEVTOOLS_SERVER_URL ?? "http://127.0.0.1:4318";

export function Inspector() {
  const [session, setSession] = useState<InspectorSession | null>(null);
  const [liveSession, setLiveSession] = useState<InspectorSession | null>(null);
  const [runs, setRuns] = useState<InspectorSessionSummary[]>([]);
  const [leftView, setLeftView] = useState<"timeline" | "runs">("timeline");
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<"sms" | "voice">("voice");
  const [connected, setConnected] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayBody, setReplayBody] = useState("");
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [preserveWebhookId, setPreserveWebhookId] = useState(false);
  const [preserveTimestamp, setPreserveTimestamp] = useState(false);
  const [baselineId, setBaselineId] = useState<string>("");
  const [baselineEditorOpen, setBaselineEditorOpen] = useState(false);
  const [baselineName, setBaselineName] = useState("");
  const [baselineSaving, setBaselineSaving] = useState(false);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<RunComparison | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const viewingSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/state`)
      .then((response) => response.json())
      .then((state: InspectorSession) => {
        setLiveSession(state);
        setSession(state);
        setChannel(state.channel);
        setSelectedId(state.deliveries.at(-1)?.id ?? null);
      })
      .catch(() => setConnected(false));

    fetch(`${SERVER_URL}/api/history`)
      .then((response) => response.json())
      .then((history: InspectorSessionSummary[]) => {
        setRuns(history);
        setBaselineId((current) => current || history.find((run) => run.baselineName)?.id || "");
      })
      .catch(() => undefined);

    const source = new EventSource(`${SERVER_URL}/api/events`);
    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("error", () => setConnected(false));
    source.addEventListener("state", (event) => {
      const state = JSON.parse((event as MessageEvent).data) as InspectorSession;
      setLiveSession(state);
      if (viewingSessionIdRef.current === null) {
        setSession(state);
        setChannel(state.channel);
        setSelectedId((current) => current ?? state.deliveries.at(-1)?.id ?? null);
      }
    });
    source.addEventListener("delivery", (event) => {
      const delivery = JSON.parse((event as MessageEvent).data) as InspectorDelivery;
      if (viewingSessionIdRef.current === null) setSelectedId(delivery.id);
    });
    source.addEventListener("history", (event) => {
      const history = JSON.parse((event as MessageEvent).data) as InspectorSessionSummary[];
      setRuns(history);
      setBaselineId((current) => current || history.find((run) => run.baselineName)?.id || "");
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

  useEffect(() => {
    setReplayBody(selected ? JSON.stringify(selected.request.body, null, 2) : "");
    setReplayError(null);
    setReplayOpen(false);
    setPreserveWebhookId(false);
    setPreserveTimestamp(false);
  }, [selected?.id]);

  useEffect(() => {
    setComparison(null);
  }, [session?.id]);

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
    viewingSessionIdRef.current = null;
    setViewingSessionId(null);
    setLiveSession(state);
    setSession(state);
    setSelectedId(null);
  }

  async function openRun(run: InspectorSessionSummary) {
    if (run.id === liveSession?.id) {
      viewingSessionIdRef.current = null;
      setViewingSessionId(null);
      setSession(liveSession);
      setChannel(liveSession.channel);
      setSelectedId(liveSession.deliveries.at(-1)?.id ?? null);
      return;
    }

    const response = await fetch(`${SERVER_URL}/api/history/${run.id}`);
    if (!response.ok) return;
    const saved = (await response.json()) as InspectorSession;
    viewingSessionIdRef.current = saved.id;
    setViewingSessionId(saved.id);
    setSession(saved);
    setChannel(saved.channel);
    setSelectedId(saved.deliveries.at(-1)?.id ?? null);
    setLeftView("timeline");
  }

  async function deleteRun(run: InspectorSessionSummary) {
    if (run.id === liveSession?.id || !window.confirm("Delete this saved run?")) return;
    const response = await fetch(`${SERVER_URL}/api/history/${run.id}`, { method: "DELETE" });
    if (!response.ok) return;
    setRuns((current) => current.filter((item) => item.id !== run.id));
    if (viewingSessionId === run.id && liveSession) await openRun(runs.find((item) => item.id === liveSession.id) ?? summarizeLive(liveSession));
  }

  function exportRun(format: "json" | "md") {
    if (!session) return;
    window.open(`${SERVER_URL}/api/history/${session.id}/report.${format}`, "_blank", "noopener,noreferrer");
  }

  function exportScenario() {
    if (!session || !session.transcript.some((turn) => turn.role === "user")) return;
    window.open(`${SERVER_URL}/api/history/${session.id}/scenario.yaml`, "_blank", "noopener,noreferrer");
  }

  async function replayDelivery() {
    if (!session || !selected) return;
    setReplayBusy(true);
    setReplayError(null);
    try {
      const body = JSON.parse(replayBody) as unknown;
      const response = await fetch(`${SERVER_URL}/api/replay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          deliveryId: selected.id,
          body,
          preserveWebhookId,
          preserveTimestamp
        })
      });
      const payload = (await response.json()) as InspectorDelivery | { error?: string };
      if (!response.ok) throw new Error("error" in payload && payload.error ? payload.error : "Replay failed");
      const delivery = payload as InspectorDelivery;
      const stateResponse = await fetch(`${SERVER_URL}/api/state`);
      const state = (await stateResponse.json()) as InspectorSession;
      viewingSessionIdRef.current = null;
      setViewingSessionId(null);
      setLiveSession(state);
      setSession(state);
      setChannel(state.channel);
      setSelectedId(delivery.id);
      setLeftView("timeline");
      setReplayOpen(false);
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : String(error));
    } finally {
      setReplayBusy(false);
    }
  }

  async function toggleBaseline() {
    if (!session) return;
    if (session.baseline) {
      const response = await fetch(`${SERVER_URL}/api/history/${session.id}/baseline`, { method: "DELETE" });
      if (!response.ok) return;
      const updated = (await response.json()) as InspectorSession;
      setSession(updated);
      if (session.id === liveSession?.id) setLiveSession(updated);
      if (baselineId === session.id) setBaselineId("");
      setComparison(null);
      setBaselineEditorOpen(false);
      return;
    }
    setBaselineName(`Approved ${formatRunDate(session.startedAt)}`);
    setBaselineError(null);
    setBaselineEditorOpen((open) => !open);
  }

  async function saveBaseline() {
    if (!session) return;
    const name = baselineName.trim();
    if (!name) {
      setBaselineError("Baseline name is required");
      return;
    }
    setBaselineSaving(true);
    setBaselineError(null);
    try {
      const response = await fetch(`${SERVER_URL}/api/history/${session.id}/baseline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      const payload = (await response.json()) as InspectorSession | { error?: string };
      if (!response.ok) throw new Error("error" in payload && payload.error ? payload.error : "Could not save baseline");
      const updated = payload as InspectorSession;
      setSession(updated);
      if (session.id === liveSession?.id) setLiveSession(updated);
      setBaselineId(session.id);
      setComparison(null);
      setBaselineEditorOpen(false);
    } catch (error) {
      setBaselineError(error instanceof Error ? error.message : String(error));
    } finally {
      setBaselineSaving(false);
    }
  }

  async function compareToBaseline() {
    if (!session || !baselineId) return;
    const response = await fetch(`${SERVER_URL}/api/compare/${baselineId}/${session.id}`);
    if (!response.ok) return;
    setComparison((await response.json()) as RunComparison);
  }

  const viewingLive = viewingSessionId === null;

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
              onClick={() => exportRun("json")}
              disabled={!session}
              className="grid h-9 w-9 place-items-center rounded-md border border-line bg-white text-slate-600 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
              title="Export JSON report"
              aria-label="Export JSON report"
            >
              <FileJson size={16} />
            </button>
            <button
              onClick={() => exportRun("md")}
              disabled={!session}
              className="grid h-9 w-9 place-items-center rounded-md border border-line bg-white text-slate-600 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
              title="Export Markdown report"
              aria-label="Export Markdown report"
            >
              <FileText size={16} />
            </button>
            <button
              onClick={exportScenario}
              disabled={!session || !session.transcript.some((turn) => turn.role === "user")}
              className="grid h-9 w-9 place-items-center rounded-md border border-line bg-white text-slate-600 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
              title="Export scenario YAML"
              aria-label="Export scenario YAML"
            >
              <FileCode2 size={16} />
            </button>
            <button
              onClick={() => void toggleBaseline()}
              disabled={!session}
              className={`grid h-9 w-9 place-items-center rounded-md border bg-white hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40 ${session?.baseline ? "border-fern text-fern" : "border-line text-slate-600"}`}
              title={session?.baseline ? "Remove baseline" : "Save as baseline"}
              aria-label={session?.baseline ? "Remove baseline" : "Save as baseline"}
            >
              <Bookmark size={16} fill={session?.baseline ? "currentColor" : "none"} />
            </button>
            <button
              onClick={reset}
              disabled={!viewingLive}
              className="grid h-9 w-9 place-items-center rounded-md border border-line bg-white text-slate-600 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
              title="Reset session"
              aria-label="Reset session"
            >
              <RotateCcw size={16} />
            </button>
            <button
              onClick={endCall}
              disabled={!viewingLive}
              className="grid h-9 w-9 place-items-center rounded-md border border-line bg-white text-slate-600 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
              title="End call"
              aria-label="End call"
            >
              <PhoneOff size={16} />
            </button>
          </div>
        </div>
        {baselineEditorOpen ? (
          <div className="border-t border-line bg-mist">
            <div className="mx-auto flex max-w-[1440px] flex-wrap items-end gap-3 px-5 py-4">
              <label className="min-w-[260px] flex-1">
                <span className="mb-1 block text-[11px] font-medium uppercase text-slate-500">Baseline name</span>
                <input
                  value={baselineName}
                  onChange={(event) => setBaselineName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveBaseline();
                  }}
                  className="config-input"
                  aria-label="Baseline name"
                  autoFocus
                />
              </label>
              <button
                onClick={() => void saveBaseline()}
                disabled={baselineSaving}
                className="h-9 rounded-md bg-ink px-4 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {baselineSaving ? "Saving…" : "Save baseline"}
              </button>
              <button
                onClick={() => setBaselineEditorOpen(false)}
                disabled={baselineSaving}
                className="h-9 rounded-md border border-line bg-white px-4 text-xs font-medium text-slate-600 hover:border-slate-400 disabled:opacity-50"
              >
                Cancel
              </button>
              {baselineError ? <div className="w-full text-xs text-danger">{baselineError}</div> : null}
            </div>
          </div>
        ) : null}
      </header>

      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-4 px-5 py-5 xl:grid-cols-[320px_minmax(0,1fr)_420px]">
        <section className="min-h-[520px] rounded-lg border border-line bg-white shadow-soft">
          <PanelHeader icon={leftView === "timeline" ? <Clock3 size={16} /> : <History size={16} />} title={leftView === "timeline" ? "Timeline" : "Runs"} meta={leftView === "timeline" ? `${session?.deliveries.length ?? 0} deliveries` : `${runs.length} saved`} />
          <div className="grid grid-cols-2 border-b border-line p-2">
            <ViewTab active={leftView === "timeline"} onClick={() => setLeftView("timeline")} icon={<Clock3 size={14} />} label="Timeline" />
            <ViewTab active={leftView === "runs"} onClick={() => setLeftView("runs")} icon={<History size={14} />} label="Runs" />
          </div>
          <div className="max-h-[calc(100vh-220px)] overflow-auto px-3 py-3">
            {leftView === "timeline" && session?.deliveries.length ? (
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
            ) : leftView === "timeline" ? (
              <EmptyLine label="No deliveries yet" />
            ) : runs.length ? (
              runs.map((run) => (
                <div key={run.id} className={`group mb-2 flex items-center rounded-md border ${session?.id === run.id ? "border-fern bg-emerald-50" : "border-line bg-white hover:border-slate-400"}`}>
                  <button onClick={() => void openRun(run)} className="min-w-0 flex-1 px-3 py-2 text-left">
                    <span className="flex items-center gap-2 text-sm font-medium text-ink">
                      {run.id === liveSession?.id ? <Radio size={13} className="shrink-0 text-fern" /> : null}
                      <span className="truncate">{formatRunDate(run.startedAt)}</span>
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-500">
                      {run.channel} / {run.transcriptTurns} turns / {run.deliveries} deliveries
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-500">{run.status}</span>
                    {run.baselineName ? <span className="mt-1 block truncate text-xs font-medium text-fern">Baseline: {run.baselineName}</span> : null}
                  </button>
                  {run.id !== liveSession?.id ? (
                    <button onClick={() => void deleteRun(run)} className="mr-2 grid h-8 w-8 shrink-0 place-items-center text-slate-400 hover:text-danger" title="Delete run" aria-label="Delete run">
                      <Trash2 size={15} />
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <EmptyLine label="No saved runs yet" />
            )}
          </div>
        </section>

        <section className="min-h-[520px] rounded-lg border border-line bg-white shadow-soft">
          <PanelHeader icon={<Play size={16} />} title="Transcript" meta={viewingLive ? session?.status ?? "idle" : "saved run"} />
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
                disabled={!viewingLive}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void sendTurn();
                }}
                className="h-10 min-w-0 flex-1 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-fern disabled:bg-mist disabled:text-slate-500"
                placeholder={viewingLive ? "Type caller turn" : "Saved run is read-only"}
                aria-label="Caller turn"
              />
              <button
                onClick={sendTurn}
                disabled={!viewingLive}
                className="grid h-10 w-10 place-items-center rounded-md bg-ink text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
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
            {selected ? (
              <div className="border-t border-line p-3">
                <button
                  onClick={() => setReplayOpen((open) => !open)}
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-line bg-white text-sm font-medium text-slate-700 hover:border-slate-400"
                >
                  <RefreshCw size={15} />
                  Edit and replay
                </button>
                {replayOpen ? (
                  <div className="mt-3 space-y-3">
                    <textarea
                      value={replayBody}
                      onChange={(event) => setReplayBody(event.target.value)}
                      className="h-48 w-full resize-y rounded-md border border-line bg-mist p-3 font-mono text-xs leading-5 text-slate-700 outline-none focus:border-fern"
                      aria-label="Replay request body"
                      spellCheck={false}
                    />
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input type="checkbox" checked={preserveWebhookId} onChange={(event) => setPreserveWebhookId(event.target.checked)} />
                      Preserve webhook ID
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input type="checkbox" checked={preserveTimestamp} onChange={(event) => setPreserveTimestamp(event.target.checked)} />
                      Preserve timestamp
                    </label>
                    {replayError ? <div className="text-xs text-danger">{replayError}</div> : null}
                    <button
                      onClick={() => void replayDelivery()}
                      disabled={replayBusy}
                      className="h-9 w-full rounded-md bg-ink text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      {replayBusy ? "Replaying…" : "Send replay"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
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

          {session?.scenarioResult ? <ScenarioCard result={session.scenarioResult} /> : null}

          {session ? (
            <ComparisonCard
              session={session}
              baselines={runs.filter((run) => run.baselineName)}
              baselineId={baselineId}
              onBaselineChange={setBaselineId}
              onCompare={() => void compareToBaseline()}
              comparison={comparison}
            />
          ) : null}

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

function ViewTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-8 items-center justify-center gap-2 border-b-2 text-xs font-medium ${active ? "border-fern text-fern" : "border-transparent text-slate-500 hover:text-ink"}`}
    >
      {icon}
      {label}
    </button>
  );
}

function PayloadBlock({ value }: { value: unknown | null }) {
  return (
    <pre className="max-h-[270px] min-h-[150px] overflow-auto px-4 py-3 text-xs leading-5 text-slate-700">
      {value ? JSON.stringify(value, null, 2) : "null"}
    </pre>
  );
}

function ScenarioCard({ result }: { result: NonNullable<InspectorSession["scenarioResult"]> }) {
  return (
    <section className="rounded-lg border border-line bg-white shadow-soft">
      <PanelHeader
        icon={result.passed ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
        title="Scenario"
        meta={result.passed ? "passed" : `${result.failedCount} failed`}
      />
      <ul className="space-y-2 px-4 pb-4 text-xs leading-5">
        {result.assertions.map((assertion, index) => (
          <li key={`${assertion.kind}-${assertion.turnIndex ?? "final"}-${index}`} className="flex gap-2">
            <span className={assertion.passed ? "text-fern" : "text-danger"}>{assertion.passed ? "PASS" : "FAIL"}</span>
            <span className="text-slate-600">{assertion.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ComparisonCard({
  session,
  baselines,
  baselineId,
  onBaselineChange,
  onCompare,
  comparison
}: {
  session: InspectorSession;
  baselines: InspectorSessionSummary[];
  baselineId: string;
  onBaselineChange: (id: string) => void;
  onCompare: () => void;
  comparison: RunComparison | null;
}) {
  return (
    <section className="rounded-lg border border-line bg-white shadow-soft">
      <PanelHeader icon={<Scale size={16} />} title="Baseline" meta={comparison ? (comparison.passed ? "passed" : "regressed") : session.baseline?.name} />
      <div className="space-y-3 px-4 pb-4 text-sm">
        <select
          value={baselineId}
          onChange={(event) => onBaselineChange(event.target.value)}
          className="h-9 w-full rounded-md border border-line bg-white px-2 text-xs text-ink outline-none focus:border-fern"
          aria-label="Comparison baseline"
        >
          <option value="">Select saved baseline</option>
          {baselines.map((baseline) => (
            <option key={baseline.id} value={baseline.id}>
              {baseline.baselineName}
            </option>
          ))}
        </select>
        <button
          onClick={onCompare}
          disabled={!baselineId}
          className="h-9 w-full rounded-md bg-ink text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
        >
          Compare current run
        </button>
        {comparison ? (
          <div className="space-y-2">
            <div className={`font-semibold ${comparison.passed ? "text-fern" : "text-danger"}`}>
              {comparison.passed ? "No regressions" : `${comparison.regressions.length} regression(s)`}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <KeyValue name="latency delta" value={`${comparison.latency.deltaMs}ms`} />
              <KeyValue name="missing actions" value={comparison.actions.missing.join(", ") || "none"} />
              <KeyValue name="transcript" value={comparison.transcript.changed ? "changed" : "same"} />
              <KeyValue name="new warnings" value={String(comparison.warnings.added.length)} />
            </div>
            {comparison.regressions.length ? (
              <ul className="space-y-1 text-xs leading-5 text-danger">
                {comparison.regressions.map((regression) => <li key={regression}>{regression}</li>)}
              </ul>
            ) : null}
          </div>
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

function formatRunDate(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function summarizeLive(session: InspectorSession): InspectorSessionSummary {
  return {
    id: session.id,
    targetUrl: session.targetUrl,
    channel: session.channel,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    transcriptTurns: session.transcript.length,
    deliveries: session.deliveries.length
  };
}
