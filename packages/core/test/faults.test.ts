import { describe, expect, it } from "vitest";
import { buildMessageEvent, buildSignedDelivery, injectDeliveryFaults, verifyWebhook } from "../src/index.js";

describe("delivery fault injection", () => {
  const secret = "whsec_fault_test";
  const original = buildSignedDelivery(buildMessageEvent({ message: "hello", channel: "sms" }), {
    secret,
    timestampSeconds: 2_000_000_000,
    webhookId: "wh_original"
  });

  it("creates valid stale and malformed deliveries before applying tampering", () => {
    const { delivery, applied } = injectDeliveryFaults(
      original,
      { staleTimestampSeconds: 600, malformedJson: true, duplicateWebhookId: true },
      { secret, nowSeconds: 2_000_000_000, previousWebhookId: "wh_previous" }
    );

    expect(delivery.webhookId).toBe("wh_previous");
    expect(delivery.timestampSeconds).toBe(1_999_999_400);
    expect(() => JSON.parse(delivery.rawBody)).toThrow();
    expect(
      verifyWebhook(
        delivery.rawBody,
        delivery.headers["X-Webhook-Signature"],
        delivery.headers["X-Webhook-Timestamp"],
        secret,
        Number.POSITIVE_INFINITY
      )
    ).toBe(true);
    expect(applied).toEqual(["duplicate_webhook_id", "stale_timestamp", "malformed_json"]);
  });

  it("can tamper, invalidate, or omit signatures", () => {
    const tampered = injectDeliveryFaults(original, { tamperBody: true }, { secret }).delivery;
    expect(
      verifyWebhook(tampered.rawBody, tampered.headers["X-Webhook-Signature"], tampered.headers["X-Webhook-Timestamp"], secret, Infinity)
    ).toBe(false);

    const invalid = injectDeliveryFaults(original, { invalidSignature: true }, { secret }).delivery;
    expect(invalid.headers["X-Webhook-Signature"]).toBe(`sha256=${"0".repeat(64)}`);

    const missing = injectDeliveryFaults(original, { omitSignature: true }, { secret }).delivery;
    expect(missing.headers["X-Webhook-Signature"]).toBeUndefined();
  });
});
