import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  buildJsonReport,
  DevtoolsRuntime,
  type DevtoolsServerConfig,
  type InspectorSession
} from "@agentphone-devtools/server";

export interface CiRunOptions {
  minimumScore: number;
  reportPath?: string;
  junitPath?: string;
}

export interface CiRunResult {
  passed: boolean;
  scorePassed: boolean;
  session: InspectorSession;
  summary: {
    scenarioPath: string;
    passed: boolean;
    sessionId: string;
    outcome?: string;
    score?: number;
    minimumScore: number;
    assertions: {
      passed: number;
      failed: number;
    };
    reportPath?: string;
    junitPath?: string;
  };
}

export interface CiSuiteResult {
  passed: boolean;
  runs: CiRunResult[];
  summary: {
    passed: boolean;
    total: number;
    passedCount: number;
    failedCount: number;
    minimumScore: number;
    scenarios: CiRunResult["summary"][];
    reportPath?: string;
    junitPath?: string;
  };
}

export async function runScenarioInCi(
  config: DevtoolsServerConfig,
  scenarioPath: string,
  options: CiRunOptions
): Promise<CiRunResult> {
  const runtime = new DevtoolsRuntime(config);
  const session = await runtime.runScenario(scenarioPath);
  const result = evaluateCiRun(session, scenarioPath, options.minimumScore);
  const reportPath = options.reportPath ? resolve(options.reportPath) : undefined;
  const junitPath = options.junitPath ? resolve(options.junitPath) : undefined;

  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(
      reportPath,
      `${JSON.stringify(
        {
          ...buildJsonReport(session),
          scenarioPath,
          ci: { passed: result.passed, scorePassed: result.scorePassed, minimumScore: options.minimumScore }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  }

  if (junitPath) {
    await mkdir(dirname(junitPath), { recursive: true });
    await writeFile(junitPath, buildJunitReport(session, scenarioPath, options.minimumScore, result.scorePassed), "utf8");
  }

  return {
    ...result,
    summary: {
      ...result.summary,
      ...(reportPath ? { reportPath } : {}),
      ...(junitPath ? { junitPath } : {})
    }
  };
}

export async function runScenarioSuiteInCi(
  config: DevtoolsServerConfig,
  scenarioPaths: string[],
  options: CiRunOptions
): Promise<CiSuiteResult> {
  if (scenarioPaths.length === 0) throw new Error("A scenario suite must contain at least one scenario");

  const runtime = new DevtoolsRuntime(config);
  const runs: CiRunResult[] = [];
  for (const scenarioPath of scenarioPaths) {
    const session = await runtime.runScenario(scenarioPath);
    runs.push(evaluateCiRun(session, scenarioPath, options.minimumScore));
  }

  const passedCount = runs.filter((run) => run.passed).length;
  const passed = passedCount === runs.length;
  const reportPath = options.reportPath ? resolve(options.reportPath) : undefined;
  const junitPath = options.junitPath ? resolve(options.junitPath) : undefined;

  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, buildJsonSuiteReport(runs, options.minimumScore), "utf8");
  }

  if (junitPath) {
    await mkdir(dirname(junitPath), { recursive: true });
    await writeFile(junitPath, buildJunitSuiteReport(runs, options.minimumScore), "utf8");
  }

  return {
    passed,
    runs,
    summary: {
      passed,
      total: runs.length,
      passedCount,
      failedCount: runs.length - passedCount,
      minimumScore: options.minimumScore,
      scenarios: runs.map((run) => run.summary),
      ...(reportPath ? { reportPath } : {}),
      ...(junitPath ? { junitPath } : {})
    }
  };
}

export function buildJsonSuiteReport(
  runs: CiRunResult[],
  minimumScore: number,
  generatedAt = new Date().toISOString()
): string {
  const passedCount = runs.filter((run) => run.passed).length;
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt,
      suite: {
        passed: passedCount === runs.length,
        total: runs.length,
        passedCount,
        failedCount: runs.length - passedCount,
        minimumScore
      },
      runs: runs.map((run) => ({
        scenarioPath: run.summary.scenarioPath,
        passed: run.passed,
        scorePassed: run.scorePassed,
        session: run.session
      }))
    },
    null,
    2
  )}\n`;
}

export function buildJunitReport(
  session: InspectorSession,
  scenarioPath: string,
  minimumScore: number,
  scorePassed = Boolean(session.evalResult && session.evalResult.score >= minimumScore)
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${junitTestSuite(session, scenarioPath, minimumScore, scorePassed).join("\n")}\n`;
}

export function buildJunitSuiteReport(runs: CiRunResult[], minimumScore: number): string {
  const stats = runs.map((run) => junitStats(run.session, run.scorePassed));
  const tests = stats.reduce((total, item) => total + item.tests, 0);
  const failures = stats.reduce((total, item) => total + item.failures, 0);
  const durationSeconds = stats.reduce((total, item) => total + item.durationSeconds, 0);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="AgentPhone scenario suite" tests="${tests}" failures="${failures}" time="${durationSeconds.toFixed(3)}">`
  ];
  for (const run of runs) {
    lines.push(...junitTestSuite(run.session, run.summary.scenarioPath, minimumScore, run.scorePassed).map((line) => `  ${line}`));
  }
  lines.push("</testsuites>");
  return `${lines.join("\n")}\n`;
}

function evaluateCiRun(session: InspectorSession, scenarioPath: string, minimumScore: number): CiRunResult {
  const scorePassed = Boolean(session.evalResult && session.evalResult.score >= minimumScore);
  const passed = session.scenarioResult?.passed === true && scorePassed;
  return {
    passed,
    scorePassed,
    session,
    summary: {
      scenarioPath,
      passed,
      sessionId: session.id,
      outcome: session.evalResult?.outcome,
      score: session.evalResult?.score,
      minimumScore,
      assertions: {
        passed: session.scenarioResult?.passedCount ?? 0,
        failed: session.scenarioResult?.failedCount ?? 0
      }
    }
  };
}

function junitTestSuite(
  session: InspectorSession,
  scenarioPath: string,
  minimumScore: number,
  scorePassed: boolean
): string[] {
  const assertions = session.scenarioResult?.assertions ?? [];
  const stats = junitStats(session, scorePassed);
  const lines = [
    `<testsuite name="${xmlEscape(`AgentPhone: ${basename(scenarioPath)}`)}" tests="${stats.tests}" failures="${stats.failures}" time="${stats.durationSeconds.toFixed(3)}">`,
    "  <properties>",
    `    <property name="sessionId" value="${xmlEscape(session.id)}"/>`,
    `    <property name="outcome" value="${xmlEscape(session.evalResult?.outcome ?? "unknown")}"/>`,
    `    <property name="score" value="${session.evalResult?.score ?? 0}"/>`,
    `    <property name="minimumScore" value="${minimumScore}"/>`,
    "  </properties>"
  ];

  for (const assertion of assertions) {
    const location = assertion.turnIndex === undefined ? "final" : `turn ${assertion.turnIndex + 1}`;
    lines.push(`  <testcase classname="agentphone.scenario" name="${xmlEscape(`${location} ${assertion.kind}`)}">`);
    if (!assertion.passed) {
      lines.push(
        `    <failure message="${xmlEscape(assertion.message)}">${xmlEscape(`Expected: ${assertion.expected}\nObserved: ${assertion.observed}`)}</failure>`
      );
    }
    lines.push("  </testcase>");
  }

  const observedScore = session.evalResult?.score ?? 0;
  lines.push('  <testcase classname="agentphone.scenario" name="minimum eval score">');
  if (!scorePassed) {
    lines.push(
      `    <failure message="${xmlEscape(`Eval score ${observedScore} is below minimum ${minimumScore}`)}">${xmlEscape(`Expected score >= ${minimumScore}\nObserved score: ${observedScore}`)}</failure>`
    );
  }
  lines.push("  </testcase>", "</testsuite>");
  return lines;
}

function junitStats(session: InspectorSession, scorePassed: boolean) {
  const assertions = session.scenarioResult?.assertions ?? [];
  return {
    tests: assertions.length + 1,
    failures: assertions.filter((assertion) => !assertion.passed).length + (scorePassed ? 0 : 1),
    durationSeconds: session.deliveries.reduce((total, delivery) => total + delivery.latencyMs, 0) / 1000
  };
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
