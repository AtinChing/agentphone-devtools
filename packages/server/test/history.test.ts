import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDevtoolsServer, DevtoolsRuntime, type DevtoolsServerConfig } from "../src/index.js";

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("persistent run history", () => {
  it("restores completed sessions after the runtime restarts", async () => {
    const directory = temporaryDirectory();
    const target = await webhookTarget();
    const config = testConfig(directory, target);
    const firstRuntime = new DevtoolsRuntime(config);
    const firstSessionId = firstRuntime.getState().id;

    await firstRuntime.sendCallerTurn("Can you check charger 12?", "sms");
    await firstRuntime.endCall();

    const secondRuntime = new DevtoolsRuntime(config);
    const summary = secondRuntime.getHistory().find((session) => session.id === firstSessionId);
    const restored = secondRuntime.getHistorySession(firstSessionId);

    expect(summary).toMatchObject({ status: "ended", transcriptTurns: 2, deliveries: 1 });
    expect(restored?.transcript.map((turn) => turn.content)).toEqual(["Can you check charger 12?", "Charger 12 is back online."]);
    expect(readFileSync(config.historyPath, "utf8")).not.toContain(config.secret);
  });

  it("retains only the configured number of sessions", () => {
    const directory = temporaryDirectory();
    const config = { ...testConfig(directory, "http://127.0.0.1:1/webhook"), historyLimit: 2 };
    const runtime = new DevtoolsRuntime(config);

    runtime.updateConfig({ targetUrl: "http://127.0.0.1:2/webhook" });
    runtime.reset();
    runtime.updateConfig({ targetUrl: "http://127.0.0.1:3/webhook" });
    runtime.reset();

    expect(JSON.parse(readFileSync(config.historyPath, "utf8")).sessions).toHaveLength(2);
  });

  it("starts with a warning when the history file is damaged", () => {
    const directory = temporaryDirectory();
    const config = testConfig(directory, "http://127.0.0.1:1/webhook");
    writeFileSync(config.historyPath, "not json", "utf8");

    const runtime = new DevtoolsRuntime(config);

    expect(runtime.getState().warnings[0]).toContain("Could not load run history");
  });

  it("serves session details and protects the active session from deletion", async () => {
    const directory = temporaryDirectory();
    const { app, runtime } = await createDevtoolsServer(testConfig(directory, "http://127.0.0.1:1/webhook"));
    cleanup.push(() => app.close());
    const activeId = runtime.getState().id;

    runtime.updateConfig({ targetUrl: "http://127.0.0.1:2/webhook" });
    const historicalId = activeId;
    runtime.reset();

    const detail = await app.inject({ method: "GET", url: `/api/history/${historicalId}` });
    const protectedDelete = await app.inject({ method: "DELETE", url: `/api/history/${runtime.getState().id}` });
    const deleted = await app.inject({ method: "DELETE", url: `/api/history/${historicalId}` });
    const missing = await app.inject({ method: "GET", url: `/api/history/${historicalId}` });

    expect(detail.statusCode).toBe(200);
    expect(protectedDelete.statusCode).toBe(409);
    expect(deleted.statusCode).toBe(204);
    expect(missing.statusCode).toBe(404);
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agentphone-history-"));
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
    response.end(JSON.stringify({ text: "Charger 12 is back online." }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test webhook did not bind to a TCP port");
  return `http://127.0.0.1:${address.port}/webhook`;
}
