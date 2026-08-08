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
  event: "agent.message" | "agent.call_ended";
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
  inheritedFrom?: {
    sessionId: string;
  };
}

export interface TurnLabel {
  turnIndex: number;
  verdict?: "good" | "bad";
  note?: string;
}

export interface StepQueueTurn {
  caller: string;
  expect?: { actions?: string[] };
  edited?: boolean;
}

export interface StepState {
  active: boolean;
  scenarioName: string | null;
  channel: "sms" | "voice";
  sessionId: string | null;
  completedTurns: number;
  queue: StepQueueTurn[];
  sending: boolean;
  lastResult?: {
    turnNumber: number;
    expectResults: Array<{ action: string; passed: boolean; observed: string[] }>;
  };
  checkpoint: {
    recentHistoryTurns: number;
    conversationState: Record<string, unknown> | null;
  } | null;
}

export interface TranscriptTurn {
  role: "agent" | "user";
  content: string;
}

export interface ScenarioAssertion {
  kind: "delivery" | "action";
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
  logs?: string[];
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
  scenarioResult?: ScenarioResult;
  baseline?: {
    name: string;
    createdAt: string;
  };
  warnings: string[];
  forkedFrom?: {
    sessionId: string;
    turnIndex: number;
  };
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
  forkedFrom?: {
    sessionId: string;
    turnIndex: number;
  };
}

export interface RunComparison {
  baselineSessionId: string;
  candidateSessionId: string;
  passed: boolean;
  regressions: string[];
  actions: { baseline: string[]; candidate: string[]; missing: string[]; added: string[]; regressed: boolean };
  transcript: { baselineTurns: number; candidateTurns: number; changed: boolean; regressed: boolean };
  latency: { baselineAverageMs: number; candidateAverageMs: number; deltaMs: number; deltaPercent: number; regressed: boolean };
  warnings: { baseline: string[]; candidate: string[]; added: string[]; regressed: boolean };
}
