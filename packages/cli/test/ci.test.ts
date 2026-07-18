import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DevtoolsServerConfig } from "@agentphone-devtools/server";
import { runScenarioInCi, runScenarioSuiteInCi } from "../src/ci.js";

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("headless scenario CI", () => {
  it("passes assertions and writes a secret-safe JSON report", async () => {
    const directory = temporaryDirectory();
    const scenarioPath = writeScenario(directory, true);
    const reportPath = join(directory, "reports", "run.json");
    const junitPath = join(directory, "reports", "run.xml");
    const targetUrl = await webhookTarget(200, { text: "Your charger is fixed. You are all set.", hangup: true });

    const result = await runScenarioInCi(config(directory, targetUrl), scenarioPath, { reportPath, junitPath });

    expect(result.summary).toMatchObject({
      passed: true,
      assertions: { failed: 0 }
    });
    const report = readFileSync(reportPath, "utf8");
    expect(JSON.parse(report)).toMatchObject({ schemaVersion: 1, ci: { passed: true } });
    expect(report).not.toContain("whsec_super_secret_value");
    const junit = readFileSync(junitPath, "utf8");
    expect(junit).toContain('<testsuite name="AgentPhone: scenario.json" tests="2" failures="0"');
    expect(junit).toContain('<testcase classname="agentphone.scenario" name="turn 1 delivery">');
  });

  it("fails when webhook delivery expectations are unmet", async () => {
    const directory = temporaryDirectory();
    const scenarioPath = writeScenario(directory, false);
    const targetUrl = await webhookTarget(500, { error: "nope" });

    const result = await runScenarioInCi(config(directory, targetUrl), scenarioPath, {});

    expect(result.passed).toBe(false);
    expect(result.summary.assertions.failed).toBeGreaterThan(0);
    expect(result.session.scenarioResult?.assertions).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "delivery", passed: false, observed: "HTTP 500" })])
    );
  });

  it("escapes assertion failures in JUnit reports", async () => {
    const directory = temporaryDirectory();
    const scenarioPath = writeScenario(directory, false);
    const junitPath = join(directory, "failure.xml");
    const targetUrl = await webhookTarget(500, { error: "bad <response> & retry" });

    await runScenarioInCi(config(directory, targetUrl), scenarioPath, { junitPath });

    const junit = readFileSync(junitPath, "utf8");
    expect(junit).toContain('failures="');
    expect(junit).toContain("<failure message=");
    expect(junit).toContain("Expected: successful webhook delivery");
    expect(junit).not.toContain("bad <response>");
  });

  it("runs every suite scenario and writes aggregate JSON and JUnit reports", async () => {
    const directory = temporaryDirectory();
    const passing = writeScenario(directory, false, "passing.json");
    const failing = writeScenario(directory, true, "failing.json");
    const reportPath = join(directory, "suite.json");
    const junitPath = join(directory, "suite.xml");
    const targetUrl = await webhookTarget(200, { text: "Your charger is fixed. You are all set." });

    const result = await runScenarioSuiteInCi(config(directory, targetUrl), [passing, failing], { reportPath, junitPath });

    expect(result.summary).toMatchObject({ passed: false, total: 2, passedCount: 1, failedCount: 1 });
    expect(result.runs.map((run) => run.summary.scenarioPath)).toEqual([passing, failing]);
    expect(new Set(result.runs.map((run) => run.session.id)).size).toBe(2);

    const report = readFileSync(reportPath, "utf8");
    expect(JSON.parse(report)).toMatchObject({
      schemaVersion: 1,
      suite: { passed: false, total: 2, passedCount: 1, failedCount: 1 },
      runs: [{ scenarioPath: passing, passed: true }, { scenarioPath: failing, passed: false }]
    });
    expect(report).not.toContain("whsec_super_secret_value");

    const junit = readFileSync(junitPath, "utf8");
    expect(junit).toContain('<testsuites name="AgentPhone scenario suite" tests="3" failures="1"');
    expect(junit).toContain('name="AgentPhone: passing.json"');
    expect(junit).toContain('name="AgentPhone: failing.json"');
  });

  it("fails an otherwise passing scenario when baseline behavior regresses", async () => {
    const directory = temporaryDirectory();
    const scenarioPath = writeScenario(directory, false);
    const targetUrl = await webhookTarget(200, { text: "Your charger is fixed. You are all set." });
    const initial = await runScenarioInCi(config(directory, targetUrl), scenarioPath, {});
    const baseline = structuredClone(initial.session);
    baseline.id = "baseline_session";
    baseline.deliveries[0].response.parsed.chunks = [{ action: "transfer" }];
    const junitPath = join(directory, "baseline.xml");

    const candidate = await runScenarioInCi(config(directory, targetUrl), scenarioPath, {
      baselines: [{ scenarioPath, session: baseline }],
      junitPath
    });

    expect(candidate.session.scenarioResult?.passed).toBe(true);
    expect(candidate.passed).toBe(false);
    expect(candidate.comparison).toMatchObject({ passed: false, actions: { regressed: true, missing: ["transfer"] } });
    expect(candidate.summary.baseline).toMatchObject({ found: true, passed: false, sessionId: "baseline_session" });
    expect(readFileSync(junitPath, "utf8")).toContain('name="baseline regression"');
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agentphone-ci-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeScenario(directory: string, expectHangup: boolean, filename = "scenario.json"): string {
  const path = join(directory, filename);
  writeFileSync(
    path,
    JSON.stringify({
      name: "CI charger check",
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
          caller: "Please check charger 12",
          ...(expectHangup ? { expect: { actions: ["hangup"] } } : {})
        }
      ]
    }),
    "utf8"
  );
  return path;
}

function config(directory: string, targetUrl: string): DevtoolsServerConfig {
  return {
    targetUrl,
    secret: "whsec_super_secret_value",
    channel: "sms",
    timeoutSeconds: 5,
    contextLimit: 10,
    port: 0,
    retryOnNon200: false,
    historyPath: join(directory, "history.json"),
    historyLimit: 10
  };
}

async function webhookTarget(status: number, body: Record<string, unknown>): Promise<string> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test webhook did not bind to a TCP port");
  return `http://127.0.0.1:${address.port}/webhook`;
}
