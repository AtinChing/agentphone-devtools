import type { Contact, InspectorDelivery, InspectorSession, InspectorSessionSummary } from "@/lib/types";

/**
 * Pure helpers for the Messages-style view: channel styling, thread-list
 * grouping, transcript → bubble mapping (with each customer bubble tied to
 * its webhook delivery), date separators, fork families and clock text.
 */

export type ThreadChannel = "imessage" | "sms" | "whatsapp";

/** Conversation background; the bubble tails mask against it. */
export const THREAD_BG = "#1a1a1a";
export const LIST_BG = "#161616";
export const RAIL_BG = "#171717";

export interface ChannelStyle {
  label: string;
  /** Customer (right) bubble fill. */
  bubble: string;
  /** Accent for selection bars, buttons. */
  accent: string;
  /** Readable text tint on dark surfaces. */
  text: string;
  placeholder: string;
}

export const CHANNELS: Record<ThreadChannel, ChannelStyle> = {
  imessage: { label: "iMessage", bubble: "#1f8fff", accent: "#1f8fff", text: "#5aa9ff", placeholder: "iMessage" },
  sms: { label: "SMS", bubble: "#34c759", accent: "#34c759", text: "#5fd47a", placeholder: "Text Message" },
  whatsapp: { label: "WhatsApp", bubble: "#005c4b", accent: "#25d366", text: "#25d366", placeholder: "WhatsApp message" }
};

export const CHANNEL_ORDER: ThreadChannel[] = ["imessage", "sms", "whatsapp"];

export const AGENT_BUBBLE = "#2c2c2e";

export function toThreadChannel(channel?: string | null): ThreadChannel {
  if (channel === "sms" || channel === "mms") return "sms";
  if (channel === "whatsapp") return "whatsapp";
  return "imessage";
}

export function firstName(name: string | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || "there";
}

export function timeOf(iso: string | undefined): number {
  if (!iso) return 0;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? 0 : at;
}

// ── Thread list ──────────────────────────────────────────────────────────────

export interface ThreadRow {
  key: string;
  kind: "run" | "draft";
  /** Run id (kind "run") or contact id (kind "draft"). */
  id: string;
  contactId?: string;
  name: string;
  number?: string;
  channel: ThreadChannel;
  preview: string;
  at?: string;
  forkedFrom?: { sessionId: string; turnIndex: number };
  live: boolean;
  ended: boolean;
}

export interface ThreadGroup {
  key: string;
  header?: { title: string; subtitle?: string; count: number };
  rows: ThreadRow[];
}

/**
 * One row per message-channel run, grouped by contact (a header only when a
 * contact has several runs), newest activity first; contacts without any
 * message runs trail as empty threads.
 */
export function buildThreadGroups(input: {
  runs: InspectorSessionSummary[];
  contacts: Contact[];
  liveId: string | null;
  stepLiveId: string | null;
  query: string;
}): ThreadGroup[] {
  const { runs, contacts, liveId, stepLiveId } = input;
  const query = input.query.trim().toLowerCase();
  const queryDigits = query.replace(/\D/g, "");
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const matches = (row: ThreadRow) => {
    if (!query) return true;
    if (row.name.toLowerCase().includes(query)) return true;
    if (row.preview.toLowerCase().includes(query)) return true;
    if (queryDigits.length >= 3 && row.number && row.number.replace(/\D/g, "").includes(queryDigits)) return true;
    return false;
  };

  const visible = runs.filter((run) => run.channel !== "voice" && (run.transcriptTurns > 0 || run.id === stepLiveId));
  const groups = new Map<string, { key: string; title: string; subtitle?: string; rows: ThreadRow[]; latest: number; total: number }>();
  const contactsWithRuns = new Set<string>();

  for (const run of visible) {
    const record = run.contact ? contactById.get(run.contact.id) : undefined;
    if (run.contact) contactsWithRuns.add(run.contact.id);
    const name = record?.name ?? run.contact?.name ?? "Unknown number";
    const number = record?.number ?? run.contact?.number;
    const row: ThreadRow = {
      key: `run:${run.id}`,
      kind: "run",
      id: run.id,
      contactId: run.contact?.id,
      name,
      number,
      channel: toThreadChannel(run.channel),
      preview: run.lastMessage ?? "No messages yet",
      at: run.lastActivityAt ?? run.startedAt,
      forkedFrom: run.forkedFrom,
      live: run.id === liveId,
      ended: run.status === "ended"
    };
    const groupKey = run.contact ? `contact:${run.contact.id}` : "unknown";
    const group = groups.get(groupKey) ?? {
      key: groupKey,
      title: name,
      subtitle: number ? formatPhoneShort(number) : undefined,
      rows: [],
      latest: 0,
      total: 0
    };
    group.total += 1;
    if (matches(row)) {
      group.rows.push(row);
      group.latest = Math.max(group.latest, timeOf(row.at));
    }
    groups.set(groupKey, group);
  }

  const ordered: ThreadGroup[] = [...groups.values()]
    .filter((group) => group.rows.length > 0)
    .sort((a, b) => b.latest - a.latest)
    .map((group) => ({
      key: group.key,
      rows: group.rows.sort((a, b) => timeOf(b.at) - timeOf(a.at)),
      ...(group.total > 1 ? { header: { title: group.title, subtitle: group.subtitle, count: group.total } } : {})
    }));

  const drafts = contacts
    .filter((contact) => !contactsWithRuns.has(contact.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map<ThreadRow>((contact) => ({
      key: `draft:${contact.id}`,
      kind: "draft",
      id: contact.id,
      contactId: contact.id,
      name: contact.name,
      number: contact.number,
      channel: toThreadChannel(contact.channel),
      preview: "No messages yet",
      live: false,
      ended: false
    }))
    .filter(matches);
  for (const row of drafts) ordered.push({ key: row.key, rows: [row] });
  return ordered;
}

function formatPhoneShort(number: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(number);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : number;
}

/** Messages-style list time: clock time today, "Yesterday", weekday this week, else a short date. */
export function listTime(iso: string | undefined, now = new Date()): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const days = dayDiff(now, at);
  if (days === 0) return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return at.toLocaleDateString([], { weekday: "long" });
  if (at.getFullYear() === now.getFullYear()) return at.toLocaleDateString([], { month: "short", day: "numeric" });
  return at.toLocaleDateString([], { month: "numeric", day: "numeric", year: "2-digit" });
}

/** Calendar-day difference: positive when `at` is before `now`. */
function dayDiff(now: Date, at: Date): number {
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const b = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}

/** Centered transcript separator: "Today 2:14 PM", "Yesterday 4:00 PM", "Sun, Sep 14 at 4:00 PM". */
export function separatorLabel(iso: string, now = new Date()): { day: string; time: string } {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return { day: "", time: "" };
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = dayDiff(now, at);
  if (days === 0) return { day: "Today", time };
  if (days === 1) return { day: "Yesterday", time };
  if (days === -1) return { day: "Tomorrow", time };
  const day = at.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(at.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {})
  });
  return { day, time: `at ${time}` };
}

export const SEPARATOR_GAP_MS = 3_600_000;

// ── Deliveries ───────────────────────────────────────────────────────────────

/** Caller turn N (0-based) ↔ the Nth non-replay agent.message delivery. */
export function turnDeliveries(session: InspectorSession): InspectorDelivery[] {
  return session.deliveries.filter((delivery) => delivery.event === "agent.message" && !delivery.replayOf);
}

export function isFailed(delivery: InspectorDelivery): boolean {
  return delivery.timedOut || !delivery.ok;
}

export function failureText(delivery: InspectorDelivery): string {
  if (delivery.timedOut) return "timed out";
  if (!delivery.response.status) return "handler unreachable";
  return `HTTP ${delivery.response.status}`;
}

export function observedActions(delivery: InspectorDelivery | undefined): string[] {
  if (!delivery) return [];
  const actions = new Set<string>();
  for (const chunk of delivery.response.parsed.chunks) {
    for (const field of ["action", "digits", "press_digit", "dtmf"] as const) {
      const value = chunk[field];
      if (typeof value === "string" && value) actions.add(value);
    }
    if (typeof chunk.transferNumber === "string") actions.add("transfer");
    if (chunk.hangup === true) actions.add("hangup");
  }
  return [...actions];
}

// ── Transcript → bubbles ─────────────────────────────────────────────────────

export interface Bubble {
  /** Transcript index. */
  index: number;
  role: "user" | "agent";
  text: string;
  at: string;
  /** Outbound business send (campaign opener / follow-up), not a webhook reply. */
  seed: boolean;
  /** Customer bubbles: 1-based caller ordinal. */
  callerOrdinal?: number;
  /** Customer turns strictly before this entry (fork point for seeds). */
  callersBefore: number;
  /** Customer bubbles: their delivery. Agent replies: the delivery they answer. */
  delivery?: InspectorDelivery;
  failed: boolean;
  /** Agent replies: the caller ordinal they answer. */
  replyTo?: number;
  /** Error bodies recorded after a failed delivery never reach the customer's phone. */
  hidden: boolean;
}

export function buildBubbles(session: InspectorSession): Bubble[] {
  const deliveries = turnDeliveries(session);
  const seeds = new Set(session.outboundSeeds ?? []);
  const bubbles: Bubble[] = [];
  let ordinal = 0;
  session.transcript.forEach((turn, index) => {
    const at = session.turnTimes?.[index] ?? session.startedAt;
    if (turn.role === "user") {
      ordinal += 1;
      const delivery = deliveries[ordinal - 1];
      bubbles.push({
        index,
        role: "user",
        text: turn.content,
        at,
        seed: false,
        callerOrdinal: ordinal,
        callersBefore: ordinal - 1,
        delivery,
        failed: delivery ? isFailed(delivery) : false,
        hidden: false
      });
      return;
    }
    const seed = seeds.has(index) || ordinal === 0;
    const delivery = seed ? undefined : deliveries[ordinal - 1];
    bubbles.push({
      index,
      role: "agent",
      text: turn.content,
      at,
      seed,
      callersBefore: ordinal,
      delivery,
      failed: false,
      ...(seed ? {} : { replyTo: ordinal }),
      hidden: !seed && delivery ? isFailed(delivery) : false
    });
  });
  return bubbles;
}

export function countUserTurns(session: InspectorSession | null | undefined): number {
  return session ? session.transcript.filter((turn) => turn.role === "user").length : 0;
}

/**
 * The most recent outbound business send: quick replies branch from it.
 * `forkPoint` = customer turns before it (the /api/step/fork turnIndex that
 * keeps the send in the prefix); `repliesAfter` = customer turns after it.
 */
export function latestOpener(session: InspectorSession | null | undefined): { index: number; text: string; forkPoint: number; repliesAfter: number } | null {
  if (!session) return null;
  const seeds = (session.outboundSeeds ?? []).filter((index) => session.transcript[index]?.role === "agent");
  if (!seeds.length) return null;
  const index = Math.max(...seeds);
  let before = 0;
  let after = 0;
  session.transcript.forEach((turn, position) => {
    if (turn.role !== "user") return;
    if (position < index) before += 1;
    else after += 1;
  });
  return { index, text: session.transcript[index].content, forkPoint: before, repliesAfter: after };
}

/**
 * Transcript index where a fork's own messages begin (everything before it
 * was inherited). Exact when the source run is loaded; otherwise inferred
 * from the fork's caller-turn count.
 */
export function forkBoundary(branch: InspectorSession, source?: InspectorSession): number | null {
  const fork = branch.forkedFrom;
  if (!fork) return null;
  const transcript = source ? source.transcript : branch.transcript;
  let seen = 0;
  for (let index = 0; index < transcript.length; index += 1) {
    if (transcript[index].role !== "user") continue;
    seen += 1;
    if (seen > fork.turnIndex) return index;
  }
  return transcript.length;
}

export function forkLabel(forkedFrom: { turnIndex: number } | undefined): string {
  if (!forkedFrom) return "";
  return forkedFrom.turnIndex === 0 ? "from the opener" : `after message ${forkedFrom.turnIndex}`;
}

// ── Payload helpers ──────────────────────────────────────────────────────────

interface EnvelopeLike {
  conversationState?: unknown;
  data?: { conversationState?: unknown; from?: unknown };
}

/** conversationState as the handler saw it on the latest turn. */
export function sessionConversationState(session: InspectorSession): unknown {
  const delivery = turnDeliveries(session).at(-1);
  const body = delivery?.request.body as EnvelopeLike | undefined;
  if (!body) return undefined;
  return body.conversationState ?? body.data?.conversationState ?? null;
}

/** The customer's number from the payload, for runs with no contact. */
export function sessionFromNumber(session: InspectorSession): string | undefined {
  for (const delivery of turnDeliveries(session)) {
    const from = (delivery.request.body as EnvelopeLike | undefined)?.data?.from;
    if (typeof from === "string" && from) return from;
  }
  return undefined;
}

// ── Fork families ────────────────────────────────────────────────────────────

/** All run ids connected to `anchorId` through forkedFrom links, in either direction. */
export function collectFamilyIds(anchorId: string, runs: InspectorSessionSummary[]): string[] {
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

// ── Clock ────────────────────────────────────────────────────────────────────

/** "+2d 3h", "−45m", or "real time" when within a minute of now. */
export function formatOffset(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 60_000) return "real time";
  const sign = ms < 0 ? "−" : "+";
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (!days && minutes) parts.push(`${minutes}m`);
  return `${sign}${parts.join(" ") || "0m"}`;
}
