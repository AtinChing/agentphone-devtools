import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareRuns, DevtoolsRuntime, type DevtoolsServerConfig, type InspectorSession } from "../src/index.js";
import { buildMarkdownReport } from "../src/report.js";
import type { Scenario } from "@agentphone-devtools/core";

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("informational logs are separate from diagnostic warnings", () => {
  it("records the scenario breadcrumb as a log, not a warning", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget()));

    const session = await runtime.runScenario(scenario());

    expect(session.logs).toContain("Running scenario: Log separation scenario");
    expect(session.warnings).toEqual([]);
  });

  it("does not manufacture a regression when a scenario run is compared to a manual baseline", async () => {
    const config = testConfig(temporaryDirectory(), await webhookTarget());
    const runtime = new DevtoolsRuntime(config);

    // Baseline recorded by hand in the Inspector, so it never carries a
    // "Running scenario: ..." breadcrumb.
    await runtime.sendCallerTurn("Is charger 12 online?", "sms");
    const baseline = runtime.getState();
    runtime.reset();
    const candidate = await runtime.runScenario(scenario());

    const comparison = compareRuns(baseline, candidate);

    // Before the fix, "Running scenario: ..." lived in `warnings`, so merely
    // replaying a scenario reported a phantom "new warning(s) appeared".
    expect(comparison.warnings.added).toEqual([]);
    expect(comparison.regressions).toEqual([]);
    expect(comparison.passed).toBe(true);
  });

  it("does not double-count a failed assertion as a warning regression", async () => {
    const config = testConfig(temporaryDirectory(), await webhookTarget());
    const runtime = new DevtoolsRuntime(config);

    const baseline = await runtime.runScenario(scenario());
    runtime.reset();
    // The target never returns a `hangup` action, so this expectation fails.
    const candidate = await runtime.runScenario(scenario({ expectHangup: true }));

    expect(candidate.scenarioResult?.failedCount).toBe(1);
    expect(candidate.logs).toContain("Turn 1 did not return expected action hangup");
    expect(candidate.warnings).toEqual([]);

    const comparison = compareRuns(baseline, candidate);
    expect(comparison.warnings.added).toEqual([]);
    expect(comparison.regressions).toEqual([]);
  });

  it("still treats a genuine handler warning as a regression", async () => {
    const config = testConfig(temporaryDirectory(), await webhookTarget());
    const runtime = new DevtoolsRuntime(config);
    const baseline = await runtime.runScenario(scenario());

    const candidate: InspectorSession = {
      ...baseline,
      id: "sess_candidate",
      warnings: ["Voice response was not a JSON object; caller hears silence"]
    };

    const comparison = compareRuns(baseline, candidate);

    expect(comparison.warnings.added).toEqual(["Voice response was not a JSON object; caller hears silence"]);
    expect(comparison.passed).toBe(false);
  });

  it("keeps logs visible in the markdown report", async () => {
    const runtime = new DevtoolsRuntime(testConfig(temporaryDirectory(), await webhookTarget()));

    const report = buildMarkdownReport(await runtime.runScenario(scenario()));

    expect(report).toContain("## Run Log");
    expect(report).toContain("Running scenario: Log separation scenario");
  });
});

function scenario(options: { expectHangup?: boolean } = {}): Scenario {
  return {
    name: "Log separation scenario",
    description: "Exercises the scenario runner against a local target.",
    channel: "sms",
    agentId: "agt_local",
    numberId: "num_local",
    from: "+15559876543",
    to: "+15551234567",
    conversationState: null,
    contextLimit: 10,
    timeoutSeconds: 5,
    turns: [{ caller: "Is charger 12 online?", ...(options.expectHangup ? { expect: { actions: ["hangup"] } } : {}) }]
  };
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agentphone-logs-"));
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

describe("retry warnings are baseline-stable", () => {
  it("emits identical retry warnings across runs so baselines do not false-positive", async () => {
    const failing: Server = createServer((_request, response) => {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "boom" }));
    });
    await new Promise<void>((resolve) => failing.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => new Promise<void>((resolve, reject) => failing.close((error) => (error ? reject(error) : resolve()))));
    const address = failing.address();
    if (!address || typeof address === "string") throw new Error("failing target did not bind");
    const config = {
      ...testConfig(temporaryDirectory(), `http://127.0.0.1:${address.port}/webhook`),
      retryOnNon200: true
    };
    const runtime = new DevtoolsRuntime(config);

    await runtime.sendCallerTurn("first run turn", "sms");
    const first = runtime.getState();
    runtime.reset();
    await runtime.sendCallerTurn("first run turn", "sms");
    const second = runtime.getState();

    expect(first.warnings.some((warning) => /^Retry 1 scheduled after HTTP 500$/.test(warning))).toBe(true);
    // Volatile ids in warning text used to make every retry run a phantom regression.
    const comparison = compareRuns(first, second);
    expect(comparison.warnings.added).toEqual([]);
  }, 30000);
});
