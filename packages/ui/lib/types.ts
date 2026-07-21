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

export type GraphReviewStatus = "pending" | "approved" | "rejected";

export interface PathReviewSummary {
  pathName: string;
  route: string[];
  tags: string[];
  description?: string;
  expectedOutcome?: "resolved" | "handed_off" | "failed";
  nodeCount: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  status: "approved" | "pending" | "rejected" | "mixed";
}

export interface GraphFamilySummary {
  id: string;
  name: string;
  channel: "sms" | "voice";
  path: string;
  pathCount: number;
  paths: PathReviewSummary[];
}

export interface GraphNodeReview {
  status: GraphReviewStatus;
  annotations?: string[];
  originalTranscript?: string;
  correctedTranscript?: string;
}

export interface GraphNode {
  caller: string;
  expect?: {
    outcome?: "resolved" | "handed_off" | "failed";
    actions?: string[];
    status?: number;
    timedOut?: boolean;
    retries?: number;
  };
  review?: GraphNodeReview;
}

export interface LoadedGraphFamily {
  id: string;
  path: string;
  graph: {
    metadata: { name: string; channel: "sms" | "voice"; description?: string };
    nodes: Record<string, GraphNode>;
    edges: Array<{ from: string; to: string; label: string }>;
    paths: Record<string, { route: string[]; tags?: string[]; description?: string }>;
  };
  paths: PathReviewSummary[];
}

