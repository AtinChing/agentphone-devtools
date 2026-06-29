import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { SessionHistoryStore } from "./history.js";
import {
  buildCallEndedEvent,
  buildMessageEvent,
  buildSignedDelivery,
  buildVoiceMessageEvent,
  dispatchSignedDelivery,
  evaluateConversation,
  id,
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
  type EvalResult,
  type Scenario,
  type SignedDelivery,
  type TranscriptTurn
} from "@agentphone-devtools/core";

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

  deleteHistorySession(sessionId: string): boolean {
    if (sessionId === this.session.id) return false;
    const deleted = this.sessionStore.delete(sessionId);
    if (deleted) this.emit("history", this.getHistory());
    return deleted;
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

  async sendCallerTurn(text: string, channel = this.config.channel): Promise<InspectorDelivery> {
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
    const delivery = await this.dispatchAndRecord(payload);
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

    for (const turn of scenario.turns) {
      await this.sendCallerTurn(turn.caller, scenario.channel);
      if (turn.waitMs) await new Promise((resolve) => setTimeout(resolve, turn.waitMs));
    }

    await this.endCall();
    if (this.session.callEnded) {
      this.session.evalResult = this.buildEvalResult(this.session.callEnded, scenario.expectedOutcome);
    }
    if (this.session.evalResult && scenario.expectedOutcome && this.session.evalResult.outcome !== scenario.expectedOutcome) {
      this.session.warnings.push(`Scenario expected ${scenario.expectedOutcome}, eval observed ${this.session.evalResult.outcome}`);
    }
    this.publishState();
    return this.getState();
  }

  private async dispatchAndRecord(payload: AgentPhoneEnvelope): Promise<InspectorDelivery> {
    const signed = buildSignedDelivery(payload, { secret: this.config.secret });
    const { result, retries } = await this.dispatchPossiblyWithRetry(signed);
    const delivery: InspectorDelivery = {
      id: id("del"),
      event: payload.event,
      channel: payload.channel,
      direction: "inbound",
      timestamp: payload.timestamp,
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
      retries
    };

    this.session.deliveries.push(delivery);
    this.persistSession();
    this.emit("delivery", delivery);
    return delivery;
  }

  private async dispatchPossiblyWithRetry(signed: SignedDelivery): Promise<{ result: DispatchResult; retries: number }> {
    const delays = [0, 250, 750, 1500, 3000, 5000];
    let result: DispatchResult | undefined;
    let retries = 0;

    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      result = await dispatchSignedDelivery(signed, {
        targetUrl: this.config.targetUrl,
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

  private buildEvalResult(callEnded?: CallEndedEnvelope["data"], expectedOutcome?: EvalResult["outcome"]): EvalResult {
    return evaluateConversation({
      transcript: this.session.transcript,
      callEnded,
      expectedOutcome,
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

  app.delete<{ Params: { sessionId: string } }>("/api/history/:sessionId", async (request, reply) => {
    if (request.params.sessionId === runtime.getState().id) {
      return reply.code(409).send({ error: "the active session cannot be deleted" });
    }
    if (!runtime.deleteHistorySession(request.params.sessionId)) {
      return reply.code(404).send({ error: "session not found" });
    }
    return reply.code(204).send();
  });

  app.post<{
    Body: RuntimeConfigUpdate;
  }>("/api/config", async (request) => runtime.updateConfig(request.body));

  app.post<{
    Body: RuntimeConfigUpdate & { conversationState?: ConversationState };
  }>("/api/reset", async (request) => runtime.reset(request.body));

  app.post<{
    Body: { text: string; channel?: "sms" | "voice" };
  }>("/api/send", async (request, reply) => {
    if (!request.body?.text) return reply.code(400).send({ error: "text is required" });
    return runtime.sendCallerTurn(request.body.text, request.body.channel);
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
    score: session.evalResult?.score
  };
}
