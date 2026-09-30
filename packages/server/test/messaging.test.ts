import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseScenario, verifyWebhook, type Scenario } from "@agentphone-devtools/core";
import { createDevtoolsServer, DevtoolsRuntime, type DevtoolsServerConfig, type InspectorDelivery } from "../src/index.js";
import { StepController } from "../src/step-controller.js";
import { stringifyScenarioYaml } from "../src/scenario-export.js";

const cleanup: Array<() => void | Promise<void>> = [];
const DAY = 86_400_000;

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("simulated clock", () => {
  it("moves payload timestamps and history times, never the signature header", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget()));
    const before = Date.now();

    await runtime.sendCallerTurn("Hi", "imessage");
    runtime.advanceClock(2 * DAY);
    const delivery = await runtime.sendCallerTurn("YES", "imessage");

    const body = delivery.request.body as { timestamp: string; recentHistory: Array<{ at: string }> };
    const payloadAt = Date.parse(body.timestamp);
    // Payload timestamps are whole seconds, so allow the truncation.
    expect(payloadAt).toBeGreaterThanOrEqual(before - 1_000 + 2 * DAY);
    // The earlier turns keep their original (earlier) times in history.
    expect(Date.parse(body.recentHistory[0].at)).toBeLessThan(before + DAY);
    // The signature is minted in real time so the handler's replay window still accepts it.
    const signedAt = Number(delivery.request.headers["X-Webhook-Timestamp"]);
    expect(Math.abs(signedAt * 1000 - Date.now())).toBeLessThan(60_000);
    expect(
      verifyWebhook(
        delivery.request.rawBody,
        delivery.request.headers["X-Webhook-Signature"],
        delivery.request.headers["X-Webhook-Timestamp"],
        "whsec_super_secret_value"
      )
    ).toBe(true);
    expect(runtime.getState().clockOffsetMs).toBe(2 * DAY);
  });

  it("setClock pins an absolute time and reset clears the offset", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget()));
    runtime.setClock("2026-09-14T16:00:00.000Z");
    expect(runtime.now().slice(0, 16)).toBe("2026-09-14T16:00");
    expect(() => runtime.setClock("yesterday")).toThrow(/Invalid clock time/);
    expect(() => runtime.advanceClock(-1)).toThrow(/forward/);
    runtime.reset();
    expect(runtime.clockOffset()).toBe(0);
  });
});

describe("scenario caller identity", () => {
  it("binds a scenario's from number to a known contact, else reports it as the caller", async () => {
    const captured = await capturingTarget();
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), captured.url));
    runtime.setContactResolver((number) =>
      number === "+15559876544" ? { id: "ct_j", name: "Jordan Reyes", number, channel: "sms", conversationState: null, createdAt: "" } as never : undefined
    );

    await runtime.runScenario(scenario({ from: "+15559876544", turns: [{ caller: "hi" }] }));
    expect(runtime.getState().contact).toEqual({ id: "ct_j", name: "Jordan Reyes", number: "+15559876544" });
    expect((captured.bodies.at(-1) as { data: { from: string } }).data.from).toBe("+15559876544");

    await runtime.runScenario(scenario({ from: "+15550009999", turns: [{ caller: "hi" }] }));
    expect(runtime.getState().contact).toBeUndefined();
    expect((captured.bodies.at(-1) as { data: { from: string } }).data.from).toBe("+15550009999");

    const step = new StepController(runtime);
    step.startFromScenario(scenario({ from: "+15559876544", turns: [{ caller: "hi" }] }));
    expect(step.state().contact?.name).toBe("Jordan Reyes");
  });

  it("resolves the contact of older runs from their payloads at read time", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget()));
    await runtime.runScenario(scenario({ from: "+15559876544", turns: [{ caller: "hi" }] }));
    const sessionId = runtime.getState().id;
    expect(runtime.getState().contact).toBeUndefined();

    // A contact added later (or a history file from before contacts existed) still lines up.
    runtime.setContactResolver((number) =>
      number === "+15559876544" ? { id: "ct_j", name: "Jordan Reyes", number, channel: "sms", conversationState: null, createdAt: "" } as never : undefined
    );
    expect(runtime.getHistorySession(sessionId)?.contact).toEqual({ id: "ct_j", name: "Jordan Reyes", number: "+15559876544" });
    expect(runtime.getHistory().find((run) => run.id === sessionId)?.contact?.name).toBe("Jordan Reyes");
  });
});

describe("whatsapp channel", () => {
  it("delivers agent.message events on whatsapp like sms", async () => {
    const captured = await capturingTarget();
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), captured.url));
    const delivery = await runtime.sendCallerTurn("Hola", "whatsapp");
    expect(delivery.ok).toBe(true);
    expect(delivery.channel).toBe("whatsapp");
    expect((captured.bodies.at(-1) as { channel: string; data: { message: string } })).toMatchObject({ channel: "whatsapp", data: { message: "Hola" } });
    expect(runtime.getState().channel).toBe("whatsapp");
  });
});

describe("outbound seeds (campaign sends outside the webhook)", () => {
  it("seeds the opener into history so the reply reaches the handler with context", async () => {
    const captured = await capturingTarget();
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), captured.url));

    runtime.seedAgentMessage("Fall tune-up special. Reply YES to claim.", "imessage");
    const state = runtime.getState();
    expect(state.transcript).toEqual([{ role: "agent", content: "Fall tune-up special. Reply YES to claim." }]);
    expect(state.outboundSeeds).toEqual([0]);
    expect(state.deliveries).toHaveLength(0);
    expect(state.status).toBe("running");

    await runtime.sendCallerTurn("YES", "imessage");
    const body = captured.bodies.at(-1) as { recentHistory: Array<{ direction: string; content: string }> };
    expect(body.recentHistory).toEqual([
      { direction: "outbound", content: "Fall tune-up special. Reply YES to claim.", channel: "imessage", at: expect.any(String) }
    ]);
    expect(() => runtime.seedAgentMessage("   ")).toThrow(/must not be empty/);
  });

  it("runScenario applies startAt, per-turn after, and agent turns", async () => {
    const captured = await capturingTarget();
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), captured.url));

    const session = await runtime.runScenario(
      scenario({
        channel: "sms",
        startAt: "2026-09-14T16:00:00.000Z",
        turns: [{ agent: "Opener" }, { caller: "YES", after: "10d", expect: { actions: ["ack"] } }]
      })
    );

    const body = captured.bodies.at(-1) as { timestamp: string; recentHistory: Array<{ at: string; content: string }> };
    expect(body.recentHistory.map((item) => item.content)).toEqual(["Opener"]);
    expect(body.recentHistory[0].at.slice(0, 16)).toBe("2026-09-14T16:00");
    expect(body.timestamp.slice(0, 10)).toBe("2026-09-24");
    expect(session.scenarioResult?.passed).toBe(true);
    expect(session.outboundSeeds).toEqual([0]);
    expect(session.turnTimes).toHaveLength(3);
  });

  it("forks from turn 0 when the run opens with a seed, carrying the seed and the clock", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget()));
    runtime.setClock("2026-09-14T16:00:00.000Z");
    runtime.seedAgentMessage("Opener", "imessage");
    runtime.advanceClock(2 * 3_600_000);
    await runtime.sendCallerTurn("YES", "imessage");
    const sourceId = runtime.getState().id;

    const forked = runtime.forkFromSession(sourceId, 0);
    expect(forked.forkedFrom).toEqual({ sessionId: sourceId, turnIndex: 0 });
    expect(forked.transcript).toEqual([{ role: "agent", content: "Opener" }]);
    expect(forked.outboundSeeds).toEqual([0]);
    expect(forked.deliveries).toHaveLength(0);
    expect(runtime.now().slice(0, 13)).toBe("2026-09-14T18");

    // A run without seeds still cannot fork before its first caller turn.
    runtime.reset();
    await runtime.sendCallerTurn("Plain", "sms");
    expect(() => runtime.forkFromSession(runtime.getState().id, 0)).toThrow(/between 1 and 1/);
  });
});

describe("scenario export with simulated time", () => {
  it("emits agent turns, startAt, and after gaps that round-trip through the schema", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget()));
    runtime.reset({ contact: { id: "ct_1", name: "Jordan Reyes", number: "+15559876544" }, channel: "imessage" });
    runtime.setClock("2026-09-14T16:00:00.000Z");
    runtime.seedAgentMessage("Opener", "imessage");
    runtime.advanceClock(2 * 3_600_000);
    await runtime.sendCallerTurn("YES", "imessage");
    await runtime.sendCallerTurn("Thanks", "imessage");

    const exported = runtime.getScenarioExport(runtime.getState().id, { scaffoldAssertions: true });
    expect(exported?.startAt?.slice(0, 16)).toBe("2026-09-14T16:00");
    expect(exported?.from).toBe("+15559876544");
    expect(exported?.channel).toBe("imessage");
    expect(exported?.turns).toEqual([
      { agent: "Opener" },
      { caller: "YES", after: "2h", expect: { actions: ["ack"] } },
      { caller: "Thanks", expect: { actions: ["ack"] } }
    ]);

    const yaml = stringifyScenarioYaml(exported!);
    expect(yaml).toContain('- agent: "Opener"');
    expect(yaml).toContain('after: "2h"');
    const parsed = parseScenario(yaml);
    expect(parsed.turns).toEqual(exported!.turns);
  });
});

describe("step controller messaging additions", () => {
  it("drop, warp, and agent turns shape the queue and clock", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget()));
    const step = new StepController(runtime);
    step.startFromScenario(scenario({ turns: [{ caller: "one" }, { caller: "two" }] }));

    expect(step.dropNext().queue.map((turn) => turn.caller)).toEqual(["two"]);
    const warped = step.warp("3d");
    expect(warped.clockOffsetMs).toBe(3 * DAY);

    step.addAgentTurn("Follow-up offer", "1d");
    expect(step.state().queue.at(-1)).toEqual({ agent: "Follow-up offer", after: "1d" });
    expect(() => step.addAgentTurn("  ")).toThrow();
    expect(() => step.warp("later")).toThrow(/Invalid duration/);

    await step.sendNext(); // "two"
    const seeded = await step.sendNext(); // agent follow-up, no delivery
    expect(seeded.delivery).toBeUndefined();
    expect(seeded.state.clockOffsetMs).toBe(4 * DAY);
    expect(runtime.getState().transcript.at(-1)).toEqual({ role: "agent", content: "Follow-up offer" });
    expect(runtime.getState().outboundSeeds).toEqual([2]);
    expect(() => step.dropNext()).toThrow(/Nothing queued/);
  });

  it("startBlank opens an empty conversation with a contact", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget()));
    const step = new StepController(runtime);
    const state = step.startBlank("imessage", { id: "ct_1", name: "Maya Chen", number: "+15559876543" }, { tier: "gold" });
    expect(state).toMatchObject({ active: true, channel: "imessage", scenarioName: "Conversation with Maya Chen", queue: [] });
    expect(state.contact?.number).toBe("+15559876543");
    expect(state.checkpoint?.conversationState).toEqual({ tier: "gold" });
    step.addTurn("Hi there");
    const { delivery } = await step.sendNext();
    expect((delivery!.request.body as { data: { from: string } }).data.from).toBe("+15559876543");
  });

  it("evaluates forbidden actions and reply patterns per step", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget({ text: "Your code is FALL20", action: "issue_promo_code" })));
    const step = new StepController(runtime);
    step.startFromScenario(
      scenario({ turns: [{ caller: "YES", expect: { forbiddenActions: ["opt_out", "issue_promo_code"], replyMatches: "fall20" } }] })
    );
    const { state } = await step.sendNext();
    expect(state.lastResult?.expectResults).toEqual([
      { action: "no opt_out", passed: true, observed: ["issue_promo_code"] },
      { action: "no issue_promo_code", passed: false, observed: ["issue_promo_code"] },
      { action: "reply~/fall20/i", passed: true, observed: ["Your code is FALL20"] }
    ]);
  });
});

describe("messaging HTTP routes", () => {
  it("clock, seed, step drop/warp/agent, and conversations/start", async () => {
    const { app, runtime } = await server();

    const clock = await app.inject({ method: "GET", url: "/api/clock" });
    expect(clock.json()).toMatchObject({ offsetMs: 0 });

    const advanced = await app.inject({ method: "POST", url: "/api/clock/advance", payload: { duration: "2d" } });
    expect(advanced.json().offsetMs).toBe(2 * DAY);
    const badAdvance = await app.inject({ method: "POST", url: "/api/clock/advance", payload: { duration: "whenever" } });
    expect(badAdvance.statusCode).toBe(400);
    const pinned = await app.inject({ method: "POST", url: "/api/clock/set", payload: { at: "2026-09-14T16:00:00Z" } });
    expect(pinned.json().now.slice(0, 16)).toBe("2026-09-14T16:00");

    const contacts = (await app.inject({ method: "GET", url: "/api/contacts" })).json() as Array<{ id: string; name: string }>;
    const jordan = contacts.find((contact) => contact.name === "Jordan Reyes")!;
    const started = await app.inject({ method: "POST", url: "/api/conversations/start", payload: { contactId: jordan.id } });
    expect(started.json()).toMatchObject({ channel: "sms", contact: { name: "Jordan Reyes", number: "+15559876544" } });
    expect(started.json().clockOffsetMs).toBe(0);
    const missingContact = await app.inject({ method: "POST", url: "/api/conversations/start", payload: { contactId: "ct_nope" } });
    expect(missingContact.statusCode).toBe(404);

    const seeded = await app.inject({ method: "POST", url: "/api/seed-agent-message", payload: { text: "Opener" } });
    expect(seeded.json().outboundSeeds).toEqual([0]);
    const emptySeed = await app.inject({ method: "POST", url: "/api/seed-agent-message", payload: {} });
    expect(emptySeed.statusCode).toBe(400);

    // Step mode on a contact, with the messaging controls.
    const step = await app.inject({ method: "POST", url: "/api/step/start", payload: { contactId: jordan.id, channel: "imessage" } });
    expect(step.json()).toMatchObject({ active: true, channel: "imessage", contact: { name: "Jordan Reyes" } });
    const agentTurn = await app.inject({ method: "POST", url: "/api/step/agent", payload: { text: "Opener", after: "0s" } });
    expect(agentTurn.json().queue).toEqual([{ agent: "Opener", after: "0s" }]);
    await app.inject({ method: "POST", url: "/api/step/add", payload: { caller: "YES" } });
    const dropped = await app.inject({ method: "POST", url: "/api/step/drop", payload: {} });
    expect(dropped.json().queue).toEqual([{ caller: "YES" }]);
    const warped = await app.inject({ method: "POST", url: "/api/step/warp", payload: { duration: "1h" } });
    expect(warped.json().clockOffsetMs).toBe(3_600_000);
    const badWarp = await app.inject({ method: "POST", url: "/api/step/warp", payload: { duration: "" } });
    expect(badWarp.statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/api/step/end", payload: {} });
    const emptyDrop = await app.inject({ method: "POST", url: "/api/step/drop", payload: {} });
    expect(emptyDrop.statusCode).toBe(409);
    expect(runtime.getState().status).toBe("ended");
  });

  it("step/start on a scenario file with startAt pins the clock", async () => {
    const { app, runtime } = await server();
    const path = scenarioFile(`
name: Campaign
channel: imessage
startAt: "2026-09-14T16:00:00Z"
agentId: agt_local
numberId: num_local
from: "+15559876544"
to: "+15551234567"
conversationState: null
contextLimit: 10
timeoutSeconds: 5
turns:
  - agent: Opener
  - caller: YES
    after: 2h
`);
    const started = await app.inject({ method: "POST", url: "/api/step/start", payload: { scenarioPath: path } });
    expect(started.json().virtualNow.slice(0, 16)).toBe("2026-09-14T16:00");
    expect(started.json().queue).toEqual([{ agent: "Opener" }, { caller: "YES", after: "2h" }]);
    const first = await app.inject({ method: "POST", url: "/api/step/send", payload: {} });
    // The opener is seeded, not delivered: history grows, no turn completes.
    expect(first.json()).toMatchObject({ completedTurns: 0, checkpoint: { recentHistoryTurns: 1 } });
    const second = await app.inject({ method: "POST", url: "/api/step/send", payload: {} });
    expect(second.json().virtualNow.slice(0, 16)).toBe("2026-09-14T18:00");
    expect(second.json()).toMatchObject({ completedTurns: 1, queue: [] });
    const body = runtime.getState().deliveries[0].request.body as { recentHistory: unknown[]; timestamp: string };
    expect(body.recentHistory).toHaveLength(1);
    expect(body.timestamp.slice(0, 16)).toBe("2026-09-14T18:00");
  });
});

async function server() {
  const created = await createDevtoolsServer(testConfig(temporaryDirectory(), await webhookTarget()));
  cleanup.push(() => created.app.close());
  return created;
}

function scenario(options: Partial<Scenario> & { turns: Scenario["turns"] }): Scenario {
  return {
    name: "Messaging scenario",
    channel: "imessage",
    agentId: "agt_local",
    numberId: "num_local",
    from: "+15559876544",
    to: "+15551234567",
    conversationState: null,
    contextLimit: 10,
    timeoutSeconds: 5,
    ...options
  };
}

function scenarioFile(yaml: string): string {
  const path = join(temporaryDirectory(), "scenario.yaml");
  writeFileSync(path, yaml, "utf8");
  return path;
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agentphone-messaging-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function testConfig(directory: string, targetUrl: string): DevtoolsServerConfig {
  return {
    targetUrl,
    secret: "whsec_super_secret_value",
    channel: "imessage",
    timeoutSeconds: 5,
    contextLimit: 10,
    port: 0,
    retryOnNon200: false,
    historyPath: join(directory, "history.json"),
    historyLimit: 100
  };
}

async function webhookTarget(responseBody: Record<string, unknown> = { text: "ok", action: "ack" }): Promise<string> {
  return (await capturingTarget(responseBody)).url;
}

async function capturingTarget(responseBody: Record<string, unknown> = { text: "ok", action: "ack" }) {
  const bodies: unknown[] = [];
  const server: Server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      if (raw) bodies.push(JSON.parse(raw));
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(responseBody));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test webhook did not bind to a TCP port");
  return { url: `http://127.0.0.1:${address.port}/webhook`, bodies };
}

export type { InspectorDelivery };
