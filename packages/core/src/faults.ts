import type { DeliveryFault, SignedDelivery } from "./types.js";
import { signRawBody } from "./signer.js";

export interface FaultInjectionOptions {
  secret: string;
  previousWebhookId?: string;
  nowSeconds?: number;
}

export interface FaultInjectionResult {
  delivery: SignedDelivery;
  applied: string[];
}

export function injectDeliveryFaults(
  input: SignedDelivery,
  fault: DeliveryFault | undefined,
  options: FaultInjectionOptions
): FaultInjectionResult {
  const delivery: SignedDelivery = {
    ...input,
    headers: { ...input.headers }
  };
  const applied: string[] = [];
  if (!fault) return { delivery, applied };

  if (fault.duplicateWebhookId) {
    delivery.webhookId = options.previousWebhookId ?? "wh_fault_duplicate";
    delivery.headers["X-Webhook-ID"] = delivery.webhookId;
    applied.push("duplicate_webhook_id");
  }

  if (fault.staleTimestampSeconds !== undefined) {
    delivery.timestampSeconds = (options.nowSeconds ?? Math.floor(Date.now() / 1000)) - fault.staleTimestampSeconds;
    delivery.headers["X-Webhook-Timestamp"] = String(delivery.timestampSeconds);
    delivery.headers["X-Webhook-Signature"] = signRawBody({
      rawBody: delivery.rawBody,
      secret: options.secret,
      timestampSeconds: delivery.timestampSeconds
    });
    applied.push("stale_timestamp");
  }

  if (fault.malformedJson) {
    delivery.rawBody = '{"malformed":';
    delivery.headers["X-Webhook-Signature"] = signRawBody({
      rawBody: delivery.rawBody,
      secret: options.secret,
      timestampSeconds: delivery.timestampSeconds
    });
    applied.push("malformed_json");
  }

  if (fault.tamperBody) {
    delivery.rawBody += "\n";
    applied.push("tampered_body");
  }

  if (fault.invalidSignature) {
    delivery.headers["X-Webhook-Signature"] = `sha256=${"0".repeat(64)}`;
    applied.push("invalid_signature");
  }

  if (fault.omitSignature) {
    delete delivery.headers["X-Webhook-Signature"];
    applied.push("missing_signature");
  }

  if (fault.simulateTimeout) applied.push("simulated_timeout");
  return { delivery, applied };
}
