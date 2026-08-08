import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { SessionHistoryStore } from "./history.js";
import { buildJsonReport, buildMarkdownReport } from "./report.js";
import { buildScenarioFromSession, stringifyScenarioJson, stringifyScenarioYaml, type ScenarioExportOptions } from "./scenario-export.js";
import { compareRuns, type RunComparison, type RunComparisonOptions } from "./comparison.js";
import { parseRuntimeConfigUpdate, RuntimeConfigValidationError, type RuntimeConfigUpdate } from "./config.js";
import { DEFAULT_PORT_SCAN_ATTEMPTS, findAvailablePort, isAddressInUse } from "./ports.js";
import { StepController } from "./step-controller.js";
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
  type SignedDelivery,
  type TranscriptTurn
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

export interface DevtoolsServerConfig {
  targetUrl: string;
  secret: string;
  channel: "sms" | "voice";
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
  recentHistory: Array<{ content: string; direction: "inbound" | "outbound"; channel: "sms" | "voice"; at: string }>;
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

export interface InspectorSession {
  id: string;
  targetUrl: string;
  secretPreview: string;
  channel: "sms" | "voice";
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
  channel: "sms" | "voice";
  status: InspectorSession["status"];
  startedAt: string;
  endedAt?: string;
  transcriptTurns: number;
  deliveries: number;
  baselineName?: string;
  forkedFrom?: InspectorSession["forkedFrom"];
}

type SseClient = {
  write: (event: string, data: unknown) => void;
  close: () => void;
};

type HistoryTurn = TranscriptTurn & { at: string; channel: "sms" | "voice" };

export class DevtoolsRuntime {
  private readonly clients = new Set<SseClient>();
  private readonly history: HistoryTurn[] = [];
  private readonly sessionStore: SessionHistoryStore;
  private config: DevtoolsServerConfig;
  private conversationState: ConversationState = null;
  private session: InspectorSession;

  constructor(config: DevtoolsServerConfig) {
    this.config = config;
    this.sessionStore = new SessionHistoryStore(config.historyPath, config.historyLimit);
    this.session = this.newSession();
    if (this.sessionStore.loadWarning) this.session.warnings.push(this.sessionStore.loadWarning);
    this.persistSession();
  }

  getState(): InspectorSession {
    return structuredClone(this.session);
  }

  getHistory(): InspectorSessionSummary[] {
    return this.sessionStore
      .list()
      .filter((session) => session.id === this.session.id || session.status !== "idle" || session.transcript.length > 0 || session.deliveries.length > 0)
      .map(summarizeSession);
  }

  getHistorySession(sessionId: string): InspectorSession | undefined {
    return sessionId === this.session.id ? this.getState() : this.sessionStore.get(sessionId);
  }

  getScenarioExport(sessionId: string, options: ScenarioExportOptions = {}): Scenario | undefined {
    const session = this.getHistorySession(sessionId);
    if (!session) return undefined;
    const active = sessionId === this.session.id;
    return buildScenarioFromSession(
      session,
      {
        contextLimit: active ? this.config.contextLimit : 10,
        timeoutSeconds: active ? this.config.timeoutSeconds : 30,
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

  reset(update?: RuntimeConfigUpdate & { conversationState?: ConversationState }): InspectorSession {
    if (update) {
      const { conversationState, ...configUpdate } = update;
      this.config = { ...this.config, ...parseRuntimeConfigUpdate(configUpdate) };
      this.conversationState = conversationState ?? null;
    } else {
      this.conversationState = null;
    }
    if (isUntouchedSession(this.session)) this.sessionStore.delete(this.session.id);
    this.history.length = 0;
    this.session = this.newSession();
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

  async sendCallerTurn(text: string, channel = this.config.channel, fault?: DeliveryFault): Promise<InspectorDelivery> {
    this.session.status = "running";
    const timestamp = isoNow();
    const recentHistory = scenarioToRecentHistory(this.history, this.config.contextLimit);
    const payload =
      channel === "voice"
        ? buildVoiceMessageEvent({
            transcript: text,
            timestamp,
            callId: this.session.callId,
            agentId: "agt_local",
            conversationState: this.conversationState,
            recentHistory
          })
        : buildMessageEvent({
            message: text,
            channel,
            timestamp,
            conversationId: this.session.conversationId,
            agentId: "agt_local",
            conversationState: this.conversationState,
            recentHistory
          });

    this.pushTranscript({ role: "user", content: text }, timestamp, channel);
    const delivery = await this.dispatchAndRecord(payload, fault);
    this.recordAgentResponse(delivery, channel);
    this.publishState();
    return delivery;
  }

  async endCall(options: { disconnectionReason?: string; callSuccessful?: boolean } = {}): Promise<InspectorDelivery | null> {
    this.session.status = "ended";
    this.session.endedAt = isoNow();

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
      conversationState: scenario.conversationState
    });

    this.pushLog(`Running scenario: ${scenario.name}`);
    this.publishState();

    const turnDeliveries: InspectorDelivery[] = [];
    for (const turn of scenario.turns) {
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
    if (!Number.isInteger(callerTurns) || callerTurns < 1 || callerTurns > totalCallerTurns) {
      throw new Error(`Fork point must be a completed caller turn between 1 and ${totalCallerTurns}`);
    }

    const forkingLive = sourceSessionId === this.session.id;
    const conversationState = forkingLive
      ? structuredClone(this.conversationState)
      : extractConversationState(source, callerTurns);
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

    this.reset({ channel: source.channel, conversationState });
    this.session.forkedFrom = { sessionId: source.id, turnIndex: callerTurns };
    this.session.status = "running";
    for (const turn of prefix) this.pushTranscript({ ...turn }, source.startedAt, source.channel);
    this.session.deliveries = source.deliveries
      .filter((delivery) => delivery.event === "agent.message" && !delivery.replayOf)
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
        this.session.warnings.push(`Retry ${retries} scheduled for ${signed.webhookId} after HTTP ${result.status}`);
        this.publishState();
      }
    }

    if (!result) throw new Error("Dispatch loop exited before making a request");
    return { result, retries };
  }

  private recordAgentResponse(delivery: InspectorDelivery, channel: "sms" | "voice"): void {
    const parsed = delivery.response.parsed;
    const responseText = parsed.final?.text ?? parsed.chunks.find((chunk) => chunk.text && !chunk.interim)?.text ?? fallbackSmsText(delivery);
    if (!responseText) return;
    this.pushTranscript({ role: "agent", content: responseText }, isoNow(), channel);
  }

  private pushTranscript(turn: TranscriptTurn, at: string, channel: "sms" | "voice"): void {
    this.session.transcript.push(turn);
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
      logs: []
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
    Body: { text: string; channel?: "sms" | "voice"; fault?: DeliveryFault };
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

  app.get("/api/step", async () => step.state());

  app.post<{ Body: { scenarioPath?: string; sessionId?: string } }>("/api/step/start", async (request, reply) => {
    const body = request.body ?? {};
    try {
      if (body.scenarioPath) return step.startFromScenario(await loadScenarioFile(body.scenarioPath));
      if (body.sessionId) return step.startFromSession(body.sessionId);
      return reply.code(400).send({ error: "scenarioPath or sessionId is required" });
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
    ...(session.forkedFrom ? { forkedFrom: session.forkedFrom } : {})
  };
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
