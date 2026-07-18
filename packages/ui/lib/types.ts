export interface AgentResponseChunk {
  text?: string;
  hangup?: boolean;
  action?: string;
  transferNumber?: string;
  digits?: string;
  press_digit?: string;
  dtmf?: string;
  interim?: boolean;
  [key: string]: unknown;
}

export interface ParsedAgentResponse {
  mode: "empty" | "json" | "ndjson" | "text" | "invalid";
  final?: AgentResponseChunk;
  chunks: AgentResponseChunk[];
  warnings: string[];
}

export interface InspectorDelivery {
  id: string;
  event: "agent.message" | "agent.call_ended" | "agent.reaction";
  channel: "sms" | "mms" | "imessage" | "voice";
  direction: "inbound";
  timestamp: string;
  webhookId: string;
  request: {
    headers: Record<string, string>;
    rawBody: string;
    body: unknown;
  };
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    rawBody: string;
    parsed: ParsedAgentResponse;
  };
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

export interface TranscriptTurn {
  role: "agent" | "user";
  content: string;
}

export interface EvalResult {
  outcome: "resolved" | "handed_off" | "failed";
  stayedOnTask: boolean;
  correctActions: boolean | null;
  score: number;
  reasons: string[];
  metrics: {
    turnCount: number;
    agentTurns: number;
    userTurns: number;
    deadAirTurns: number;
    durationSeconds?: number;
  };
}

export interface ScenarioAssertion {
  kind: "delivery" | "outcome" | "action";
  passed: boolean;
  expected: string;
  observed: string;
  turnIndex?: number;
  message: string;
}

export interface ScenarioResult {
  passed: boolean;
  assertions: ScenarioAssertion[];
  passedCount: number;
  failedCount: number;
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
  callEnded?: {
    summary: string;
    userSentiment: string;
    callSuccessful: boolean;
    durationSeconds: number;
    disconnectionReason: string;
  };
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

export interface RunComparison {
  baselineSessionId: string;
  candidateSessionId: string;
  passed: boolean;
  regressions: string[];
  outcome: { baseline?: string; candidate?: string; changed: boolean; regressed: boolean };
  score: { baseline?: number; candidate?: number; delta?: number; regressed: boolean };
  actions: { baseline: string[]; candidate: string[]; missing: string[]; added: string[]; regressed: boolean };
  transcript: { baselineTurns: number; candidateTurns: number; changed: boolean; regressed: boolean };
  latency: { baselineAverageMs: number; candidateAverageMs: number; deltaMs: number; deltaPercent: number; regressed: boolean };
  warnings: { baseline: string[]; candidate: string[]; added: string[]; regressed: boolean };
}

export interface RuntimeConfig {
  targetUrl: string;
  secretPreview: string;
  channel: "sms" | "voice";
  timeoutSeconds: number;
  contextLimit: number;
  retryOnNon200: boolean;
  port: number;
  host?: string;
  historyPath: string;
  historyLimit: number;
}
