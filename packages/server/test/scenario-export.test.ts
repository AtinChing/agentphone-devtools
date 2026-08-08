import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseScenario } from "@agentphone-devtools/core";
import { DevtoolsRuntime, type DevtoolsServerConfig } from "../src/index.js";
import { buildScenarioFromSession, stringifyScenarioYaml } from "../src/scenario-export.js";

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("scenario export scaffolding", () => {
  it("scaffolds expected actions from observed behavior", async () => {
    const config = testConfig(temporaryDirectory(), await webhookTarget({ text: "ok", action: "ack" }));
    const runtime = new DevtoolsRuntime(config);

    await runtime.sendCallerTurn("My charger stopped.", "sms");
    await runtime.sendCallerTurn("It is charger EV-2204.", "sms");
    const sessionId = runtime.getState().id;

    const scaffolded = runtime.getScenarioExport(sessionId, { scaffoldAssertions: true });
    const plain = runtime.getScenarioExport(sessionId);

    // Observed behavior becomes the regression contract.
    expect(scaffolded?.turns).toEqual([
      { caller: "My charger stopped.", expect: { actions: ["ack"] } },
      { caller: "It is charger EV-2204.", expect: { actions: ["ack"] } }
    ]);
    // Without opting in, the export stays a plain replay script.
    expect(plain?.turns).toEqual([{ caller: "My charger stopped." }, { caller: "It is charger EV-2204." }]);
    expect(plain?.turns.every((turn) => !("expect" in turn))).toBe(true);

    // The scaffolded YAML must survive the scenario schema untouched.
    const roundTripped = parseScenario(stringifyScenarioYaml(scaffolded!));
    expect(roundTripped).toMatchObject({
      channel: "sms",
      contextLimit: 10,
      timeoutSeconds: 5,
      turns: [
        { caller: "My charger stopped.", expect: { actions: ["ack"] } },
        { caller: "It is charger EV-2204.", expect: { actions: ["ack"] } }
      ]
    });
  });

  it("no-action turns get no scaffold", async () => {
    const config = testConfig(temporaryDirectory(), await webhookTarget({ text: "ok" }));
    const runtime = new DevtoolsRuntime(config);

    await runtime.sendCallerTurn("My charger stopped.", "sms");
    await runtime.sendCallerTurn("It is charger EV-2204.", "sms");
    const sessionId = runtime.getState().id;

    const scaffolded = runtime.getScenarioExport(sessionId, { scaffoldAssertions: true });

    expect(scaffolded?.turns).toEqual([{ caller: "My charger stopped." }, { caller: "It is charger EV-2204." }]);
    expect(scaffolded?.turns.every((turn) => !("expect" in turn))).toBe(true);
    // A scaffold-free export is still schema-valid.
    expect(parseScenario(stringifyScenarioYaml(scaffolded!)).turns).toHaveLength(2);
  });

  it("forked exports include the inherited prefix and record lineage", async () => {
    const config = testConfig(temporaryDirectory(), await webhookTarget({ text: "ok", action: "ack" }));
    const runtime = new DevtoolsRuntime(config);

    await runtime.sendCallerTurn("My charger stopped.", "sms");
    const sourceSessionId = runtime.getState().id;

    runtime.forkFromSession(sourceSessionId, 1);
    await runtime.sendCallerTurn("Actually, it is charger EV-9000.", "sms");
    const forkedSessionId = runtime.getState().id;

    const scenario = runtime.getScenarioExport(forkedSessionId, { scaffoldAssertions: true });

    expect(scenario?.turns).toHaveLength(2);
    // The inherited prefix turn keeps the action observed on the source run,
    // even though this session never re-sent it.
    expect(scenario?.turns[0]).toEqual({ caller: "My charger stopped.", expect: { actions: ["ack"] } });
    expect(scenario?.turns[1]).toEqual({ caller: "Actually, it is charger EV-9000.", expect: { actions: ["ack"] } });
    expect(scenario?.description).toContain(`Forked from run ${sourceSessionId} after turn 1`);

    // The same lineage note is produced when building straight from a session.
    const direct = buildScenarioFromSession(
      runtime.getHistorySession(forkedSessionId)!,
      { contextLimit: 10, timeoutSeconds: 5, conversationState: null },
      { scaffoldAssertions: true }
    );
    expect(direct.description).toContain(`Forked from run ${sourceSessionId} after turn 1`);
    expect(parseScenario(stringifyScenarioYaml(direct)).turns).toEqual(scenario?.turns);
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agentphone-scenario-export-"));
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
