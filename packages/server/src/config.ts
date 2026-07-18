export interface RuntimeConfigUpdate {
  targetUrl?: string;
  secret?: string;
  channel?: "sms" | "voice";
  timeoutSeconds?: number;
  contextLimit?: number;
  retryOnNon200?: boolean;
}

const CONFIG_KEYS = new Set<keyof RuntimeConfigUpdate>([
  "targetUrl",
  "secret",
  "channel",
  "timeoutSeconds",
  "contextLimit",
  "retryOnNon200"
]);

export class RuntimeConfigValidationError extends Error {
  constructor(readonly issues: string[]) {
    super("Invalid runtime configuration");
    this.name = "RuntimeConfigValidationError";
  }
}

export function parseRuntimeConfigUpdate(input: unknown): RuntimeConfigUpdate {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RuntimeConfigValidationError(["configuration must be a JSON object"]);
  }

  const record = input as Record<string, unknown>;
  const issues: string[] = [];
  const update: RuntimeConfigUpdate = {};

  for (const key of Object.keys(record)) {
    if (!CONFIG_KEYS.has(key as keyof RuntimeConfigUpdate)) issues.push(`${key} is not a configurable runtime setting`);
  }

  if (record.targetUrl !== undefined) {
    if (typeof record.targetUrl !== "string" || !validHttpUrl(record.targetUrl)) {
      issues.push("targetUrl must be an absolute http:// or https:// URL");
    } else {
      update.targetUrl = record.targetUrl;
    }
  }

  if (record.secret !== undefined) {
    if (typeof record.secret !== "string" || record.secret.trim().length === 0 || record.secret.length > 4096) {
      issues.push("secret must be a non-empty string no longer than 4096 characters");
    } else {
      update.secret = record.secret;
    }
  }

  if (record.channel !== undefined) {
    if (record.channel !== "sms" && record.channel !== "voice") issues.push("channel must be sms or voice");
    else update.channel = record.channel;
  }

  if (record.timeoutSeconds !== undefined) {
    if (!Number.isInteger(record.timeoutSeconds) || Number(record.timeoutSeconds) < 5 || Number(record.timeoutSeconds) > 120) {
      issues.push("timeoutSeconds must be an integer between 5 and 120");
    } else update.timeoutSeconds = Number(record.timeoutSeconds);
  }

  if (record.contextLimit !== undefined) {
    if (!Number.isInteger(record.contextLimit) || Number(record.contextLimit) < 0 || Number(record.contextLimit) > 50) {
      issues.push("contextLimit must be an integer between 0 and 50");
    } else update.contextLimit = Number(record.contextLimit);
  }

  if (record.retryOnNon200 !== undefined) {
    if (typeof record.retryOnNon200 !== "boolean") issues.push("retryOnNon200 must be a boolean");
    else update.retryOnNon200 = record.retryOnNon200;
  }

  if (issues.length) throw new RuntimeConfigValidationError(issues);
  return update;
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}
