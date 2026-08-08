import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DevtoolsRuntime, type DevtoolsServerConfig } from "../src/index.js";

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("fork from checkpoint", () => {
  it("carries the exact conversation checkpoint into the forked run", async () => {
    const config = testConfig(temporaryDirectory(), await webhookTarget({ text: "ok", action: "ack" }));
    const runtime = new DevtoolsRuntime(config);

    runtime.reset({ channel: "sms", conversationState: { customerName: "Maya" } });
    await runtime.sendCallerTurn("My charger stopped.", "sms");
    await runtime.sendCallerTurn("It is charger EV-2204.", "sms");
    const sourceSessionId = runtime.getState().id;
    const sourceTranscript = runtime.getState().transcript;

    runtime.forkFromSession(sourceSessionId, 1);
    const forkDelivery = await runtime.sendCallerTurn("Actually, it is charger EV-9000.", "sms");
    const forked = runtime.getState();

    // (a) Only the shared prefix is inherited; the new turn is genuinely re-sent.
    const inherited = forked.deliveries.filter((delivery) => delivery.inheritedFrom);
    expect(inherited).toHaveLength(1);
    expect(inherited[0].inheritedFrom).toEqual({ sessionId: sourceSessionId });
    expect(forked.deliveries).toHaveLength(2);
    expect(forked.deliveries[1].inheritedFrom).toBeUndefined();

    // (b) The checkpoint the handler sees is turn 1 only — turn 2 never happened
    // on this branch.
    expect(forkDelivery.request.body.recentHistory).toHaveLength(2);
    expect(
      forkDelivery.request.body.recentHistory.map((entry) => ({ content: entry.content, direction: entry.direction }))
    ).toEqual([
      { content: "My charger stopped.", direction: "inbound" },
      { content: sourceTranscript[1].content, direction: "outbound" }
    ]);
    expect(
      forkDelivery.request.body.recentHistory.some((entry) => entry.content === "It is charger EV-2204.")
    ).toBe(false);

    // (c) Conversation state travels with the checkpoint.
    expect(forkDelivery.request.body.conversationState).toEqual({ customerName: "Maya" });

    // (d) + (e) Lineage and the replayed prefix transcript.
    expect(forked.forkedFrom).toEqual({ sessionId: sourceSessionId, turnIndex: 1 });
    expect(forked.transcript.map((turn) => turn.content)).toEqual([
      "My charger stopped.",
      sourceTranscript[1].content,
      "Actually, it is charger EV-9000.",
      sourceTranscript[1].content
    ]);
    expect(forked.transcript).toHaveLength(4);
  });

  it("forks from a saved session after the runtime moves on", async () => {
    const config = testConfig(temporaryDirectory(), await webhookTarget({ text: "ok", action: "ack" }));
    const runtime = new DevtoolsRuntime(config);

    runtime.reset({ channel: "sms", conversationState: { ticketId: "TCK-42", tier: "gold" } });
    await runtime.sendCallerTurn("My charger stopped.", "sms");
    await runtime.sendCallerTurn("It is charger EV-2204.", "sms");
    await runtime.endCall();
    const savedSessionId = runtime.getState().id;

    // The runtime moves on: live conversation state is cleared, and the source
    // run only survives in stored history.
    runtime.reset();
    expect(runtime.conversationSnapshot().conversationState).toBeNull();

    runtime.forkFromSession(savedSessionId, 2);
    const forkDelivery = await runtime.sendCallerTurn("Any update on that?", "sms");
    const forked = runtime.getState();

    expect(forkDelivery.request.body.conversationState).toEqual({ ticketId: "TCK-42", tier: "gold" });
    expect(forkDelivery.request.body.recentHistory).toHaveLength(4);
    expect(forked.forkedFrom).toEqual({ sessionId: savedSessionId, turnIndex: 2 });
    expect(forked.deliveries.filter((delivery) => delivery.inheritedFrom?.sessionId === savedSessionId)).toHaveLength(2);
  });

  it("rejects invalid fork points", async () => {
    const config = testConfig(temporaryDirectory(), await webhookTarget({ text: "ok", action: "ack" }));
    const runtime = new DevtoolsRuntime(config);

    await runtime.sendCallerTurn("My charger stopped.", "sms");
    const sessionId = runtime.getState().id;

    expect(() => runtime.forkFromSession(sessionId, 0)).toThrow();
    expect(() => runtime.forkFromSession(sessionId, 2)).toThrow();
    expect(() => runtime.forkFromSession("sess_missing", 1)).toThrow();
    // A rejected fork must not disturb the live run.
    expect(runtime.getState().id).toBe(sessionId);
  });

  it("persists lineage and labels across restarts", async () => {
    const config = testConfig(temporaryDirectory(), await webhookTarget({ text: "ok", action: "ack" }));
    const runtime = new DevtoolsRuntime(config);

    await runtime.sendCallerTurn("My charger stopped.", "sms");
    const sourceSessionId = runtime.getState().id;

    runtime.forkFromSession(sourceSessionId, 1);
    const forkedSessionId = runtime.getState().id;
    await runtime.sendCallerTurn("Try the other charger.", "sms");

    const labelled = runtime.setTurnLabel(forkedSessionId, {
      turnIndex: 0,
      verdict: "bad",
      note: "robotic greeting"
    });
    expect(labelled?.turnLabels).toEqual([{ turnIndex: 0, verdict: "bad", note: "robotic greeting" }]);

    // Re-labelling the same turn replaces the verdict rather than stacking.
    const relabelled = runtime.setTurnLabel(forkedSessionId, {
      turnIndex: 0,
      verdict: "good",
      note: "greeting reads fine now"
    });
    expect(relabelled?.turnLabels).toEqual([{ turnIndex: 0, verdict: "good", note: "greeting reads fine now" }]);
    expect(runtime.setTurnLabel("sess_missing", { turnIndex: 0, verdict: "good" })).toBeNull();

    const restarted = new DevtoolsRuntime(config);
    const stored = restarted.getHistorySession(forkedSessionId);

    expect(stored?.forkedFrom).toEqual({ sessionId: sourceSessionId, turnIndex: 1 });
    expect(stored?.turnLabels).toEqual([{ turnIndex: 0, verdict: "good", note: "greeting reads fine now" }]);
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agentphone-fork-"));
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

async function webhookTarget(responseBody: Record<string, unknown>): Promise<string> {
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
