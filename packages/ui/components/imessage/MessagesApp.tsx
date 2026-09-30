"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { Contact, InspectorSession, StepState } from "@/lib/types";
import { buildTurnForest, flattenForest, type TurnNode } from "@/components/ConversationTree";
import { formatDateTime, formatPhone } from "@/components/dashboard/ui";
import { SimulatorRail, type FamilyRow, type RailProps } from "./SimulatorRail";
import { ThreadList } from "./ThreadList";
import { preferredChannel, ThreadView, type DraftState, type ThreadContact } from "./ThreadView";
import { useRunSessions } from "./useRunSessions";
import {
  buildThreadGroups,
  collectFamilyIds,
  countUserTurns,
  forkLabel,
  isFailed,
  latestOpener,
  sessionConversationState,
  sessionFromNumber,
  toThreadChannel,
  turnDeliveries,
  type ThreadChannel,
  type ThreadRow
} from "./model";

type Selection = { kind: "run"; id: string } | ({ kind: "draft" } & DraftState);

const RAIL_KEY = "agentphone-devtools.imessage.rail";

/**
 * The iMessage tab: a Messages.app-style window over the simulator. The
 * view is the customer's phone; the business on the other end is the
 * developer's webhook handler. The step controller is the engine, so the
 * live thread is the stepped session, and every fork, clock warp and
 * outbound campaign send goes through the same endpoints the Inspector uses.
 */
export function MessagesApp() {
  const { connected, session, runs, step, voice, contacts, refreshStep } = useLive();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [query, setQuery] = useState("");
  const [railOpen, setRailOpen] = useState(true);
  const [highlight, setHighlight] = useState<{ ordinal: number; nonce: number } | null>(null);
  const [looseSend, setLooseSend] = useState<{ text: string; base: number; id: string } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const initRef = useRef(false);
  const pendingContactRef = useRef<string | null>(null);

  // ── Selection + URL ────────────────────────────────────────────────────────
  const writeUrl = useCallback((runId: string | null) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("contact");
      if (runId) url.searchParams.set("session", runId);
      else url.searchParams.delete("session");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* ignore */
    }
  }, []);

  const selectRun = useCallback(
    (id: string) => {
      initRef.current = true;
      setHighlight(null);
      setBanner(null);
      setSelection({ kind: "run", id });
      writeUrl(id);
    },
    [writeUrl]
  );

  const openDraft = useCallback(
    (draft: DraftState) => {
      initRef.current = true;
      setHighlight(null);
      setSelection({ kind: "draft", ...draft });
      writeUrl(null);
    },
    [writeUrl]
  );

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(RAIL_KEY);
      if (stored) setRailOpen(stored !== "closed");
      else if (window.innerWidth < 1200) setRailOpen(false);
    } catch {
      /* ignore */
    }
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session");
    const contactId = params.get("contact");
    if (sessionId) {
      initRef.current = true;
      setSelection({ kind: "run", id: sessionId });
    } else if (contactId) {
      initRef.current = true;
      pendingContactRef.current = contactId;
    }
    const timer = window.setTimeout(() => setSettled(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  const toggleRail = useCallback(() => {
    setRailOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(RAIL_KEY, next ? "open" : "closed");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // ── Derived state ──────────────────────────────────────────────────────────
  const stepLiveId = step?.active ? step.sessionId : null;
  const liveDotId =
    stepLiveId ?? (session && session.status !== "ended" && session.channel !== "voice" && session.transcript.length > 0 ? session.id : null);

  const groups = useMemo(
    () => buildThreadGroups({ runs, contacts, liveId: liveDotId, stepLiveId, query }),
    [runs, contacts, liveDotId, stepLiveId, query]
  );

  const selectedRunId = selection?.kind === "run" ? selection.id : null;
  const familyIds = useMemo(() => (selectedRunId ? collectFamilyIds(selectedRunId, runs) : []), [selectedRunId, runs]);
  const { sessions, missing } = useRunSessions(familyIds, runs, session);
  const selectedSession: InspectorSession | null = selectedRunId ? sessions[selectedRunId] ?? null : null;
  const selectedSummary = selectedRunId ? runs.find((run) => run.id === selectedRunId) : undefined;

  const isStepLive = Boolean(selectedRunId && selectedRunId === stepLiveId);
  const isLooseLive = Boolean(
    selectedRunId && !isStepLive && !step?.active && session && selectedRunId === session.id && session.status !== "ended"
  );
  const ended = selectedSession?.status === "ended";
  const composableRun = (isStepLive || isLooseLive) && !ended;
  const threadChannel: ThreadChannel =
    selection?.kind === "draft" ? selection.channel : toThreadChannel(selectedSession?.channel ?? selectedSummary?.channel);

  const contactRecord: Contact | undefined = useMemo(() => {
    const id = selection?.kind === "draft" ? selection.contactId : selectedSession?.contact?.id ?? selectedSummary?.contact?.id;
    return id ? contacts.find((candidate) => candidate.id === id) : undefined;
  }, [selection, selectedSession, selectedSummary, contacts]);

  const threadContact: ThreadContact | null = useMemo(() => {
    if (selection?.kind === "draft") {
      return contactRecord ? { id: contactRecord.id, name: contactRecord.name, number: contactRecord.number } : null;
    }
    if (!selectedSession && !selectedSummary) return null;
    if (contactRecord) return { id: contactRecord.id, name: contactRecord.name, number: contactRecord.number };
    const snapshot = selectedSession?.contact ?? selectedSummary?.contact;
    if (snapshot) return { id: snapshot.id, name: snapshot.name, number: snapshot.number };
    const from = selectedSession ? sessionFromNumber(selectedSession) : undefined;
    return { name: from ? formatPhone(from) : "Unknown number", number: from, unknown: true };
  }, [selection, contactRecord, selectedSession, selectedSummary]);

  const userCount = countUserTurns(selectedSession);
  const queueHead = step?.queue[0];
  const stepSendingCaller = Boolean(isStepLive && step?.sending && queueHead?.caller !== undefined);
  const awaitingStepReply = stepSendingCaller && userCount === (step?.completedTurns ?? -1);
  const awaitingLooseReply = Boolean(looseSend && looseSend.id === selectedRunId && userCount === looseSend.base);
  const optimistic = awaitingStepReply ? queueHead?.caller ?? null : awaitingLooseReply ? looseSend?.text ?? null : null;
  const typing = awaitingStepReply || awaitingLooseReply;
  const engineBusy = Boolean(step?.sending) || Boolean(looseSend);

  // ── Deep link: ?contact=ID opens (or reuses) a live thread ─────────────────
  useEffect(() => {
    const contactId = pendingContactRef.current;
    if (!contactId || !step) return;
    pendingContactRef.current = null;
    if (step.active && step.sessionId && step.contact?.id === contactId && step.channel !== "voice") {
      selectRun(step.sessionId);
      return;
    }
    void (async () => {
      try {
        const list = await api.get<Contact[]>("/api/contacts");
        const contact = list.find((candidate) => candidate.id === contactId);
        if (!contact) {
          openDraft({ compose: true, contactId: null, channel: "imessage" });
          setBanner("That contact no longer exists. Pick another recipient.");
          return;
        }
        const state = await api.post<StepState>("/api/step/start", { contactId: contact.id, channel: preferredChannel(contact.channel) });
        if (state.sessionId) selectRun(state.sessionId);
      } catch (failure) {
        setBanner(errorMessage(failure));
      }
    })();
  }, [step, selectRun, openDraft]);

  // ── First load: open the live thread, else the most recent one ─────────────
  useEffect(() => {
    if (initRef.current || selection) return;
    if (!step || (!runs.length && !settled)) return;
    initRef.current = true;
    if (stepLiveId && step.channel !== "voice") {
      selectRun(stepLiveId);
      return;
    }
    const first = groups.flatMap((group) => group.rows).find((row) => row.kind === "run");
    if (first) selectRun(first.id);
  }, [step, runs, settled, selection, groups, stepLiveId, selectRun]);

  // ── Actions ────────────────────────────────────────────────────────────────
  async function startConversation(contactId: string | null, channel: ThreadChannel): Promise<string> {
    const state = await api.post<StepState>("/api/step/start", contactId ? { contactId, channel } : { blank: true, channel });
    if (!state.sessionId) throw new Error("The simulator did not open a conversation.");
    selectRun(state.sessionId);
    return state.sessionId;
  }

  /** Customer text through the step engine: flush queued business sends, then add/edit the head and send it. */
  async function sendThroughStep(text: string) {
    let current = await api.get<StepState>("/api/step");
    if (current.sending) throw new Error("Still waiting on the last reply.");
    if (text) {
      while (current.queue[0]?.agent !== undefined) current = await api.post<StepState>("/api/step/send");
      const head = current.queue[0];
      if (!head) await api.post("/api/step/add", { caller: text });
      else if (head.caller !== text) await api.post("/api/step/edit", { caller: text });
    } else if (!current.queue.length) {
      return;
    }
    await api.post("/api/step/send");
  }

  async function sendCustomer(text: string) {
    const current = selection;
    if (!current) return;
    if (current.kind === "draft") {
      if (!text) return;
      if (!current.contactId && contacts.length) throw new Error("Choose a recipient first.");
      await startConversation(current.contactId, current.channel);
      // The draft composer is gone now; report later failures on the thread.
      try {
        await api.post("/api/step/add", { caller: text });
        await api.post("/api/step/send");
      } catch (failure) {
        setBanner(`Conversation started, but the message was not sent: ${errorMessage(failure)}`);
      }
      return;
    }
    if (isStepLive) {
      await sendThroughStep(text);
      return;
    }
    if (isLooseLive && selectedSession) {
      if (!text) return;
      setLooseSend({ text, base: countUserTurns(selectedSession), id: selectedSession.id });
      try {
        await api.post("/api/send", { text, channel: selectedSession.channel });
      } finally {
        setLooseSend(null);
      }
      return;
    }
    throw new Error("This conversation is read-only. Fork from a message to continue it.");
  }

  async function forkThread(sourceId: string, turnIndex: number, caller: string, advance?: string) {
    const state = await api.post<StepState>("/api/step/fork", { sessionId: sourceId, turnIndex, ...(caller ? { caller } : {}) });
    if (state.sessionId) selectRun(state.sessionId);
    // The branch is open (and the fork popover closed); report later failures on the thread.
    try {
      if (advance) await api.post("/api/clock/advance", { duration: advance });
      if (caller) await api.post("/api/step/send");
    } catch (failure) {
      setBanner(`Branch created, but the first message was not sent: ${errorMessage(failure)}`);
    }
  }

  async function quickReply(text: string, advance?: string) {
    if (!selectedSession) return;
    const opener = latestOpener(selectedSession);
    if (!opener) throw new Error("This thread has no campaign opener to branch from.");
    if (composableRun && opener.repliesAfter === 0) {
      if (advance) await api.post("/api/clock/advance", { duration: advance });
      await sendCustomer(text);
      return;
    }
    await forkThread(selectedSession.id, opener.forkPoint, text, advance);
  }

  async function seedBusiness(text: string) {
    if (selection?.kind === "draft") {
      await startConversation(selection.contactId, selection.channel);
    } else if (!composableRun) {
      throw new Error("This run is saved. Start a new conversation, or fork this one, to send.");
    }
    await api.post("/api/seed-agent-message", { text, channel: threadChannel });
  }

  async function endConversation() {
    if (isStepLive) await api.post("/api/step/end");
    else if (isLooseLive) await api.post("/api/end-call");
  }

  async function startNewWithContact() {
    const contactId = threadContact?.id && contacts.some((candidate) => candidate.id === threadContact.id) ? threadContact.id : null;
    await startConversation(contactId, threadChannel);
  }

  async function startDraft() {
    if (selection?.kind !== "draft") return;
    await startConversation(selection.contactId, selection.channel);
  }

  async function advanceClock(duration: string) {
    await api.post("/api/clock/advance", { duration });
    void refreshStep();
  }

  function onSelectRow(row: ThreadRow) {
    if (row.kind === "run") selectRun(row.id);
    else openDraft({ compose: false, contactId: row.id, channel: row.channel });
  }

  function newMessage() {
    openDraft({ compose: true, contactId: null, channel: "imessage" });
  }

  // ── Branch family (rail) ───────────────────────────────────────────────────
  const familySessions = useMemo(
    () => familyIds.map((id) => sessions[id]).filter((candidate): candidate is InspectorSession => Boolean(candidate)),
    [familyIds, sessions]
  );
  // When the original run opens with a campaign send, every "from the
  // opener" fork shares it: show it as one root so the archetype branches
  // visibly fan out of a single outbound message.
  const roots = useMemo(() => {
    const forest = buildTurnForest(familySessions);
    const origin = familySessions.find((candidate) => !candidate.forkedFrom);
    if (!origin || !(origin.outboundSeeds ?? []).includes(0)) return forest;
    const opener: TurnNode = {
      key: `${origin.id}:opener`,
      runId: origin.id,
      turnNumber: 0,
      caller: "Campaign opener · via API",
      agentReply: origin.transcript[0]?.content ?? "",
      actions: [],
      failed: false,
      runIds: familySessions.map((candidate) => candidate.id),
      children: forest
    };
    return [opener];
  }, [familySessions]);
  const selectedNodeKey = useMemo(() => {
    if (!selectedRunId) return null;
    const nodes = flattenForest(roots).filter((node) => node.runIds.includes(selectedRunId));
    if (highlight) {
      const hit = nodes.find((node) => node.turnNumber === highlight.ordinal);
      if (hit) return hit.key;
    }
    return nodes.sort((a, b) => b.turnNumber - a.turnNumber)[0]?.key ?? null;
  }, [roots, selectedRunId, highlight]);

  function onSelectNode(node: TurnNode) {
    if (selectedRunId && node.runIds.includes(selectedRunId)) {
      if (node.turnNumber > 0) setHighlight({ ordinal: node.turnNumber, nonce: Date.now() });
    }
    else selectRun(node.runId);
  }

  const familyRows: FamilyRow[] = useMemo(() => {
    return familyIds
      .map((id) => {
        const summary = runs.find((run) => run.id === id);
        const full = sessions[id];
        const forkedFrom = full?.forkedFrom ?? summary?.forkedFrom;
        const callers = full ? full.transcript.filter((turn) => turn.role === "user") : [];
        const firstNew = forkedFrom ? callers[forkedFrom.turnIndex]?.content : undefined;
        const failed = full ? turnDeliveries(full).some((delivery) => !delivery.inheritedFrom && isFailed(delivery)) : false;
        const started = full?.startedAt ?? summary?.startedAt ?? "";
        return {
          started,
          row: {
            id,
            title: forkedFrom ? (firstNew ? `“${firstNew}”` : "Branch · no reply yet") : "Original",
            subtitle: forkedFrom ? `Branch ${forkLabel(forkedFrom)}` : `Started ${formatDateTime(started)}`,
            turns: callers.length,
            status: failed ? false : summary?.scenarioPassed ?? full?.scenarioResult?.passed ?? null,
            live: id === liveDotId,
            selected: id === selectedRunId,
            forked: Boolean(forkedFrom)
          } satisfies FamilyRow
        };
      })
      .sort((a, b) => a.started.localeCompare(b.started))
      .map((entry) => entry.row);
  }, [familyIds, runs, sessions, liveDotId, selectedRunId]);

  // ── Rail inputs ────────────────────────────────────────────────────────────
  let conversationState: unknown = null;
  let stateSource: RailProps["stateSource"] = null;
  if (selection?.kind === "draft") {
    conversationState = contactRecord?.conversationState ?? null;
    stateSource = contactRecord ? "contact" : null;
  } else if (isStepLive && step?.checkpoint) {
    conversationState = step.checkpoint.conversationState;
    stateSource = "live";
  } else if (selectedSession) {
    const fromPayload = sessionConversationState(selectedSession);
    if (fromPayload !== undefined) {
      conversationState = fromPayload;
      stateSource = "run";
    } else if (contactRecord) {
      conversationState = contactRecord.conversationState;
      stateSource = "contact";
    }
  }

  const seedEnabled = selection?.kind === "draft" ? Boolean(selection.contactId) || contacts.length === 0 : composableRun;
  const seedHint = !selection
    ? "Pick or start a conversation first."
    : selection.kind === "draft"
      ? "Choose a recipient first."
      : ended
        ? "This conversation ended. Start a new one, or fork it, to send."
        : "This run is saved. Start a new conversation, or fork this one, to send.";

  const opener = selection?.kind === "run" ? latestOpener(selectedSession) : null;
  const exportName = (() => {
    const name = threadContact?.name ?? "Conversation";
    const firstNew = selectedSession?.forkedFrom
      ? selectedSession.transcript.filter((turn) => turn.role === "user")[selectedSession.forkedFrom.turnIndex]?.content
      : undefined;
    return `${name} ${firstNew ? `- ${firstNew}` : "conversation"}`.slice(0, 60);
  })();

  const mode = !selection
    ? "empty"
    : selection.kind === "draft"
      ? "draft"
      : selectedSession
        ? "run"
        : missing.has(selection.id) && connected
          ? "missing"
          : "loading";

  const composingRow =
    selection?.kind === "draft" && selection.compose ? { name: contactRecord?.name, channel: selection.channel } : null;
  const selectedKey =
    selection?.kind === "run" ? `run:${selection.id}` : selection?.kind === "draft" && !selection.compose && selection.contactId ? `draft:${selection.contactId}` : null;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <ThreadList
        groups={groups}
        selectedKey={selectedKey}
        query={query}
        onQuery={setQuery}
        onSelect={onSelectRow}
        onNew={newMessage}
        composing={composingRow}
        connected={connected}
      />

      <ThreadView
        connected={connected}
        banner={banner}
        onDismissBanner={() => setBanner(null)}
        mode={mode}
        session={selectedSession}
        sourceSession={selectedSession?.forkedFrom ? sessions[selectedSession.forkedFrom.sessionId] : undefined}
        contact={threadContact}
        channel={threadChannel}
        stepLive={isStepLive}
        live={isStepLive || isLooseLive}
        ended={ended}
        composable={composableRun}
        sending={engineBusy}
        typing={typing}
        optimistic={optimistic}
        queued={isStepLive && !step?.sending ? queueHead ?? null : null}
        lastResult={step?.lastResult}
        highlight={highlight}
        familyCount={familyIds.length}
        railOpen={railOpen}
        voiceAvailable={voice.available}
        draft={selection?.kind === "draft" ? { compose: selection.compose, contactId: selection.contactId, channel: selection.channel } : null}
        contacts={contacts}
        onToggleRail={toggleRail}
        onEnd={endConversation}
        onSend={sendCustomer}
        onSkipQueued={async () => {
          await api.post("/api/step/drop");
        }}
        onFork={async (turnIndex, caller) => {
          if (!selectedSession) return;
          await forkThread(selectedSession.id, turnIndex, caller);
        }}
        onSelectRun={selectRun}
        onNewMessage={newMessage}
        onStartNew={startNewWithContact}
        onDraftChange={(next) => openDraft(next)}
        onStartDraft={startDraft}
      />

      {railOpen ? (
        <SimulatorRail
          onClose={toggleRail}
          contact={threadContact}
          contactNotes={contactRecord?.notes}
          channel={threadChannel}
          conversationState={conversationState}
          stateSource={stateSource}
          clockOffsetMs={step?.clockOffsetMs ?? session?.clockOffsetMs ?? 0}
          onAdvanceClock={advanceClock}
          engineBusy={engineBusy}
          seed={{ enabled: seedEnabled, hint: seedHint, onSeed: seedBusiness }}
          quick={{
            opener: opener ? { text: opener.text } : null,
            direct: Boolean(opener && composableRun && opener.repliesAfter === 0),
            onQuickReply: quickReply
          }}
          family={
            selectedRunId
              ? {
                  roots,
                  rows: familyRows,
                  liveSessionId: stepLiveId ?? liveDotId,
                  selectedKey: selectedNodeKey,
                  onSelectNode,
                  onSelectRun: selectRun
                }
              : null
          }
          checks={
            selectedRunId
              ? {
                  results: isStepLive ? step?.lastResult?.expectResults : undefined,
                  turnNumber: isStepLive ? step?.lastResult?.turnNumber : undefined,
                  scenario: selectedSession?.scenarioResult
                }
              : null
          }
          exportRun={selectedRunId && selectedSession && selectedSession.transcript.length > 0 ? { id: selectedRunId, defaultName: exportName } : null}
        />
      ) : null}
    </div>
  );
}
