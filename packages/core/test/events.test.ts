import { describe, expect, it } from "vitest";
import {
  buildCallEndedEvent,
  buildMessageEvent,
  buildSignedDelivery,
  buildVoiceMessageEvent,
  callEndedEnvelopeSchema,
  messageEnvelopeSchema,
  voiceMessageEnvelopeSchema
} from "../src/index.js";

describe("AgentPhone event builders", () => {
  it("builds the documented SMS agent.message shape", () => {
    const payload = buildMessageEvent({
      timestamp: "2025-01-15T12:00:00Z",
      agentId: "agt_abc123",
      conversationId: "conv_def456",
      numberId: "num_xyz789",
      from: "+15559876543",
      to: "+15551234567",
      message: "Hi, I need help with my order",
      conversationState: { customerName: "Jane Doe", orderId: "ORD-12345" },
      recentHistory: [{ content: "Hello", direction: "inbound", channel: "sms", at: "2025-01-15T11:59:00Z" }]
    });

    expect(messageEnvelopeSchema.parse(payload)).toEqual({
      event: "agent.message",
      channel: "sms",
      timestamp: "2025-01-15T12:00:00Z",
      agentId: "agt_abc123",
      data: {
        conversationId: "conv_def456",
        numberId: "num_xyz789",
        from: "+15559876543",
        to: "+15551234567",
        message: "Hi, I need help with my order",
        mediaUrl: null,
        direction: "inbound",
        receivedAt: "2025-01-15T12:00:00Z"
      },
      conversationState: { customerName: "Jane Doe", orderId: "ORD-12345" },
      recentHistory: [{ content: "Hello", direction: "inbound", channel: "sms", at: "2025-01-15T11:59:00Z" }]
    });
  });

  it("builds the documented voice agent.message shape", () => {
    const payload = buildVoiceMessageEvent({
      timestamp: "2025-01-15T12:00:00Z",
      callId: "call_abc123",
      numberId: "num_xyz789",
      from: "+15559876543",
      to: "+15551234567",
      transcript: "I need help with my order"
    });

    expect(voiceMessageEnvelopeSchema.parse(payload).data).toEqual({
      callId: "call_abc123",
      numberId: "num_xyz789",
      from: "+15559876543",
      to: "+15551234567",
      status: "in-progress",
      transcript: "I need help with my order",
      confidence: 0.95,
      direction: "inbound"
    });
  });

  it("builds the documented call-ended shape", () => {
    const payload = buildCallEndedEvent({
      timestamp: "2025-01-15T14:05:30Z",
      callId: "call_ghi012",
      numberId: "num_xyz789",
      from: "+15559876543",
      to: "+15551234567",
      startedAt: "2025-01-15T14:00:00Z",
      endedAt: "2025-01-15T14:05:30Z",
      durationSeconds: 330,
      transcript: [
        { role: "agent", content: "Hello! How can I help you today?" },
        { role: "user", content: "I need help with my order." }
      ],
      summary: "Customer called about an order inquiry.",
      userSentiment: "Positive",
      callSuccessful: true
    });

    expect(callEndedEnvelopeSchema.parse(payload).data).toMatchObject({
      callId: "call_ghi012",
      status: "completed",
      durationSeconds: 330,
      summary: "Customer called about an order inquiry.",
      userSentiment: "Positive",
      callSuccessful: true
    });
  });

  it("sends all four required security headers", () => {
    const payload = buildMessageEvent({ message: "hello" });
    const delivery = buildSignedDelivery(payload, { secret: "whsec_demo", timestampSeconds: 1736942400, webhookId: "wh_test" });

    expect(delivery.headers).toMatchObject({
      "X-Webhook-Signature": expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
      "X-Webhook-Timestamp": "1736942400",
      "X-Webhook-ID": "wh_test",
      "X-Webhook-Event": "agent.message"
    });
  });
});
