import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { AgentPhoneEnvelope, AgentPhoneEvent, SignedDelivery } from "./types.js";
import { eventType, serializePayload } from "./events.js";

export interface SignInput {
  rawBody: string | Buffer;
  secret: string;
  timestampSeconds?: number;
}

export function signRawBody({ rawBody, secret, timestampSeconds = nowSeconds() }: SignInput): string {
  const signedString = Buffer.concat([
    Buffer.from(String(timestampSeconds)),
    Buffer.from("."),
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody)
  ]);
  const hex = createHmac("sha256", secret).update(signedString).digest("hex");
  return `sha256=${hex}`;
}

export interface WebhookHeaderInput extends SignInput {
  event: AgentPhoneEvent;
  webhookId?: string;
}

export function buildWebhookHeaders(input: WebhookHeaderInput): Record<string, string> {
  const timestampSeconds = input.timestampSeconds ?? nowSeconds();
  return {
    "Content-Type": "application/json",
    "X-Webhook-Signature": signRawBody({ rawBody: input.rawBody, secret: input.secret, timestampSeconds }),
    "X-Webhook-Timestamp": String(timestampSeconds),
    "X-Webhook-ID": input.webhookId ?? `wh_${randomUUID()}`,
    "X-Webhook-Event": input.event
  };
}

export interface BuildSignedDeliveryOptions {
  secret: string;
  timestampSeconds?: number;
  webhookId?: string;
}

export function buildSignedDelivery<TPayload extends AgentPhoneEnvelope>(
  payload: TPayload,
  options: BuildSignedDeliveryOptions
): SignedDelivery<TPayload> {
  const rawBody = serializePayload(payload);
  const timestampSeconds = options.timestampSeconds ?? nowSeconds();
  const webhookId = options.webhookId ?? `wh_${randomUUID()}`;
  const headers = buildWebhookHeaders({
    rawBody,
    secret: options.secret,
    timestampSeconds,
    webhookId,
    event: eventType(payload)
  });

  return {
    payload,
    rawBody,
    headers,
    timestampSeconds,
    webhookId
  };
}

export function verifyWebhook(rawBody: string | Buffer, signature: string, timestamp: string | number, secret: string, toleranceSeconds = 300): boolean {
  const ts = typeof timestamp === "number" ? timestamp : Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;
  const expected = signRawBody({ rawBody, secret, timestampSeconds: ts });

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
