import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Scenario } from "@agentphone-devtools/core";
import {
  createDevtoolsServer,
  DevtoolsRuntime,
  type DevtoolsServerConfig,
  type InspectorDelivery
} from "../src/index.js";
import { StepController } from "../src/step-controller.js";

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("step controller", () => {
  it("steps a scenario turn by turn with expectation results", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget()));
    const step = new StepController(runtime);

    const started = step.startFromScenario(
      scenario({
        turns: [
          { caller: "My charger stopped.", expect: { actions: ["ack"] } },
          { caller: "The station is EV-2204.", expect: { actions: ["missing_action"] } }
        ]
      })
    );

    expect(started.active).toBe(true);
    expect(started.queue).toHaveLength(2);
    expect(started.completedTurns).toBe(0);

    const first = await step.sendNext();
    expect(first.state.lastResult?.turnNumber).toBe(1);
    expect(first.state.lastResult?.expectResults).toEqual([{ action: "ack", passed: true, observed: ["ack"] }]);
    expect(first.state.queue).toHaveLength(1);
    expect(first.state.completedTurns).toBe(1);

    const second = await step.sendNext();
    expect(second.state.lastResult?.turnNumber).toBe(2);
    expect(second.state.lastResult?.expectResults).toEqual([
      { action: "missing_action", passed: false, observed: ["ack"] }
    ]);
    expect(second.state.queue).toEqual([]);

    // Two caller turns plus two agent replies are the checkpoint the next
    // webhook payload would carry.
    expect(second.state.checkpoint?.recentHistoryTurns).toBe(4);
  });

  it("editNext and addTurn shape the queue", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget()));
    const step = new StepController(runtime);

    const inactive = new StepController(runtime);
    expect(() => inactive.addTurn("extra")).toThrow();

    step.startFromScenario(scenario({ turns: [{ caller: "scripted line" }, { caller: "second line" }] }));

    const edited = step.editNext("changed");
    expect(edited.queue[0]).toEqual({ caller: "changed", edited: true });

    const { delivery } = await step.sendNext();
    expect(callerTextOf(delivery)).toBe("changed");

    const appended = step.addTurn("extra");
    expect(appended.queue.map((turn) => turn.caller)).toEqual(["second line", "extra"]);

    expect(() => step.editNext("")).toThrow();
    expect(() => step.addTurn("   ")).toThrow();
  });

  it("fork mid-step replaces the queue and continues on the branch", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget()));
    const step = new StepController(runtime);

    step.startFromScenario(
      scenario({ turns: [{ caller: "turn one" }, { caller: "turn two" }, { caller: "turn three" }] })
    );
    await step.sendNext();
    await step.sendNext();
    const beforeFork = step.state();
    expect(beforeFork.queue).toHaveLength(1);

    const forked = step.fork(1, { caller: "branch text" });

    expect(forked.queue).toEqual([{ caller: "branch text" }]);
    expect(forked.completedTurns).toBe(1);
    expect(forked.sessionId).not.toBe(beforeFork.sessionId);
    expect(runtime.getState().forkedFrom).toEqual({ sessionId: beforeFork.sessionId, turnIndex: 1 });

    const { delivery, state } = await step.sendNext();
    // Only the shared prefix (turn one + its reply) reaches the handler.
    expect(delivery.request.body.recentHistory).toHaveLength(2);
    expect(state.queue).toEqual([]);
  });

  it("startFromSession scaffolds the queue from a saved run", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget()));

    await runtime.sendCallerTurn("My charger stopped.", "sms");
    await runtime.sendCallerTurn("The station is EV-2204.", "sms");
    await runtime.endCall();
    const savedSessionId = runtime.getState().id;

    const step = new StepController(runtime);
    const state = step.startFromSession(savedSessionId);

    expect(state.queue).toEqual([
      { caller: "My charger stopped.", expect: { actions: ["ack"] } },
      { caller: "The station is EV-2204.", expect: { actions: ["ack"] } }
    ]);
    // The replay runs on a fresh session, so the saved run stays intact.
    expect(state.sessionId).not.toBe(savedSessionId);
    expect(runtime.getHistorySession(savedSessionId)?.transcript).toHaveLength(4);
  });

  it("notify fires on mutations", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget()));
    let notifications = 0;
    const step = new StepController(runtime, () => {
      notifications += 1;
    });

    step.startFromScenario(scenario({ turns: [{ caller: "turn one" }, { caller: "turn two" }] }));
    const afterStart = notifications;
    expect(afterStart).toBeGreaterThan(0);

    await step.sendNext();
    const afterSend = notifications;
    expect(afterSend).toBeGreaterThan(afterStart);

    step.editNext("changed");
    const afterEdit = notifications;
    expect(afterEdit).toBeGreaterThan(afterSend);

    await step.end();
    expect(notifications).toBeGreaterThan(afterEdit);
  });

  it("sendNext with empty queue throws; end() deactivates", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget()));
    const step = new StepController(runtime);

    step.startFromScenario(scenario({ turns: [{ caller: "only turn" }] }));
    await step.sendNext();

    await expect(step.sendNext()).rejects.toThrow();

    const ended = await step.end();
    expect(ended.active).toBe(false);
    expect(ended.queue).toEqual([]);
    expect(step.state().active).toBe(false);
    await expect(step.sendNext()).rejects.toThrow();
  });
});

describe("step API routes", () => {
  it("start/send/edit/add/fork/end round-trip over HTTP", async () => {
    const { app } = await stepServer();
    const scenarioPath = scenarioFile([{ caller: "turn one" }, { caller: "turn two" }, { caller: "turn three" }]);

    const started = await app.inject({ method: "POST", url: "/api/step/start", payload: { scenarioPath } });
    expect(started.statusCode).toBe(200);
    expect(started.json().active).toBe(true);
    expect(started.json().queue).toHaveLength(3);

    const sent = await app.inject({ method: "POST", url: "/api/step/send", payload: {} });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().completedTurns).toBe(1);

    const edited = await app.inject({ method: "POST", url: "/api/step/edit", payload: { caller: "x" } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().queue[0].caller).toBe("x");

    const added = await app.inject({ method: "POST", url: "/api/step/add", payload: { caller: "y" } });
    expect(added.statusCode).toBe(200);
    expect(added.json().queue).toHaveLength(3);
    expect(added.json().queue.at(-1).caller).toBe("y");

    const forked = await app.inject({
      method: "POST",
      url: "/api/step/fork",
      payload: { turnIndex: 1, caller: "z" }
    });
    expect(forked.statusCode).toBe(200);
    expect(forked.json().queue).toEqual([{ caller: "z" }]);

    const ended = await app.inject({ method: "POST", url: "/api/step/end", payload: {} });
    expect(ended.statusCode).toBe(200);
    expect(ended.json().active).toBe(false);

    const state = await app.inject({ method: "GET", url: "/api/step" });
    expect(state.statusCode).toBe(200);
    expect(state.json().active).toBe(false);
  });

  it("invalid requests get 4xx", async () => {
    const { app } = await stepServer();

    const noSource = await app.inject({ method: "POST", url: "/api/step/start", payload: {} });
    expect(noSource.statusCode).toBe(400);

    const notStarted = await app.inject({ method: "POST", url: "/api/step/send", payload: {} });
    expect(notStarted.statusCode).toBe(409);

    const started = await app.inject({
      method: "POST",
      url: "/api/step/start",
      payload: { scenarioPath: scenarioFile([{ caller: "turn one" }, { caller: "turn two" }]) }
    });
    expect(started.statusCode).toBe(200);

    const emptyEdit = await app.inject({ method: "POST", url: "/api/step/edit", payload: { caller: "" } });
    expect(emptyEdit.statusCode).toBe(400);

    const badFork = await app.inject({ method: "POST", url: "/api/step/fork", payload: { turnIndex: 99 } });
    expect(badFork.statusCode).toBe(400);
  });

  it("labels endpoint validates and persists", async () => {
    const { app } = await stepServer();
    await app.inject({
      method: "POST",
      url: "/api/step/start",
      payload: { scenarioPath: scenarioFile([{ caller: "turn one" }]) }
    });
    const sent = await app.inject({ method: "POST", url: "/api/step/send", payload: {} });
    const sessionId = sent.json().sessionId as string;

    const labelled = await app.inject({
      method: "POST",
      url: `/api/history/${sessionId}/labels`,
      payload: { turnIndex: 0, verdict: "good", note: "n" }
    });
    expect(labelled.statusCode).toBe(200);
    expect(labelled.json().turnLabels).toContainEqual({ turnIndex: 0, verdict: "good", note: "n" });

    const outOfRange = await app.inject({
      method: "POST",
      url: `/api/history/${sessionId}/labels`,
      payload: { turnIndex: 42, verdict: "good" }
    });
    expect(outOfRange.statusCode).toBe(400);

    const unknown = await app.inject({
      method: "POST",
      url: "/api/history/sess_missing/labels",
      payload: { turnIndex: 0, verdict: "good" }
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("scenario export honors assertions query", async () => {
    const { app } = await stepServer();
    await app.inject({
      method: "POST",
      url: "/api/step/start",
      payload: { scenarioPath: scenarioFile([{ caller: "turn one" }]) }
    });
    const sent = await app.inject({ method: "POST", url: "/api/step/send", payload: {} });
    const sessionId = sent.json().sessionId as string;

    const scaffolded = await app.inject({
      method: "GET",
      url: `/api/history/${sessionId}/scenario.yaml?assertions=1`
    });
    expect(scaffolded.statusCode).toBe(200);
    expect(scaffolded.body).toContain("actions");
    expect(scaffolded.body).toContain('"ack"');

    const plain = await app.inject({ method: "GET", url: `/api/history/${sessionId}/scenario.yaml` });
    expect(plain.statusCode).toBe(200);
    expect(plain.body).not.toContain("expect");
  });
});

/** The caller text the handler actually received (`message` on SMS, `transcript` on voice). */
function callerTextOf(delivery: InspectorDelivery): string | undefined {
  const data = delivery.request.body.data as { message?: string; transcript?: string };
  return data.message ?? data.transcript;
}

async function stepServer() {
  const created = await createDevtoolsServer(testConfig(temporaryDirectory(), await webhookTarget()));
  cleanup.push(() => created.app.close());
  return created;
}

function scenario(options: { turns: Scenario["turns"] }): Scenario {
  return {
    name: "Step debugger scenario",
    description: "Drives the step controller against a local target.",
    channel: "sms",
    agentId: "agt_local",
    numberId: "num_local",
    from: "+15559876543",
    to: "+15551234567",
    conversationState: null,
    contextLimit: 10,
    timeoutSeconds: 5,
    turns: options.turns
  };
}

/** Write a scenario YAML the /api/step/start route can load by absolute path. */
function scenarioFile(turns: Scenario["turns"]): string {
  const directory = temporaryDirectory();
  const path = join(directory, "scenario.yaml");
  const lines = [
    "name: Step debugger scenario",
    "channel: sms",
    "agentId: agt_local",
    "numberId: num_local",
    'from: "+15559876543"',
    'to: "+15551234567"',
    "conversationState: null",
    "contextLimit: 10",
    "timeoutSeconds: 5",
    "turns:",
    ...turns.map((turn) => `  - caller: ${JSON.stringify(turn.caller)}`)
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agentphone-step-"));
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
