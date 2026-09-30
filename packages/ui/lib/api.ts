/**
 * Thin client for the local devtools server. Every request goes to the
 * server the CLI started (its URL is injected at dev-server launch); JSON
 * bodies are always sent, even when empty, because Fastify rejects an empty
 * body on a JSON POST.
 */
export const SERVER_URL = process.env.NEXT_PUBLIC_AGENTPHONE_DEVTOOLS_SERVER_URL ?? "http://127.0.0.1:4318";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly issues: string[] = []
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  let body: BodyInit | undefined;
  if (init.raw !== undefined) {
    body = init.raw;
  } else if (method !== "GET" && method !== "HEAD") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body ?? {});
  }
  const response = await fetch(`${SERVER_URL}${path}`, { method, headers, body });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    const record = parsed && typeof parsed === "object" ? (parsed as { error?: unknown; issues?: unknown }) : {};
    const issues = Array.isArray(record.issues) ? record.issues.filter((issue): issue is string => typeof issue === "string") : [];
    const message =
      typeof record.error === "string"
        ? issues.length
          ? `${record.error}: ${issues.join("; ")}`
          : record.error
        : `${response.status} ${response.statusText}`;
    throw new ApiError(message, response.status, issues);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body: unknown = {}) => request<T>(path, { method: "PUT", body }),
  delete: <T = void>(path: string) => request<T>(path, { method: "DELETE" }),
  /** POST raw bytes (audio for transcription). */
  postRaw: <T>(path: string, raw: BodyInit, contentType: string) => request<T>(path, { method: "POST", raw, headers: { "Content-Type": contentType } })
};

/** Absolute URL for a server-side download (reports, scenario exports). */
export function serverUrl(path: string): string {
  return `${SERVER_URL}${path}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
