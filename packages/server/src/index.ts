import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { SessionHistoryStore } from "./history.js";
import { buildJsonReport, buildMarkdownReport } from "./report.js";
import { buildScenarioFromSession, stringifyScenarioJson, stringifyScenarioYaml } from "./scenario-export.js";
import { compareRuns, type RunComparison, type RunComparisonOptions } from "./comparison.js";
import {
  buildCallEndedEvent,
  buildMessageEvent,
  buildSignedDelivery,
  buildVoiceMessageEvent,
  dispatchSignedDelivery,
  evaluateConversation,
  evaluateScenario,
  id,
  injectDeliveryFaults,
  isoNow,
  loadScenarioFile,
  maybeEvaluateWithLlm,
  scenarioToRecentHistory,
  type AgentPhoneChannel,
  type AgentPhoneEnvelope,
  type AgentResponseChunk,
  type CallEndedEnvelope,
  type ConversationState,
  type DispatchResult,
  type DeliveryFault,
  type EvalResult,
  type Scenario,
  type ScenarioResult,
  type SignedDelivery,
  type TranscriptTurn
} from "@agentphone-devtools/core";

export { buildJsonReport, buildMarkdownReport } from "./report.js";
export { compareRuns, type RunComparison, type RunComparisonOptions } from "./comparison.js";

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

type RuntimeConfigUpdate = Partial<Omit<DevtoolsServerConfig, "port" | "historyPath" | "historyLimit">>;

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
  evalResult?: EvalResult;
  scenarioResult?: ScenarioResult;
  baseline?: {
    name: string;
    createdAt: string;
  };
  warnings: string[];
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
  outcome?: EvalResult["outcome"];
  score?: number;
  baselineName?: string;
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

  getConfig(): Omit<DevtoolsServerConfig, "secret"> & { secretPreview: string } {
    const { secret: _secret, ...safe } = this.config;
    return { ...safe, secretPreview: maskSecret(this.config.secret) };
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

  getScenarioExport(sessionId: string): Scenario | undefined {
    const session = this.getHistorySession(sessionId);
    if (!session) return undefined;
    const active = sessionId === this.session.id;
    return buildScenarioFromSession(session, {
      contextLimit: active ? this.config.contextLimit : 10,
      timeoutSeconds: active ? this.config.timeoutSeconds : 30,
      conversationState: active ? this.conversationState : null
    });
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

  updateConfig(update: RuntimeConfigUpdate): InspectorSession {
    this.config = { ...this.config, ...compact(update) };
    this.session.targetUrl = this.config.targetUrl;
    this.session.secretPreview = maskSecret(this.config.secret);
    this.session.channel = this.config.channel;
    this.publishState();
    return this.getState();
  }

  reset(update?: RuntimeConfigUpdate & { conversationState?: ConversationState }): InspectorSession {
    if (update) {
      const { conversationState, ...configUpdate } = update;
      this.config = { ...this.config, ...compact(configUpdate) };
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
      this.session.evalResult = maybeEvaluateWithLlm({
        transcript: this.session.transcript,
        responses: this.session.deliveries.flatMap((delivery) => delivery.response.parsed.chunks)
      });
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
    this.session.evalResult = this.buildEvalResult(payload.data);
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

    this.session.warnings.push(`Running scenario: ${scenario.name}`);
    this.publishState();

    const turnDeliveries: InspectorDelivery[] = [];
    for (const turn of scenario.turns) {
      turnDeliveries.push(await this.sendCallerTurn(turn.caller, scenario.channel, turn.fault));
      if (turn.waitMs) await new Promise((resolve) => setTimeout(resolve, turn.waitMs));
    }

    const callEndedDelivery = await this.endCall();
    const expectedActions = scenario.turns.flatMap((turn) => turn.expect?.actions ?? []);
    if (this.session.callEnded) {
      this.session.evalResult = this.buildEvalResult(this.session.callEnded, scenario.expectedOutcome, expectedActions);
    } else {
      this.session.evalResult = this.buildEvalResult(undefined, scenario.expectedOutcome, expectedActions);
    }
    this.session.scenarioResult = evaluateScenario(scenario, {
      turns: turnDeliveries.map(toScenarioTurnObservation),
      ...(callEndedDelivery ? { callEnded: toScenarioTurnObservation(callEndedDelivery) } : {}),
      evalResult: this.session.evalResult
    });
    for (const assertion of this.session.scenarioResult.assertions) {
      if (!assertion.passed) this.session.warnings.push(assertion.message);
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
    const delivery = await this.dispatchSignedAndRecord(injected.delivery, {
      appliedFaults: injected.applied,
      simulateTimeout: input.fault?.simulateTimeout === true,
      targetUrl: input.targetUrl,
      replayOf: { sessionId: input.sessionId, deliveryId: input.deliveryId }
    });
    this.publishState();
    return delivery;
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

  private buildEvalResult(
    callEnded?: CallEndedEnvelope["data"],
    expectedOutcome?: EvalResult["outcome"],
    expectedActions?: string[]
  ): EvalResult {
    return evaluateConversation({
      transcript: this.session.transcript,
      callEnded,
      expectedOutcome,
      expectedActions,
      responses: this.session.deliveries.filter((item) => item.event === "agent.message").flatMap((item) => item.response.parsed.chunks),
      deadAirTurns: this.session.deliveries
        .filter((item) => item.event === "agent.message")
        .filter((item) => item.warnings.some((warning) => warning.includes("silence") || warning.includes("dead air"))).length
    });
  }

  private pushTranscript(turn: TranscriptTurn, at: string, channel: "sms" | "voice"): void {
    this.session.transcript.push(turn);
    this.history.push({ ...turn, at, channel });
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
      warnings: []
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

  private emit(event: string, data: unknown): void {
    for (const client of this.clients) client.write(event, data);
  }
}

export async function createDevtoolsServer(config: DevtoolsServerConfig): Promise<{ app: FastifyInstance; runtime: DevtoolsRuntime }> {
  const app = Fastify({ logger: false });
  const runtime = new DevtoolsRuntime(config);

  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));
  app.get("/api/config", async () => runtime.getConfig());
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

  app.get<{ Params: { sessionId: string } }>("/api/history/:sessionId/scenario.json", async (request, reply) => {
    const scenario = runtime.getScenarioExport(request.params.sessionId);
    if (!scenario) return reply.code(404).send({ error: "session not found" });
    if (!scenario.turns.length) return reply.code(422).send({ error: "session has no caller turns to export" });
    return reply
      .header("Content-Disposition", `attachment; filename="${scenarioFilename(request.params.sessionId, "json")}"`)
      .type("application/json")
      .send(stringifyScenarioJson(scenario));
  });

  app.get<{ Params: { sessionId: string } }>("/api/history/:sessionId/scenario.yaml", async (request, reply) => {
    const scenario = runtime.getScenarioExport(request.params.sessionId);
    if (!scenario) return reply.code(404).send({ error: "session not found" });
    if (!scenario.turns.length) return reply.code(422).send({ error: "session has no caller turns to export" });
    return reply
      .header("Content-Disposition", `attachment; filename="${scenarioFilename(request.params.sessionId, "yaml")}"`)
      .type("application/yaml; charset=utf-8")
      .send(stringifyScenarioYaml(scenario));
  });

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
      maxScoreDrop?: string;
      maxLatencyIncreasePercent?: string;
      latencyGraceMs?: string;
      requireTranscriptMatch?: string;
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
    Body: RuntimeConfigUpdate;
  }>("/api/config", async (request) => runtime.updateConfig(request.body));

  app.post<{
    Body: RuntimeConfigUpdate & { conversationState?: ConversationState };
  }>("/api/reset", async (request) => runtime.reset(request.body));

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
    const delivery = await runtime.replayDelivery(body);
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
    request.raw.on("close", unsubscribe);
  });

  return { app, runtime };
}

export async function startDevtoolsServer(config: DevtoolsServerConfig): Promise<{ app: FastifyInstance; runtime: DevtoolsRuntime; url: string; close: () => Promise<void> }> {
  const { app, runtime } = await createDevtoolsServer(config);
  const host = config.host ?? "127.0.0.1";
  await app.listen({ port: config.port, host });
  const url = `http://${host}:${config.port}`;
  return {
    app,
    runtime,
    url,
    close: () => app.close()
  };
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
    outcome: session.evalResult?.outcome,
    score: session.evalResult?.score,
    baselineName: session.baseline?.name
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

function comparisonOptionsFromQuery(query: {
  maxScoreDrop?: string;
  maxLatencyIncreasePercent?: string;
  latencyGraceMs?: string;
  requireTranscriptMatch?: string;
}): RunComparisonOptions {
  return compact({
    maxScoreDrop: optionalNumber(query.maxScoreDrop),
    maxLatencyIncreasePercent: optionalNumber(query.maxLatencyIncreasePercent),
    latencyGraceMs: optionalNumber(query.latencyGraceMs),
    requireTranscriptMatch: query.requireTranscriptMatch === undefined ? undefined : query.requireTranscriptMatch === "true"
  });
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
