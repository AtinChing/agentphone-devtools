"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowUp, ChevronRight, Clock3, Download, GitBranch, Loader2, Megaphone, MessageCircle, Save } from "lucide-react";
import { api, errorMessage, serverUrl } from "@/lib/api";
import type { ScenarioResult, StepExpectResult } from "@/lib/types";
import { ConversationTree, TreeLegend, type TurnNode } from "@/components/ConversationTree";
import { Avatar, Button, ChannelBadge, Eyebrow, Field, inputClass, Modal, Notice, StatusDot, formatPhone } from "@/components/dashboard/ui";
import { CHANNELS, firstName, formatOffset, RAIL_BG, type ThreadChannel } from "./model";
import type { ThreadContact } from "./ThreadView";

export interface FamilyRow {
  id: string;
  title: string;
  subtitle: string;
  turns: number;
  status: boolean | null;
  live: boolean;
  selected: boolean;
  forked: boolean;
}

export interface RailProps {
  onClose: () => void;
  contact: ThreadContact | null;
  contactNotes?: string;
  channel: ThreadChannel;
  conversationState: unknown;
  stateSource: "live" | "run" | "contact" | null;
  clockOffsetMs: number;
  onAdvanceClock: (duration: string) => Promise<void>;
  /** A turn is in flight on the step engine. */
  engineBusy: boolean;
  seed: { enabled: boolean; hint?: string; onSeed: (text: string) => Promise<void> };
  quick: {
    opener: { text: string } | null;
    direct: boolean;
    onQuickReply: (text: string, advance?: string) => Promise<void>;
  };
  family: {
    roots: TurnNode[];
    rows: FamilyRow[];
    liveSessionId: string | null;
    selectedKey: string | null;
    onSelectNode: (node: TurnNode) => void;
    onSelectRun: (id: string) => void;
  } | null;
  checks: { results?: StepExpectResult[]; turnNumber?: number; scenario?: ScenarioResult } | null;
  exportRun: { id: string; defaultName: string } | null;
}

/**
 * The right rail: everything the simulator adds on top of a plain Messages
 * window. Contact + state, the simulated clock, outbound campaign sends,
 * archetype quick replies (each a fork), the branch tree, checks, export.
 */
export function SimulatorRail(props: RailProps) {
  return (
    <aside className="flex w-[330px] shrink-0 flex-col border-l border-line" style={{ background: RAIL_BG }}>
      <div className="flex h-[62px] shrink-0 items-center gap-2 border-b border-line px-4">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-bright">Simulator</div>
          <div className="truncate text-[11.5px] text-slate-500">Clock, campaigns and branches</div>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Hide simulator rail"
          title="Hide"
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-mist hover:text-bright"
        >
          <ChevronRight size={17} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.contact ? <ContactSection {...props} contact={props.contact} /> : null}
        <ClockSection offsetMs={props.clockOffsetMs} busy={props.engineBusy} onAdvance={props.onAdvanceClock} />
        <SeedSection contact={props.contact} channel={props.channel} busy={props.engineBusy} {...props.seed} />
        {props.quick.opener ? (
          <QuickRepliesSection
            channel={props.channel}
            contact={props.contact}
            opener={props.quick.opener}
            direct={props.quick.direct}
            busy={props.engineBusy}
            onQuickReply={props.quick.onQuickReply}
          />
        ) : null}
        {props.family ? <BranchesSection {...props.family} /> : null}
        {props.checks && (props.checks.results?.length || props.checks.scenario) ? <ChecksSection {...props.checks} /> : null}
        {props.exportRun ? <ExportSection {...props.exportRun} /> : null}
        <div className="h-6" />
      </div>
    </aside>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-4">
      <div className="mb-2.5 flex items-center gap-2">
        <Eyebrow>{title}</Eyebrow>
        {aside ? <div className="ml-auto">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Hint({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`mt-2 text-[11.5px] leading-[16px] text-slate-500 ${className}`}>{children}</p>;
}

function InlineError({ message }: { message: string | null }) {
  return message ? <div className="mt-2 text-[12px] text-[#f08080]">{message}</div> : null;
}

// ── Contact ──────────────────────────────────────────────────────────────────

function ContactSection({
  contact,
  contactNotes,
  channel,
  conversationState,
  stateSource
}: {
  contact: ThreadContact;
  contactNotes?: string;
  channel: ThreadChannel;
  conversationState: unknown;
  stateSource: RailProps["stateSource"];
}) {
  const json = conversationState === undefined ? "null" : JSON.stringify(conversationState, null, 2);
  const sourceLabel = stateSource === "live" ? "live checkpoint" : stateSource === "run" ? "latest payload" : stateSource === "contact" ? "contact default" : "";
  return (
    <Section title="Contact">
      <div className="flex items-center gap-3">
        <Avatar name={contact.unknown ? "#" : contact.name} size={34} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-bright">{contact.name}</div>
          <div className="truncate text-[12px] text-slate-500">{contact.number ? formatPhone(contact.number) : "No number"}</div>
        </div>
        <ChannelBadge channel={channel} />
      </div>
      {contactNotes ? <p className="mt-2.5 text-[12px] leading-[17px] text-slate-500">{contactNotes}</p> : null}
      <div className="mt-3 flex items-baseline justify-between">
        <span className="data text-[11px] text-slate-500">conversationState</span>
        <span className="text-[10.5px] text-slate-400">{sourceLabel}</span>
      </div>
      <pre className="console-pane data mt-1.5 max-h-[180px] overflow-auto rounded-lg border border-line px-3 py-2 text-[11.5px] leading-[17px]">{json}</pre>
    </Section>
  );
}

// ── Clock ────────────────────────────────────────────────────────────────────

function ClockSection({ offsetMs, busy, onAdvance }: { offsetMs: number; busy: boolean; onAdvance: (duration: string) => Promise<void> }) {
  const [now, setNow] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function advance(duration: string) {
    const value = duration.trim();
    if (!value) return;
    setPending(value);
    setError(null);
    try {
      await onAdvance(value);
      if (value === custom.trim()) setCustom("");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(null);
    }
  }

  const virtual = now === null ? null : new Date(now + offsetMs);
  const shifted = Math.abs(offsetMs) >= 60_000;
  return (
    <Section title="Clock">
      <div className="rounded-xl border border-line bg-panel px-3.5 py-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[12px] text-slate-500">
            <Clock3 size={12} /> Simulated time
          </span>
          <span className={`data rounded-md px-1.5 py-0.5 text-[11px] ${shifted ? "bg-amber-50 text-amber-300" : "text-slate-500"}`}>{formatOffset(offsetMs)}</span>
        </div>
        <div className="mt-1.5 text-[16px] font-semibold text-bright">
          {virtual ? virtual.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "—"}
          <span className="data ml-2 text-[14px] font-normal text-slate-600">
            {virtual ? virtual.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : ""}
          </span>
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-4 gap-1.5">
        {["1h", "1d", "7d", "10d"].map((duration) => (
          <button
            key={duration}
            type="button"
            disabled={busy || pending !== null}
            onClick={() => void advance(duration)}
            className="data flex h-7 items-center justify-center rounded-md border border-line bg-raised text-[12px] font-medium text-slate-700 transition hover:border-slate-400 hover:text-bright disabled:opacity-40"
          >
            {pending === duration ? <Loader2 size={12} className="animate-spin" /> : `+${duration}`}
          </button>
        ))}
      </div>
      <form
        className="mt-1.5 flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void advance(custom);
        }}
      >
        <input
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          placeholder="2d"
          aria-label="Advance the clock by"
          className="data h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2.5 text-[12.5px] text-bright outline-none placeholder:text-slate-400 focus:border-fern"
        />
        <button
          type="submit"
          disabled={busy || pending !== null || !custom.trim()}
          className="h-8 rounded-md border border-line bg-raised px-3 text-[12.5px] font-semibold text-bright transition hover:border-slate-400 disabled:opacity-40"
        >
          Go
        </button>
      </form>
      <InlineError message={error} />
      <Hint>Moves the payload timestamp and history times. The signature header stays real, so the handler&apos;s replay window still accepts it.</Hint>
    </Section>
  );
}

// ── Send as business ─────────────────────────────────────────────────────────

function SeedSection({
  contact,
  channel,
  busy,
  enabled,
  hint,
  onSeed
}: {
  contact: ThreadContact | null;
  channel: ThreadChannel;
  busy: boolean;
  enabled: boolean;
  hint?: string;
  onSeed: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = contact && !contact.unknown ? firstName(contact.name) : "there";
  const presets = [
    {
      label: "Fall tune-up opener",
      text: `Hi ${name}, it's North Lot EV Charging. Fall tune-up special: 20% off any service booked this week. Reply YES to claim, or STOP to opt out.`
    },
    {
      label: "Appointment reminder",
      text: "Reminder from North Lot EV Charging: your tune-up is tomorrow at 9:00 AM. Reply C to confirm or R to reschedule."
    },
    { label: "Follow-up", text: "Still interested in the fall tune-up special? Reply YES and we'll book you in." }
  ];

  async function send() {
    const value = text.trim();
    if (!value || !enabled) return;
    setSending(true);
    setError(null);
    try {
      await onSeed(value);
      setText("");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSending(false);
    }
  }

  return (
    <Section title="Send as business">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void send();
          }
        }}
        rows={3}
        placeholder="Write an outbound message…"
        className="w-full resize-none rounded-xl border border-line bg-raised px-3 py-2 text-[13px] leading-[18px] text-bright outline-none placeholder:text-slate-400 focus:border-fern"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => setText(preset.text)}
            className="rounded-full border border-line bg-raised px-2.5 py-1 text-[11.5px] text-slate-700 transition hover:border-slate-400 hover:text-bright"
          >
            {preset.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => void send()}
        disabled={!enabled || busy || sending || !text.trim()}
        className="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg bg-[#3a3a38] text-[13px] font-semibold text-bright transition hover:bg-[#474744] disabled:opacity-40"
      >
        {sending ? <Loader2 size={13} className="animate-spin" /> : <Megaphone size={13} />}
        Send as business
        <span className="text-[11px] font-normal text-slate-500">via {CHANNELS[channel].label}</span>
      </button>
      <InlineError message={error} />
      {!enabled && hint ? <Hint className="text-caution">{hint}</Hint> : null}
      <Hint>Outbound sends go through the API, not the webhook. This seeds the conversation history so the customer&apos;s reply hits your handler with the real context.</Hint>
    </Section>
  );
}

// ── Quick replies ────────────────────────────────────────────────────────────

const ARCHETYPES: Array<{ key: string; label: string; text: string; advance?: string }> = [
  { key: "interested", label: "Interested", text: "YES" },
  { key: "question", label: "Has a question", text: "What does it include?" },
  { key: "declines", label: "Declines", text: "No thanks, not right now." },
  { key: "late", label: "Late reply (+10d)", text: "YES", advance: "10d" },
  { key: "optout", label: "Opt out", text: "STOP" }
];

function QuickRepliesSection({
  channel,
  contact,
  opener,
  direct,
  busy,
  onQuickReply
}: {
  channel: ThreadChannel;
  contact: ThreadContact | null;
  opener: { text: string };
  direct: boolean;
  busy: boolean;
  onQuickReply: (text: string, advance?: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const style = CHANNELS[channel];

  async function run(key: string, text: string, advance?: string) {
    setPending(key);
    setError(null);
    try {
      await onQuickReply(text, advance);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(null);
    }
  }

  return (
    <Section title="Quick replies" aside={<span className="text-[10.5px] text-slate-400">{direct ? "sends here" : "each one forks"}</span>}>
      <p className="text-[12px] leading-[17px] text-slate-500">
        {direct
          ? `Reply as ${contact && !contact.unknown ? firstName(contact.name) : "the customer"} on this thread.`
          : "Each reply branches from the opener, so one campaign send fans out into customer archetypes."}
      </p>
      <div className="mt-2 line-clamp-2 border-l-2 border-line pl-2 text-[11.5px] italic leading-[16px] text-slate-500">“{opener.text}”</div>
      <div className="mt-2.5 space-y-0.5">
        {ARCHETYPES.map((archetype) => (
          <button
            key={archetype.key}
            type="button"
            disabled={busy || pending !== null}
            onClick={() => void run(archetype.key, archetype.text, archetype.advance)}
            className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-mist disabled:opacity-50"
          >
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-700 group-hover:text-bright">{archetype.label}</span>
            <span className="max-w-[150px] truncate rounded-[14px] px-2.5 py-[3px] text-[12px] text-white" style={{ background: style.bubble }}>
              {archetype.text}
            </span>
            <span className="flex w-4 shrink-0 justify-center text-slate-500">
              {pending === archetype.key ? (
                <Loader2 size={13} className="animate-spin" />
              ) : direct ? (
                <ArrowUp size={13} />
              ) : (
                <GitBranch size={13} className="text-indigo-400" />
              )}
            </span>
          </button>
        ))}
      </div>
      <InlineError message={error} />
    </Section>
  );
}

// ── Branches ─────────────────────────────────────────────────────────────────

function BranchesSection({
  roots,
  rows,
  liveSessionId,
  selectedKey,
  onSelectNode,
  onSelectRun
}: NonNullable<RailProps["family"]>) {
  return (
    <Section title="Branches" aside={<span className="text-[10.5px] text-slate-400">{rows.length === 1 ? "1 run" : `${rows.length} runs`}</span>}>
      <div className="tree-canvas h-[260px] overflow-hidden rounded-xl border border-line">
        {roots.length ? (
          <ConversationTree roots={roots} liveSessionId={liveSessionId} selectedKey={selectedKey} onSelect={onSelectNode} />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-[12px] leading-[17px] text-slate-500">
            The tree grows one checkpoint per customer message. Branches you fork appear beside the original.
          </div>
        )}
      </div>
      <div className="mt-2">
        <TreeLegend />
      </div>
      <div className="mt-3 space-y-0.5">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => onSelectRun(row.id)}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${row.selected ? "bg-mist" : "hover:bg-white/[0.035]"}`}
          >
            {row.forked ? <GitBranch size={13} className="shrink-0 text-indigo-400" /> : <MessageCircle size={13} className="shrink-0 text-slate-500" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-bright">{row.title}</span>
              <span className="block truncate text-[11px] text-slate-500">{row.subtitle}</span>
            </span>
            {row.live ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#34c759]" title="Live" /> : null}
            <span className="data shrink-0 text-[11px] text-slate-500" title="Customer messages">
              {row.turns}
            </span>
            <StatusDot ok={row.status} className="shrink-0" />
          </button>
        ))}
      </div>
    </Section>
  );
}

// ── Checks ───────────────────────────────────────────────────────────────────

function ChecksSection({ results, turnNumber, scenario }: { results?: StepExpectResult[]; turnNumber?: number; scenario?: ScenarioResult }) {
  const failing = scenario?.assertions.filter((assertion) => !assertion.passed).slice(0, 4) ?? [];
  return (
    <Section title="Checks">
      {results?.length ? (
        <div>
          <div className="mb-1.5 text-[11.5px] text-slate-500">Expectations on message {turnNumber}</div>
          <ul className="space-y-1">
            {results.map((result) => (
              <li key={result.action} className="flex items-center gap-2 text-[12.5px]">
                <StatusDot ok={result.passed} />
                <span className="data min-w-0 flex-1 truncate text-slate-700">{result.action}</span>
                <span className="shrink-0 text-[11px] text-slate-500">{result.passed ? "passed" : `saw ${result.observed.join(", ") || "none"}`}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {scenario ? (
        <div className={results?.length ? "mt-3" : ""}>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px]">
            <StatusDot ok={scenario.passed} />
            <span className="font-medium text-bright">Scenario {scenario.passed ? "passed" : "failed"}</span>
            <span className="ml-auto text-[11.5px] text-slate-500">
              {scenario.passedCount} passed · {scenario.failedCount} failed
            </span>
          </div>
          {failing.length ? (
            <ul className="mt-1.5 space-y-1">
              {failing.map((assertion, index) => (
                <li key={index} className="text-[11.5px] leading-[16px] text-[#f08080]">
                  {assertion.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

// ── Export ───────────────────────────────────────────────────────────────────

function ExportSection({ id, defaultName }: { id: string; defaultName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ path: string; turns: number } | null>(null);

  useEffect(() => {
    setSaved(null);
    setError(null);
  }, [id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await api.post<{ path: string; name: string; turns: number }>(`/api/history/${encodeURIComponent(id)}/export`, {
        name: name.trim() || defaultName
      });
      const marker = result.path.indexOf(".agentphone-devtools");
      setSaved({ path: marker >= 0 ? result.path.slice(marker) : result.path, turns: result.turns });
      setOpen(false);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Export">
      <div className="grid grid-cols-2 gap-2">
        <a
          href={serverUrl(`/api/history/${encodeURIComponent(id)}/scenario.yaml?assertions=1`)}
          download
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line bg-raised text-[12.5px] font-semibold text-bright transition hover:border-slate-400"
        >
          <Download size={13} /> Download YAML
        </a>
        <button
          type="button"
          onClick={() => {
            setName(defaultName);
            setError(null);
            setOpen(true);
          }}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line bg-raised text-[12.5px] font-semibold text-bright transition hover:border-slate-400"
        >
          <Save size={13} /> Save as scenario
        </button>
      </div>
      {saved ? (
        <div className="mt-2.5 text-[12.5px]">
          <Notice tone="good">
            Saved to <code className="data break-all text-[11.5px]">{saved.path}</code>, now in the scenario picker.
          </Notice>
        </div>
      ) : null}
      <Hint>Exports include assertions scaffolded from the actions this run observed, so it replays as a regression test.</Hint>
      {open ? (
        <Modal
          title="Save as scenario"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" busy={saving} onClick={() => void save()}>
                Save scenario
              </Button>
            </>
          }
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Field label="Scenario name" hint="Written to .agentphone-devtools/exports/ and listed with your other scenarios.">
              <input autoFocus value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
            </Field>
          </form>
          {error ? (
            <div className="mt-3">
              <Notice tone="error">{error}</Notice>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </Section>
  );
}
