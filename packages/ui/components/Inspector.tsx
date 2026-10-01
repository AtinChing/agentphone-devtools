"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, Bookmark, CheckCircle2, Clock3, FastForward, FileCode2, FileJson, FileText, GitBranch, History, Loader2, Megaphone, MessageSquareX, Mic, PhoneOff, Play, Radio, RefreshCw, RotateCcw, Scale, Send, Square, StepForward, StickyNote, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import type {
  InspectorDelivery,
  InspectorSession,
  InspectorSessionSummary,
  RunComparison,
  ScenarioListing,
  SessionChannel,
  StepExpect,
  StepQueueTurn,
  StepState,
  TurnLabel
} from "@/lib/types";
import { api, errorMessage, SERVER_URL } from "@/lib/api";
import { formatPhone } from "@/components/dashboard/ui";
import { buildTurnForest, ConversationTree, flattenForest, TreeLegend, type TurnNode } from "@/components/ConversationTree";

// The three message channels all deliver agent.message webhooks; voice is a call.
const CHANNEL_OPTIONS: Array<{ value: SessionChannel; label: string }> = [
  { value: "sms", label: "SMS" },
  { value: "imessage", label: "iMessage" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "voice", label: "Voice" }
];

const DEFAULT_SCENARIO = "examples/scenarios/appointment-cancellation.yaml";

// AgentPhone console recipes (see the dashboard's ui.tsx), local so the
// Inspector's dense controls can size them per use.
const PANEL = "rounded-[18px] bg-card shadow-card";
const INPUT = "focus-ring rounded-[10px] bg-input px-3 text-[13px] text-white placeholder:text-white/30";
const PRIMARY_BUTTON =
  "focus-ring inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[8px] bg-primary font-medium leading-none text-white transition-[background-color,transform] duration-200 hover:bg-primary/90 active:scale-[0.96] disabled:opacity-50";
const SUBMIT_BUTTON =
  "focus-ring inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-primary font-medium leading-none text-primary-foreground-strong transition-[filter,transform] duration-200 hover:brightness-110 active:scale-[0.96] disabled:opacity-50 disabled:hover:brightness-100";
const SECONDARY_BUTTON =
  "focus-ring inline-flex shrink-0 items-center justify-center rounded-[8px] border border-surface-border bg-white/[0.03] font-medium leading-none text-white transition-[background-color,color,transform] duration-200 hover:bg-white/[0.06] active:scale-[0.96] disabled:opacity-40";
const ICON_BUTTON =
  "focus-ring grid h-8 w-8 place-items-center rounded-[8px] border transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40";
const ICON_IDLE = "border-white/[0.08] text-white/60 hover:bg-white/[0.06] hover:text-white";
const ICON_ACTIVE = "border-primary text-primary hover:bg-primary/10";
const BADGE = "rounded border px-2 py-0.5 text-[10px] font-medium leading-4";
const BADGE_GREEN = `${BADGE} border-primary/20 bg-primary/15 text-primary`;
const BADGE_RED = `${BADGE} border-red-500/20 bg-red-500/15 text-red-400`;
const BADGE_AMBER = `${BADGE} border-amber-500/20 bg-amber-500/15 text-amber-400`;
const BADGE_NEUTRAL = `${BADGE} border-white/[0.08] bg-white/[0.05] text-white/60`;

export function Inspector() {
  const [session, setSession] = useState<InspectorSession | null>(null);
  const [liveSession, setLiveSession] = useState<InspectorSession | null>(null);
  const [runs, setRuns] = useState<InspectorSessionSummary[]>([]);
  const [leftView, setLeftView] = useState<"timeline" | "runs">("timeline");
  const [centerView, setCenterView] = useState<"transcript" | "tree">("transcript");
  const [familySessions, setFamilySessions] = useState<InspectorSession[]>([]);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [treeForkText, setTreeForkText] = useState("");
  const [treeForkBusy, setTreeForkBusy] = useState(false);
  const [treeForkError, setTreeForkError] = useState<string | null>(null);
  // Voice dictation: a developer convenience for filling the caller input,
  // NOT a simulation of AgentPhone's STT. Transcription runs on the local
  // devtools server (whisper.cpp); hidden entirely when unavailable.
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [voiceTarget, setVoiceTarget] = useState<"caller" | "fork" | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  // Hold-space push-to-talk: held = speaking to the agent (auto-sends on
  // release), released = speaking to humans. Intent routing by key, so
  // narrating a demo never becomes a ghost turn — deliberately NOT open-mic
  // VAD, which cannot tell narration from caller turns.
  const voiceStateRef = useRef(voiceState);
  voiceStateRef.current = voiceState;
  const holdToTalkRef = useRef(false);
  const autoSendRef = useRef(false);
  const stepStateRef = useRef<StepState | null>(null);
  const channelRef = useRef<SessionChannel>("voice");
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<SessionChannel>("voice");
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
  const [stepState, setStepState] = useState<StepState | null>(null);
  const [stepStripOpen, setStepStripOpen] = useState(false);
  const [stepScenarioPath, setStepScenarioPath] = useState(DEFAULT_SCENARIO);
  // Advanced mode types any path (absolute ones included) instead of picking.
  const [stepScenarioAdvanced, setStepScenarioAdvanced] = useState(false);
  const [stepScenarioCustomPath, setStepScenarioCustomPath] = useState("");
  const [scenarios, setScenarios] = useState<ScenarioListing[] | null>(null);
  const [scenariosError, setScenariosError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [warpInput, setWarpInput] = useState("");
  const [outboundText, setOutboundText] = useState("");
  const [outboundAfter, setOutboundAfter] = useState("");
  // An outbound head turn shows read-only until the user asks to edit it.
  const [agentHeadEditable, setAgentHeadEditable] = useState(false);
  // One note editor at a time; the key names the transcript row or tree node.
  const [noteEditorKey, setNoteEditorKey] = useState<string | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [forkTurn, setForkTurn] = useState<number | null>(null);
  const [forkText, setForkText] = useState("");
  const [forkBusy, setForkBusy] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const callerInputRef = useRef<HTMLInputElement | null>(null);
  const viewingSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/state`)
      .then((response) => response.json())
      .then((state: InspectorSession) => {
        setLiveSession(state);
        setSession(state);
        setChannel(state.channel);
        setSelectedId(state.deliveries.at(-1)?.id ?? null);
        // Deep link (/devtools?session=ID) from the dashboard. Resolved after
        // the live state so a link to the live run stays live, not a snapshot.
        const linked = new URLSearchParams(window.location.search).get("session");
        if (linked && linked !== state.id) void openRun({ id: linked });
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
    source.addEventListener("step", (event) => {
      setStepState(JSON.parse((event as MessageEvent).data) as StepState);
    });

    fetch(`${SERVER_URL}/api/step`)
      .then((response) => response.json())
      .then((state: StepState) => setStepState(state))
      .catch(() => undefined);

    fetch(`${SERVER_URL}/api/voice`)
      .then((response) => response.json())
      .then((support: { available?: boolean }) => setVoiceAvailable(support.available === true))
      .catch(() => setVoiceAvailable(false));

    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // In step mode the caller input mirrors the next queued turn; editing it
  // before sending is how a scripted turn gets rewritten. An outbound head
  // (campaign opener) mirrors too, but stays read-only unless unlocked.
  const queueHead = stepState?.active ? stepState.queue[0] : undefined;
  const nextQueuedText = stepState?.active ? queueHead?.caller ?? queueHead?.agent ?? "" : null;
  useEffect(() => {
    setText(nextQueuedText ?? "");
    setAgentHeadEditable(false);
  }, [nextQueuedText]);

  // The picker re-reads the scenario folders each time the strip opens, so
  // new exports show up without a reload.
  useEffect(() => {
    if (!stepStripOpen) return;
    let cancelled = false;
    api
      .get<ScenarioListing[]>("/api/scenarios")
      .then((listings) => {
        if (cancelled) return;
        setScenarios(listings);
        setScenariosError(null);
        setStepScenarioPath((current) =>
          listings.some((listing) => listing.path === current && !listing.error)
            ? current
            : listings.find((listing) => listing.path === DEFAULT_SCENARIO && !listing.error)?.path ??
              listings.find((listing) => !listing.error)?.path ??
              current
        );
      })
      .catch((error) => {
        if (!cancelled) setScenariosError(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [stepStripOpen]);

  stepStateRef.current = stepState;
  channelRef.current = channel;

  // Hold-space push-to-talk. Registered once; handlers read refs only.
  useEffect(() => {
    if (!voiceAvailable) return;
    const typingTarget = () => {
      const element = document.activeElement;
      return (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || typingTarget()) return;
      if (viewingSessionIdRef.current !== null) return; // saved runs are read-only
      event.preventDefault();
      if (voiceStateRef.current !== "idle") return;
      holdToTalkRef.current = true;
      void beginRecording("caller", true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !holdToTalkRef.current) return;
      event.preventDefault();
      holdToTalkRef.current = false;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceAvailable]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [session?.transcript.length]);

  const selected = useMemo(() => {
    if (!session) return null;
    return session.deliveries.find((delivery) => delivery.id === selectedId) ?? session.deliveries.at(-1) ?? null;
  }, [selectedId, session]);

  // Caller-turn ordinals (1-based) drive labels and fork points.
  const transcriptRows = useMemo(() => {
    let ordinal = 0;
    return (session?.transcript ?? []).map((turn) => ({
      turn,
      ordinal: turn.role === "user" ? ++ordinal : null
    }));
  }, [session?.transcript]);

  // Tree mode works on the viewed run's whole fork family: every run reachable
  // through forkedFrom links, fetched in full so prefixes can merge into one
  // tree of turns.
  useEffect(() => {
    if (centerView !== "tree" || !session) {
      return;
    }
    const ids = collectFamilyIds(session.id, runs);
    let cancelled = false;
    void (async () => {
      const family: InspectorSession[] = [];
      for (const id of ids) {
        if (id === session.id) family.push(session);
        else if (id === liveSession?.id) family.push(liveSession);
        else {
          const response = await fetch(`${SERVER_URL}/api/history/${id}`).catch(() => null);
          if (response?.ok) family.push((await response.json()) as InspectorSession);
        }
      }
      if (!cancelled) setFamilySessions(family);
    })();
    return () => {
      cancelled = true;
    };
  }, [centerView, session, liveSession, runs]);

  const forest = useMemo(() => buildTurnForest(familySessions), [familySessions]);
  const selectedNode = useMemo(
    () => flattenForest(forest).find((node) => node.key === selectedNodeKey) ?? null,
    [forest, selectedNodeKey]
  );

  useEffect(() => {
    setReplayBody(selected ? JSON.stringify(selected.request.body, null, 2) : "");
    setReplayError(null);
    setReplayOpen(false);
    setPreserveWebhookId(false);
    setPreserveTimestamp(false);
  }, [selected?.id]);

  useEffect(() => {
    setComparison(null);
    setNoteEditorKey(null);
  }, [session?.id]);

  async function stepApi(path: string, body?: unknown): Promise<boolean> {
    setStepError(null);
    const response = await fetch(`${SERVER_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Fastify rejects an empty body when the JSON content-type is set.
      body: JSON.stringify(body ?? {})
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setStepError(payload.error ?? "Step request failed");
      return false;
    }
    return true;
  }

  function showLive() {
    viewingSessionIdRef.current = null;
    setViewingSessionId(null);
    setLeftView("timeline");
    setSelectedId(null);
  }

  async function startStepScenario() {
    // Until the list loads, the default path is still a valid pick.
    const picked = scenarios === null ? stepScenarioPath : selectedListing?.path ?? "";
    const path = (stepScenarioAdvanced ? stepScenarioCustomPath : picked).trim();
    if (!path) {
      setStepError(stepScenarioAdvanced ? "Enter a scenario path (relative to where the CLI was started)" : "Pick a scenario");
      return;
    }
    const listing = stepScenarioAdvanced ? undefined : scenarios?.find((item) => item.path === path);
    if (listing?.error) {
      setStepError(`${listing.name} is invalid: ${listing.error}`);
      return;
    }
    if (await stepApi("/api/step/start", { scenarioPath: path })) {
      setStepStripOpen(false);
      showLive();
    }
  }

  async function startStepReplay(run: InspectorSessionSummary) {
    if (await stepApi("/api/step/start", { sessionId: run.id })) showLive();
  }

  async function endStep() {
    await stepApi("/api/step/end");
  }

  /** Remove the queue head without sending it (the CLI's `drop`). */
  async function dropQueueHead() {
    await stepApi("/api/step/drop");
  }

  async function warpClock() {
    const duration = warpInput.trim();
    if (!duration) {
      setStepError("Enter a duration to warp by, e.g. 2d, 3h or 1h30m");
      return;
    }
    if (await stepApi("/api/step/warp", { duration })) setWarpInput("");
  }

  /** Queue an outbound business message; it is seeded, never delivered. */
  async function queueOutbound() {
    const outbound = outboundText.trim();
    if (!outbound) return;
    const after = outboundAfter.trim();
    if (await stepApi("/api/step/agent", { text: outbound, ...(after ? { after } : {}) })) {
      setOutboundText("");
      setOutboundAfter("");
    }
  }

  /** Send caller text through the same path as typing. Refs-only so hold-space closures stay fresh. */
  async function sendCallerText(raw: string) {
    const trimmed = raw.trim();
    const step = stepStateRef.current;
    const live = viewingSessionIdRef.current === null;
    if (step?.active && live) {
      if (step.sending) return;
      const head = step.queue[0];
      if (!head) {
        if (!trimmed) return;
        if (!(await stepApi("/api/step/add", { caller: trimmed }))) return;
      } else if (trimmed && trimmed !== (head.caller ?? head.agent)) {
        // step/edit rewrites the head whatever its kind, outbound included.
        if (!(await stepApi("/api/step/edit", { caller: trimmed }))) return;
      }
      // An outbound head is seeded without a delivery, so there is no
      // lastResult to show afterwards — the transcript is the feedback.
      await stepApi("/api/step/send");
      return;
    }
    if (!trimmed) return;
    setText("");
    await fetch(`${SERVER_URL}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: trimmed, channel: channelRef.current })
    });
  }

  async function sendTurn() {
    await sendCallerText(text);
  }

  async function submitFork() {
    if (!session || forkTurn === null) return;
    const caller = forkText.trim();
    if (!caller) {
      setForkError("Enter the branch's next caller text");
      return;
    }
    setForkBusy(true);
    setForkError(null);
    try {
      const response = await fetch(`${SERVER_URL}/api/step/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, turnIndex: forkTurn, caller })
      });
      const payload = (await response.json()) as StepState | { error?: string };
      if (!response.ok) throw new Error("error" in payload && payload.error ? payload.error : "Fork failed");
      setForkTurn(null);
      setForkText("");
      showLive();
    } catch (error) {
      setForkError(error instanceof Error ? error.message : String(error));
    } finally {
      setForkBusy(false);
    }
  }

  /**
   * Start capturing the mic. Reads only refs and stable setters, so it works
   * from once-registered key listeners without stale-closure bugs. With
   * autoSend, the transcript is sent as the caller turn on stop (hold-space
   * mode); without it, the transcript fills the target input for editing.
   */
  async function beginRecording(target: "caller" | "fork", autoSend: boolean) {
    if (voiceStateRef.current !== "idle") return;
    setVoiceError(null);
    // Speech is always a caller turn; it must not overwrite a queued outbound message.
    const step = stepStateRef.current;
    if (target === "caller" && step?.active && viewingSessionIdRef.current === null && step.queue[0]?.agent !== undefined) {
      setVoiceTarget("caller");
      setVoiceError("The next queued turn is an outbound message — send or drop it before speaking.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceError("Microphone unavailable or permission denied.");
      return;
    }
    autoSendRef.current = autoSend;
    const recorder = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      setVoiceState("transcribing");
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const response = await fetch(`${SERVER_URL}/api/voice/transcribe`, {
          method: "POST",
          headers: { "Content-Type": blob.type.split(";")[0] || "audio/webm" },
          body: blob
        });
        const payload = (await response.json()) as { text?: string; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Transcription failed");
        const heard = (payload.text ?? "").trim();
        if (!heard) {
          setVoiceError("Heard nothing — try again or type the turn.");
        } else if (autoSendRef.current) {
          await sendCallerText(heard);
        } else if (target === "fork") {
          setTreeForkText(heard);
        } else {
          setText(heard);
        }
      } catch (error) {
        setVoiceError(error instanceof Error ? error.message : String(error));
      } finally {
        autoSendRef.current = false;
        setVoiceState("idle");
        setVoiceTarget(null);
      }
    };
    recorder.start();
    recorderRef.current = recorder;
    setVoiceTarget(target);
    setVoiceState("recording");
    // Hold released before the mic finished opening: stop immediately.
    if (autoSend && !holdToTalkRef.current) recorder.stop();
  }

  /** Mic-button flow: click to record, click again to stop and fill the input. */
  async function toggleDictation(target: "caller" | "fork") {
    if (voiceStateRef.current === "recording") {
      recorderRef.current?.stop();
      return;
    }
    await beginRecording(target, false);
  }

  /**
   * The server replaces a turn's label wholesale, so every write carries
   * both fields: a thumbs click keeps the note, a note save keeps the
   * verdict. Returns an error message, or null on success.
   */
  async function labelTurn(
    callerOrdinal: number,
    patch: { verdict?: TurnLabel["verdict"]; note?: string },
    existing: Pick<TurnLabel, "verdict" | "note"> | undefined,
    runId?: string
  ): Promise<string | null> {
    const targetId = runId ?? session?.id;
    if (!targetId) return "No run to label";
    const verdict = "verdict" in patch ? patch.verdict : existing?.verdict;
    const note = ("note" in patch ? patch.note : existing?.note)?.trim();
    const response = await fetch(`${SERVER_URL}/api/history/${targetId}/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnIndex: callerOrdinal - 1, ...(verdict ? { verdict } : {}), ...(note ? { note } : {}) })
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      return payload.error ?? "Could not save the label";
    }
    const updated = (await response.json()) as InspectorSession;
    if (updated.id === session?.id) setSession(updated);
    if (updated.id === liveSession?.id) setLiveSession(updated);
    setFamilySessions((current) => current.map((member) => (member.id === updated.id ? updated : member)));
    return null;
  }

  function toggleNoteEditor(key: string) {
    setNoteError(null);
    setNoteEditorKey((current) => (current === key ? null : key));
  }

  async function saveNote(callerOrdinal: number, draft: string, existing: Pick<TurnLabel, "verdict" | "note"> | undefined, runId?: string) {
    setNoteBusy(true);
    setNoteError(null);
    try {
      const error = await labelTurn(callerOrdinal, { note: draft }, existing, runId);
      if (error) setNoteError(error);
      else setNoteEditorKey(null);
    } finally {
      setNoteBusy(false);
    }
  }

  async function forkFromNode(node: TurnNode) {
    const caller = treeForkText.trim();
    if (!caller) {
      setTreeForkError("Enter the branch's next caller text");
      return;
    }
    setTreeForkBusy(true);
    setTreeForkError(null);
    try {
      const response = await fetch(`${SERVER_URL}/api/step/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: node.runId, turnIndex: node.turnNumber, caller })
      });
      const payload = (await response.json()) as StepState | { error?: string };
      if (!response.ok) throw new Error("error" in payload && payload.error ? payload.error : "Fork failed");
      // Send the branch turn right away so the new branch appears on the
      // canvas immediately — a fork that queues silently looks like nothing
      // happened. The step session stays active for follow-up turns.
      const sendResponse = await fetch(`${SERVER_URL}/api/step/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (!sendResponse.ok) {
        const sendPayload = (await sendResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(sendPayload.error ?? "Fork created, but sending the branch turn failed");
      }
      setTreeForkText("");
      setSelectedNodeKey(null);
      viewingSessionIdRef.current = null;
      setViewingSessionId(null);
    } catch (error) {
      setTreeForkError(error instanceof Error ? error.message : String(error));
    } finally {
      setTreeForkBusy(false);
    }
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

  async function openRun(run: Pick<InspectorSessionSummary, "id">) {
    if (run.id === liveSession?.id) {
      viewingSessionIdRef.current = null;
      setViewingSessionId(null);
      setSession(liveSession);
      setChannel(liveSession.channel);
      setSelectedId(liveSession.deliveries.at(-1)?.id ?? null);
      return;
    }

    const response = await fetch(`${SERVER_URL}/api/history/${encodeURIComponent(run.id)}`).catch(() => null);
    if (!response?.ok) return;
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
    // Assertions are scaffolded from the actions each turn actually returned,
    // so the export is a ready-to-approve regression scenario.
    window.open(`${SERVER_URL}/api/history/${session.id}/scenario.yaml?assertions=1`, "_blank", "noopener,noreferrer");
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
  // Hangup follows the session's real channel, not the toolbar's pending pick.
  const isVoice = (session?.channel ?? channel) === "voice";
  // The Inspector speaks the channel's language: a call has a caller and an
  // agent taking turns; a thread has a customer and a business exchanging
  // messages. Accessible names keep "turn" so they stay stable.
  const words = isVoice
    ? { you: "caller", them: "agent", unit: "turn", typeNext: "Type caller turn", typeBranch: "Type the next caller turn for this branch", strip: "edit the next caller line, fork from any turn" }
    : { you: "customer", them: "business", unit: "message", typeNext: `Type the customer's ${channelLabel(session?.channel ?? channel)} message`, typeBranch: "Type the customer's next message for this branch", strip: "edit the customer's next message, fork from any message" };
  // A conversation has one channel. Once the live session has a turn (or a
  // step session is running) the picker only applies to the next reset.
  const channelLocked = Boolean(stepState?.active) || (liveSession?.transcript.length ?? 0) > 0;
  const headIsAgent = Boolean(viewingLive && queueHead && queueHead.agent !== undefined);
  const selectedListing = scenarios?.find((listing) => listing.path === stepScenarioPath);
  const scenarioGroups = groupScenarios(scenarios ?? []);

  // Fills the dashboard frame: toolbar on top, three panels below that each
  // scroll internally (stacked, with one outer scroll, below xl).
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-white/[0.06] text-white">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4">
          <div className="flex min-w-0 flex-1 basis-[320px] items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary/15 text-primary">
              <Activity size={17} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="flex items-baseline gap-2 truncate font-heading text-[18px] font-bold leading-tight text-white">
                Inspector
                <span className="micro font-normal text-primary">step debugger</span>
              </h1>
              <div className="mt-1 flex min-w-0 items-center gap-x-3 overflow-hidden whitespace-nowrap font-mono text-[12px] text-text-secondary">
                <span className="min-w-0 truncate">{session?.targetUrl ?? "waiting for simulator"}</span>
                {session?.secretPreview ? <span className="shrink-0 text-text-dim">{session.secretPreview}</span> : null}
                {session?.contact ? (
                  <span className="min-w-0 shrink-[4] truncate text-text-subtle" title={session.contact.number}>
                    Contact: {session.contact.name} · {formatPhone(session.contact.number)}
                  </span>
                ) : null}
                <span className={`flex shrink-0 items-center gap-1.5 ${connected ? "text-primary" : "text-amber-400"}`}>
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${connected ? "bg-primary" : "bg-amber-400"}`} />
                  {connected ? "live" : "offline"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <div
              className="flex gap-1 rounded-[10px] bg-white/[0.04] p-1"
              role="radiogroup"
              aria-label="Channel"
              title={channelLocked ? `This conversation is on ${channel}. Reset to start one on another channel.` : undefined}
            >
              {CHANNEL_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  role="radio"
                  aria-checked={channel === option.value}
                  disabled={channelLocked && channel !== option.value}
                  onClick={() => setChannel(option.value)}
                  className={`rounded-[6px] px-3 py-1.5 text-[13px] leading-none transition-colors ${
                    channel === option.value ? "bg-white/10 font-medium text-white" : "text-white/50 hover:text-white/80"
                  } disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-white/50`}
                  title={
                    channelLocked && channel !== option.value
                      ? `Conversation is on ${channel} — reset to start a ${option.label} one`
                      : option.value === "voice"
                        ? "Voice call"
                        : `${option.label} thread — agent.message deliveries`
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
            <span className="mx-1 h-5 w-px bg-white/[0.08]" aria-hidden="true" />
            <button
              onClick={() => {
                setStepError(null);
                setStepStripOpen((open) => !open);
              }}
              className={`${ICON_BUTTON} ${stepState?.active || stepStripOpen ? ICON_ACTIVE : ICON_IDLE}`}
              title={stepState?.active ? "Step session active" : "Step through a scenario"}
              aria-label="Step through a scenario"
            >
              <StepForward size={16} />
            </button>
            <button
              onClick={() => exportRun("json")}
              disabled={!session}
              className={`${ICON_BUTTON} ${ICON_IDLE}`}
              title="Export JSON report"
              aria-label="Export JSON report"
            >
              <FileJson size={16} />
            </button>
            <button
              onClick={() => exportRun("md")}
              disabled={!session}
              className={`${ICON_BUTTON} ${ICON_IDLE}`}
              title="Export Markdown report"
              aria-label="Export Markdown report"
            >
              <FileText size={16} />
            </button>
            <button
              onClick={exportScenario}
              disabled={!session || !session.transcript.some((turn) => turn.role === "user")}
              className={`${ICON_BUTTON} ${ICON_IDLE}`}
              title="Export scenario YAML"
              aria-label="Export scenario YAML"
            >
              <FileCode2 size={16} />
            </button>
            <span className="mx-1 h-5 w-px bg-white/[0.08]" aria-hidden="true" />
            <button
              onClick={() => void toggleBaseline()}
              disabled={!session}
              className={`${ICON_BUTTON} ${session?.baseline ? ICON_ACTIVE : ICON_IDLE}`}
              title={session?.baseline ? "Remove baseline" : "Save as baseline"}
              aria-label={session?.baseline ? "Remove baseline" : "Save as baseline"}
            >
              <Bookmark size={16} fill={session?.baseline ? "currentColor" : "none"} />
            </button>
            <span className="mx-1 h-5 w-px bg-white/[0.08]" aria-hidden="true" />
            <button
              onClick={reset}
              disabled={!viewingLive}
              className={`${ICON_BUTTON} ${ICON_IDLE}`}
              title="Reset session"
              aria-label="Reset session"
            >
              <RotateCcw size={16} />
            </button>
            {/* Hanging up is voice-only; a message thread just closes (no webhook). */}
            <button
              onClick={endCall}
              disabled={!viewingLive}
              className={`${ICON_BUTTON} ${ICON_IDLE}`}
              title={isVoice ? "End call" : "End conversation"}
              aria-label={isVoice ? "End call" : "End conversation"}
            >
              {isVoice ? <PhoneOff size={16} /> : <MessageSquareX size={16} />}
            </button>
          </div>
        </div>
        {stepStripOpen ? (
          <div className="mx-5 mb-4 overflow-hidden rounded-[16px] border border-primary/20 bg-primary/10">
            <div className="flex flex-wrap items-end gap-2.5 px-4 pb-2.5 pt-3.5">
              <div className="min-w-[280px] flex-1">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                    {stepScenarioAdvanced ? "Scenario path (relative to the CLI's working directory, or absolute)" : "Scenario"}
                  </span>
                  <button
                    onClick={() => {
                      setStepError(null);
                      if (!stepScenarioAdvanced && !stepScenarioCustomPath) setStepScenarioCustomPath(stepScenarioPath);
                      setStepScenarioAdvanced((advanced) => !advanced);
                    }}
                    className="text-[12px] text-text-secondary underline-offset-2 transition-colors hover:text-white hover:underline"
                  >
                    {stepScenarioAdvanced ? "pick from list" : "advanced: path"}
                  </button>
                </div>
                {stepScenarioAdvanced ? (
                  <input
                    value={stepScenarioCustomPath}
                    onChange={(event) => setStepScenarioCustomPath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void startStepScenario();
                    }}
                    className={`h-9 w-full ${INPUT}`}
                    placeholder="examples/scenarios/appointment-cancellation.yaml"
                    aria-label="Scenario path"
                    autoFocus
                  />
                ) : (
                  <select
                    value={selectedListing ? selectedListing.path : ""}
                    onChange={(event) => {
                      setStepError(null);
                      setStepScenarioPath(event.target.value);
                    }}
                    className={`h-9 w-full ${INPUT}`}
                    aria-label="Scenario"
                  >
                    {!selectedListing ? <option value="">{scenarios === null && !scenariosError ? "Loading scenarios…" : "Select a scenario"}</option> : null}
                    {scenarioGroups.map(([group, listings]) => (
                      <optgroup key={group} label={groupLabel(group)}>
                        {listings.map((listing) => (
                          <option key={listing.path} value={listing.path} disabled={Boolean(listing.error)} title={listing.error ?? listing.path}>
                            {listing.name} · {channelLabel(listing.channel)}
                            {listing.error ? " — invalid" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                )}
              </div>
              <button
                onClick={() => void startStepScenario()}
                className={`h-9 px-3.5 text-[14px] ${PRIMARY_BUTTON}`}
              >
                <StepForward size={15} />
                Start stepping
              </button>
              {stepState?.active ? (
                <button
                  onClick={() => void endStep()}
                  className={`h-9 px-3.5 text-[13px] ${SECONDARY_BUTTON}`}
                >
                  End current step session
                </button>
              ) : null}
              <button
                onClick={() => setStepStripOpen(false)}
                className={`h-9 px-3.5 text-[13px] ${SECONDARY_BUTTON}`}
              >
                Close
              </button>
              {!stepScenarioAdvanced && selectedListing ? (
                <div className="w-full truncate text-[12px] text-text-secondary" title={selectedListing.description}>
                  {selectedListing.description ? `${selectedListing.description} · ` : ""}
                  <span className="data text-[11px] text-text-dim">
                    {selectedListing.turns} turn{selectedListing.turns === 1 ? "" : "s"}
                    {selectedListing.callerTurns < selectedListing.turns ? ` (${selectedListing.turns - selectedListing.callerTurns} outbound)` : ""}
                    {selectedListing.hasAssertions ? " · assertions" : ""}
                  </span>
                </div>
              ) : null}
              {scenariosError && !stepScenarioAdvanced ? (
                <div className="w-full text-[12px] text-amber-400">Could not list scenarios ({scenariosError}) — use advanced: path.</div>
              ) : null}
            </div>
            {/* Simulated clock + outbound queue: one compact row. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-primary/15 px-4 py-2.5">
              <span
                className="flex items-center gap-1.5 text-[12px] text-text-subtle"
                title="Simulated clock — stamps payload timestamps and recentHistory, never the signing header"
              >
                <Clock3 size={13} className="text-text-secondary" />
                <span className="data">{stepState ? formatClock(stepState.virtualNow) : "—"}</span>
                <span className={`data ${stepState?.clockOffsetMs ? BADGE_AMBER : BADGE_NEUTRAL}`}>
                  {formatOffset(stepState?.clockOffsetMs ?? 0)}
                </span>
              </span>
              <form
                className="flex items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void warpClock();
                }}
              >
                <input
                  value={warpInput}
                  onChange={(event) => setWarpInput(event.target.value)}
                  className={`h-8 w-16 ${INPUT}`}
                  placeholder="2d"
                  aria-label="Warp the simulated clock by"
                  title="Duration: 90s, 45m, 3h, 2d, 1h30m"
                />
                <button
                  type="submit"
                  disabled={stepState?.sending}
                  className={`h-8 gap-1 px-2.5 text-[12px] ${SECONDARY_BUTTON}`}
                  title="Advance the simulated clock without sending anything"
                >
                  <FastForward size={13} />
                  Warp
                </button>
              </form>
              <span className="h-5 w-px bg-primary/20" aria-hidden="true" />
              <form
                className="flex min-w-[260px] flex-1 items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void queueOutbound();
                }}
              >
                <Megaphone size={13} className="shrink-0 text-amber-400" aria-hidden="true" />
                <input
                  value={outboundText}
                  onChange={(event) => setOutboundText(event.target.value)}
                  disabled={!stepState?.active}
                  className={`h-8 min-w-0 flex-1 disabled:opacity-50 ${INPUT}`}
                  placeholder={stepState?.active ? "Outbound business message to queue" : "Start stepping to queue outbound messages"}
                  aria-label="Outbound message"
                />
                <input
                  value={outboundAfter}
                  onChange={(event) => setOutboundAfter(event.target.value)}
                  disabled={!stepState?.active}
                  className={`h-8 w-16 disabled:opacity-50 ${INPUT}`}
                  placeholder="after"
                  aria-label="Delay before the outbound message"
                  title="Optional: advance the clock this much before it is sent, e.g. 2h"
                />
                <button
                  type="submit"
                  disabled={!stepState?.active || !outboundText.trim()}
                  className={`h-8 px-3 text-[12px] ${SECONDARY_BUTTON}`}
                  title="Queue a business message — seeded into history, no webhook delivery"
                >
                  Queue
                </button>
              </form>
            </div>
            <div className="border-t border-primary/15 px-4 py-2.5 text-[12px] leading-[18px] text-text-secondary">
              Runs one {words.unit} at a time: review each webhook, {words.strip}, then export the path as a regression scenario.
              Tip: the Runs tab can step-replay any saved run.
              {stepError ? <div className="mt-1 text-red-400">{stepError}</div> : null}
            </div>
          </div>
        ) : null}
        {baselineEditorOpen ? (
          <div className={`mx-5 mb-4 border border-white/[0.06] ${PANEL}`}>
            <div className="flex flex-wrap items-end gap-2.5 px-4 py-3.5">
              <label className="min-w-[260px] flex-1">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-secondary">Baseline name</span>
                <input
                  value={baselineName}
                  onChange={(event) => setBaselineName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveBaseline();
                  }}
                  className={`h-9 w-full ${INPUT}`}
                  aria-label="Baseline name"
                  autoFocus
                />
              </label>
              <button
                onClick={() => void saveBaseline()}
                disabled={baselineSaving}
                className={`h-9 px-3.5 text-[14px] ${PRIMARY_BUTTON}`}
              >
                {baselineSaving ? "Saving…" : "Save baseline"}
              </button>
              <button
                onClick={() => setBaselineEditorOpen(false)}
                disabled={baselineSaving}
                className={`h-9 px-3.5 text-[13px] ${SECONDARY_BUTTON}`}
              >
                Cancel
              </button>
              {baselineError ? <div className="w-full text-[12px] text-red-400">{baselineError}</div> : null}
            </div>
          </div>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-auto p-4 xl:grid-cols-[272px_minmax(0,1fr)_360px] xl:grid-rows-[minmax(0,1fr)] xl:overflow-hidden 2xl:grid-cols-[320px_minmax(0,1fr)_420px]">
        <section className={`flex h-[440px] min-h-0 flex-col overflow-hidden ${PANEL} xl:h-auto`}>
          <PanelHeader
            icon={leftView === "timeline" ? <Clock3 size={16} /> : <History size={16} />}
            title={leftView === "timeline" ? "Timeline" : "Runs"}
            meta={leftView === "timeline" ? `${session?.deliveries.length ?? 0} deliveries` : `${runs.length} saved`}
          />
          <div className="border-b border-white/[0.06] px-3 py-2.5">
            <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-white/[0.04] p-1">
              <ViewTab active={leftView === "timeline"} onClick={() => setLeftView("timeline")} icon={<Clock3 size={14} />} label="Timeline" />
              <ViewTab active={leftView === "runs"} onClick={() => setLeftView("runs")} icon={<History size={14} />} label="Runs" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
            {leftView === "timeline" && session?.deliveries.length ? (
              session.deliveries.map((delivery) => (
                <button
                  key={delivery.id}
                  onClick={() => setSelectedId(delivery.id)}
                  className={`focus-ring mb-2 grid w-full grid-cols-[1fr_auto] gap-2 rounded-[12px] border px-3 py-2.5 text-left transition-colors ${
                    selected?.id === delivery.id ? "border-primary/40 bg-primary/10" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text">
                      {delivery.event}
                      {delivery.inheritedFrom ? <span className="ml-2 rounded border border-purple-500/20 bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-medium text-purple-400">inherited</span> : null}
                    </span>
                    <span className="data mt-1 block truncate text-xs text-text-secondary">
                      {channelLabel(delivery.channel)} / {delivery.webhookId}
                    </span>
                  </span>
                  <span className={`data self-center text-xs font-medium ${delivery.timedOut || !delivery.ok ? "text-red-400" : "text-primary"}`}>
                    {delivery.latencyMs}ms
                  </span>
                </button>
              ))
            ) : leftView === "timeline" ? (
              <EmptyLine label="No deliveries yet" />
            ) : runs.length ? (
              runs.map((run) => (
                <div key={run.id} className={`group mb-2 flex items-center rounded-[12px] border transition-colors ${session?.id === run.id ? "border-primary/40 bg-primary/10" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]"}`}>
                  <button onClick={() => void openRun(run)} className="focus-ring min-w-0 flex-1 rounded-[12px] px-3 py-2.5 text-left">
                    <span className="flex items-center gap-2 text-sm font-medium text-text">
                      {run.id === liveSession?.id ? <Radio size={13} className="shrink-0 text-primary" /> : null}
                      {run.contact ? <span className="truncate" title={run.contact.number}>{run.contact.name}</span> : null}
                      <span className={`truncate ${run.contact ? "shrink-0 text-xs font-normal text-text-secondary" : ""}`}>{formatRunDate(run.startedAt)}</span>
                    </span>
                    <span className="data mt-1 block truncate text-xs text-text-secondary">
                      {channelLabel(run.channel)} / {run.transcriptTurns} turns / {run.deliveries} deliveries
                    </span>
                    <span className="mt-1 block truncate text-xs text-text-dim">{run.status}</span>
                    {run.baselineName ? <span className="mt-1 block truncate text-xs font-medium text-primary">Baseline: {run.baselineName}</span> : null}
                    {run.forkedFrom ? (
                      <span className="mt-1 flex items-center gap-1 truncate text-xs font-medium text-indigo-600">
                        <GitBranch size={11} className="shrink-0" />
                        fork of {run.forkedFrom.sessionId.slice(0, 12)}… after turn {run.forkedFrom.turnIndex}
                      </span>
                    ) : null}
                  </button>
                  {run.transcriptTurns > 0 ? (
                    <button
                      onClick={() => void startStepReplay(run)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-primary"
                      title="Step-replay this run turn by turn"
                      aria-label="Step-replay this run"
                    >
                      <StepForward size={15} />
                    </button>
                  ) : null}
                  {run.id !== liveSession?.id ? (
                    <button onClick={() => void deleteRun(run)} className="mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-text-secondary transition-colors hover:bg-red-500/10 hover:text-red-400" title="Delete run" aria-label="Delete run">
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

        <section className={`flex h-[78vh] min-h-[560px] flex-col overflow-hidden ${PANEL} xl:h-auto xl:min-h-0`}>
          <PanelHeader
            icon={centerView === "transcript" ? <Play size={16} /> : <GitBranch size={16} />}
            title={centerView === "transcript" ? "Transcript" : "Conversation Tree"}
            meta={viewingLive ? session?.status ?? "idle" : "saved run"}
          />
          <div className="border-b border-white/[0.06] px-3 py-2.5">
            <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-white/[0.04] p-1">
              <ViewTab active={centerView === "transcript"} onClick={() => setCenterView("transcript")} icon={<Play size={14} />} label="Transcript" />
              <ViewTab active={centerView === "tree"} onClick={() => setCenterView("tree")} icon={<GitBranch size={14} />} label="Tree" />
            </div>
          </div>
          {centerView === "tree" ? (
            <>
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-white/[0.06] px-4 py-2.5">
                <TreeLegend />
                <span className="data text-[11px] text-text-dim">
                  {familySessions.length} run(s) · every node is a frozen checkpoint
                </span>
              </div>
              <div className="min-h-[220px] flex-1">
                <ConversationTree
                  roots={forest}
                  liveSessionId={liveSession?.id ?? null}
                  selectedKey={selectedNodeKey}
                  onSelect={(node) => {
                    setTreeForkError(null);
                    setSelectedNodeKey((current) => (current === node.key ? null : node.key));
                  }}
                />
              </div>
              {selectedNode ? (
                <div className="shrink-0 border-t border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="data text-[11px] text-text-secondary">
                        checkpoint · turn {selectedNode.turnNumber}
                        {selectedNode.latencyMs !== undefined ? ` · ${selectedNode.latencyMs}ms` : ""}
                        {` · state: ${selectedNode.turnNumber * 2} history turn(s)`}
                        {selectedNode.actions.length ? ` · ${selectedNode.actions.join(", ")}` : ""}
                      </div>
                      <div className="mt-1 truncate text-sm font-medium text-text">{selectedNode.caller}</div>
                      <div className="mt-0.5 truncate text-sm text-text-subtle">{selectedNode.agentReply ?? "(no reply)"}</div>
                      {selectedNode.label?.note ? (
                        <div className="mt-1.5 flex items-start gap-1.5 rounded-[8px] border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-xs leading-5 text-amber-300">
                          <StickyNote size={12} className="mt-1 shrink-0" aria-hidden="true" />
                          <span className="max-h-24 overflow-auto whitespace-pre-wrap break-words">{selectedNode.label.note}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="relative flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => void labelTurn(selectedNode.turnNumber, { verdict: "good" }, selectedNode.label, selectedNode.runId)}
                        className={`grid h-7 w-7 place-items-center rounded-[6px] transition-colors hover:bg-primary/15 hover:text-primary ${selectedNode.label?.verdict === "good" ? "text-primary" : "text-text-secondary"}`}
                        title="Label good"
                        aria-label="Label this checkpoint good"
                      >
                        <ThumbsUp size={13} />
                      </button>
                      <button
                        onClick={() => void labelTurn(selectedNode.turnNumber, { verdict: "bad" }, selectedNode.label, selectedNode.runId)}
                        className={`grid h-7 w-7 place-items-center rounded-[6px] transition-colors hover:bg-red-500/15 hover:text-red-400 ${selectedNode.label?.verdict === "bad" ? "text-red-400" : "text-text-secondary"}`}
                        title="Label bad"
                        aria-label="Label this checkpoint bad"
                      >
                        <ThumbsDown size={13} />
                      </button>
                      <button
                        onClick={() => toggleNoteEditor(`tree:${selectedNode.key}`)}
                        className={`grid h-7 w-7 place-items-center rounded-[6px] transition-colors hover:bg-amber-500/15 hover:text-amber-300 ${selectedNode.label?.note ? "text-amber-300" : "text-text-secondary"}`}
                        title={selectedNode.label?.note ? `Note: ${selectedNode.label.note}` : "Add a note"}
                        aria-label="Edit this checkpoint's note"
                      >
                        <StickyNote size={13} />
                      </button>
                      {noteEditorKey === `tree:${selectedNode.key}` ? (
                        <NotePopover
                          key={`tree:${selectedNode.key}`}
                          initial={selectedNode.label?.note ?? ""}
                          busy={noteBusy}
                          error={noteError}
                          className="bottom-full right-0 mb-2"
                          onCancel={() => setNoteEditorKey(null)}
                          onSave={(draft) => void saveNote(selectedNode.turnNumber, draft, selectedNode.label, selectedNode.runId)}
                        />
                      ) : null}
                      {runs.some((run) => run.id === selectedNode.runId) && selectedNode.runId !== session?.id ? (
                        <button
                          onClick={() => {
                            const run = runs.find((item) => item.id === selectedNode.runId);
                            if (run) void openRun(run);
                          }}
                          className={`ml-1 h-7 px-2.5 text-[11px] ${SECONDARY_BUTTON}`}
                        >
                          open run
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={treeForkText}
                      onChange={(event) => setTreeForkText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void forkFromNode(selectedNode);
                      }}
                      className={`h-9 min-w-0 flex-1 ${INPUT}`}
                      placeholder="Fork from this state — what does the caller say instead?"
                      aria-label="Caller text for the new branch"
                    />
                    {voiceAvailable ? (
                      <MicToggle
                        small
                        state={voiceTarget === "fork" ? voiceState : "idle"}
                        onClick={() => void toggleDictation("fork")}
                      />
                    ) : null}
                    <button
                      onClick={() => void forkFromNode(selectedNode)}
                      disabled={treeForkBusy}
                      className={`h-9 px-3.5 text-[13px] ${SUBMIT_BUTTON}`}
                    >
                      {treeForkBusy ? "Forking…" : "Fork from here"}
                    </button>
                  </div>
                  {treeForkError ? <div className="mt-1 text-xs text-red-400">{treeForkError}</div> : null}
                  {voiceError && voiceTarget === "fork" ? <div className="mt-1 text-xs text-red-400">{voiceError}</div> : null}
                </div>
              ) : (
                <div className="border-t border-white/[0.06] px-4 py-2.5 text-xs text-text-secondary">
                  Click a checkpoint to inspect its state, label it, or fork the conversation from that exact point.
                </div>
              )}
            </>
          ) : null}
          <div ref={transcriptRef} className={`${centerView === "tree" ? "hidden" : ""} min-h-0 flex-1 overflow-auto px-4 py-4`}>
            {session?.forkedFrom ? (
              <div className="mb-3 flex items-center gap-2 rounded-[10px] border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
                <GitBranch size={13} className="shrink-0" />
                <span className="truncate">
                  Forked from run {session.forkedFrom.sessionId} after turn {session.forkedFrom.turnIndex}
                </span>
              </div>
            ) : null}
            {session?.transcript.length ? (
              <div>
                {transcriptRows.map(({ turn, ordinal }, index) => {
                  const label = ordinal !== null ? session.turnLabels?.find((item) => item.turnIndex === ordinal - 1) : undefined;
                  // Seeded business messages (campaign openers) never went through the webhook.
                  const outbound = turn.role === "agent" && (session.outboundSeeds?.includes(index) ?? false);
                  const at = session.turnTimes?.[index];
                  const noteKey = `transcript:${session.id}:${ordinal}`;
                  return (
                    <div key={`${turn.role}-${index}`} className="group relative border-b border-white/[0.04]">
                      <div className="flex items-start gap-3 py-2.5">
                        <span
                          className={`micro mt-1 w-12 shrink-0 text-right ${turn.role === "agent" ? "text-text-secondary" : "text-primary"}`}
                          title={at ? formatClock(at) : undefined}
                        >
                          {turn.role === "agent" ? words.them : words.you}
                        </span>
                        <div className={`min-w-0 flex-1 text-sm leading-6 ${turn.role === "agent" ? "text-text-subtle" : "font-medium text-text"}`}>
                          {outbound ? (
                            <span
                              className="micro mr-2 inline-flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/15 px-1.5 py-0.5 align-[1px] text-amber-400"
                              title="Outbound business message — seeded into history, no webhook delivery"
                            >
                              <Megaphone size={10} aria-hidden="true" />
                              outbound
                            </span>
                          ) : null}
                          {turn.content}
                        </div>
                      </div>
                      {ordinal !== null ? (
                        <div className="flex items-center gap-1 pb-1.5 pl-[60px] text-[11px] text-text-secondary opacity-60 transition group-hover:opacity-100">
                          {label?.verdict ? (
                            <span
                              title={label.note}
                              className={label.verdict === "good" ? BADGE_GREEN : BADGE_RED}
                            >
                              {label.verdict}
                            </span>
                          ) : null}
                          <span className="data mr-1">t{ordinal}</span>
                          <button
                            onClick={() => void labelTurn(ordinal, { verdict: "good" }, label)}
                            className={`grid h-6 w-6 place-items-center rounded-[6px] transition-colors hover:bg-primary/15 hover:text-primary ${label?.verdict === "good" ? "text-primary" : ""}`}
                            title="Label this turn good"
                            aria-label={`Label turn ${ordinal} good`}
                          >
                            <ThumbsUp size={12} />
                          </button>
                          <button
                            onClick={() => void labelTurn(ordinal, { verdict: "bad" }, label)}
                            className={`grid h-6 w-6 place-items-center rounded-[6px] transition-colors hover:bg-red-500/15 hover:text-red-400 ${label?.verdict === "bad" ? "text-red-400" : ""}`}
                            title="Label this turn bad"
                            aria-label={`Label turn ${ordinal} bad`}
                          >
                            <ThumbsDown size={12} />
                          </button>
                          <button
                            onClick={() => toggleNoteEditor(noteKey)}
                            className={`grid h-6 w-6 place-items-center rounded-[6px] transition-colors hover:bg-amber-500/15 hover:text-amber-300 ${label?.note || noteEditorKey === noteKey ? "text-amber-300" : ""}`}
                            title={label?.note ? `Note: ${label.note}` : "Add a note to this turn"}
                            aria-label={`Edit the note on turn ${ordinal}`}
                          >
                            <StickyNote size={12} />
                          </button>
                          <button
                            onClick={() => {
                              setForkError(null);
                              setForkText("");
                              setForkTurn((current) => (current === ordinal ? null : ordinal));
                            }}
                            className={`grid h-6 w-6 place-items-center rounded-[6px] transition-colors hover:bg-indigo-50 hover:text-indigo-600 ${forkTurn === ordinal ? "text-indigo-600" : ""}`}
                            title={`Fork the conversation from turn ${ordinal}`}
                            aria-label={`Fork from turn ${ordinal}`}
                          >
                            <GitBranch size={12} />
                          </button>
                        </div>
                      ) : null}
                      {ordinal !== null && noteEditorKey === noteKey ? (
                        <NotePopover
                          key={noteKey}
                          initial={label?.note ?? ""}
                          busy={noteBusy}
                          error={noteError}
                          className="left-[60px] top-[calc(100%-6px)]"
                          onCancel={() => setNoteEditorKey(null)}
                          onSave={(draft) => void saveNote(ordinal, draft, label)}
                        />
                      ) : null}
                      {forkTurn === ordinal && ordinal !== null ? (
                        <div className="mb-2 ml-[60px] rounded-[12px] border border-indigo-200 bg-indigo-50 p-3">
                          <div className="mb-2 text-xs font-medium text-indigo-700">
                            New branch from the checkpoint after {words.unit} {ordinal} — same history and state, different next line:
                          </div>
                          <div className="flex gap-2">
                            <input
                              value={forkText}
                              onChange={(event) => setForkText(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") void submitFork();
                              }}
                              className="h-9 min-w-0 flex-1 rounded-[10px] border border-indigo-200 bg-input px-3 text-[13px] text-white outline-none placeholder:text-white/30 focus:border-indigo-400"
                              placeholder="What does the caller say instead?"
                              aria-label="Caller text for the new branch"
                              autoFocus
                            />
                            <button
                              onClick={() => void submitFork()}
                              disabled={forkBusy}
                              className="h-9 rounded-[8px] bg-[#5b46c9] px-3.5 text-[13px] font-medium text-white transition-[background-color,transform] hover:bg-[#6a55d8] active:scale-[0.96] disabled:opacity-50"
                            >
                              {forkBusy ? "Forking…" : "Fork"}
                            </button>
                          </div>
                          {forkError ? <div className="mt-2 text-xs text-red-400">{forkError}</div> : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyLine label="Transcript will appear here" />
            )}
          </div>

          {stepState?.active && viewingLive && centerView === "transcript" ? (
            <div className="shrink-0 border-t border-primary/20 bg-primary/10 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="flex items-center gap-1.5 font-medium text-primary">
                  <StepForward size={13} />
                  Stepping{stepState.scenarioName ? `: ${stepState.scenarioName}` : ""}
                </span>
                <span className="text-text-secondary">
                  {words.unit} {stepState.completedTurns + 1}
                  {stepState.queue.length ? ` · ${stepState.queue.length} queued` : " · queue empty (type to add)"}
                </span>
                {stepState.checkpoint ? (
                  <span className="text-text-secondary">
                    checkpoint: {stepState.checkpoint.recentHistoryTurns} history {words.unit}(s)
                    {stepState.checkpoint.conversationState ? " + state" : ""}
                  </span>
                ) : null}
                <button
                  onClick={() => {
                    setStepError(null);
                    setStepStripOpen(true);
                  }}
                  className="data flex items-center gap-1 text-[11px] text-text-secondary transition-colors hover:text-white"
                  title="Simulated clock — open the step strip to warp it or queue an outbound message"
                >
                  <Clock3 size={12} />
                  {formatClock(stepState.virtualNow)}
                  <span className={stepState.clockOffsetMs ? "text-amber-400" : ""}>· {formatOffset(stepState.clockOffsetMs)}</span>
                </button>
                {/* Absent after an outbound seed: nothing was delivered, so nothing to check. */}
                {stepState.lastResult?.expectResults.map((expectation, index) => (
                  <span
                    key={`${expectation.action}-${index}`}
                    className={expectation.passed ? BADGE_GREEN : BADGE_RED}
                    title={expectation.passed ? undefined : `observed: ${expectation.observed.join(", ") || "none"}`}
                  >
                    {expectation.passed ? "PASS" : "FAIL"} {expectation.action}
                  </span>
                ))}
                <button
                  onClick={() => void endStep()}
                  className={`ml-auto h-7 px-2.5 text-[12px] ${SECONDARY_BUTTON}`}
                >
                  End step
                </button>
              </div>
              {stepState.queue.length ? (
                <div className={`mt-1.5 space-y-1 ${queueExpanded ? "max-h-32 overflow-auto" : ""}`}>
                  {(queueExpanded ? stepState.queue : stepState.queue.slice(0, 1)).map((turn, index) => (
                    <div key={index} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="micro w-9 shrink-0 text-text-secondary">{index === 0 ? "next" : `#${index + 1}`}</span>
                      <QueuedTurn turn={turn} youLabel={words.you} />
                      {index === 0 ? (
                        <>
                          <button
                            onClick={() => void dropQueueHead()}
                            disabled={stepState.sending}
                            className={`h-6 gap-1 px-2 text-[11px] hover:border-red-500/30 hover:text-red-400 ${SECONDARY_BUTTON}`}
                            title="Drop this queued turn without sending it"
                            aria-label="Drop the next queued turn"
                          >
                            <Trash2 size={12} />
                            Drop
                          </button>
                          {stepState.queue.length > 1 ? (
                            <button onClick={() => setQueueExpanded((open) => !open)} className="micro shrink-0 text-text-secondary transition-colors hover:text-white">
                              {queueExpanded ? "hide queue" : `+${stepState.queue.length - 1} more`}
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {stepError ? <div className="mt-1 text-xs text-red-400">{stepError}</div> : null}
            </div>
          ) : null}
          <div className={`${centerView === "tree" ? "hidden" : ""} shrink-0 border-t border-white/[0.06] p-3`}>
            <div className="flex gap-2">
              <input
                ref={callerInputRef}
                value={text}
                disabled={!viewingLive}
                readOnly={headIsAgent && !agentHeadEditable}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void sendTurn();
                }}
                className={`focus-ring h-10 min-w-0 flex-1 rounded-[10px] border px-3 text-sm disabled:cursor-not-allowed disabled:text-text-secondary ${
                  headIsAgent
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-300 placeholder:text-amber-300/50"
                    : "border-transparent bg-input text-white placeholder:text-white/30 disabled:bg-white/[0.04]"
                }`}
                placeholder={
                  !viewingLive
                    ? "Saved run is read-only"
                    : stepState?.active
                      ? stepState.queue.length
                        ? `Next scripted ${words.unit} — edit before sending`
                        : words.typeBranch
                      : words.typeNext
                }
                aria-label={headIsAgent ? "Next outbound message" : "Caller turn"}
              />
              {voiceAvailable && viewingLive ? (
                <MicToggle
                  state={voiceTarget === "caller" ? voiceState : "idle"}
                  onClick={() => void toggleDictation("caller")}
                />
              ) : null}
              <button
                onClick={sendTurn}
                disabled={!viewingLive || (stepState?.active && stepState.sending)}
                className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-primary text-white transition-[background-color,transform] hover:bg-primary/90 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40"
                title={headIsAgent ? "Seed the outbound message" : stepState?.active ? "Send next step" : "Send turn"}
                aria-label={headIsAgent ? "Seed the outbound message" : stepState?.active ? "Send next step" : "Send turn"}
              >
                {headIsAgent ? <Megaphone size={16} /> : stepState?.active ? <StepForward size={16} /> : <Send size={16} />}
              </button>
            </div>
            {headIsAgent ? (
              <div className="micro mt-1.5 flex items-center gap-2 text-amber-400">
                <Megaphone size={11} aria-hidden="true" />
                outbound message — press Send to seed it
                {!agentHeadEditable ? (
                  <button
                    onClick={() => {
                      setAgentHeadEditable(true);
                      callerInputRef.current?.focus();
                    }}
                    className="micro text-text-secondary underline-offset-2 hover:text-white hover:underline"
                  >
                    edit
                  </button>
                ) : null}
              </div>
            ) : null}
            {voiceError && voiceTarget !== "fork" ? <div className="mt-1 text-xs text-red-400">{voiceError}</div> : null}
            {voiceAvailable && viewingLive && !voiceError && !headIsAgent ? (
              <div className={`micro mt-1.5 ${voiceState === "recording" ? "text-red-400" : voiceState === "transcribing" ? "text-primary" : "text-text-dim"}`}>
                {voiceState === "recording"
                  ? "recording — release space (or click stop) to send"
                  : voiceState === "transcribing"
                    ? "transcribing…"
                    : "hold space to talk · release to send"}
              </div>
            ) : null}
          </div>
        </section>

        <aside className="space-y-4 xl:min-h-0 xl:overflow-auto xl:pr-1">
          <section className={`overflow-hidden ${PANEL}`}>
            <PanelHeader icon={<Square size={16} />} title="Request" meta={selected?.event ?? ""} />
            <PayloadBlock value={selected ? { headers: selected.request.headers, body: selected.request.body } : null} />
            {selected ? (
              <div className="border-t border-white/[0.06] p-3">
                <button
                  onClick={() => setReplayOpen((open) => !open)}
                  className={`h-9 w-full gap-2 text-[13px] ${SECONDARY_BUTTON}`}
                >
                  <RefreshCw size={15} />
                  Edit and replay
                </button>
                {replayOpen ? (
                  <div className="mt-3 space-y-3">
                    <textarea
                      value={replayBody}
                      onChange={(event) => setReplayBody(event.target.value)}
                      className="focus-ring h-48 w-full resize-y rounded-[12px] border border-white/[0.06] bg-[#111] p-3 font-mono text-[12px] leading-5 text-text"
                      aria-label="Replay request body"
                      spellCheck={false}
                    />
                    <label className="flex items-center gap-2 text-[12px] text-text-secondary">
                      <input type="checkbox" className="accent-[#26b65a]" checked={preserveWebhookId} onChange={(event) => setPreserveWebhookId(event.target.checked)} />
                      Preserve webhook ID
                    </label>
                    <label className="flex items-center gap-2 text-[12px] text-text-secondary">
                      <input type="checkbox" className="accent-[#26b65a]" checked={preserveTimestamp} onChange={(event) => setPreserveTimestamp(event.target.checked)} />
                      Preserve timestamp
                    </label>
                    {replayError ? <div className="text-xs text-red-400">{replayError}</div> : null}
                    <button
                      onClick={() => void replayDelivery()}
                      disabled={replayBusy}
                      className={`h-9 w-full text-sm ${SUBMIT_BUTTON}`}
                    >
                      {replayBusy ? "Replaying…" : "Send replay"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className={`overflow-hidden ${PANEL}`}>
            <PanelHeader icon={<CheckCircle2 size={16} />} title="Response" meta={selected ? String(selected.response.status) : ""} />
            <PayloadBlock value={selected ? { status: selected.response.status, headers: selected.response.headers, parsed: selected.response.parsed, rawBody: selected.response.rawBody } : null} />
          </section>

          {session?.callEnded && session.channel === "voice" ? (
            <section className={`overflow-hidden ${PANEL}`}>
              <PanelHeader icon={<PhoneOff size={16} />} title="Call Ended" meta={`${session.callEnded.durationSeconds}s`} />
              <div className="space-y-2 p-4 text-sm">
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
            <section className="overflow-hidden rounded-[18px] border border-amber-500/20 bg-amber-500/10">
              <PanelHeader icon={<AlertTriangle size={16} />} title="Warnings" meta={String(session.warnings.length)} />
              <ul className="space-y-2 p-4 text-sm text-amber-300">
                {session.warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {session?.logs?.length ? (
            <section className={`overflow-hidden ${PANEL}`}>
              <PanelHeader icon={<Clock3 size={16} />} title="Run log" meta={String(session.logs.length)} />
              <ul className="space-y-2 p-4 text-sm text-text-subtle">
                {session.logs.map((entry, index) => (
                  <li key={`${entry}-${index}`}>{entry}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function PanelHeader({ icon, title, meta }: { icon: React.ReactNode; title: string; meta?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
      <div className="micro flex items-center gap-2 text-text-secondary">
        <span className="text-text-dim [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        {title}
      </div>
      {meta ? <span className="data max-w-[180px] truncate text-[11px] text-text-dim">{meta}</span> : null}
    </div>
  );
}

function ViewTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`focus-ring flex items-center justify-center gap-2 rounded-[6px] px-3 py-1.5 text-[13px] leading-none transition-colors [&>svg]:h-3.5 [&>svg]:w-3.5 ${active ? "bg-white/10 font-medium text-white" : "text-white/50 hover:text-white/80"}`}
    >
      {icon}
      {label}
    </button>
  );
}

function PayloadBlock({ value }: { value: unknown | null }) {
  return (
    <pre className="console-pane max-h-[270px] min-h-[150px] overflow-auto px-4 py-3 text-[12px] leading-5">
      {tokenizeJson(value ? JSON.stringify(value, null, 2) : "null")}
    </pre>
  );
}

// Minimal JSON tinting via React spans (no innerHTML): keys green, strings
// light, numbers/keywords amber, punctuation dim.
const JSON_TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g;

function tokenizeJson(json: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of json.matchAll(JSON_TOKEN)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(<span key={index++} style={{ color: "#8b897f" }}>{json.slice(cursor, start)}</span>);
    if (match[1] !== undefined) {
      nodes.push(<span key={index++} style={{ color: "#8fd694" }}>{match[1]}</span>);
      nodes.push(<span key={index++} style={{ color: "#8b897f" }}>{match[2]}</span>);
    } else if (match[3] !== undefined) {
      nodes.push(<span key={index++}>{match[3]}</span>);
    } else {
      nodes.push(<span key={index++} style={{ color: "#e0b16b" }}>{match[0]}</span>);
    }
    cursor = start + match[0].length;
  }
  if (cursor < json.length) nodes.push(<span key={index++} style={{ color: "#8b897f" }}>{json.slice(cursor)}</span>);
  return nodes;
}

function ScenarioCard({ result }: { result: NonNullable<InspectorSession["scenarioResult"]> }) {
  return (
    <section className={`overflow-hidden ${PANEL}`}>
      <PanelHeader
        icon={result.passed ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
        title="Scenario"
        meta={result.passed ? "passed" : `${result.failedCount} failed`}
      />
      <ul className="space-y-2 p-4 text-xs leading-5">
        {result.assertions.map((assertion, index) => (
          <li key={`${assertion.kind}-${assertion.turnIndex ?? "final"}-${index}`} className="flex gap-2">
            <span className={`data shrink-0 font-medium ${assertion.passed ? "text-primary" : "text-red-400"}`}>{assertion.passed ? "PASS" : "FAIL"}</span>
            <span className="text-text-subtle">{assertion.message}</span>
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
    <section className={`overflow-hidden ${PANEL}`}>
      <PanelHeader icon={<Scale size={16} />} title="Baseline" meta={comparison ? (comparison.passed ? "passed" : "regressed") : session.baseline?.name} />
      <div className="space-y-3 p-4 text-sm">
        <select
          value={baselineId}
          onChange={(event) => onBaselineChange(event.target.value)}
          className={`h-9 w-full ${INPUT}`}
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
          className={`h-9 w-full text-sm ${SUBMIT_BUTTON}`}
        >
          Compare current run
        </button>
        {comparison ? (
          <div className="space-y-2">
            <div className={`font-semibold ${comparison.passed ? "text-primary" : "text-red-400"}`}>
              {comparison.passed ? "No regressions" : `${comparison.regressions.length} regression(s)`}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <KeyValue name="latency delta" value={`${comparison.latency.deltaMs}ms`} />
              <KeyValue name="missing actions" value={comparison.actions.missing.join(", ") || "none"} />
              <KeyValue name="transcript" value={comparison.transcript.changed ? "changed" : "same"} />
              <KeyValue name="new warnings" value={String(comparison.warnings.added.length)} />
            </div>
            {comparison.regressions.length ? (
              <ul className="space-y-1 text-xs leading-5 text-red-400">
                {comparison.regressions.map((regression) => <li key={regression}>{regression}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Push-to-talk toggle: mic → red stop while recording → spinner while transcribing. */
function MicToggle({ state, onClick, small }: { state: "idle" | "recording" | "transcribing"; onClick: () => void; small?: boolean }) {
  const size = small ? "h-9 w-9" : "h-10 w-10";
  return (
    <button
      onClick={onClick}
      disabled={state === "transcribing"}
      className={`focus-ring grid ${size} shrink-0 place-items-center rounded-[10px] border transition-colors ${
        state === "recording"
          ? "border-red-500/30 bg-red-500/15 text-red-400"
          : "border-surface-border bg-white/[0.03] text-white/70 hover:bg-white/[0.06] hover:text-white"
      } disabled:opacity-60`}
      title={state === "recording" ? "Stop recording" : state === "transcribing" ? "Transcribing…" : "Dictate this turn (local transcription)"}
      aria-label={state === "recording" ? "Stop recording" : "Dictate caller turn"}
    >
      {state === "recording" ? <Square size={14} fill="currentColor" /> : state === "transcribing" ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
    </button>
  );
}

/** One queued step: a caller line or an outbound business message, with its delay and expectations. */
function QueuedTurn({ turn, youLabel = "caller" }: { turn: StepQueueTurn; youLabel?: string }) {
  const outbound = turn.agent !== undefined;
  const content = turn.agent ?? turn.caller ?? "";
  return (
    <>
      {outbound ? (
        <span
          className="micro flex shrink-0 items-center gap-1 rounded border border-amber-500/20 bg-amber-500/15 px-1.5 py-0.5 text-amber-400"
          title="Outbound business message — seeded into history, no webhook delivery"
        >
          <Megaphone size={10} aria-hidden="true" />
          outbound
        </span>
      ) : (
        <span className="micro shrink-0 text-primary">{youLabel}</span>
      )}
      <span className={`min-w-[8rem] flex-1 truncate ${outbound ? "text-amber-300" : "text-text"}`} title={content}>
        {content}
      </span>
      {turn.edited ? <span className="micro shrink-0 text-text-secondary">edited</span> : null}
      {turn.after !== undefined ? (
        <span className="data shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-text-subtle" title="The simulated clock advances this much before the turn is sent">
          after {formatAfter(turn.after)}
        </span>
      ) : null}
      {turn.expect ? <ExpectChips expect={turn.expect} /> : null}
    </>
  );
}

/** What the step debugger will check on this turn's reply. */
function ExpectChips({ expect }: { expect: StepExpect }) {
  const chip = "data shrink-0 rounded px-1.5 py-0.5 text-[10px]";
  return (
    <>
      {(expect.actions ?? []).map((action) => (
        <span key={`a-${action}`} className={`${chip} bg-primary/15 text-primary`} title="Expected action">
          {action}
        </span>
      ))}
      {(expect.forbiddenActions ?? []).map((action) => (
        <span key={`f-${action}`} className={`${chip} bg-red-500/15 text-red-400`} title="Forbidden action">
          no {action}
        </span>
      ))}
      {expect.replyMatches !== undefined ? (
        <span className={`${chip} max-w-[12rem] truncate bg-white/[0.06] text-text-subtle`} title={`Reply must match /${expect.replyMatches}/i`}>
          /{expect.replyMatches}/
        </span>
      ) : null}
    </>
  );
}

/** Small anchored editor for a turn's free-text note. Escape cancels, ⌘/Ctrl+Enter saves. */
function NotePopover({
  initial,
  busy,
  error,
  className,
  onSave,
  onCancel
}: {
  initial: string;
  busy: boolean;
  error: string | null;
  className: string;
  onSave: (draft: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <div
      role="dialog"
      aria-label="Turn note"
      className={`absolute z-20 w-72 rounded-[12px] border border-surface-border bg-surface p-3 shadow-modal ${className}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onSave(draft);
        }
      }}
    >
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="focus-ring h-20 w-full resize-y rounded-[10px] bg-input p-2.5 text-xs leading-5 text-white placeholder:text-white/30"
        placeholder="Why is this turn good or bad? (empty clears the note)"
        aria-label="Note"
        autoFocus
      />
      {error ? <div className="mt-1 text-[11px] text-red-400">{error}</div> : null}
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <span className="micro mr-auto text-text-dim">esc to close</span>
        <button onClick={onCancel} className="h-7 rounded-[8px] px-2.5 text-[12px] text-text-dim transition-colors hover:text-white">
          Cancel
        </button>
        <button
          onClick={() => onSave(draft)}
          disabled={busy}
          className={`h-7 px-3 text-[12px] ${SUBMIT_BUTTON}`}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function KeyValue({ name, value }: { name: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-white/[0.06] bg-white/[0.04] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-text-secondary">{name}</div>
      <div className="mt-1 break-words text-sm text-text">{value}</div>
    </div>
  );
}

function EmptyLine({ label }: { label: string }) {
  return <div className="grid min-h-[160px] place-items-center text-sm text-text-secondary">{label}</div>;
}

function formatRunDate(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function channelLabel(channel: string): string {
  return CHANNEL_OPTIONS.find((option) => option.value === channel)?.label ?? channel;
}

/** Simulated wall-clock time, with the weekday since warps usually span days. */
function formatClock(timestamp: string): string {
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(at);
}

/** Clock offset as its two largest units ("+2d 3h"); zero reads "real time". */
function formatOffset(offsetMs: number): string {
  if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) < 1000) return "real time";
  return `${offsetMs < 0 ? "-" : "+"}${formatDuration(Math.abs(offsetMs))}`;
}

function formatDuration(ms: number): string {
  const units: Array<[string, number]> = [
    ["d", 86_400_000],
    ["h", 3_600_000],
    ["m", 60_000],
    ["s", 1000]
  ];
  const parts: string[] = [];
  let rest = ms;
  for (const [unit, size] of units) {
    const count = Math.floor(rest / size);
    if (count > 0) {
      parts.push(`${count}${unit}`);
      rest -= count * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ") || `${ms}ms`;
}

/** Scenario `after` is a duration string ("2h") or milliseconds. */
function formatAfter(after: string | number): string {
  return typeof after === "number" ? formatDuration(after) : after;
}

/** Scenario listings grouped by folder, in the server's (path-sorted) order. */
function groupScenarios(listings: ScenarioListing[]): Array<[string, ScenarioListing[]]> {
  const groups = new Map<string, ScenarioListing[]>();
  for (const listing of listings) groups.set(listing.group, [...(groups.get(listing.group) ?? []), listing]);
  return [...groups];
}

/** "examples/messaging" → "Messaging", ".agentphone-devtools/exports" → "Exports". */
function groupLabel(group: string): string {
  const leaf = group.split("/").filter(Boolean).at(-1) ?? group;
  return leaf.charAt(0).toUpperCase() + leaf.slice(1);
}

/** All run ids connected to `anchorId` through forkedFrom links, in either direction. */
function collectFamilyIds(anchorId: string, runs: InspectorSessionSummary[]): string[] {
  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
  };
  for (const run of runs) {
    if (run.forkedFrom?.sessionId) link(run.forkedFrom.sessionId, run.id);
  }
  const seen = new Set<string>([anchorId]);
  const queue = [anchorId];
  while (queue.length) {
    for (const next of adjacency.get(queue.shift()!) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen];
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
    deliveries: session.deliveries.length,
    ...(session.contact ? { contact: session.contact } : {})
  };
}
