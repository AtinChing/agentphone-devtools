export type MessageChannel = "sms" | "mms" | "imessage" | "whatsapp";
/**
 * Channels the simulator can drive a whole conversation over. MMS is a
 * message channel in the contract but its media payloads are not simulated,
 * so it is not a session channel.
 */
export type SessionChannel = "sms" | "imessage" | "whatsapp" | "voice";
export type VoiceChannel = "voice";
export type AgentPhoneChannel = MessageChannel | VoiceChannel;
export type AgentPhoneEvent = "agent.message" | "agent.call_ended";
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

export type MessageEnvelope = CommonEnvelope<"agent.message", MessageChannel, MessageData>;
export type VoiceMessageEnvelope = CommonEnvelope<"agent.message", "voice", VoiceMessageData>;
export type CallEndedEnvelope = CommonEnvelope<"agent.call_ended", "voice", CallEndedData>;
export type AgentPhoneEnvelope = MessageEnvelope | VoiceMessageEnvelope | CallEndedEnvelope;

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

/**
 * Simulated elapsed time before a turn ("2d", "3h", "45m", "90s", "500ms",
 * combinations like "1h30m", or a number of milliseconds). Advances the
 * simulator's virtual clock — payload timestamps and recentHistory[].at move
 * forward — without actually waiting, so time-dependent handler logic
 * (follow-up windows, promo expiry, re-introduction after long gaps) is
 * testable in milliseconds.
 */
export type SimulatedDelay = string | number;

export interface ScenarioCallerTurn {
  caller: string;
  expect?: {
    actions?: string[];
    /** Actions that must NOT appear (e.g. no marketing action after an opt-out). */
    forbiddenActions?: string[];
    status?: number;
    timedOut?: boolean;
    retries?: number;
    /**
     * Case-insensitive regex the agent's reply text must match. Meant for
     * mandated fixed phrases (compliance disclosures, opt-out confirmations)
     * where exact wording is required — not for general semantic checks,
     * which stay out of the gate because model wording varies.
     */
    replyMatches?: string;
  };
  fault?: DeliveryFault;
  waitMs?: number;
  after?: SimulatedDelay;
}

/**
 * An outbound message the business sent outside the webhook (e.g. a
 * campaign opener sent through the send API). It is seeded into the
 * conversation history so later inbound replies reach the handler with the
 * real context, but nothing is delivered to the webhook for it.
 */
export interface ScenarioAgentTurn {
  agent: string;
  after?: SimulatedDelay;
}

export type ScenarioTurn = ScenarioCallerTurn | ScenarioAgentTurn;

export interface DeliveryFault {
  invalidSignature?: boolean;
  omitSignature?: boolean;
  staleTimestampSeconds?: number;
  tamperBody?: boolean;
  malformedJson?: boolean;
  duplicateWebhookId?: boolean;
  simulateTimeout?: boolean;
}

export interface Scenario {
  name: string;
  description?: string;
  channel: SessionChannel;
  /** ISO datetime the simulated clock starts at (defaults to real time). */
  startAt?: string;
  agentId: string;
  numberId: string;
  from: string;
  to: string;
  conversationState: ConversationState;
  contextLimit: number;
  timeoutSeconds: number;
  turns: ScenarioTurn[];
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
