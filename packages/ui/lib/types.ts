export type SessionChannel = "sms" | "imessage" | "whatsapp" | "voice";
export type MessageChannel = "sms" | "mms" | "imessage" | "whatsapp";

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
  channel: MessageChannel | "voice";
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

export interface StepExpect {
  actions?: string[];
  forbiddenActions?: string[];
  replyMatches?: string;
  status?: number;
  timedOut?: boolean;
  retries?: number;
}

/** A queued step: a caller turn (delivered) or an outbound agent message (seeded, never delivered). */
export interface StepQueueTurn {
  caller?: string;
  agent?: string;
  expect?: StepExpect;
  after?: string | number;
  edited?: boolean;
}

export interface StepExpectResult {
  action: string;
  passed: boolean;
  observed: string[];
}

export interface StepState {
  active: boolean;
  scenarioName: string | null;
  channel: SessionChannel;
  sessionId: string | null;
  contact?: SessionContact;
  completedTurns: number;
  queue: StepQueueTurn[];
  sending: boolean;
  lastResult?: {
    turnNumber: number;
    expectResults: StepExpectResult[];
  };
  checkpoint: {
    recentHistoryTurns: number;
    conversationState: Record<string, unknown> | null;
  } | null;
  clockOffsetMs: number;
  virtualNow: string;
}

export interface TranscriptTurn {
  role: "agent" | "user";
  content: string;
}

export interface ScenarioAssertion {
  kind: "delivery" | "action" | "reply";
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

export interface SessionContact {
  id: string;
  name: string;
  number: string;
}

export interface InspectorSession {
  id: string;
  targetUrl: string;
  secretPreview: string;
  logs?: string[];
  channel: SessionChannel;
  contact?: SessionContact;
  /** ISO timestamp per transcript entry (aligned by index); carries the simulated clock. */
  turnTimes?: string[];
  /** Transcript indexes of agent messages seeded as outbound sends (campaign openers). */
  outboundSeeds?: number[];
  clockOffsetMs?: number;
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
  runSettings?: {
    contextLimit: number;
    timeoutSeconds: number;
    retryOnNon200?: boolean;
  };
  forkedFrom?: {
    sessionId: string;
    turnIndex: number;
  };
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
  forkedFrom?: {
    sessionId: string;
    turnIndex: number;
  };
  scenarioPassed?: boolean;
  contact?: SessionContact;
  averageLatencyMs?: number;
  lastMessage?: string;
  lastActivityAt?: string;
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

// ── Dashboard resources ──────────────────────────────────────────────────────

export interface Contact {
  id: string;
  name: string;
  number: string;
  channel: SessionChannel;
  conversationState: Record<string, unknown> | null;
  notes?: string;
  createdAt: string;
}

export type ContactInput = Omit<Contact, "id" | "createdAt"> & { id?: string };

export interface EnvironmentView {
  id: string;
  name: string;
  targetUrl: string;
  secretPreview: string;
  channel?: SessionChannel;
  createdAt: string;
}

export interface EnvironmentInput {
  id?: string;
  name: string;
  targetUrl: string;
  secret?: string;
  channel?: SessionChannel;
}

export interface EnvironmentsResponse {
  active: { targetUrl: string; secretPreview: string; channel: SessionChannel };
  environments: EnvironmentView[];
}

export interface DailyActivity {
  date: string;
  messages: number;
  calls: number;
  deliveries: number;
}

export interface UsageStats {
  totals: {
    runs: number;
    deliveries: number;
    messages: number;
    calls: number;
    failedDeliveries: number;
    averageLatencyMs: number;
    scenarioRuns: number;
    scenarioPassRate: number;
    contacts: number;
    forks: number;
    optOuts: number;
  };
  windows: {
    last24h: { messages: number; calls: number };
    last7d: { messages: number; calls: number };
    last30d: { messages: number; calls: number };
  };
  byDay: DailyActivity[];
  webhookHealth: {
    successRate: number;
    lastDeliveryAt?: string;
    lastStatus?: number;
    timeouts: number;
  };
}

export interface ScenarioListing {
  path: string;
  group: string;
  name: string;
  description?: string;
  channel: SessionChannel;
  turns: number;
  callerTurns: number;
  hasAssertions: boolean;
  error?: string;
}

export interface ClockState {
  offsetMs: number;
  now: string;
}

export interface VoiceSupport {
  available: boolean;
  reason?: string;
}

export interface DeliveryFault {
  invalidSignature?: boolean;
  omitSignature?: boolean;
  staleTimestampSeconds?: number;
  tamperBody?: boolean;
  malformedJson?: boolean;
  duplicateWebhookId?: boolean;
  simulateTimeout?: boolean;
}

export interface RuntimeConfigUpdate {
  targetUrl?: string;
  secret?: string;
  channel?: SessionChannel;
  timeoutSeconds?: number;
  contextLimit?: number;
  retryOnNon200?: boolean;
}
