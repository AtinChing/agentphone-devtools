import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDevtoolsServer, DEFAULT_CONTACTS, SAMPLE_SCENARIOS, seedSampleRuns, SamplesUnavailableError, type DevtoolsServerConfig } from "../src/index.js";
import { ContactsStore } from "../src/contacts.js";

const cleanup: Array<() => void | Promise<void>> = [];
const REPO_ROOT = join(__dirname, "../../..");

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("default contacts", () => {
  it("ships three people per channel and restores missing ones by number", () => {
    const perChannel = new Map<string, number>();
    for (const contact of DEFAULT_CONTACTS) perChannel.set(contact.channel, (perChannel.get(contact.channel) ?? 0) + 1);
    expect([...perChannel.entries()].sort()).toEqual([
      ["imessage", 3],
      ["sms", 3],
      ["voice", 3],
      ["whatsapp", 3]
    ]);
    expect(new Set(DEFAULT_CONTACTS.map((contact) => contact.number)).size).toBe(DEFAULT_CONTACTS.length);

    const store = new ContactsStore(join(temporaryDirectory(), "contacts.json"));
    expect(store.list()).toHaveLength(12);
    const maya = store.list().find((contact) => contact.name === "Maya Chen")!;
    store.delete(maya.id);
    expect(store.ensureDefaults()).toBe(1);
    expect(store.ensureDefaults()).toBe(0);
    expect(store.list().some((contact) => contact.number === maya.number)).toBe(true);
  });
});

describe("sample conversations", () => {
  it("runs every sample scenario against the handler and binds each to a contact", async () => {
    const { runtime, contacts } = await server(await webhookTarget());
    const result = await seedSampleRuns(runtime, contacts, REPO_ROOT);

    expect(result.runs).toBe(SAMPLE_SCENARIOS.length);
    expect(result.skipped).toEqual([]);
    const runs = runtime.getHistory().filter((run) => run.transcriptTurns > 0);
    expect(runs).toHaveLength(SAMPLE_SCENARIOS.length);
    expect(runs.every((run) => run.contact?.name)).toBe(true);
    const names = new Set(runs.map((run) => run.contact?.name));
    expect(names.size).toBeGreaterThanOrEqual(12);
    const channels = new Set(runs.map((run) => run.channel));
    expect(channels).toEqual(new Set(["sms", "imessage", "whatsapp", "voice"]));
    // The live session is left clean, not parked on the last sample.
    expect(runtime.getState().transcript).toHaveLength(0);
  }, 30_000);

  it("refuses to fill history with connection errors when the handler is down", async () => {
    const { runtime, contacts } = await server("http://127.0.0.1:9/webhook");
    await expect(seedSampleRuns(runtime, contacts, REPO_ROOT)).rejects.toBeInstanceOf(SamplesUnavailableError);
    expect(runtime.getHistory().filter((run) => run.transcriptTurns > 0)).toHaveLength(0);
  }, 30_000);

  it("is reachable over HTTP and reports a 502 when the handler is down", async () => {
    const { app } = await server("http://127.0.0.1:9/webhook");
    const response = await app.inject({ method: "POST", url: "/api/samples/seed", payload: {} });
    expect(response.statusCode).toBe(502);
    const status = await app.inject({ method: "GET", url: "/api/samples" });
    expect(status.json()).toMatchObject({ scenarios: SAMPLE_SCENARIOS.length, loaded: 0 });
  }, 30_000);
});

async function server(targetUrl: string) {
  const created = await createDevtoolsServer(testConfig(temporaryDirectory(), targetUrl));
  cleanup.push(() => created.app.close());
  return created;
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agentphone-samples-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function testConfig(directory: string, targetUrl: string): DevtoolsServerConfig {
  return {
    targetUrl,
    secret: "whsec_super_secret_value",
    channel: "sms",
    timeoutSeconds: 5,
    contextLimit: 10,
    port: 0,
    retryOnNon200: false,
    historyPath: join(directory, "history.json"),
    historyLimit: 100
  };
}

async function webhookTarget(): Promise<string> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ text: "ok", action: "ack" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test webhook did not bind to a TCP port");
  return `http://127.0.0.1:${address.port}/webhook`;
}
