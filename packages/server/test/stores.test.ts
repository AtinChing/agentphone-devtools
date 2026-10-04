import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDevtoolsServer, DevtoolsRuntime, type DevtoolsServerConfig } from "../src/index.js";
import { ContactsStore } from "../src/contacts.js";
import { EnvironmentsStore, maskSecretPreview } from "../src/environments.js";
import { computeUsageStats } from "../src/stats.js";
import { listScenarios } from "../src/scenarios.js";

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("contacts store", () => {
  it("seeds defaults once, validates numbers, and persists across instances", () => {
    const path = join(temporaryDirectory(), "contacts.json");
    const store = new ContactsStore(path);
    expect(store.list()).toHaveLength(12);
    expect(store.list().map((contact) => contact.name)).toEqual(expect.arrayContaining(["Jordan Reyes", "Maya Chen", "Priya Natarajan", "Sam Okafor"]));

    const added = store.upsert({ name: "Test Person", number: "+15550001111", channel: "imessage", conversationState: { tier: "gold" } });
    expect(added.id).toMatch(/^ct_/);
    expect(() => store.upsert({ name: "", number: "+15550001111", channel: "sms", conversationState: null })).toThrow(/name/);
    expect(() => store.upsert({ name: "Bad", number: "555-0000", channel: "sms", conversationState: null })).toThrow(/E\.164/);
    expect(() => store.upsert({ name: "Bad", number: "+15550001111", channel: "fax" as never, conversationState: null })).toThrow(/channel/);

    const renamed = store.upsert({ id: added.id, name: "Renamed", number: "+15550001111", channel: "sms", conversationState: null });
    expect(renamed.createdAt).toBe(added.createdAt);

    const reopened = new ContactsStore(path);
    expect(reopened.list()).toHaveLength(13);
    expect(reopened.get(added.id)?.name).toBe("Renamed");
    expect(reopened.delete(added.id)).toBe(true);
    expect(reopened.delete(added.id)).toBe(false);
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(1);
  });
});

describe("environments store", () => {
  it("keeps secrets server-side and exposes a preview", () => {
    const store = new EnvironmentsStore(join(temporaryDirectory(), "environments.json"));
    const view = store.upsert({ name: "Staging", targetUrl: "http://localhost:4000/webhook", secret: "whsec_staging_secret_value", channel: "sms" });
    expect(view).not.toHaveProperty("secret");
    expect(view.secretPreview).toBe(maskSecretPreview("whsec_staging_secret_value"));
    expect(view.secretPreview).not.toContain("staging_secret");
    expect(store.get(view.id)?.secret).toBe("whsec_staging_secret_value");
    expect(() => store.upsert({ name: "", targetUrl: "http://x", secret: "s" })).toThrow();
    expect(() => store.upsert({ name: "Bad URL", targetUrl: "not a url", secret: "s" })).toThrow();
  });
});

describe("usage stats", () => {
  it("aggregates runs, deliveries, windows, and opt-outs", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget({ text: "bye", action: "opt_out" })));
    await runtime.sendCallerTurn("STOP", "sms");
    await runtime.endCall();
    runtime.reset({ channel: "voice" });
    await runtime.sendCallerTurn("hello", "voice");
    await runtime.endCall();

    const sessions = runtime.getHistory().map((summary) => runtime.getHistorySession(summary.id)!);
    const stats = computeUsageStats(sessions, new Date(), 7);
    expect(stats.totals).toMatchObject({ runs: 2, messages: 1, calls: 1, optOuts: 2, failedDeliveries: 0 });
    expect(stats.totals.deliveries).toBe(3); // two turns + the voice call_ended
    expect(stats.windows.last24h).toEqual({ messages: 1, calls: 1 });
    expect(stats.byDay).toHaveLength(7);
    expect(stats.byDay.at(-1)?.deliveries).toBe(3);
    expect(stats.webhookHealth.successRate).toBe(100);
    expect(computeUsageStats([]).totals.runs).toBe(0);
  });
});

describe("scenario listing", () => {
  it("walks directories, groups by folder, and reports parse errors inline", async () => {
    const root = temporaryDirectory();
    mkdirSync(join(root, "messaging"), { recursive: true });
    writeFileSync(
      join(root, "messaging", "good.yaml"),
      `name: Good\nchannel: imessage\nagentId: a\nnumberId: n\nfrom: "+15559876544"\nto: "+15551234567"\nconversationState: null\ncontextLimit: 10\ntimeoutSeconds: 5\nturns:\n  - agent: Opener\n  - caller: YES\n    expect:\n      actions: [ack]\n`
    );
    writeFileSync(join(root, "messaging", "broken.yaml"), "name: Broken\nturns: []\n");
    writeFileSync(join(root, "messaging", "notes.txt"), "ignored");

    const listings = await listScenarios(["messaging", "missing-dir"], root);
    expect(listings.map((listing) => listing.path)).toEqual(["messaging/broken.yaml", "messaging/good.yaml"]);
    expect(listings[1]).toMatchObject({ name: "Good", group: "messaging", channel: "imessage", turns: 2, callerTurns: 1, hasAssertions: true });
    expect(listings[0].error).toBeTruthy();
  });
});

describe("scenario export to the exports folder", () => {
  it("writes a scenario file the picker can discover", async () => {
    const { app, runtime } = await server();
    const previousCwd = process.cwd();
    const workdir = temporaryDirectory();
    process.chdir(workdir);
    cleanup.push(() => process.chdir(previousCwd));

    await runtime.sendCallerTurn("hello", "sms");
    const sessionId = runtime.getState().id;
    const saved = await app.inject({ method: "POST", url: `/api/history/${sessionId}/export`, payload: { name: "My Saved Run!" } });
    expect(saved.json()).toEqual({ path: ".agentphone-devtools/exports/my-saved-run.yaml", name: "My Saved Run!", turns: 1 });
    const yaml = readFileSync(join(workdir, ".agentphone-devtools/exports/my-saved-run.yaml"), "utf8");
    expect(yaml).toContain('name: "My Saved Run!"');
    expect(yaml).toContain("actions:");

    const listed = await listScenarios([".agentphone-devtools/exports"], workdir);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: "My Saved Run!", group: "exports", callerTurns: 1, hasAssertions: true });

    const missing = await app.inject({ method: "POST", url: "/api/history/sess_nope/export", payload: {} });
    expect(missing.statusCode).toBe(404);
    const empty = await app.inject({ method: "POST", url: `/api/history/${runtime.reset().id}/export`, payload: {} });
    expect(empty.statusCode).toBe(422);
  });
});

describe("dashboard HTTP routes", () => {
  it("contacts, environments, scenarios, stats, and clearing history", async () => {
    const { app, runtime } = await server();

    const created = await app.inject({ method: "POST", url: "/api/contacts", payload: { name: "New Contact", number: "+15550002222", channel: "imessage" } });
    expect(created.statusCode).toBe(200);
    const contactId = created.json().id as string;
    const updated = await app.inject({ method: "PUT", url: `/api/contacts/${contactId}`, payload: { name: "Updated", number: "+15550002222", channel: "sms" } });
    expect(updated.json()).toMatchObject({ id: contactId, name: "Updated", channel: "sms" });
    const invalid = await app.inject({ method: "POST", url: "/api/contacts", payload: { name: "Bad", number: "nope" } });
    expect(invalid.statusCode).toBe(400);
    const removed = await app.inject({ method: "DELETE", url: `/api/contacts/${contactId}` });
    expect(removed.statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/api/contacts/${contactId}` })).statusCode).toBe(404);

    const environment = await app.inject({
      method: "POST",
      url: "/api/environments",
      payload: { name: "Second handler", targetUrl: runtime.getState().targetUrl, secret: "whsec_other_secret_value", channel: "sms" }
    });
    expect(environment.json()).not.toHaveProperty("secret");
    const listed = await app.inject({ method: "GET", url: "/api/environments" });
    expect(listed.json().active.targetUrl).toBe(runtime.getState().targetUrl);
    expect(listed.json().environments).toHaveLength(1);
    const activated = await app.inject({ method: "POST", url: `/api/environments/${environment.json().id}/activate`, payload: {} });
    expect(activated.json()).toMatchObject({ channel: "sms", secretPreview: expect.stringContaining("whsec") });
    expect(JSON.stringify(activated.json())).not.toContain("other_secret_value");
    expect((await app.inject({ method: "DELETE", url: `/api/environments/${environment.json().id}` })).statusCode).toBe(204);

    const scenarios = await app.inject({ method: "GET", url: "/api/scenarios" });
    expect(scenarios.statusCode).toBe(200);
    expect(Array.isArray(scenarios.json())).toBe(true);

    await runtime.sendCallerTurn("hello", "sms");
    await runtime.endCall();
    const stats = await app.inject({ method: "GET", url: "/api/stats" });
    expect(stats.json().totals.runs).toBe(1);

    // Clearing removes every saved run except the one currently live.
    runtime.reset();
    const cleared = await app.inject({ method: "DELETE", url: "/api/history" });
    expect(cleared.json().removed).toBe(1);
    expect(runtime.getHistory().every((summary) => summary.id === runtime.getState().id)).toBe(true);
  });
});

async function server() {
  const created = await createDevtoolsServer(testConfig(temporaryDirectory(), await webhookTarget()));
  cleanup.push(() => created.app.close());
  return created;
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agentphone-stores-"));
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

async function webhookTarget(responseBody: Record<string, unknown> = { text: "ok", action: "ack" }): Promise<string> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(responseBody));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test webhook did not bind to a TCP port");
  return `http://127.0.0.1:${address.port}/webhook`;
}
