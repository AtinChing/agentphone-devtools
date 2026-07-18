import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseScenario, verifyWebhook } from "@agentphone-devtools/core";
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

  it("retains only the configured number of sessions", async () => {
    const directory = temporaryDirectory();
    const config = { ...testConfig(directory, await webhookTarget()), historyLimit: 2 };
    const runtime = new DevtoolsRuntime(config);

    for (let index = 0; index < 3; index += 1) {
      await runtime.sendCallerTurn(`Run ${index + 1}`, "sms");
      await runtime.endCall();
      if (index < 2) runtime.reset();
    }

    expect(JSON.parse(readFileSync(config.historyPath, "utf8")).sessions).toHaveLength(2);
  });

  it("does not retain untouched sessions when resetting", () => {
    const directory = temporaryDirectory();
    const config = testConfig(directory, "http://127.0.0.1:1/webhook");
    const runtime = new DevtoolsRuntime(config);

    runtime.reset();
    runtime.reset();

    const stored = JSON.parse(readFileSync(config.historyPath, "utf8")) as { sessions: Array<{ id: string }> };
    expect(stored.sessions.map((session) => session.id)).toEqual([runtime.getState().id]);
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
    const { app, runtime } = await createDevtoolsServer(testConfig(directory, await webhookTarget()));
    cleanup.push(() => app.close());
    const activeId = runtime.getState().id;

    await runtime.sendCallerTurn("Save this run", "sms");
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

  it("exports saved sessions as JSON and Markdown reports", async () => {
    const directory = temporaryDirectory();
    const target = await webhookTarget();
    const { app, runtime } = await createDevtoolsServer(testConfig(directory, target));
    cleanup.push(() => app.close());

    await runtime.sendCallerTurn("Can you check charger 12?", "sms");
    await runtime.endCall();
    const sessionId = runtime.getState().id;

    const json = await app.inject({ method: "GET", url: `/api/history/${sessionId}/report.json` });
    const markdown = await app.inject({ method: "GET", url: `/api/history/${sessionId}/report.md` });
    const missing = await app.inject({ method: "GET", url: "/api/history/missing/report.md" });

    expect(json.statusCode).toBe(200);
    expect(json.headers["content-disposition"]).toBe(`attachment; filename="agentphone-run-${sessionId}.json"`);
    const jsonReport = json.json();
    expect(jsonReport).toMatchObject({
      schemaVersion: 1,
      session: {
        id: sessionId,
        secretPreview: "whsec_...alue"
      }
    });
    expect(jsonReport.session.transcript.map((turn: { content: string }) => turn.content)).toEqual(["Can you check charger 12?", "Charger 12 is back online."]);
    expect(json.body).not.toContain("whsec_super_secret_value");

    expect(markdown.statusCode).toBe(200);
    expect(markdown.headers["content-disposition"]).toBe(`attachment; filename="agentphone-run-${sessionId}.md"`);
    expect(markdown.body).toContain(`# AgentPhone Run Report: ${sessionId}`);
    expect(markdown.body).toContain("## Transcript");
    expect(markdown.body).toContain("Charger 12 is back online.");
    expect(markdown.body).not.toContain("whsec_super_secret_value");
    expect(missing.statusCode).toBe(404);
  });

  it("exports replayable scenarios from recorded caller turns", async () => {
    const directory = temporaryDirectory();
    const target = await webhookTarget();
    const { app, runtime } = await createDevtoolsServer({ ...testConfig(directory, target), channel: "voice" });
    cleanup.push(() => app.close());

    await runtime.sendCallerTurn("My charger stopped.", "voice");
    await runtime.sendCallerTurn("It is charger EV-2204.", "voice");
    await runtime.endCall();
    const sessionId = runtime.getState().id;

    const json = await app.inject({ method: "GET", url: `/api/history/${sessionId}/scenario.json` });
    const yaml = await app.inject({ method: "GET", url: `/api/history/${sessionId}/scenario.yaml` });
    const empty = await app.inject({ method: "GET", url: `/api/history/${runtime.reset().id}/scenario.yaml` });

    expect(json.statusCode).toBe(200);
    expect(json.headers["content-disposition"]).toBe(`attachment; filename="agentphone-scenario-${sessionId}.json"`);
    expect(json.body).not.toContain("whsec_super_secret_value");
    expect(parseScenario(json.body, "recorded.json")).toMatchObject({
      name: `Recorded run ${sessionId}`,
      channel: "voice",
      turns: [{ caller: "My charger stopped." }, { caller: "It is charger EV-2204." }]
    });

    expect(yaml.statusCode).toBe(200);
    expect(yaml.headers["content-disposition"]).toBe(`attachment; filename="agentphone-scenario-${sessionId}.yaml"`);
    expect(parseScenario(yaml.body, "recorded.yaml")).toMatchObject({
      channel: "voice",
      contextLimit: 10,
      timeoutSeconds: 5,
      turns: [{ caller: "My charger stopped." }, { caller: "It is charger EV-2204." }]
    });
    expect(empty.statusCode).toBe(422);
  });

  it("records per-turn scenario assertions and expected actions", async () => {
    const directory = temporaryDirectory();
    const target = await webhookTarget({ action: "transfer" });
    const runtime = new DevtoolsRuntime({ ...testConfig(directory, target), channel: "voice" });

    const session = await runtime.runScenario({
      name: "Transfer to support",
      channel: "voice",
      agentId: "agt_local",
      numberId: "num_local",
      from: "+15559876543",
      to: "+15551234567",
      conversationState: null,
      contextLimit: 10,
      timeoutSeconds: 5,
      turns: [{ caller: "Get me a specialist", expect: { actions: ["transfer"] } }]
    });

    expect(session.scenarioResult).toMatchObject({ passed: true, failedCount: 0 });
    expect(session.scenarioResult?.assertions.map((assertion) => assertion.kind)).toEqual(["delivery", "action", "delivery"]);
  });

  it("passes expected security rejections from injected request faults", async () => {
    const directory = temporaryDirectory();
    const target = await verifyingWebhookTarget("whsec_super_secret_value");
    const runtime = new DevtoolsRuntime(testConfig(directory, target));

    const session = await runtime.runScenario({
      name: "Reject unsigned webhook",
      channel: "sms",
      agentId: "agt_local",
      numberId: "num_local",
      from: "+15559876543",
      to: "+15551234567",
      conversationState: null,
      contextLimit: 10,
      timeoutSeconds: 5,
      turns: [
        {
          caller: "Unsigned request",
          fault: { omitSignature: true },
          expect: { status: 401 }
        }
      ]
    });

    expect(session.scenarioResult).toMatchObject({ passed: true, failedCount: 0 });
    expect(session.deliveries[0]).toMatchObject({ faults: ["missing_signature"], response: { status: 401 } });
  });

  it("simulates timeouts through the configured retry policy", async () => {
    const directory = temporaryDirectory();
    const runtime = new DevtoolsRuntime({
      ...testConfig(directory, "http://127.0.0.1:1/webhook"),
      retryOnNon200: true
    });

    const session = await runtime.runScenario({
      name: "Timeout retries",
      channel: "sms",
      agentId: "agt_local",
      numberId: "num_local",
      from: "+15559876543",
      to: "+15551234567",
      conversationState: null,
      contextLimit: 10,
      timeoutSeconds: 5,
      turns: [
        {
          caller: "Timeout please",
          fault: { simulateTimeout: true },
          expect: { timedOut: true, retries: 5 }
        }
      ]
    });

    expect(session.scenarioResult).toMatchObject({ passed: true, failedCount: 0 });
    expect(session.deliveries[0]).toMatchObject({ timedOut: true, retries: 5, faults: ["simulated_timeout"] });
  });

  it("edits, re-signs, and traces historical delivery replays", async () => {
    const directory = temporaryDirectory();
    const captured = await capturingWebhookTarget("whsec_super_secret_value");
    const { app, runtime } = await createDevtoolsServer(testConfig(directory, captured.url));
    cleanup.push(() => app.close());

    const original = await runtime.sendCallerTurn("Original caller text", "sms");
    const sourceSessionId = runtime.getState().id;
    runtime.reset();
    const editedBody = structuredClone(original.request.body);
    if (editedBody.event !== "agent.message" || editedBody.channel === "voice") throw new Error("Expected message fixture");
    editedBody.data.message = "Edited replay text";

    const replay = await app.inject({
      method: "POST",
      url: "/api/replay",
      payload: {
        sessionId: sourceSessionId,
        deliveryId: original.id,
        body: editedBody
      }
    });
    const preserved = await app.inject({
      method: "POST",
      url: "/api/replay",
      payload: {
        sessionId: sourceSessionId,
        deliveryId: original.id,
        preserveWebhookId: true,
        preserveTimestamp: true
      }
    });
    const missing = await app.inject({
      method: "POST",
      url: "/api/replay",
      payload: { sessionId: "missing", deliveryId: "missing" }
    });

    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      replayOf: { sessionId: sourceSessionId, deliveryId: original.id },
      request: { body: { data: { message: "Edited replay text" } } }
    });
    expect(replay.json().webhookId).not.toBe(original.webhookId);
    expect(preserved.json()).toMatchObject({
      webhookId: original.webhookId,
      request: { headers: { "X-Webhook-Timestamp": original.request.headers["X-Webhook-Timestamp"] } }
    });
    expect(missing.statusCode).toBe(404);
    expect(captured.requests).toHaveLength(3);
    expect(captured.requests.every((request) => request.validSignature)).toBe(true);
    expect(JSON.parse(captured.requests[1].body).data.message).toBe("Edited replay text");
  });

  it("persists named baselines and serves run comparisons", async () => {
    const directory = temporaryDirectory();
    const target = await webhookTarget();
    const config = testConfig(directory, target);
    const { app, runtime } = await createDevtoolsServer(config);
    cleanup.push(() => app.close());

    await runtime.sendCallerTurn("Check charger 12", "sms");
    await runtime.endCall();
    const sessionId = runtime.getState().id;

    const marked = await app.inject({
      method: "POST",
      url: `/api/history/${sessionId}/baseline`,
      payload: { name: "Approved charger behavior" }
    });
    const comparison = await app.inject({
      method: "GET",
      url: `/api/compare/${sessionId}/${sessionId}?requireTranscriptMatch=true`
    });
    const restarted = new DevtoolsRuntime(config);

    expect(marked.statusCode).toBe(200);
    expect(marked.json()).toMatchObject({ baseline: { name: "Approved charger behavior" } });
    expect(comparison.statusCode).toBe(200);
    expect(comparison.json()).toMatchObject({ passed: true, regressions: [], transcript: { changed: false } });
    expect(restarted.getHistory().find((session) => session.id === sessionId)).toMatchObject({
      baselineName: "Approved charger behavior"
    });

    const cleared = await app.inject({ method: "DELETE", url: `/api/history/${sessionId}/baseline` });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().baseline).toBeUndefined();
  });

  it("validates runtime configuration without exposing the signing secret", async () => {
    const directory = temporaryDirectory();
    const { app, runtime } = await createDevtoolsServer(testConfig(directory, "http://127.0.0.1:3000/webhook"));
    cleanup.push(() => app.close());

    const invalid = await app.inject({
      method: "POST",
      url: "/api/config",
      payload: { targetUrl: "file:///tmp/webhook", timeoutSeconds: 2, historyPath: "/tmp/not-allowed" }
    });
    const updated = await app.inject({
      method: "POST",
      url: "/api/config",
      payload: {
        targetUrl: "http://localhost:4000/agentphone",
        secret: "whsec_replaced_secret",
        channel: "voice",
        timeoutSeconds: 45,
        contextLimit: 25,
        retryOnNon200: true
      }
    });
    const safeConfig = await app.inject({ method: "GET", url: "/api/config" });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: "Invalid runtime configuration" });
    expect(invalid.json().issues).toHaveLength(3);
    expect(runtime.getConfig().targetUrl).toBe("http://localhost:4000/agentphone");
    expect(updated.json()).toMatchObject({
      targetUrl: "http://localhost:4000/agentphone",
      channel: "voice",
      secretPreview: "whsec_...cret"
    });
    expect(safeConfig.json()).toMatchObject({
      targetUrl: "http://localhost:4000/agentphone",
      timeoutSeconds: 45,
      contextLimit: 25,
      retryOnNon200: true,
      secretPreview: "whsec_...cret"
    });
    expect(safeConfig.body).not.toContain("whsec_replaced_secret");
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

async function webhookTarget(responseBody: Record<string, unknown> = { text: "Charger 12 is back online." }): Promise<string> {
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

async function verifyingWebhookTarget(secret: string): Promise<string> {
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const valid = verifyWebhook(
        body,
        String(request.headers["x-webhook-signature"] ?? ""),
        String(request.headers["x-webhook-timestamp"] ?? ""),
        secret
      );
      response.writeHead(valid ? 200 : 401, { "Content-Type": "application/json" });
      response.end(JSON.stringify(valid ? { text: "accepted" } : { error: "invalid signature" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test webhook did not bind to a TCP port");
  return `http://127.0.0.1:${address.port}/webhook`;
}

async function capturingWebhookTarget(secret: string): Promise<{
  url: string;
  requests: Array<{ body: string; validSignature: boolean }>;
}> {
  const requests: Array<{ body: string; validSignature: boolean }> = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        body,
        validSignature: verifyWebhook(
          body,
          String(request.headers["x-webhook-signature"] ?? ""),
          String(request.headers["x-webhook-timestamp"] ?? ""),
          secret
        )
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ text: "Replay accepted" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test webhook did not bind to a TCP port");
  return { url: `http://127.0.0.1:${address.port}/webhook`, requests };
}
