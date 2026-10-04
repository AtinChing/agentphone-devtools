import { id, isoNow, type SessionChannel } from "@agentphone-devtools/core";
import { JsonFileStore } from "./json-store.js";

/**
 * A named simulator target — the dashboard's "sub-account" concept mapped
 * onto what a local devtool actually has: which webhook it points at, with
 * which secret. Switching environments retargets the live session.
 */
export interface Environment {
  id: string;
  name: string;
  targetUrl: string;
  secret: string;
  channel?: SessionChannel;
  createdAt: string;
}

/** Wire shape: the secret never leaves the server. */
export interface EnvironmentView {
  id: string;
  name: string;
  targetUrl: string;
  secretPreview: string;
  channel?: SessionChannel;
  createdAt: string;
}

export type EnvironmentInput = { id?: string; name: string; targetUrl: string; secret?: string; channel?: SessionChannel };

export class EnvironmentsStore {
  private readonly store: JsonFileStore<Environment>;

  constructor(filePath: string) {
    this.store = new JsonFileStore<Environment>(filePath);
  }

  list(): EnvironmentView[] {
    return this.store
      .list()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(toView);
  }

  get(environmentId: string): Environment | undefined {
    return this.store.get(environmentId);
  }

  upsert(input: EnvironmentInput): EnvironmentView {
    const name = input.name?.trim();
    if (!name) throw new Error("Environment name is required");
    let url: URL;
    try {
      url = new URL(input.targetUrl);
    } catch {
      throw new Error("targetUrl must be an absolute http:// or https:// URL");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("targetUrl must use http or https");
    const existing = input.id ? this.store.get(input.id) : undefined;
    const secret = input.secret?.trim() || existing?.secret;
    if (!secret) throw new Error("A signing secret is required");
    const environment: Environment = {
      id: existing?.id ?? input.id ?? id("env"),
      name,
      targetUrl: input.targetUrl,
      secret,
      ...(input.channel ? { channel: input.channel } : existing?.channel ? { channel: existing.channel } : {}),
      createdAt: existing?.createdAt ?? isoNow()
    };
    return toView(this.store.upsert(environment));
  }

  delete(environmentId: string): boolean {
    return this.store.delete(environmentId);
  }
}

export function maskSecretPreview(secret: string): string {
  if (secret.length <= 8) return `${secret.slice(0, 2)}…`;
  return `${secret.slice(0, 6)}...${secret.slice(-4)}`;
}

function toView(environment: Environment): EnvironmentView {
  const { secret, ...rest } = environment;
  return { ...rest, secretPreview: maskSecretPreview(secret) };
}
