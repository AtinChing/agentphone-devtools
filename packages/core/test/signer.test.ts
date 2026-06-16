import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildMessageEvent, buildSignedDelivery, signRawBody, verifyWebhook } from "../src/index.js";

function documentedVerifyWebhook(rawBody: string, signature: string, timestamp: string, secret: string) {
  if (Math.abs(Date.now() / 1000 - Number.parseInt(timestamp)) > 300) return false;
  const signedString = timestamp + "." + rawBody;
  const expected = crypto.createHmac("sha256", secret).update(signedString).digest("hex");
  return signature === `sha256=${expected}`;
}

describe("AgentPhone webhook signing", () => {
  it("matches the documented verifier over the exact raw body", () => {
    const payload = buildMessageEvent({
      timestamp: "2025-01-15T12:00:00Z",
      conversationId: "conv_def456",
      agentId: "agt_abc123",
      numberId: "num_xyz789",
      from: "+15559876543",
      to: "+15551234567",
      message: "Hi, I need help with my order",
      conversationState: { customerName: "Jane Doe", orderId: "ORD-12345" },
      recentHistory: [{ content: "Hello", direction: "inbound", channel: "sms", at: "2025-01-15T11:59:00Z" }]
    });
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const delivery = buildSignedDelivery(payload, {
      secret: "whsec_demo",
      timestampSeconds,
      webhookId: "wh_test"
    });

    expect(documentedVerifyWebhook(delivery.rawBody, delivery.headers["X-Webhook-Signature"], delivery.headers["X-Webhook-Timestamp"], "whsec_demo")).toBe(true);
    expect(verifyWebhook(delivery.rawBody, delivery.headers["X-Webhook-Signature"], delivery.headers["X-Webhook-Timestamp"], "whsec_demo")).toBe(true);
  });

  it("changes when raw body bytes change", () => {
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const rawBody = "{\"event\":\"agent.message\"}";
    const signature = signRawBody({ rawBody, secret: "whsec_demo", timestampSeconds });

    expect(verifyWebhook(rawBody.replace("message", "call_ended"), signature, timestampSeconds, "whsec_demo")).toBe(false);
  });
});
