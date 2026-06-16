import { setTimeout as sleep } from "node:timers/promises";
import type { AgentPhoneEnvelope, AgentResponseChunk, DispatchOptions, DispatchResult, ParsedAgentResponse, SignedDelivery } from "./types.js";
import { buildSignedDelivery } from "./signer.js";

const DEFAULT_TIMEOUT_SECONDS = 30;

export async function dispatchWebhook(payload: AgentPhoneEnvelope, options: DispatchOptions): Promise<DispatchResult> {
  const signed = buildSignedDelivery(payload, {
    secret: options.secret,
    timestampSeconds: options.timestampSeconds,
    webhookId: options.webhookId
  });

  return dispatchSignedDelivery(signed, options);
}

export async function dispatchSignedDelivery(signed: SignedDelivery, options: Omit<DispatchOptions, "secret" | "webhookId" | "timestampSeconds">): Promise<DispatchResult> {
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const started = performance.now();

  try {
    const response = await fetch(options.targetUrl, {
      method: "POST",
      headers: signed.headers,
      body: signed.rawBody,
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") ?? "";
    const parsed = await parseAgentResponse(response, contentType, options.onChunk);
    const latencyMs = Math.round(performance.now() - started);

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      latencyMs,
      timedOut: latencyMs > timeoutSeconds * 1000,
      headers: headersToRecord(response.headers),
      rawResponseBody: parsed.rawBody,
      parsed: parsed.response
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: 0,
      statusText: timedOut ? "Timeout" : "Dispatch error",
      latencyMs,
      timedOut,
      headers: {},
      rawResponseBody: "",
      parsed: emptyParsed(timedOut ? `Handler exceeded ${timeoutSeconds}s timeout` : "No parseable handler response"),
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

export interface RetryOptions extends DispatchOptions {
  retryOnNon200?: boolean;
  compressedBackoffMs?: number[];
  onRetry?: (attempt: number, delayMs: number, result: DispatchResult) => void;
}

export async function dispatchWebhookWithRetry(payload: AgentPhoneEnvelope, options: RetryOptions): Promise<DispatchResult> {
  const backoffMs = options.compressedBackoffMs ?? [0, 250, 750, 1500, 3000, 5000];
  let lastResult: DispatchResult | undefined;

  for (let attempt = 0; attempt < backoffMs.length; attempt += 1) {
    if (attempt > 0) await sleep(backoffMs[attempt]);
    lastResult = await dispatchWebhook(payload, options);
    if (!options.retryOnNon200 || lastResult.ok) return lastResult;
    if (attempt < backoffMs.length - 1) options.onRetry?.(attempt + 1, backoffMs[attempt + 1], lastResult);
  }

  return lastResult ?? dispatchWebhook(payload, options);
}

async function parseAgentResponse(
  response: Response,
  contentType: string,
  onChunk?: (chunk: AgentResponseChunk) => void
): Promise<{ rawBody: string; response: ParsedAgentResponse }> {
  if (response.status === 204 || response.body === null) {
    return { rawBody: "", response: emptyParsed() };
  }

  if (contentType.includes("application/x-ndjson")) {
    return parseNdjsonResponse(response, onChunk);
  }

  const rawBody = await response.text();
  if (rawBody.trim() === "") return { rawBody, response: emptyParsed() };

  if (contentType.includes("application/json") || looksLikeJson(rawBody)) {
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!isObject(parsed) || Array.isArray(parsed)) {
        return { rawBody, response: { mode: "invalid", chunks: [], warnings: ["Voice response was not a JSON object; caller hears silence"] } };
      }
      const chunk = parsed as AgentResponseChunk;
      onChunk?.(chunk);
      return { rawBody, response: { mode: "json", final: chunk, chunks: [chunk], warnings: normalizeWarnings(chunk) } };
    } catch {
      return { rawBody, response: { mode: "invalid", chunks: [], warnings: ["Response looked like JSON but could not be parsed"] } };
    }
  }

  return {
    rawBody,
    response: {
      mode: "text",
      chunks: [],
      warnings: ["Non-object response ignored by voice contract; caller hears silence"]
    }
  };
}

async function parseNdjsonResponse(
  response: Response,
  onChunk?: (chunk: AgentResponseChunk) => void
): Promise<{ rawBody: string; response: ParsedAgentResponse }> {
  const reader = response.body?.getReader();
  if (!reader) return { rawBody: "", response: emptyParsed() };

  const decoder = new TextDecoder();
  const chunks: AgentResponseChunk[] = [];
  const warnings: string[] = [];
  let rawBody = "";
  let buffer = "";
  let final: AgentResponseChunk | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    rawBody += text;
    buffer += text;

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        const chunk = parseNdjsonLine(line, warnings);
        if (chunk) {
          chunks.push(chunk);
          onChunk?.(chunk);
          if (!chunk.interim && !final) final = chunk;
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    const chunk = parseNdjsonLine(trailing, warnings);
    if (chunk) {
      chunks.push(chunk);
      onChunk?.(chunk);
      if (!chunk.interim && !final) final = chunk;
    }
  }

  for (const chunk of chunks) warnings.push(...normalizeWarnings(chunk));
  if (!final && chunks.length > 0) warnings.push("NDJSON stream ended without a final non-interim chunk");
  if (chunks.length === 0) warnings.push("NDJSON response contained no parseable object chunks");

  return {
    rawBody,
    response: {
      mode: "ndjson",
      final,
      chunks,
      warnings
    }
  };
}

function parseNdjsonLine(line: string, warnings: string[]): AgentResponseChunk | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isObject(parsed) || Array.isArray(parsed)) {
      warnings.push("Ignored NDJSON chunk because it was not a JSON object");
      return null;
    }
    return parsed as AgentResponseChunk;
  } catch {
    warnings.push("Ignored malformed NDJSON chunk");
    return null;
  }
}

function emptyParsed(warning?: string): ParsedAgentResponse {
  return { mode: "empty", chunks: [], warnings: warning ? [warning] : [] };
}

function normalizeWarnings(chunk: AgentResponseChunk): string[] {
  const warnings: string[] = [];
  if (chunk.digits && (chunk.press_digit || chunk.dtmf)) warnings.push("Both digits and an alias were returned; digits takes precedence");
  if (!chunk.text && !chunk.action && !chunk.hangup && !chunk.digits && !chunk.press_digit && !chunk.dtmf && !chunk.interim) {
    warnings.push("JSON object had no voice response fields; caller hears silence");
  }
  return warnings;
}

function looksLikeJson(rawBody: string): boolean {
  const trimmed = rawBody.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}
