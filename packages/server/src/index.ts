import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { SessionHistoryStore } from "./history.js";
import { buildJsonReport, buildMarkdownReport } from "./report.js";
import { buildScenarioFromSession, stringifyScenarioJson, stringifyScenarioYaml, type ScenarioExportOptions } from "./scenario-export.js";
import { compareRuns, type RunComparison, type RunComparisonOptions } from "./comparison.js";
import { parseRuntimeConfigUpdate, RuntimeConfigValidationError, type RuntimeConfigUpdate } from "./config.js";
import { DEFAULT_PORT_SCAN_ATTEMPTS, findAvailablePort, isAddressInUse } from "./ports.js";
import { StepController } from "./step-controller.js";
import { detectVoiceSupport, transcribeAudioBuffer, type VoiceSupport } from "./voice.js";
import { ContactsStore, type Contact, type ContactInput } from "./contacts.js";
import { EnvironmentsStore, type EnvironmentInput } from "./environments.js";
import { computeUsageStats } from "./stats.js";
import { listScenarios } from "./scenarios.js";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

// Voice tooling doesn't change while the server runs; detect once on demand.
let cachedVoiceSupport: VoiceSupport | undefined;
function detectVoiceSupportCached(): VoiceSupport {
  cachedVoiceSupport ??= detectVoiceSupport();
  return cachedVoiceSupport;
}
import {
  buildCallEndedEvent,
  buildMessageEvent,
  buildSignedDelivery,
  buildVoiceMessageEvent,
  dispatchSignedDelivery,
  evaluateScenario,
  id,
  injectDeliveryFaults,
  isoNow,
  loadScenarioFile,
  scenarioToRecentHistory,
  type AgentPhoneChannel,
  type AgentPhoneEnvelope,
  type AgentResponseChunk,
  type CallEndedEnvelope,
  type ConversationState,
  type DispatchResult,
  type DeliveryFault,
  type Scenario,
  type ScenarioResult,
  type SessionChannel,
  type SignedDelivery,
  type TranscriptTurn,
  isCallerTurn,
  parseDuration
} from "@agentphone-devtools/core";

export { buildJsonReport, buildMarkdownReport } from "./report.js";
export { compareRuns, type RunComparison, type RunComparisonOptions } from "./comparison.js";
export { parseRuntimeConfigUpdate, RuntimeConfigValidationError, type RuntimeConfigUpdate } from "./config.js";
export { findAvailablePort, isAddressInUse, isPortAvailable, DEFAULT_PORT_SCAN_ATTEMPTS } from "./ports.js";
export {
  buildScenarioFromSession,
  stringifyScenarioJson,
  stringifyScenarioYaml,
  type ScenarioExportDefaults,
  type ScenarioExportOptions
} from "./scenario-export.js";
export {
  StepController,
  type StepExpectResult,
  type StepQueueTurn,
  type StepState
} from "./step-controller.js";
export {
  detectVoiceSupport,
  startPushToTalk,
  transcribeAudioBuffer,
  transcribeWav,
  type PushToTalkRecording,
  type VoiceSupport
} from "./voice.js";
export { ContactsStore, type Contact, type ContactInput } from "./contacts.js";
export { EnvironmentsStore, type Environment, type EnvironmentInput, type EnvironmentView } from "./environments.js";
export { computeUsageStats, type UsageStats, type DailyActivity } from "./stats.js";
export { listScenarios, type ScenarioListing } from "./scenarios.js";

export interface DevtoolsServerConfig {
  targetUrl: string;
  secret: string;
  channel: SessionChannel;
  timeoutSeconds: number;
  contextLimit: number;
  port: number;
  host?: string;
  retryOnNon200?: boolean;
  historyPath: string;
  historyLimit: number;
}

export interface InspectorRequest {
  headers: Record<string, string>;
  rawBody: string;
  body: AgentPhoneEnvelope;
}

export interface InspectorResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  rawBody: string;
  parsed: DispatchResult["parsed"];
}

export interface InspectorDelivery {
  id: string;
  event: AgentPhoneEnvelope["event"];
  channel: AgentPhoneChannel;
  direction: "inbound";
  timestamp: string;
  webhookId: string;
  request: InspectorRequest;
  response: InspectorResponse;
  latencyMs: number;
  timedOut: boolean;
  ok: boolean;
  warnings: string[];
  retries: number;
  faults?: string[];
  replayOf?: {
    sessionId: string;
    deliveryId: string;
  };
  /**
   * Present on deliveries copied from a source run during a fork. The copy
   * preserves what the handler actually saw and returned on the shared
   * prefix; it was not re-sent by this session.
   */
  inheritedFrom?: {
    sessionId: string;
  };
}

/** A developer verdict on one caller turn's handler response. */
export interface TurnLabel {
  /** Zero-based caller-turn ordinal (first caller turn = 0). */
  turnIndex: number;
  verdict?: "good" | "bad";
  note?: string;
}

/**
 * The complete conversation state at a turn boundary. Because the webhook
 * contract carries all state in each request (recentHistory +
 * conversationState), this snapshot is sufficient to fork a conversation
 * exactly — the handler itself is stateless per request.
 */
export interface ConversationCheckpoint {
  recentHistory: Array<{ content: string; direction: "inbound" | "outbound"; channel: SessionChannel; at: string }>;
  conversationState: ConversationState;
}

export interface ReplayDeliveryInput {
  sessionId: string;
  deliveryId: string;
  body?: AgentPhoneEnvelope;
  targetUrl?: string;
  preserveWebhookId?: boolean;
  preserveTimestamp?: boolean;
  fault?: DeliveryFault;
}

/** A simulated customer: who the caller/texter is in a conversation. */
export interface SessionContact {
  id: string;
  name: string;
  number: string;
}

export interface InspectorSession {
  id: string;
  targetUrl: string;
  secretPreview: string;
  channel: SessionChannel;
  /** The simulated customer on this conversation, when one was chosen. */
  contact?: SessionContact;
  /**
   * ISO timestamp per transcript entry (aligned by index). Carries the
   * simulated clock, so a message thread can show real day/time gaps.
   */
  turnTimes?: string[];
  /**
   * Transcript indexes of agent messages that were seeded as outbound sends
   * (campaign openers, scheduled follow-ups) rather than webhook replies.
   */
  outboundSeeds?: number[];
  /** Virtual-clock offset from real time, in ms, at the last update. */
  clockOffsetMs?: number;
  status: "idle" | "running" | "ended";
  startedAt: string;
  endedAt?: string;
  conversationId: string;
  callId: string;
  transcript: TranscriptTurn[];
  deliveries: InspectorDelivery[];
  callEnded?: CallEndedEnvelope["data"];
  scenarioResult?: ScenarioResult;
  baseline?: {
    name: string;
    createdAt: string;
  };
  /**
   * Diagnostic warnings about handler behavior. Baseline comparison treats a
   * newly added warning as a regression, so only genuine handler-contract
   * problems belong here. Informational breadcrumbs go in `logs`.
   */
  warnings: string[];
  /**
   * Informational run breadcrumbs (scenario started, assertion outcomes).
   * Never used as a regression signal. Optional so history files and baseline
   * report artifacts written before this field existed still load.
   */
  logs?: string[];
  /**
   * The runtime settings this session actually ran with, so exporting a
   * saved run reproduces its real context window and timeout instead of
   * defaults. Optional so history written before this field existed loads.
   */
  runSettings?: {
    contextLimit: number;
    timeoutSeconds: number;
    retryOnNon200?: boolean;
  };
  /** Lineage when this session was forked from another run's checkpoint. */
  forkedFrom?: {
    sessionId: string;
    /** Number of caller turns inherited from the source run. */
    turnIndex: number;
  };
  /** Developer verdicts per caller turn; persisted with run history. */
  turnLabels?: TurnLabel[];
}

export interface InspectorSessionSummary {
  id: string;
  targetUrl: string;
  channel: SessionChannel;
  status: InspectorSession["status"];
  startedAt: string;
  endedAt?: string;
  transcriptTurns: number;
  deliveries: number;
  baselineName?: string;
  forkedFrom?: InspectorSession["forkedFrom"];
  /** Scenario outcome, when the run executed one. */
  scenarioPassed?: boolean;
  contact?: SessionContact;
  averageLatencyMs?: number;
  lastMessage?: string;
  lastActivityAt?: string;
}

type SseClient = {
  write: (event: string, data: unknown) => void;
  close: () => void;
};

type HistoryTurn = TranscriptTurn & { at: string; channel: SessionChannel };

export class DevtoolsRuntime {
  private readonly clients = new Set<SseClient>();
  private readonly history: HistoryTurn[] = [];
  private readonly sessionStore: SessionHistoryStore;
  private config: DevtoolsServerConfig;
  private conversationState: ConversationState = null;
  private session: InspectorSession;
  /**
   * Virtual clock: offset from real time. Payload timestamps and
   * recentHistory[].at use it so time-dependent handler logic is testable
   * without waiting. The HMAC timestamp header always uses real time, so
   * handlers' freshness checks keep working.
   */
  private clockOffsetMs = 0;

  /** Caller number for the payload when the session has no bound contact. */
  private callerNumber?: string;
  private contactResolver?: (number: string) => SessionContact | undefined;

  constructor(config: DevtoolsServerConfig) {
    this.config = config;
    this.sessionStore = new SessionHistoryStore(config.historyPath, config.historyLimit);
    this.session = this.newSession();
    if (this.sessionStore.loadWarning) this.session.warnings.push(this.sessionStore.loadWarning);
    this.persistSession();
  }

  getState(): InspectorSession {
    return this.withContact(structuredClone(this.session));
  }

  getHistory(): InspectorSessionSummary[] {
    return this.sessionStore
      .list()
      .filter((session) => session.id === this.session.id || session.status !== "idle" || session.transcript.length > 0 || session.deliveries.length > 0)
      .map((session) => summarizeSession(this.withContact(session)));
  }

  getHistorySession(sessionId: string): InspectorSession | undefined {
    if (sessionId === this.session.id) return this.getState();
    const stored = this.sessionStore.get(sessionId);
    return stored ? this.withContact(stored) : undefined;
  }

  /**
   * Runs recorded without a bound contact still carry the caller's number in
   * every payload. Resolving it at read time lets older history show up
   * under the right person without rewriting what was stored.
   */
  private withContact(session: InspectorSession): InspectorSession {
    if (session.contact || !this.contactResolver) return session;
    const first = session.deliveries.find((delivery) => delivery.event === "agent.message");
    const from = (first?.request.body as { data?: { from?: unknown } } | undefined)?.data?.from;
    const contact = typeof from === "string" ? this.resolveContact(from) : undefined;
    return contact ? { ...session, contact } : session;
  }

  getScenarioExport(sessionId: string, options: ScenarioExportOptions = {}): Scenario | undefined {
    const session = this.getHistorySession(sessionId);
    if (!session) return undefined;
    const active = sessionId === this.session.id;
    return buildScenarioFromSession(
      session,
      {
        contextLimit: active ? this.config.contextLimit : session.runSettings?.contextLimit ?? 10,
        timeoutSeconds: active ? this.config.timeoutSeconds : session.runSettings?.timeoutSeconds ?? 30,
        conversationState: active ? this.conversationState : extractConversationState(session)
      },
      options
    );
  }

  deleteHistorySession(sessionId: string): boolean {
    if (sessionId === this.session.id) return false;
    const deleted = this.sessionStore.delete(sessionId);
    if (deleted) this.emit("history", this.getHistory());
    return deleted;
  }

  /** Delete every saved run except the live session. */
  clearHistory(): number {
    let removed = 0;
    for (const session of this.sessionStore.list()) {
      if (session.id === this.session.id) continue;
      if (this.sessionStore.delete(session.id)) removed += 1;
    }
    this.emit("history", this.getHistory());
    return removed;
  }

  setBaseline(sessionId: string, name?: string): InspectorSession | null {
    const baseline = { name: name?.trim() || `Baseline ${sessionId}`, createdAt: isoNow() };
    if (sessionId === this.session.id) {
      this.session.baseline = baseline;
      this.publishState();
      return this.getState();
    }
    const session = this.sessionStore.get(sessionId);
    if (!session) return null;
    session.baseline = baseline;
    this.sessionStore.upsert(session);
    this.emit("history", this.getHistory());
    return session;
  }

  clearBaseline(sessionId: string): InspectorSession | null {
    if (sessionId === this.session.id) {
      delete this.session.baseline;
      this.publishState();
      return this.getState();
    }
    const session = this.sessionStore.get(sessionId);
    if (!session) return null;
    delete session.baseline;
    this.sessionStore.upsert(session);
    this.emit("history", this.getHistory());
    return session;
  }

  compareHistorySessions(
    baselineSessionId: string,
    candidateSessionId: string,
    options?: RunComparisonOptions
  ): RunComparison | null {
    const baseline = this.getHistorySession(baselineSessionId);
    const candidate = this.getHistorySession(candidateSessionId);
    if (!baseline || !candidate) return null;
    return compareRuns(baseline, candidate, options);
  }

  reset(
    update?: RuntimeConfigUpdate & { conversationState?: ConversationState; contact?: SessionContact | null; from?: string }
  ): InspectorSession {
    let contact: SessionContact | undefined;
    let from: string | undefined;
    if (update) {
      const { conversationState, contact: nextContact, from: nextFrom, ...configUpdate } = update;
      this.config = { ...this.config, ...parseRuntimeConfigUpdate(configUpdate) };
      this.conversationState = conversationState ?? null;
      contact = nextContact ?? undefined;
      from = nextFrom;
    } else {
      this.conversationState = null;
    }
    if (isUntouchedSession(this.session)) this.sessionStore.delete(this.session.id);
    this.history.length = 0;
    this.clockOffsetMs = 0;
    this.callerNumber = undefined;
    this.session = this.newSession();
    // A scenario's `from` binds the run to a known contact when one has that
    // number; otherwise it is still the number the payload reports.
    if (!contact && from) contact = this.resolveContact(from);
    if (contact) this.session.contact = { ...contact };
    else if (from) this.callerNumber = from;
    this.publishState();
    return this.getState();
  }

  /** Look a caller number up in the contacts the server knows about. */
  resolveContact(number: string | undefined): SessionContact | undefined {
    if (!number || !this.contactResolver) return undefined;
    const contact = this.contactResolver(number);
    return contact ? { id: contact.id, name: contact.name, number: contact.number } : undefined;
  }

  setContactResolver(resolver: ((number: string) => SessionContact | undefined) | undefined): void {
    this.contactResolver = resolver;
  }

  /** Current simulated time (real time plus the virtual-clock offset). */
  now(): string {
    return isoNow(new Date(Date.now() + this.clockOffsetMs));
  }

  clockOffset(): number {
    return this.clockOffsetMs;
  }

  /** Move the simulated clock forward. Never waits; only future timestamps change. */
  advanceClock(ms: number): InspectorSession {
    if (!Number.isFinite(ms) || ms < 0) throw new Error("Clock can only move forward");
    this.clockOffsetMs += Math.round(ms);
    this.session.clockOffsetMs = this.clockOffsetMs;
    this.pushLog(`Simulated clock advanced by ${formatOffset(ms)}`);
    this.publishState();
    return this.getState();
  }

  /** Pin the simulated clock to an absolute time (scenario startAt). */
  setClock(iso: string): InspectorSession {
    const target = Date.parse(iso);
    if (Number.isNaN(target)) throw new Error(`Invalid clock time: ${iso}`);
    this.clockOffsetMs = target - Date.now();
    this.session.clockOffsetMs = this.clockOffsetMs;
    this.publishState();
    return this.getState();
  }

  /**
   * Record an outbound message the business sent outside the webhook — a
   * campaign opener or scheduled follow-up sent through the send API. It
   * enters the transcript and rolling history so later inbound replies
   * reach the handler with the real context; nothing is delivered for it.
   */
  seedAgentMessage(text: string, channel: SessionChannel = this.config.channel): InspectorSession {
    const content = text.trim();
    if (!content) throw new Error("Outbound message text must not be empty");
    this.session.status = "running";
    if (this.session.transcript.length === 0) this.session.channel = channel;
    this.pushTranscript({ role: "agent", content }, this.now(), channel);
    (this.session.outboundSeeds ??= []).push(this.session.transcript.length - 1);
    this.publishState();
    return this.getState();
  }

  subscribe(client: SseClient): () => void {
    this.clients.add(client);
    client.write("state", this.getState());
    client.write("history", this.getHistory());
    return () => {
      client.close();
      this.clients.delete(client);
    };
  }

  async sendCallerTurn(text: string, channel: SessionChannel = this.config.channel, fault?: DeliveryFault): Promise<InspectorDelivery> {
    this.session.status = "running";
    const timestamp = this.now();
    const recentHistory = scenarioToRecentHistory(this.history, this.config.contextLimit);
    const from = this.session.contact?.number ?? this.callerNumber;
    const payload =
      channel === "voice"
        ? buildVoiceMessageEvent({
            transcript: text,
            timestamp,
            callId: this.session.callId,
            agentId: "agt_local",
            conversationState: this.conversationState,
            recentHistory,
            ...(from ? { from } : {})
          })
        : buildMessageEvent({
            message: text,
            channel,
            timestamp,
            conversationId: this.session.conversationId,
            agentId: "agt_local",
            conversationState: this.conversationState,
            recentHistory,
            ...(from ? { from } : {})
          });

    // A run's channel is whatever its first turn used, so a session opened
    // on the CLI default can still become an iMessage thread or a call.
    if (this.session.transcript.length === 0) this.session.channel = channel;
    this.pushTranscript({ role: "user", content: text }, timestamp, channel);
    const delivery = await this.dispatchAndRecord(payload, fault);
    this.recordAgentResponse(delivery, channel);
    this.publishState();
    return delivery;
  }

  async endCall(options: { disconnectionReason?: string; callSuccessful?: boolean } = {}): Promise<InspectorDelivery | null> {
    this.session.status = "ended";
    this.session.endedAt = this.now();

    if (this.session.channel !== "voice") {
      this.publishState();
      return null;
    }

    const payload = buildCallEndedEvent({
      callId: this.session.callId,
      startedAt: this.session.startedAt,
      endedAt: this.session.endedAt,
      transcript: this.session.transcript,
      disconnectionReason: options.disconnectionReason ?? "agent_hangup",
      callSuccessful: options.callSuccessful
    });
    const delivery = await this.dispatchAndRecord(payload);
    this.session.callEnded = payload.data;
    this.publishState();
    return delivery;
  }

  async runScenario(scenarioPathOrObject: string | Scenario, overrides: RuntimeConfigUpdate = {}): Promise<InspectorSession> {
    const scenario = typeof scenarioPathOrObject === "string" ? await loadScenarioFile(scenarioPathOrObject) : scenarioPathOrObject;
    this.reset({
      targetUrl: overrides.targetUrl ?? this.config.targetUrl,
      secret: overrides.secret ?? this.config.secret,
      channel: overrides.channel ?? scenario.channel,
      timeoutSeconds: overrides.timeoutSeconds ?? scenario.timeoutSeconds,
      contextLimit: overrides.contextLimit ?? scenario.contextLimit,
      retryOnNon200: overrides.retryOnNon200 ?? this.config.retryOnNon200,
      conversationState: scenario.conversationState,
      from: scenario.from
    });

    this.pushLog(`Running scenario: ${scenario.name}`);
    if (scenario.startAt) this.setClock(scenario.startAt);
    this.publishState();

    const turnDeliveries: InspectorDelivery[] = [];
    for (const turn of scenario.turns) {
      if (turn.after !== undefined) this.advanceClock(parseDuration(turn.after));
      if (!isCallerTurn(turn)) {
        this.seedAgentMessage(turn.agent, scenario.channel);
        continue;
      }
      turnDeliveries.push(await this.sendCallerTurn(turn.caller, scenario.channel, turn.fault));
      if (turn.waitMs) await new Promise((resolve) => setTimeout(resolve, turn.waitMs));
    }

    const callEndedDelivery = await this.endCall();
    this.session.scenarioResult = evaluateScenario(scenario, {
      turns: turnDeliveries.map(toScenarioTurnObservation),
      ...(callEndedDelivery ? { callEnded: toScenarioTurnObservation(callEndedDelivery) } : {})
    });
    // Assertion outcomes are already first-class in `scenarioResult`. Logging
    // them here keeps them visible without double-counting a failed assertion
    // as a baseline warning regression.
    for (const assertion of this.session.scenarioResult.assertions) {
      if (!assertion.passed) this.pushLog(assertion.message);
    }
    this.publishState();
    return this.getState();
  }

  async replayDelivery(input: ReplayDeliveryInput): Promise<InspectorDelivery | null> {
    const sourceSession = this.getHistorySession(input.sessionId);
    const source = sourceSession?.deliveries.find((delivery) => delivery.id === input.deliveryId);
    if (!source) return null;

    const payload = structuredClone(input.body ?? source.request.body);
    const timestampSeconds = input.preserveTimestamp
      ? Number.parseInt(source.request.headers["X-Webhook-Timestamp"] ?? "", 10)
      : undefined;
    const initial = buildSignedDelivery(payload, {
      secret: this.config.secret,
      ...(input.preserveWebhookId ? { webhookId: source.webhookId } : {}),
      ...(Number.isFinite(timestampSeconds) ? { timestampSeconds } : {})
    });
    const injected = injectDeliveryFaults(initial, input.fault, {
      secret: this.config.secret,
      previousWebhookId: this.session.deliveries.at(-1)?.webhookId
    });
    const replayTarget = input.targetUrl ? parseRuntimeConfigUpdate({ targetUrl: input.targetUrl }).targetUrl : undefined;
    const delivery = await this.dispatchSignedAndRecord(injected.delivery, {
      appliedFaults: injected.applied,
      simulateTimeout: input.fault?.simulateTimeout === true,
      targetUrl: replayTarget,
      replayOf: { sessionId: input.sessionId, deliveryId: input.deliveryId }
    });
    this.publishState();
    return delivery;
  }

  /**
   * The state the next webhook payload will carry: rolling history capped at
   * the configured context limit, plus the session's conversation state.
   */
  conversationSnapshot(): ConversationCheckpoint {
    return {
      recentHistory: scenarioToRecentHistory(this.history, this.config.contextLimit),
      conversationState: structuredClone(this.conversationState)
    };
  }

  /** Attach or replace a developer verdict on one caller turn. */
  setTurnLabel(sessionId: string, label: TurnLabel): InspectorSession | null {
    const live = sessionId === this.session.id;
    const session = live ? this.session : this.sessionStore.get(sessionId);
    if (!session) return null;
    const totalCallerTurns = session.transcript.filter((turn) => turn.role === "user").length;
    if (!Number.isInteger(label.turnIndex) || label.turnIndex < 0 || label.turnIndex >= totalCallerTurns) {
      throw new Error(`turnIndex must identify a completed caller turn (0..${totalCallerTurns - 1})`);
    }
    const labels = (session.turnLabels ?? []).filter((existing) => existing.turnIndex !== label.turnIndex);
    labels.push({ ...label });
    labels.sort((a, b) => a.turnIndex - b.turnIndex);
    session.turnLabels = labels;
    if (live) {
      this.publishState();
      return this.getState();
    }
    this.sessionStore.upsert(session);
    this.emit("history", this.getHistory());
    return session;
  }

  /**
   * Start a new run from another run's turn boundary. The checkpoint is the
   * source's (recentHistory, conversationState) after `callerTurns` completed
   * caller turns. Because the webhook contract carries all conversation state
   * in every request, that pair is a complete state capture: the fork is
   * exact, not approximate. The prefix transcript and its deliveries are
   * copied (marked inherited) so exports and reports cover the whole path;
   * nothing is re-sent to the handler.
   */
  forkFromSession(sourceSessionId: string, callerTurns: number): InspectorSession {
    const source = this.getHistorySession(sourceSessionId);
    if (!source) throw new Error(`No run found with id ${sourceSessionId}`);
    const totalCallerTurns = source.transcript.filter((turn) => turn.role === "user").length;
    const leadingSeeds = (source.outboundSeeds ?? []).length > 0;
    const minimumTurn = leadingSeeds ? 0 : 1;
    if (!Number.isInteger(callerTurns) || callerTurns < minimumTurn || callerTurns > totalCallerTurns) {
      throw new Error(`Fork point must be a completed caller turn between ${minimumTurn} and ${totalCallerTurns}`);
    }

    const forkingLive = sourceSessionId === this.session.id;
    const conversationState = forkingLive
      ? structuredClone(this.conversationState)
      : extractConversationState(source, Math.max(callerTurns, 1));
    const sourceClockOffset = forkingLive ? this.clockOffsetMs : source.clockOffsetMs ?? 0;
    if (forkingLive) this.persistSession();

    // Prefix ends just before the caller turn after the fork point, so the
    // agent reply to the fork-point turn is included.
    let seenCallerTurns = 0;
    let prefixLength = source.transcript.length;
    for (let index = 0; index < source.transcript.length; index += 1) {
      if (source.transcript[index].role === "user") {
        seenCallerTurns += 1;
        if (seenCallerTurns > callerTurns) {
          prefixLength = index;
          break;
        }
      }
    }
    const prefix = source.transcript.slice(0, prefixLength);
    const sourceTurnDeliveries = source.deliveries.filter(
      (delivery) => delivery.event === "agent.message" && !delivery.replayOf
    );

    this.reset({ channel: source.channel, conversationState, contact: source.contact ?? null });
    this.session.forkedFrom = { sessionId: source.id, turnIndex: callerTurns };
    this.session.status = "running";
    // Each inherited turn keeps its own timestamp (the source's per-turn
    // record when present, else its delivery's), so the forked run's
    // recentHistory reflects the source's real timing.
    let prefixCallerIndex = -1;
    prefix.forEach((turn, index) => {
      if (turn.role === "user") prefixCallerIndex += 1;
      const at =
        source.turnTimes?.[index] ??
        (prefixCallerIndex >= 0 ? sourceTurnDeliveries[prefixCallerIndex]?.timestamp : undefined) ??
        source.startedAt;
      this.pushTranscript({ ...turn }, at, source.channel);
    });
    const inheritedSeeds = (source.outboundSeeds ?? []).filter((index) => index < prefix.length);
    if (inheritedSeeds.length) this.session.outboundSeeds = [...inheritedSeeds];
    // The branch continues from the source's simulated time, never earlier
    // than its last inherited turn.
    const lastInheritedAt = this.history.at(-1)?.at;
    const lastInheritedOffset = lastInheritedAt ? Date.parse(lastInheritedAt) - Date.now() : Number.NEGATIVE_INFINITY;
    this.clockOffsetMs = Math.max(sourceClockOffset, lastInheritedOffset);
    this.session.clockOffsetMs = this.clockOffsetMs;
    this.session.deliveries = sourceTurnDeliveries
      .slice(0, callerTurns)
      .map((delivery) => ({ ...structuredClone(delivery), inheritedFrom: { sessionId: source.id } }));
    this.pushLog(`Forked from run ${source.id} after turn ${callerTurns}`);
    this.publishState();
    return this.getState();
  }

  private async dispatchAndRecord(payload: AgentPhoneEnvelope, fault?: DeliveryFault): Promise<InspectorDelivery> {
    const initial = buildSignedDelivery(payload, { secret: this.config.secret });
    const injected = injectDeliveryFaults(initial, fault, {
      secret: this.config.secret,
      previousWebhookId: this.session.deliveries.at(-1)?.webhookId
    });
    return this.dispatchSignedAndRecord(injected.delivery, {
      appliedFaults: injected.applied,
      simulateTimeout: fault?.simulateTimeout === true
    });
  }

  private async dispatchSignedAndRecord(
    signed: SignedDelivery,
    options: {
      appliedFaults?: string[];
      simulateTimeout?: boolean;
      targetUrl?: string;
      replayOf?: InspectorDelivery["replayOf"];
    } = {}
  ): Promise<InspectorDelivery> {
    const { result, retries } = await this.dispatchPossiblyWithRetry(
      signed,
      options.simulateTimeout === true,
      options.targetUrl
    );
    const delivery: InspectorDelivery = {
      id: id("del"),
      event: signed.payload.event,
      channel: signed.payload.channel,
      direction: "inbound",
      timestamp: signed.payload.timestamp,
      webhookId: signed.webhookId,
      request: {
        headers: signed.headers,
        rawBody: signed.rawBody,
        body: signed.payload
      },
      response: {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
        rawBody: result.rawResponseBody,
        parsed: result.parsed
      },
      latencyMs: result.latencyMs,
      timedOut: result.timedOut,
      ok: result.ok,
      warnings: [...result.parsed.warnings, ...(result.error ? [result.error] : [])],
      retries,
      ...(options.appliedFaults?.length ? { faults: options.appliedFaults } : {}),
      ...(options.replayOf ? { replayOf: options.replayOf } : {})
    };

    this.session.deliveries.push(delivery);
    this.persistSession();
    this.emit("delivery", delivery);
    return delivery;
  }

  private async dispatchPossiblyWithRetry(
    signed: SignedDelivery,
    simulateTimeout = false,
    targetUrl = this.config.targetUrl
  ): Promise<{ result: DispatchResult; retries: number }> {
    const delays = simulateTimeout ? [0, 1, 1, 1, 1, 1] : [0, 250, 750, 1500, 3000, 5000];
    let result: DispatchResult | undefined;
    let retries = 0;

    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      result = simulateTimeout
        ? simulatedTimeoutResult(this.config.timeoutSeconds)
        : await dispatchSignedDelivery(signed, {
            targetUrl,
            timeoutSeconds: this.config.timeoutSeconds,
            onChunk: (chunk: AgentResponseChunk) => this.emit("chunk", chunk)
          });
      if (!this.config.retryOnNon200 || result.ok) return { result, retries };
      if (attempt < delays.length - 1) {
        retries += 1;
        this.session.warnings.push(`Retry ${retries} scheduled after HTTP ${result.status}`);
        this.publishState();
      }
    }

    if (!result) throw new Error("Dispatch loop exited before making a request");
    return { result, retries };
  }

  private recordAgentResponse(delivery: InspectorDelivery, channel: SessionChannel): void {
    const parsed = delivery.response.parsed;
    const responseText = parsed.final?.text ?? parsed.chunks.find((chunk) => chunk.text && !chunk.interim)?.text ?? fallbackSmsText(delivery);
    if (!responseText) return;
    this.pushTranscript({ role: "agent", content: responseText }, this.now(), channel);
  }

  private pushTranscript(turn: TranscriptTurn, at: string, channel: SessionChannel): void {
    this.session.transcript.push(turn);
    (this.session.turnTimes ??= []).push(at);
    this.history.push({ ...turn, at, channel });
  }

  /** Record an informational breadcrumb. Never a baseline regression signal. */
  private pushLog(message: string): void {
    (this.session.logs ??= []).push(message);
  }

  private newSession(): InspectorSession {
    const startedAt = isoNow();
    return {
      id: id("sess"),
      targetUrl: this.config.targetUrl,
      secretPreview: maskSecret(this.config.secret),
      channel: this.config.channel,
      status: "idle",
      startedAt,
      conversationId: id("conv"),
      callId: id("call"),
      transcript: [],
      deliveries: [],
      warnings: [],
      logs: [],
      turnTimes: [],
      clockOffsetMs: this.clockOffsetMs,
      runSettings: {
        contextLimit: this.config.contextLimit,
        timeoutSeconds: this.config.timeoutSeconds,
        retryOnNon200: this.config.retryOnNon200 === true
      }
    };
  }

  private persistSession(): void {
    this.sessionStore.upsert(this.session);
  }

  private publishState(): void {
    this.persistSession();
    this.emit("state", this.getState());
    this.emit("history", this.getHistory());
  }

  /** Broadcast a custom event to all SSE subscribers (used by StepController). */
  publishEvent(event: string, data: unknown): void {
    this.emit(event, data);
  }

  private emit(event: string, data: unknown): void {
    for (const client of this.clients) client.write(event, data);
  }
}

export async function createDevtoolsServer(config: DevtoolsServerConfig): Promise<{ app: FastifyInstance; runtime: DevtoolsRuntime; step: StepController }> {
  const app = Fastify({ logger: false });
  const runtime = new DevtoolsRuntime(config);
  const step: StepController = new StepController(runtime, () => runtime.publishEvent("step", step.state()));
  const dataDir = dirname(config.historyPath);
  const contacts = new ContactsStore(join(dataDir, "contacts.json"));
  const environments = new EnvironmentsStore(join(dataDir, "environments.json"));
  runtime.setContactResolver((number) => contacts.list().find((contact) => contact.number === number));
  const scenarioDirectories = ["examples/scenarios", "examples/messaging", "examples/compliance", "examples/faults", ".agentphone-devtools/exports"];

  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));
  app.get("/api/state", async () => runtime.getState());
  app.get("/api/history", async () => runtime.getHistory());

  app.get<{ Params: { sessionId: string } }>("/api/history/:sessionId", async (request, reply) => {
    const session = runtime.getHistorySession(request.params.sessionId);
    if (!session) return reply.code(404).send({ error: "session not found" });
    return session;
  });

  app.get<{ Params: { sessionId: string } }>("/api/history/:sessionId/report.json", async (request, reply) => {
    const session = runtime.getHistorySession(request.params.sessionId);
    if (!session) return reply.code(404).send({ error: "session not found" });
    return reply
      .header("Content-Disposition", `attachment; filename="${reportFilename(session.id, "json")}"`)
      .type("application/json")
      .send(buildJsonReport(session));
  });

  app.get<{ Params: { sessionId: string } }>("/api/history/:sessionId/report.md", async (request, reply) => {
    const session = runtime.getHistorySession(request.params.sessionId);
    if (!session) return reply.code(404).send({ error: "session not found" });
    return reply
      .header("Content-Disposition", `attachment; filename="${reportFilename(session.id, "md")}"`)
      .type("text/markdown; charset=utf-8")
      .send(buildMarkdownReport(session));
  });

  app.get<{ Params: { sessionId: string }; Querystring: { assertions?: string } }>(
    "/api/history/:sessionId/scenario.json",
    async (request, reply) => {
      const scenario = runtime.getScenarioExport(request.params.sessionId, exportOptionsFromQuery(request.query));
      if (!scenario) return reply.code(404).send({ error: "session not found" });
      if (!scenario.turns.length) return reply.code(422).send({ error: "session has no caller turns to export" });
      return reply
        .header("Content-Disposition", `attachment; filename="${scenarioFilename(request.params.sessionId, "json")}"`)
        .type("application/json")
        .send(stringifyScenarioJson(scenario));
    }
  );

  app.get<{ Params: { sessionId: string }; Querystring: { assertions?: string } }>(
    "/api/history/:sessionId/scenario.yaml",
    async (request, reply) => {
      const scenario = runtime.getScenarioExport(request.params.sessionId, exportOptionsFromQuery(request.query));
      if (!scenario) return reply.code(404).send({ error: "session not found" });
      if (!scenario.turns.length) return reply.code(422).send({ error: "session has no caller turns to export" });
      return reply
        .header("Content-Disposition", `attachment; filename="${scenarioFilename(request.params.sessionId, "yaml")}"`)
        .type("application/yaml; charset=utf-8")
        .send(stringifyScenarioYaml(scenario));
    }
  );

  // Save a run as a scenario file under .agentphone-devtools/exports so it
  // shows up in the scenario picker and can be replayed or run in CI.
  app.post<{ Params: { sessionId: string }; Body: { name?: string; assertions?: boolean; format?: "yaml" | "json" } }>(
    "/api/history/:sessionId/export",
    async (request, reply) => {
      const body = request.body ?? {};
      const scenario = runtime.getScenarioExport(request.params.sessionId, { scaffoldAssertions: body.assertions !== false });
      if (!scenario) return reply.code(404).send({ error: "session not found" });
      if (!scenario.turns.length) return reply.code(422).send({ error: "session has no caller turns to export" });
      const trimmedName = (body.name ?? "").trim();
      if (trimmedName) scenario.name = trimmedName;
      const format = body.format === "json" ? "json" : "yaml";
      const slug = (trimmedName || `run-${request.params.sessionId}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || `run-${request.params.sessionId}`;
      const directory = resolve(process.cwd(), ".agentphone-devtools/exports");
      mkdirSync(directory, { recursive: true });
      const filePath = join(directory, `${slug}.${format}`);
      writeFileSync(filePath, format === "json" ? stringifyScenarioJson(scenario) : stringifyScenarioYaml(scenario), "utf8");
      return { path: `.agentphone-devtools/exports/${slug}.${format}`, name: scenario.name, turns: scenario.turns.length };
    }
  );

  app.delete<{ Params: { sessionId: string } }>("/api/history/:sessionId", async (request, reply) => {
    if (request.params.sessionId === runtime.getState().id) {
      return reply.code(409).send({ error: "the active session cannot be deleted" });
    }
    if (!runtime.deleteHistorySession(request.params.sessionId)) {
      return reply.code(404).send({ error: "session not found" });
    }
    return reply.code(204).send();
  });

  app.post<{ Params: { sessionId: string }; Body: { name?: string } }>(
    "/api/history/:sessionId/baseline",
    async (request, reply) => {
      const session = runtime.setBaseline(request.params.sessionId, request.body?.name);
      if (!session) return reply.code(404).send({ error: "session not found" });
      return session;
    }
  );

  app.delete<{ Params: { sessionId: string } }>("/api/history/:sessionId/baseline", async (request, reply) => {
    const session = runtime.clearBaseline(request.params.sessionId);
    if (!session) return reply.code(404).send({ error: "session not found" });
    return session;
  });

  app.get<{
    Params: { baselineSessionId: string; candidateSessionId: string };
    Querystring: {
      maxLatencyIncreasePercent?: string;
      latencyGraceMs?: string;
    };
  }>("/api/compare/:baselineSessionId/:candidateSessionId", async (request, reply) => {
    const comparison = runtime.compareHistorySessions(
      request.params.baselineSessionId,
      request.params.candidateSessionId,
      comparisonOptionsFromQuery(request.query)
    );
    if (!comparison) return reply.code(404).send({ error: "baseline or candidate session not found" });
    return comparison;
  });

  app.post<{
    Body: RuntimeConfigUpdate & { conversationState?: ConversationState };
  }>("/api/reset", async (request, reply) => {
    try {
      return runtime.reset(request.body);
    } catch (error) {
      return sendConfigValidationError(reply, error);
    }
  });

  app.post<{
    Body: { text: string; channel?: SessionChannel; fault?: DeliveryFault };
  }>("/api/send", async (request, reply) => {
    if (!request.body?.text) return reply.code(400).send({ error: "text is required" });
    return runtime.sendCallerTurn(request.body.text, request.body.channel, request.body.fault);
  });

  app.post<{
    Body: { disconnectionReason?: string; callSuccessful?: boolean };
  }>("/api/end-call", async (request) => runtime.endCall(request.body ?? {}));

  app.post<{
    Body: { path?: string; scenario?: Scenario; overrides?: RuntimeConfigUpdate };
  }>("/api/scenario", async (request, reply) => {
    const body = request.body ?? {};
    if (!body.path && !body.scenario) return reply.code(400).send({ error: "path or scenario is required" });
    return runtime.runScenario(body.scenario ?? body.path!, body.overrides ?? {});
  });

  app.post<{ Params: { sessionId: string }; Body: TurnLabel }>(
    "/api/history/:sessionId/labels",
    async (request, reply) => {
      try {
        const session = runtime.setTurnLabel(request.params.sessionId, {
          turnIndex: request.body?.turnIndex,
          ...(request.body?.verdict ? { verdict: request.body.verdict } : {}),
          ...(request.body?.note ? { note: request.body.note } : {})
        } as TurnLabel);
        if (!session) return reply.code(404).send({ error: "session not found" });
        return session;
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
      }
    }
  );

  // Voice input is a developer convenience for dictating caller turns —
  // NOT a simulation of AgentPhone's STT pipeline. Transcription runs
  // entirely locally (whisper.cpp); when unavailable, typed input is
  // unaffected.
  app.addContentTypeParser(["audio/webm", "audio/ogg", "audio/wav", "audio/mp4", "application/octet-stream"], { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.get("/api/voice", async () => {
    const support = detectVoiceSupportCached();
    return { available: support.available, ...(support.reason ? { reason: support.reason } : {}) };
  });

  app.post("/api/voice/transcribe", async (request, reply) => {
    const support = detectVoiceSupportCached();
    if (!support.available) return reply.code(503).send({ error: support.reason ?? "Voice input is not available" });
    if (!Buffer.isBuffer(request.body) || request.body.length < 128) {
      return reply.code(400).send({ error: "Send raw audio bytes (audio/webm, audio/wav, …) as the request body" });
    }
    try {
      const text = await transcribeAudioBuffer(request.body, support);
      return { text };
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/step", async () => step.state());

  app.post<{
    Body: { scenarioPath?: string; sessionId?: string; contactId?: string; channel?: SessionChannel; blank?: boolean };
  }>("/api/step/start", async (request, reply) => {
    const body = request.body ?? {};
    try {
      const contact = body.contactId ? contacts.get(body.contactId) : undefined;
      if (body.contactId && !contact) return reply.code(404).send({ error: "contact not found" });
      const sessionContact = contact ? { id: contact.id, name: contact.name, number: contact.number } : undefined;
      if (body.scenarioPath) return step.startFromScenario(await loadScenarioFile(body.scenarioPath), sessionContact);
      if (body.sessionId) return step.startFromSession(body.sessionId);
      if (body.blank || contact) {
        return step.startBlank(body.channel ?? contact?.channel ?? runtime.getState().channel, sessionContact, contact?.conversationState ?? null);
      }
      return reply.code(400).send({ error: "scenarioPath, sessionId, contactId, or blank is required" });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/step/drop", async (_request, reply) => {
    try {
      return step.dropNext();
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Body: { duration?: string | number } }>("/api/step/warp", async (request, reply) => {
    try {
      return step.warp(request.body?.duration ?? "");
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Body: { text?: string; after?: string | number } }>("/api/step/agent", async (request, reply) => {
    try {
      return step.addAgentTurn(request.body?.text ?? "", request.body?.after);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/step/send", async (_request, reply) => {
    try {
      return (await step.sendNext()).state;
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Body: { caller?: string } }>("/api/step/edit", async (request, reply) => {
    try {
      return step.editNext(request.body?.caller ?? "");
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Body: { caller?: string } }>("/api/step/add", async (request, reply) => {
    try {
      return step.addTurn(request.body?.caller ?? "");
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Body: { turnIndex?: number; caller?: string; sessionId?: string } }>(
    "/api/step/fork",
    async (request, reply) => {
      const body = request.body ?? {};
      try {
        return step.fork(Number(body.turnIndex), {
          ...(body.sessionId ? { sessionId: body.sessionId } : {}),
          ...(body.caller ? { caller: body.caller } : {})
        });
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
      }
    }
  );

  app.post("/api/step/end", async (_request, reply) => {
    try {
      return await step.end();
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{
    Body: ReplayDeliveryInput;
  }>("/api/replay", async (request, reply) => {
    const body = request.body;
    if (!body?.sessionId || !body.deliveryId) {
      return reply.code(400).send({ error: "sessionId and deliveryId are required" });
    }
    if (body.body && !isAgentPhoneEnvelope(body.body)) {
      return reply.code(400).send({ error: "body must be an AgentPhone event envelope" });
    }
    let delivery: InspectorDelivery | null;
    try {
      delivery = await runtime.replayDelivery(body);
    } catch (error) {
      return sendConfigValidationError(reply, error);
    }
    if (!delivery) return reply.code(404).send({ error: "source delivery not found" });
    return delivery;
  });

  // ── Simulated clock ───────────────────────────────────────────────────────
  app.get("/api/clock", async () => ({ offsetMs: runtime.clockOffset(), now: runtime.now() }));

  app.post<{ Body: { duration?: string | number } }>("/api/clock/advance", async (request, reply) => {
    try {
      const ms = parseDuration(request.body?.duration ?? "");
      runtime.advanceClock(ms);
      step.state();
      runtime.publishEvent("step", step.state());
      return { offsetMs: runtime.clockOffset(), now: runtime.now() };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Body: { at?: string } }>("/api/clock/set", async (request, reply) => {
    try {
      runtime.setClock(request.body?.at ?? "");
      runtime.publishEvent("step", step.state());
      return { offsetMs: runtime.clockOffset(), now: runtime.now() };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ── Outbound seeds (campaign openers, follow-ups sent outside the webhook) ─
  app.post<{ Body: { text?: string; channel?: SessionChannel } }>("/api/seed-agent-message", async (request, reply) => {
    try {
      return runtime.seedAgentMessage(request.body?.text ?? "", request.body?.channel);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ── Conversations: start a fresh live session with a contact ─────────────
  app.post<{ Body: { contactId?: string; channel?: SessionChannel; conversationState?: ConversationState } }>(
    "/api/conversations/start",
    async (request, reply) => {
      const body = request.body ?? {};
      const contact = body.contactId ? contacts.get(body.contactId) : undefined;
      if (body.contactId && !contact) return reply.code(404).send({ error: "contact not found" });
      try {
        return runtime.reset({
          ...(body.channel ?? contact?.channel ? { channel: body.channel ?? contact?.channel } : {}),
          conversationState: body.conversationState ?? contact?.conversationState ?? null,
          ...(contact ? { contact: { id: contact.id, name: contact.name, number: contact.number } } : {})
        });
      } catch (error) {
        return sendConfigValidationError(reply, error);
      }
    }
  );

  // ── Scenario discovery ────────────────────────────────────────────────────
  app.get("/api/scenarios", async () => listScenarios(scenarioDirectories));

  // ── Contacts ──────────────────────────────────────────────────────────────
  app.get("/api/contacts", async () => contacts.list());
  app.post<{ Body: ContactInput }>("/api/contacts", async (request, reply) => {
    try {
      return contacts.upsert(request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.put<{ Params: { contactId: string }; Body: ContactInput }>("/api/contacts/:contactId", async (request, reply) => {
    if (!contacts.get(request.params.contactId)) return reply.code(404).send({ error: "contact not found" });
    try {
      return contacts.upsert({ ...request.body, id: request.params.contactId });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.delete<{ Params: { contactId: string } }>("/api/contacts/:contactId", async (request, reply) => {
    if (!contacts.delete(request.params.contactId)) return reply.code(404).send({ error: "contact not found" });
    return reply.code(204).send();
  });

  // ── Environments (sub-accounts): named simulator targets ──────────────────
  app.get("/api/environments", async () => ({
    active: { targetUrl: runtime.getState().targetUrl, secretPreview: runtime.getState().secretPreview, channel: runtime.getState().channel },
    environments: environments.list()
  }));
  app.post<{ Body: EnvironmentInput }>("/api/environments", async (request, reply) => {
    try {
      return environments.upsert(request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.put<{ Params: { environmentId: string }; Body: EnvironmentInput }>("/api/environments/:environmentId", async (request, reply) => {
    if (!environments.get(request.params.environmentId)) return reply.code(404).send({ error: "environment not found" });
    try {
      return environments.upsert({ ...request.body, id: request.params.environmentId });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.delete<{ Params: { environmentId: string } }>("/api/environments/:environmentId", async (request, reply) => {
    if (!environments.delete(request.params.environmentId)) return reply.code(404).send({ error: "environment not found" });
    return reply.code(204).send();
  });
  app.post<{ Params: { environmentId: string } }>("/api/environments/:environmentId/activate", async (request, reply) => {
    const environment = environments.get(request.params.environmentId);
    if (!environment) return reply.code(404).send({ error: "environment not found" });
    try {
      return runtime.reset({
        targetUrl: environment.targetUrl,
        secret: environment.secret,
        ...(environment.channel ? { channel: environment.channel } : {})
      });
    } catch (error) {
      return sendConfigValidationError(reply, error);
    }
  });

  // ── Usage / overview aggregates ───────────────────────────────────────────
  app.get("/api/stats", async () => {
    const sessions = runtime.getHistory().map((summary) => runtime.getHistorySession(summary.id)).filter((session): session is InspectorSession => Boolean(session));
    return computeUsageStats(sessions);
  });

  app.delete("/api/history", async () => ({ removed: runtime.clearHistory() }));

  app.get("/api/events", async (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });

    const client: SseClient = {
      write(event, data) {
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      },
      close() {
        clearInterval(heartbeat);
      }
    };

    const heartbeat = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, 15_000);

    const unsubscribe = runtime.subscribe(client);
    client.write("step", step.state());
    request.raw.on("close", unsubscribe);
  });

  return { app, runtime, step };
}

export async function startDevtoolsServer(config: DevtoolsServerConfig): Promise<{ app: FastifyInstance; runtime: DevtoolsRuntime; url: string; port: number; close: () => Promise<void> }> {
  const { app, runtime } = await createDevtoolsServer(config);
  const host = config.host ?? "127.0.0.1";
  const port = await listenWithPortFallback(app, config.port, host);
  const url = `http://${host}:${port}`;
  return {
    app,
    runtime,
    url,
    port,
    close: () => app.close()
  };
}

/**
 * Bind the first free port at or above `desiredPort`. A busy default should
 * move the dev server, not crash it with a raw EADDRINUSE stack.
 */
async function listenWithPortFallback(
  app: FastifyInstance,
  desiredPort: number,
  host: string,
  attempts = DEFAULT_PORT_SCAN_ATTEMPTS
): Promise<number> {
  let candidate = await findAvailablePort(desiredPort, host, attempts);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await app.listen({ port: candidate, host });
      if (candidate !== desiredPort) {
        console.warn(`Port ${desiredPort} is already in use. AgentPhone DevTools server started on port ${candidate} instead.`);
      }
      return boundPort(app) ?? candidate;
    } catch (error) {
      // Lost a race between probing and binding; step past it and try again.
      if (desiredPort === 0 || !isAddressInUse(error)) throw error;
      candidate = await findAvailablePort(candidate + 1, host, attempts);
    }
  }
  throw new Error(`Could not bind an AgentPhone DevTools server port at or above ${desiredPort} on ${host}.`);
}

function boundPort(app: FastifyInstance): number | undefined {
  const address = app.server.address();
  return address && typeof address !== "string" ? address.port : undefined;
}

function fallbackSmsText(delivery: InspectorDelivery): string | undefined {
  if (delivery.channel === "voice") return undefined;
  const raw = delivery.response.rawBody.trim();
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object" && "text" in parsed && typeof parsed.text === "string") return parsed.text;
  } catch {
    return raw;
  }
  return undefined;
}

/**
 * Recover the conversation state a saved run was using, from the request
 * bodies it actually sent. Pass `atCallerTurn` to read the state as of that
 * turn (what a fork checkpoint needs); omit it for the run's initial state
 * (what a scenario export needs). Identical today because handler responses
 * do not yet update state mid-run, but the checkpoint contract should not
 * depend on that staying true.
 */
function extractConversationState(session: InspectorSession, atCallerTurn?: number): ConversationState {
  const deliveries = session.deliveries.filter((candidate) => candidate.event === "agent.message" && !candidate.replayOf);
  const delivery = atCallerTurn !== undefined ? (deliveries[atCallerTurn - 1] ?? deliveries.at(-1)) : deliveries[0];
  return structuredClone(delivery?.request.body.conversationState ?? null);
}

function maskSecret(secret: string): string {
  if (secret.length <= 8) return "***";
  return `${secret.slice(0, 6)}...${secret.slice(-4)}`;
}

function reportFilename(sessionId: string, extension: "json" | "md"): string {
  return `agentphone-run-${sessionId}.${extension}`;
}

function scenarioFilename(sessionId: string, extension: "json" | "yaml"): string {
  return `agentphone-scenario-${sessionId}.${extension}`;
}

function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function summarizeSession(session: InspectorSession): InspectorSessionSummary {
  return {
    id: session.id,
    targetUrl: session.targetUrl,
    channel: session.channel,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    transcriptTurns: session.transcript.length,
    deliveries: session.deliveries.length,
    baselineName: session.baseline?.name,
    ...(session.forkedFrom ? { forkedFrom: session.forkedFrom } : {}),
    ...(session.scenarioResult ? { scenarioPassed: session.scenarioResult.passed } : {}),
    ...(session.contact ? { contact: session.contact } : {}),
    ...(session.deliveries.length
      ? {
          averageLatencyMs: Math.round(
            session.deliveries.reduce((total, delivery) => total + delivery.latencyMs, 0) / session.deliveries.length
          )
        }
      : {}),
    ...(session.transcript.length ? { lastMessage: session.transcript[session.transcript.length - 1].content } : {}),
    lastActivityAt: session.turnTimes?.at(-1) ?? session.endedAt ?? session.startedAt
  };
}

function formatOffset(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 172_800_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

function isUntouchedSession(session: InspectorSession): boolean {
  return session.status === "idle" && session.transcript.length === 0 && session.deliveries.length === 0;
}

function toScenarioTurnObservation(delivery: InspectorDelivery) {
  return {
    ok: delivery.ok,
    status: delivery.response.status,
    timedOut: delivery.timedOut,
    retries: delivery.retries,
    responses: delivery.response.parsed.chunks
  };
}

function simulatedTimeoutResult(timeoutSeconds: number): DispatchResult {
  return {
    ok: false,
    status: 0,
    statusText: "Timeout",
    latencyMs: timeoutSeconds * 1000,
    timedOut: true,
    headers: {},
    rawResponseBody: "",
    parsed: {
      mode: "empty",
      chunks: [],
      warnings: [`Handler exceeded ${timeoutSeconds}s timeout`]
    },
    error: "Simulated webhook timeout"
  };
}

function isAgentPhoneEnvelope(value: unknown): value is AgentPhoneEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<AgentPhoneEnvelope>;
  return (
    typeof envelope.event === "string" &&
    typeof envelope.channel === "string" &&
    typeof envelope.timestamp === "string" &&
    typeof envelope.agentId === "string" &&
    Boolean(envelope.data && typeof envelope.data === "object") &&
    Array.isArray(envelope.recentHistory)
  );
}

function exportOptionsFromQuery(query: { assertions?: string }): ScenarioExportOptions {
  return query.assertions === "1" || query.assertions === "true" ? { scaffoldAssertions: true } : {};
}

function comparisonOptionsFromQuery(query: {
  maxLatencyIncreasePercent?: string;
  latencyGraceMs?: string;
}): RunComparisonOptions {
  return compact({
    maxLatencyIncreasePercent: optionalNumber(query.maxLatencyIncreasePercent),
    latencyGraceMs: optionalNumber(query.latencyGraceMs)
  });
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sendConfigValidationError(reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }, error: unknown) {
  if (error instanceof RuntimeConfigValidationError) {
    return reply.code(400).send({ error: error.message, issues: error.issues });
  }
  throw error;
}
