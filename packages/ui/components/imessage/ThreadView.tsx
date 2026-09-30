"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, GitBranch, Loader2, Lock, Megaphone, MessageCircle, PanelRightClose, PanelRightOpen, SquarePen, X } from "lucide-react";
import { errorMessage } from "@/lib/api";
import type { Contact, InspectorSession, StepExpectResult, StepQueueTurn, StepState } from "@/lib/types";
import { Avatar, ChannelBadge, formatPhone } from "@/components/dashboard/ui";
import { BubbleShape, DateSeparator, DeliveredLabel, ForkButton, ForkPopover, ReplyMeta, TypingBubble, type ForkMode } from "./Bubbles";
import { ComposeBar } from "./ComposeBar";
import {
  AGENT_BUBBLE,
  buildBubbles,
  CHANNEL_ORDER,
  CHANNELS,
  failureText,
  firstName,
  forkBoundary,
  forkLabel,
  observedActions,
  SEPARATOR_GAP_MS,
  THREAD_BG,
  timeOf,
  toThreadChannel,
  type Bubble,
  type ThreadChannel
} from "./model";

export interface ThreadContact {
  id?: string;
  name: string;
  number?: string;
  /** No contact record: the number came from the payload. */
  unknown?: boolean;
}

export interface DraftState {
  /** Opened from the pen button: show the To: field. */
  compose: boolean;
  contactId: string | null;
  channel: ThreadChannel;
}

export function ThreadView(props: {
  connected: boolean;
  banner?: string | null;
  onDismissBanner?: () => void;
  mode: "empty" | "missing" | "loading" | "run" | "draft";
  session: InspectorSession | null;
  sourceSession?: InspectorSession;
  contact: ThreadContact | null;
  channel: ThreadChannel;
  stepLive: boolean;
  live: boolean;
  ended: boolean;
  composable: boolean;
  sending: boolean;
  typing: boolean;
  optimistic: string | null;
  queued: StepQueueTurn | null;
  lastResult?: StepState["lastResult"];
  highlight: { ordinal: number; nonce: number } | null;
  familyCount: number;
  railOpen: boolean;
  voiceAvailable: boolean;
  draft: DraftState | null;
  contacts: Contact[];
  onToggleRail: () => void;
  onEnd: () => Promise<void>;
  onSend: (text: string) => Promise<void>;
  onSkipQueued: () => Promise<void>;
  onFork: (turnIndex: number, caller: string) => Promise<void>;
  onSelectRun: (id: string) => void;
  onNewMessage: () => void;
  onStartNew: () => Promise<void>;
  onDraftChange: (next: DraftState) => void;
  onStartDraft: () => Promise<void>;
}) {
  const { mode, session, contact, channel } = props;

  return (
    <section className="flex min-w-0 flex-1 flex-col" style={{ background: THREAD_BG }}>
      {!props.connected ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2 text-[12.5px] text-amber-300">
          <CircleAlert size={14} />
          Devtools server offline. Start <code className="data rounded bg-black/30 px-1.5 py-0.5 text-[11.5px]">npx agentphone-devtools</code>
        </div>
      ) : null}
      {props.banner ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-[#6b2a2a] bg-red-50 px-5 py-2 text-[12.5px] text-[#f08080]" role="alert">
          <CircleAlert size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={props.banner}>
            {props.banner}
          </span>
          {props.onDismissBanner ? (
            <button type="button" onClick={props.onDismissBanner} aria-label="Dismiss" className="shrink-0 text-[#f08080]/80 hover:text-[#f08080]">
              <X size={14} />
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === "empty" || mode === "missing" ? (
        <EmptyThread missing={mode === "missing"} onNewMessage={props.onNewMessage} />
      ) : mode === "loading" ? (
        <div className="flex flex-1 items-center justify-center text-slate-500">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : mode === "draft" && props.draft ? (
        <DraftThread {...props} draft={props.draft} />
      ) : session ? (
        <>
          <ThreadHeader
            contact={contact}
            channel={channel}
            session={session}
            live={props.live}
            ended={props.ended}
            familyCount={props.familyCount}
            railOpen={props.railOpen}
            onToggleRail={props.onToggleRail}
            onEnd={props.onEnd}
            onSelectRun={props.onSelectRun}
          />
          <MessageList
            session={session}
            sourceSession={props.sourceSession}
            channel={channel}
            typing={props.typing}
            optimistic={props.optimistic}
            lastResult={props.stepLive ? props.lastResult : undefined}
            highlight={props.highlight}
            sending={props.sending}
            onFork={props.onFork}
            onSelectRun={props.onSelectRun}
            footer={
              props.ended ? (
                <EndedNote name={contact?.name} onStartNew={props.onStartNew} />
              ) : null
            }
          />
          {props.composable ? (
            <ComposeBar
              key={session.id}
              channel={channel}
              sending={props.sending}
              voiceAvailable={props.voiceAvailable}
              queued={props.stepLive ? props.queued : null}
              onSend={props.onSend}
              onSkipQueued={props.stepLive ? props.onSkipQueued : undefined}
            />
          ) : !props.ended ? (
            <div className="flex shrink-0 items-center justify-center gap-2 border-t border-line px-5 py-3.5 text-[12.5px] text-slate-500">
              <Lock size={13} className="shrink-0" />
              <span>
                Read-only · this run is saved. Fork from a message to branch it (hover a bubble, then <GitBranch size={12} className="inline -translate-y-px text-indigo-400" />).
              </span>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

function ThreadHeader({
  contact,
  channel,
  session,
  live,
  ended,
  familyCount,
  railOpen,
  onToggleRail,
  onEnd,
  onSelectRun
}: {
  contact: ThreadContact | null;
  channel: ThreadChannel;
  session: InspectorSession;
  live: boolean;
  ended: boolean;
  familyCount: number;
  railOpen: boolean;
  onToggleRail: () => void;
  onEnd: () => Promise<void>;
  onSelectRun: (id: string) => void;
}) {
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = contact?.name ?? "Unknown number";
  return (
    <header className="flex h-[62px] shrink-0 items-center gap-3 border-b border-line px-5">
      <Avatar name={contact?.unknown ? "#" : name} size={38} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold text-bright">{name}</span>
          <ChannelBadge channel={channel} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px] text-slate-500">
          {contact?.number && !contact.unknown ? <span className="whitespace-nowrap">{formatPhone(contact.number)}</span> : <span>Not in contacts</span>}
          {session.forkedFrom ? (
            <>
              <span className="text-slate-300">·</span>
              <button type="button" onClick={() => onSelectRun(session.forkedFrom!.sessionId)} className="inline-flex items-center gap-1 whitespace-nowrap text-indigo-400 hover:text-indigo-700" title="Open the run this branch was forked from">
                <GitBranch size={11} />
                Branch {forkLabel(session.forkedFrom)}
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {error ? (
          <span className="max-w-[220px] truncate text-[12px] text-[#f08080]" title={error}>
            {error}
          </span>
        ) : null}
        {live && !ended ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#2e5a37] bg-[#173322] px-2.5 py-1 text-[11.5px] font-semibold text-fern">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#34c759]" />
            Live
          </span>
        ) : ended ? (
          <span className="rounded-full border border-line bg-raised px-2.5 py-1 text-[11.5px] font-medium text-slate-500">Ended</span>
        ) : (
          <span className="rounded-full border border-line bg-raised px-2.5 py-1 text-[11.5px] font-medium text-slate-500">Saved run</span>
        )}
        {live && !ended ? (
          <button
            type="button"
            disabled={ending}
            onClick={async () => {
              setEnding(true);
              setError(null);
              try {
                await onEnd();
              } catch (failure) {
                setError(errorMessage(failure));
              } finally {
                setEnding(false);
              }
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-raised px-3 text-[12.5px] font-medium text-slate-700 transition hover:border-[#6b2a2a] hover:text-[#f08080] disabled:opacity-50"
          >
            {ending ? <Loader2 size={13} className="animate-spin" /> : null}
            End conversation
          </button>
        ) : null}
        <button
          type="button"
          onClick={onToggleRail}
          aria-pressed={railOpen}
          title={railOpen ? "Hide the simulator rail" : "Show branches, clock and campaign tools"}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium transition ${
            railOpen ? "border-[#5a3b8a] bg-[#2a1f40] text-badgepurple" : "border-line bg-raised text-slate-700 hover:border-slate-400"
          }`}
        >
          <GitBranch size={13} />
          Branches
          {familyCount > 1 ? <span className="rounded bg-black/25 px-1 text-[11px]">{familyCount}</span> : null}
          {railOpen ? <PanelRightClose size={14} className="ml-0.5 opacity-70" /> : <PanelRightOpen size={14} className="ml-0.5 opacity-70" />}
        </button>
      </div>
    </header>
  );
}

// ── Messages ─────────────────────────────────────────────────────────────────

interface ForkTarget {
  index: number;
  mode: ForkMode;
}

function MessageList({
  session,
  sourceSession,
  channel,
  typing,
  optimistic,
  lastResult,
  highlight,
  sending,
  onFork,
  onSelectRun,
  footer
}: {
  session: InspectorSession;
  sourceSession?: InspectorSession;
  channel: ThreadChannel;
  typing: boolean;
  optimistic: string | null;
  lastResult?: StepState["lastResult"];
  highlight: { ordinal: number; nonce: number } | null;
  sending: boolean;
  onFork: (turnIndex: number, caller: string) => Promise<void>;
  onSelectRun: (id: string) => void;
  footer: React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fork, setFork] = useState<ForkTarget | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const style = CHANNELS[channel];
  const bubbles = useMemo(() => buildBubbles(session).filter((bubble) => !bubble.hidden), [session]);
  const boundary = useMemo(() => forkBoundary(session, sourceSession), [session, sourceSession]);
  const hasSeeds = (session.outboundSeeds?.length ?? 0) > 0;
  const minForkTurn = hasSeeds ? 0 : 1;
  const lastUser = [...bubbles].reverse().find((bubble) => bubble.role === "user");
  const newestIndex = bubbles.at(-1)?.index ?? -1;
  const seenNewest = useRef<{ id: string; index: number } | null>(null);
  const [popped, setPopped] = useState<{ id: string; index: number } | null>(null);
  // Pop only messages that arrive while the thread is open, not on first
  // paint. Held in state (set before paint) so later re-renders keep the
  // class and the animation is never cut short.
  useLayoutEffect(() => {
    const previous = seenNewest.current;
    if (previous && previous.id === session.id && newestIndex > previous.index) setPopped({ id: session.id, index: newestIndex });
    seenNewest.current = { id: session.id, index: newestIndex };
  }, [session.id, newestIndex]);
  const popIndex = popped && popped.id === session.id ? popped.index : -1;

  useEffect(() => setFork(null), [session.id]);
  useEffect(() => {
    if (!fork) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFork(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fork]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [session.id]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [bubbles.length, typing, optimistic]);

  useEffect(() => {
    if (!highlight) return;
    const target = document.getElementById(`imsg-caller-${highlight.ordinal}`);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlash(highlight.ordinal);
    const timer = window.setTimeout(() => setFlash(null), 1400);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  const results = lastResult?.expectResults.length ? lastResult : undefined;

  const nodes: React.ReactNode[] = [];
  let markerPlaced = boundary === null;
  const marker = session.forkedFrom ? (
    <div key="fork-marker" className="my-5 flex items-center gap-3 text-[11px] text-indigo-400">
      <span className="h-px flex-1 bg-indigo-200/70" />
      <button type="button" onClick={() => onSelectRun(session.forkedFrom!.sessionId)} className="inline-flex items-center gap-1.5 font-medium hover:text-indigo-700" title="Open the source run">
        <GitBranch size={12} />
        Branch starts here · forked {forkLabel(session.forkedFrom)}
      </button>
      <span className="h-px flex-1 bg-indigo-200/70" />
    </div>
  ) : null;

  bubbles.forEach((bubble, position) => {
    const previous = bubbles[position - 1];
    const next = bubbles[position + 1];
    let markerHere = false;
    if (!markerPlaced && boundary !== null && bubble.index >= boundary) {
      nodes.push(marker);
      markerPlaced = true;
      markerHere = true;
    }
    const separated = !previous || timeOf(bubble.at) - timeOf(previous.at) > SEPARATOR_GAP_MS;
    if (separated) nodes.push(<DateSeparator key={`sep-${bubble.index}`} iso={bubble.at} />);
    const grouped = Boolean(previous && previous.role === bubble.role && !separated && !markerHere);
    const crossesBoundary = boundary !== null && next !== undefined && bubble.index < boundary && next.index >= boundary;
    const lastOfGroup = !next || next.role !== bubble.role || timeOf(next.at) - timeOf(bubble.at) > SEPARATOR_GAP_MS || crossesBoundary;
    const pop = bubble.index === popIndex;

    if (bubble.role === "user") {
      const ordinal = bubble.callerOrdinal ?? 0;
      const forkOpen = fork?.index === bubble.index;
      nodes.push(
        <div key={bubble.index} id={`imsg-caller-${ordinal}`} className={`group flex flex-col items-end ${grouped ? "mt-[3px]" : "mt-3"}`}>
          <div className="flex w-full items-center justify-end gap-2">
            <ForkButton active={forkOpen} onClick={() => setFork(forkOpen ? null : { index: bubble.index, mode: "after" })} />
            <BubbleShape side="right" color={style.bubble} textColor="#ffffff" tail={lastOfGroup || bubble.failed} pop={pop} highlight={flash === ordinal}>
              {bubble.text}
            </BubbleShape>
            {bubble.failed ? (
              <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-danger text-[13px] font-bold leading-none text-white" title="Not Delivered">
                !
              </span>
            ) : null}
          </div>
          {bubble.failed && bubble.delivery ? (
            <div className="mt-1 pr-8 text-[11px] font-medium text-danger" title={bubble.delivery.response.rawBody.slice(0, 300) || undefined}>
              Not Delivered · {failureText(bubble.delivery)}
            </div>
          ) : bubble === lastUser && bubble.delivery && !optimistic ? (
            <DeliveredLabel channel={channel} at={bubble.at} />
          ) : null}
          {forkOpen ? (
            <ForkPopover
              align="right"
              mode={fork!.mode}
              onMode={(mode) => setFork({ index: bubble.index, mode })}
              insteadAllowed={ordinal - 1 >= minForkTurn}
              busyExternally={sending}
              onCancel={() => setFork(null)}
              onSubmit={async (text) => {
                const turnIndex = fork!.mode === "instead" ? ordinal - 1 : ordinal;
                await onFork(turnIndex, text);
                setFork(null);
              }}
            />
          ) : null}
        </div>
      );
      return;
    }

    nodes.push(
      <AgentRow
        key={bubble.index}
        bubble={bubble}
        grouped={grouped}
        lastOfGroup={lastOfGroup}
        pop={pop}
        showCaption={bubble.seed && !(grouped && previous?.seed)}
        showMeta={!bubble.seed && !(next && next.role === "agent" && !next.seed && next.replyTo === bubble.replyTo)}
        results={results && bubble.replyTo === results.turnNumber ? results.expectResults : undefined}
        forkOpen={fork?.index === bubble.index}
        sending={sending}
        canFork={bubble.seed && bubble.callersBefore >= minForkTurn}
        onToggleFork={() => setFork(fork?.index === bubble.index ? null : { index: bubble.index, mode: "seed" })}
        onCancelFork={() => setFork(null)}
        onSubmitFork={async (text) => {
          await onFork(bubble.callersBefore, text);
          setFork(null);
        }}
      />
    );
  });
  if (!markerPlaced && bubbles.length) nodes.push(marker);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-2">
      <div className="mx-auto flex max-w-[880px] flex-col">
        {bubbles.length === 0 && !optimistic ? (
          <div className="py-16 text-center text-[13px] text-slate-500">
            No messages yet. Say something as the customer, or send a campaign opener from the rail.
          </div>
        ) : null}
        {nodes}
        {optimistic ? (
          <div className="mt-3 flex w-full justify-end">
            <BubbleShape side="right" color={style.bubble} textColor="#ffffff" tail pop faded>
              {optimistic}
            </BubbleShape>
          </div>
        ) : null}
        {typing ? <TypingBubble /> : null}
        {footer}
      </div>
    </div>
  );
}

function AgentRow({
  bubble,
  grouped,
  lastOfGroup,
  pop,
  showCaption,
  showMeta,
  results,
  forkOpen,
  sending,
  canFork,
  onToggleFork,
  onCancelFork,
  onSubmitFork
}: {
  bubble: Bubble;
  grouped: boolean;
  lastOfGroup: boolean;
  pop: boolean;
  showCaption: boolean;
  showMeta: boolean;
  results?: StepExpectResult[];
  forkOpen: boolean;
  sending: boolean;
  canFork: boolean;
  onToggleFork: () => void;
  onCancelFork: () => void;
  onSubmitFork: (text: string) => Promise<void>;
}) {
  const actions = showMeta ? observedActions(bubble.delivery) : [];
  return (
    <div className={`group flex flex-col items-start ${grouped && !showCaption ? "mt-[3px]" : "mt-3"}`}>
      {showCaption ? (
        <div className="mb-1 ml-3 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          <Megaphone size={11} />
          Sent by business · via API
        </div>
      ) : null}
      <div className="flex w-full items-center justify-start gap-2">
        <BubbleShape side="left" color={AGENT_BUBBLE} textColor="#f0efe9" tail={lastOfGroup} pop={pop}>
          {bubble.text}
        </BubbleShape>
        {canFork ? <ForkButton active={forkOpen} onClick={onToggleFork} label={bubble.callersBefore === 0 ? "Fork from the opener" : "Fork from here"} /> : null}
        {showMeta && bubble.delivery ? (
          <span className="data shrink-0 text-[10.5px] text-slate-400 opacity-0 transition group-hover:opacity-100">
            {bubble.delivery.latencyMs}ms · HTTP {bubble.delivery.response.status}
            {bubble.delivery.inheritedFrom ? " · inherited" : ""}
          </span>
        ) : null}
      </div>
      {showMeta ? <ReplyMeta actions={actions} results={results} /> : null}
      {forkOpen ? (
        <ForkPopover align="left" mode="seed" insteadAllowed={false} busyExternally={sending} onCancel={onCancelFork} onSubmit={onSubmitFork} />
      ) : null}
    </div>
  );
}

function EndedNote({ name, onStartNew }: { name?: string; onStartNew: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-8 flex flex-col items-center gap-2.5 pb-2 text-center">
      <div className="text-[12px] text-slate-500">Conversation ended · fork from any message to continue</div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onStartNew();
          } catch (failure) {
            setError(errorMessage(failure));
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised px-3.5 py-1.5 text-[12.5px] font-medium text-bright transition hover:border-slate-400 disabled:opacity-50"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <SquarePen size={13} />}
        Start new conversation with {name ? firstName(name) : "this number"}
      </button>
      {error ? <div className="text-[12px] text-[#f08080]">{error}</div> : null}
    </div>
  );
}

function EmptyThread({ missing, onNewMessage }: { missing: boolean; onNewMessage: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <MessageCircle size={64} strokeWidth={1.2} className="text-slate-300" />
      <div className="mt-4 text-[19px] font-semibold text-slate-700">{missing ? "Conversation Not Found" : "No Conversation Selected"}</div>
      <div className="mt-1.5 text-[14px] text-slate-500">{missing ? "This run was deleted or never existed." : "Pick a thread or start a new message."}</div>
      <button
        type="button"
        onClick={onNewMessage}
        className="mt-6 inline-flex h-9 items-center gap-2 rounded-full bg-[#1f8fff] px-4 text-[13.5px] font-semibold text-white transition hover:bg-[#3d9dff]"
      >
        <SquarePen size={15} />
        New Message
      </button>
    </div>
  );
}

// ── Draft (new message / contact with no runs) ───────────────────────────────

function DraftThread(props: {
  draft: DraftState;
  contacts: Contact[];
  contact: ThreadContact | null;
  channel: ThreadChannel;
  railOpen: boolean;
  voiceAvailable: boolean;
  sending: boolean;
  onToggleRail: () => void;
  onSend: (text: string) => Promise<void>;
  onDraftChange: (next: DraftState) => void;
  onStartDraft: () => Promise<void>;
}) {
  const { draft, contacts, contact, channel } = props;
  const picked = draft.contactId ? contacts.find((candidate) => candidate.id === draft.contactId) : undefined;
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      await props.onStartDraft();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setStarting(false);
    }
  }

  const canStart = Boolean(picked) || contacts.length === 0;

  return (
    <>
      <header className="relative flex h-[62px] shrink-0 items-center gap-3 border-b border-line px-5">
        {draft.compose ? (
          <RecipientField
            contacts={contacts}
            picked={picked}
            onPick={(next) =>
              props.onDraftChange({ ...draft, contactId: next?.id ?? null, channel: next ? preferredChannel(next.channel) : draft.channel })
            }
          />
        ) : (
          <>
            <Avatar name={contact?.name ?? "?"} size={38} />
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-bright">{contact?.name}</div>
              <div className="truncate text-[12px] text-slate-500">{contact?.number ? formatPhone(contact.number) : ""}</div>
            </div>
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <div className="flex rounded-lg bg-raised p-0.5" role="radiogroup" aria-label="Channel">
            {CHANNEL_ORDER.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={channel === option}
                onClick={() => props.onDraftChange({ ...draft, channel: option })}
                className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${channel === option ? "text-white shadow-sm" : "text-slate-500 hover:text-bright"}`}
                style={channel === option ? { background: CHANNELS[option].accent } : undefined}
              >
                {CHANNELS[option].label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={props.onToggleRail}
            aria-pressed={props.railOpen}
            title={props.railOpen ? "Hide the simulator rail" : "Show the simulator rail"}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${
              props.railOpen ? "border-[#5a3b8a] bg-[#2a1f40] text-badgepurple" : "border-line bg-raised text-slate-600 hover:text-bright"
            }`}
          >
            {props.railOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 text-center">
        {picked || contact ? (
          <>
            <Avatar name={(picked?.name ?? contact?.name) || "?"} size={72} />
            <div className="mt-3 text-[18px] font-semibold text-bright">{picked?.name ?? contact?.name}</div>
            <div className="mt-0.5 text-[13px] text-slate-500">
              {formatPhone((picked?.number ?? contact?.number) || "")} · {CHANNELS[channel].label}
            </div>
            <div className="mt-5 max-w-[380px] text-[13px] leading-5 text-slate-500">
              No messages yet. Type below to message the business as {firstName(picked?.name ?? contact?.name)}, or open with a campaign from{" "}
              <span className="text-slate-700">Send as business</span> in the rail.
            </div>
          </>
        ) : (
          <div className="max-w-[360px] text-[13px] leading-5 text-slate-500">
            {contacts.length
              ? "Choose who the simulated customer is. Each contact brings their number and conversation state."
              : "No contacts yet. Add some on the Contacts page, or start a conversation from an unknown number."}
          </div>
        )}
        {canStart ? (
          <button
            type="button"
            onClick={() => void start()}
            disabled={starting}
            className="mt-5 inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13.5px] font-semibold text-white transition disabled:opacity-50"
            style={{ background: CHANNELS[channel].accent }}
          >
            {starting ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={15} />}
            {picked || contact ? "Start conversation" : "Start with an unknown number"}
          </button>
        ) : null}
        {error ? <div className="mt-3 text-[12.5px] text-[#f08080]">{error}</div> : null}
      </div>

      <ComposeBar
        key={`draft-${draft.contactId ?? "none"}`}
        channel={channel}
        sending={props.sending}
        voiceAvailable={props.voiceAvailable}
        disabled={!picked && !contact}
        disabledHint="Choose a recipient first"
        onSend={props.onSend}
      />
    </>
  );
}

export function preferredChannel(channel: string | undefined): ThreadChannel {
  return channel === "voice" ? "imessage" : toThreadChannel(channel);
}

function RecipientField({ contacts, picked, onPick }: { contacts: Contact[]; picked?: Contact; onPick: (contact: Contact | null) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(true);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalized = query.trim().toLowerCase();
  const digits = normalized.replace(/\D/g, "");
  const matches = contacts.filter(
    (candidate) =>
      !normalized ||
      candidate.name.toLowerCase().includes(normalized) ||
      (digits.length >= 2 && candidate.number.replace(/\D/g, "").includes(digits))
  );

  useEffect(() => {
    if (!picked) inputRef.current?.focus();
  }, [picked]);
  useEffect(() => setCursor(0), [normalized]);

  if (picked) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[14px] text-slate-500">To:</span>
        <span className="inline-flex max-w-[260px] items-center gap-1.5 rounded-md bg-[#1f8fff]/20 py-0.5 pl-2 pr-1 text-[14px] font-medium text-[#5aa9ff]">
          <span className="truncate">{picked.name}</span>
          <button type="button" aria-label="Remove recipient" onClick={() => onPick(null)} className="rounded p-0.5 hover:bg-[#1f8fff]/30">
            <X size={12} />
          </button>
        </span>
        <span className="truncate text-[12.5px] text-slate-500">{formatPhone(picked.number)}</span>
      </div>
    );
  }

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-2">
      <span className="text-[14px] text-slate-500">To:</span>
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setCursor((value) => Math.min(value + 1, Math.max(matches.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setCursor((value) => Math.max(value - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const choice = matches[cursor];
            if (choice) onPick(choice);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={contacts.length ? "Name or number" : "No contacts yet"}
        aria-label="Recipient"
        className="h-8 min-w-0 flex-1 bg-transparent text-[14px] text-bright outline-none placeholder:text-slate-400"
      />
      {open && matches.length ? (
        <div className="absolute left-7 top-[calc(100%+10px)] z-30 max-h-[320px] w-[340px] overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-soft">
          {matches.map((candidate, index) => {
            const style = CHANNELS[preferredChannel(candidate.channel)];
            return (
              <button
                key={candidate.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(candidate)}
                onMouseEnter={() => setCursor(index)}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left ${index === cursor ? "bg-[#1f8fff]/25" : ""}`}
              >
                <Avatar name={candidate.name} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-bright">{candidate.name}</span>
                  <span className="block truncate text-[12px] text-slate-500">{formatPhone(candidate.number)}</span>
                </span>
                <span className="shrink-0 text-[11px] font-semibold" style={{ color: style.text }}>
                  {candidate.channel === "voice" ? "Voice → iMessage" : style.label}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
