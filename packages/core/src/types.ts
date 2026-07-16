export type MessageChannel = "sms" | "mms" | "imessage";
export type VoiceChannel = "voice";
export type AgentPhoneChannel = MessageChannel | VoiceChannel;
export type AgentPhoneEvent = "agent.message" | "agent.call_ended" | "agent.reaction";
export type Direction = "inbound" | "outbound";

export type ConversationState = Record<string, unknown> | null;

export interface RecentHistoryItem {
  content: string;
  direction: Direction;
  channel: AgentPhoneChannel;
  at: string;
}

export interface CommonEnvelope<TEvent extends AgentPhoneEvent, TChannel extends AgentPhoneChannel, TData> {
  event: TEvent;
  channel: TChannel;
  timestamp: string;
  agentId: string;
  data: TData;
  conversationState: ConversationState;
  recentHistory: RecentHistoryItem[];
}

export interface MessageData {
  conversationId: string;
  numberId: string;
  from: string;
  to: string;
  message: string;
  mediaUrl: string | null;
  direction: Direction;
  receivedAt: string;
}

export interface VoiceMessageData {
  callId: string;
  numberId: string;
  from: string;
  to: string;
  status: "in-progress";
  transcript: string;
  confidence: number;
  direction: Direction;
}

export interface TranscriptTurn {
  role: "agent" | "user";
  content: string;
}

export interface CallEndedData {
  callId: string;
  numberId: string;
  from: string;
  to: string;
  direction: Direction;
  status: "completed";
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  disconnectionReason: string;
  transcript: TranscriptTurn[];
  summary: string;
  userSentiment: string;
  callSuccessful: boolean;
}

export type ReactionType = "love" | "like" | "dislike" | "laugh" | "emphasize" | "question";

export interface ReactionData {
  conversationId: string;
  numberId: string;
  reactionType: ReactionType;
  fromNumber: string;
  direction: Direction;
  messageId: string;
  messageBody: string;
  messageMediaUrl: string | null;
  createdAt: string;
}

export type MessageEnvelope = CommonEnvelope<"agent.message", MessageChannel, MessageData>;
export type VoiceMessageEnvelope = CommonEnvelope<"agent.message", "voice", VoiceMessageData>;
export type CallEndedEnvelope = CommonEnvelope<"agent.call_ended", "voice", CallEndedData>;
export type ReactionEnvelope = CommonEnvelope<"agent.reaction", "imessage", ReactionData>;
export type AgentPhoneEnvelope = MessageEnvelope | VoiceMessageEnvelope | CallEndedEnvelope | ReactionEnvelope;

export interface SignedDelivery<TPayload extends AgentPhoneEnvelope = AgentPhoneEnvelope> {
  payload: TPayload;
  rawBody: string;
  headers: Record<string, string>;
  timestampSeconds: number;
  webhookId: string;
}

export interface SimulatorIdentity {
  agentId: string;
  numberId: string;
  from: string;
  to: string;
}

export interface AgentResponseChunk {
  text?: string;
  hangup?: boolean;
  action?: "transfer" | "hangup" | string;
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

export interface DispatchResult {
  ok: boolean;
  status: number;
  statusText: string;
  latencyMs: number;
  timedOut: boolean;
  headers: Record<string, string>;
  rawResponseBody: string;
  parsed: ParsedAgentResponse;
  error?: string;
}

export interface DispatchOptions {
  targetUrl: string;
  secret: string;
  timeoutSeconds?: number;
  webhookId?: string;
  timestampSeconds?: number;
  eventOverride?: AgentPhoneEvent;
  onChunk?: (chunk: AgentResponseChunk) => void;
}

export interface ScenarioTurn {
  caller: string;
  expect?: {
    outcome?: "resolved" | "handed_off" | "failed";
    actions?: string[];
  };
  waitMs?: number;
}

export interface Scenario {
  name: string;
  description?: string;
  channel: "sms" | "voice";
  agentId: string;
  numberId: string;
  from: string;
  to: string;
  conversationState: ConversationState;
  contextLimit: number;
  timeoutSeconds: number;
  turns: ScenarioTurn[];
  expectedOutcome?: "resolved" | "handed_off" | "failed";
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

export interface EvalInput {
  transcript: TranscriptTurn[];
  callEnded?: CallEndedData;
  responses?: AgentResponseChunk[];
  expectedOutcome?: "resolved" | "handed_off" | "failed";
  expectedActions?: string[];
  deadAirTurns?: number;
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
