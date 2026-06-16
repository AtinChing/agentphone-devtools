import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  AgentPhoneEnvelope,
  AgentPhoneEvent,
  CallEndedEnvelope,
  ConversationState,
  MessageChannel,
  MessageEnvelope,
  RecentHistoryItem,
  ReactionEnvelope,
  ReactionType,
  SimulatorIdentity,
  TranscriptTurn,
  VoiceMessageEnvelope
} from "./types.js";

const phoneNumberSchema = z.string().regex(/^\+\d{8,15}$/);
const directionSchema = z.enum(["inbound", "outbound"]);
const channelSchema = z.enum(["sms", "mms", "imessage", "voice"]);
const messageChannelSchema = z.enum(["sms", "mms", "imessage"]);
const isoDateSchema = z.string().datetime({ offset: true });

export const recentHistoryItemSchema = z
  .object({
    content: z.string(),
    direction: directionSchema,
    channel: channelSchema,
    at: isoDateSchema
  })
  .strict();

export const conversationStateSchema = z.record(z.unknown()).nullable();

const baseEnvelopeFields = {
  timestamp: isoDateSchema,
  agentId: z.string().min(1),
  conversationState: conversationStateSchema,
  recentHistory: z.array(recentHistoryItemSchema)
};

export const messageDataSchema = z
  .object({
    conversationId: z.string().min(1),
    numberId: z.string().min(1),
    from: phoneNumberSchema,
    to: phoneNumberSchema,
    message: z.string(),
    mediaUrl: z.string().url().nullable(),
    direction: directionSchema,
    receivedAt: isoDateSchema
  })
  .strict();

export const voiceMessageDataSchema = z
  .object({
    callId: z.string().min(1),
    numberId: z.string().min(1),
    from: phoneNumberSchema,
    to: phoneNumberSchema,
    status: z.literal("in-progress"),
    transcript: z.string(),
    confidence: z.number().min(0).max(1),
    direction: directionSchema
  })
  .strict();

export const transcriptTurnSchema = z
  .object({
    role: z.enum(["agent", "user"]),
    content: z.string()
  })
  .strict();

export const callEndedDataSchema = z
  .object({
    callId: z.string().min(1),
    numberId: z.string().min(1),
    from: phoneNumberSchema,
    to: phoneNumberSchema,
    direction: directionSchema,
    status: z.literal("completed"),
    startedAt: isoDateSchema,
    endedAt: isoDateSchema,
    durationSeconds: z.number().int().nonnegative(),
    disconnectionReason: z.string().min(1),
    transcript: z.array(transcriptTurnSchema),
    summary: z.string(),
    userSentiment: z.string(),
    callSuccessful: z.boolean()
  })
  .strict();

export const reactionDataSchema = z
  .object({
    conversationId: z.string().min(1),
    numberId: z.string().min(1),
    reactionType: z.enum(["love", "like", "dislike", "laugh", "emphasize", "question"]),
    fromNumber: phoneNumberSchema,
    direction: directionSchema,
    messageId: z.string().min(1),
    messageBody: z.string(),
    messageMediaUrl: z.string().url().nullable(),
    createdAt: isoDateSchema
  })
  .strict();

export const messageEnvelopeSchema = z
  .object({
    event: z.literal("agent.message"),
    channel: messageChannelSchema,
    data: messageDataSchema,
    ...baseEnvelopeFields
  })
  .strict();

export const voiceMessageEnvelopeSchema = z
  .object({
    event: z.literal("agent.message"),
    channel: z.literal("voice"),
    data: voiceMessageDataSchema,
    ...baseEnvelopeFields
  })
  .strict();

export const callEndedEnvelopeSchema = z
  .object({
    event: z.literal("agent.call_ended"),
    channel: z.literal("voice"),
    data: callEndedDataSchema,
    ...baseEnvelopeFields
  })
  .strict();

export const reactionEnvelopeSchema = z
  .object({
    event: z.literal("agent.reaction"),
    channel: z.literal("imessage"),
    data: reactionDataSchema,
    ...baseEnvelopeFields
  })
  .strict();

export const agentPhoneEnvelopeSchema = z.union([messageEnvelopeSchema, voiceMessageEnvelopeSchema, callEndedEnvelopeSchema, reactionEnvelopeSchema]);

export const defaultIdentity: SimulatorIdentity = {
  agentId: "agt_local",
  numberId: "num_local",
  from: "+15559876543",
  to: "+15551234567"
};

export function isoNow(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export interface MessageBuilderInput extends Partial<SimulatorIdentity> {
  message: string;
  channel?: MessageChannel;
  timestamp?: string;
  conversationId?: string;
  conversationState?: ConversationState;
  recentHistory?: RecentHistoryItem[];
  mediaUrl?: string | null;
}

export function buildMessageEvent(input: MessageBuilderInput): MessageEnvelope {
  const timestamp = input.timestamp ?? isoNow();
  const envelope: MessageEnvelope = {
    event: "agent.message",
    channel: input.channel ?? "sms",
    timestamp,
    agentId: input.agentId ?? defaultIdentity.agentId,
    data: {
      conversationId: input.conversationId ?? id("conv"),
      numberId: input.numberId ?? defaultIdentity.numberId,
      from: input.from ?? defaultIdentity.from,
      to: input.to ?? defaultIdentity.to,
      message: input.message,
      mediaUrl: input.mediaUrl ?? null,
      direction: "inbound",
      receivedAt: timestamp
    },
    conversationState: input.conversationState ?? null,
    recentHistory: input.recentHistory ?? []
  };

  return messageEnvelopeSchema.parse(envelope);
}

export interface VoiceMessageBuilderInput extends Partial<SimulatorIdentity> {
  transcript: string;
  timestamp?: string;
  callId?: string;
  confidence?: number;
  conversationState?: ConversationState;
  recentHistory?: RecentHistoryItem[];
}

export function buildVoiceMessageEvent(input: VoiceMessageBuilderInput): VoiceMessageEnvelope {
  const timestamp = input.timestamp ?? isoNow();
  const envelope: VoiceMessageEnvelope = {
    event: "agent.message",
    channel: "voice",
    timestamp,
    agentId: input.agentId ?? defaultIdentity.agentId,
    data: {
      callId: input.callId ?? id("call"),
      numberId: input.numberId ?? defaultIdentity.numberId,
      from: input.from ?? defaultIdentity.from,
      to: input.to ?? defaultIdentity.to,
      status: "in-progress",
      transcript: input.transcript,
      confidence: input.confidence ?? 0.95,
      direction: "inbound"
    },
    conversationState: input.conversationState ?? null,
    recentHistory: input.recentHistory ?? []
  };

  return voiceMessageEnvelopeSchema.parse(envelope);
}

export interface CallEndedBuilderInput extends Partial<SimulatorIdentity> {
  callId: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  transcript: TranscriptTurn[];
  summary?: string;
  userSentiment?: string;
  callSuccessful?: boolean;
  disconnectionReason?: string;
  timestamp?: string;
  conversationState?: ConversationState;
  recentHistory?: RecentHistoryItem[];
}

export function buildCallEndedEvent(input: CallEndedBuilderInput): CallEndedEnvelope {
  const endedAt = input.endedAt ?? isoNow();
  const started = Date.parse(input.startedAt);
  const ended = Date.parse(endedAt);
  const durationSeconds =
    input.durationSeconds ?? (Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.round((ended - started) / 1000)) : 0);

  const envelope: CallEndedEnvelope = {
    event: "agent.call_ended",
    channel: "voice",
    timestamp: input.timestamp ?? endedAt,
    agentId: input.agentId ?? defaultIdentity.agentId,
    data: {
      callId: input.callId,
      numberId: input.numberId ?? defaultIdentity.numberId,
      from: input.from ?? defaultIdentity.from,
      to: input.to ?? defaultIdentity.to,
      direction: "inbound",
      status: "completed",
      startedAt: input.startedAt,
      endedAt,
      durationSeconds,
      disconnectionReason: input.disconnectionReason ?? "agent_hangup",
      transcript: input.transcript,
      summary: input.summary ?? summarizeTranscript(input.transcript),
      userSentiment: input.userSentiment ?? inferSentiment(input.transcript),
      callSuccessful: input.callSuccessful ?? inferCallSuccess(input.transcript)
    },
    conversationState: input.conversationState ?? null,
    recentHistory: input.recentHistory ?? []
  };

  return callEndedEnvelopeSchema.parse(envelope);
}

export interface ReactionBuilderInput extends Partial<SimulatorIdentity> {
  conversationId?: string;
  reactionType: ReactionType;
  messageId: string;
  messageBody: string;
  messageMediaUrl?: string | null;
  timestamp?: string;
  conversationState?: ConversationState;
  recentHistory?: RecentHistoryItem[];
}

export function buildReactionEvent(input: ReactionBuilderInput): ReactionEnvelope {
  const timestamp = input.timestamp ?? isoNow();
  const envelope: ReactionEnvelope = {
    event: "agent.reaction",
    channel: "imessage",
    timestamp,
    agentId: input.agentId ?? defaultIdentity.agentId,
    data: {
      conversationId: input.conversationId ?? id("conv"),
      numberId: input.numberId ?? defaultIdentity.numberId,
      reactionType: input.reactionType,
      fromNumber: input.from ?? defaultIdentity.from,
      direction: "inbound",
      messageId: input.messageId,
      messageBody: input.messageBody,
      messageMediaUrl: input.messageMediaUrl ?? null,
      createdAt: timestamp
    },
    conversationState: input.conversationState ?? null,
    recentHistory: input.recentHistory ?? []
  };

  return reactionEnvelopeSchema.parse(envelope);
}

export function eventType(payload: AgentPhoneEnvelope): AgentPhoneEvent {
  return payload.event;
}

export function serializePayload(payload: AgentPhoneEnvelope): string {
  agentPhoneEnvelopeSchema.parse(payload);
  return JSON.stringify(payload);
}

function summarizeTranscript(transcript: TranscriptTurn[]): string {
  const userTurns = transcript.filter((turn) => turn.role === "user").map((turn) => turn.content.trim()).filter(Boolean);
  if (userTurns.length === 0) return "Simulated call completed.";
  return `Customer discussed: ${userTurns.slice(0, 2).join(" / ")}`;
}

function inferSentiment(transcript: TranscriptTurn[]): string {
  const text = transcript.map((turn) => turn.content).join(" ").toLowerCase();
  if (/\b(thanks|thank you|great|perfect|awesome|resolved|appreciate)\b/.test(text)) return "Positive";
  if (/\b(angry|upset|bad|terrible|frustrated|failed)\b/.test(text)) return "Negative";
  return "Neutral";
}

function inferCallSuccess(transcript: TranscriptTurn[]): boolean {
  const text = transcript.map((turn) => turn.content).join(" ").toLowerCase();
  if (/\b(transfer|human|representative|failed|can't help|cannot help)\b/.test(text)) return false;
  return /\b(resolved|all set|done|confirmed|thank you|thanks|perfect)\b/.test(text);
}
