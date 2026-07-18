import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  buildJsonReport,
  DevtoolsRuntime,
  type DevtoolsServerConfig,
  type InspectorSession,
  compareRuns,
  type RunComparison,
  type RunComparisonOptions
} from "@agentphone-devtools/server";
import { findBaselineForScenario, type CiBaselineEntry } from "./baseline.js";

export interface CiRunOptions {
  reportPath?: string;
  junitPath?: string;
  baselines?: CiBaselineEntry[];
  comparisonOptions?: RunComparisonOptions;
}

export interface CiRunResult {
  passed: boolean;
  session: InspectorSession;
  comparison?: RunComparison;
  baselineMissing?: boolean;
  summary: {
    scenarioPath: string;
    passed: boolean;
    sessionId: string;
    assertions: {
      passed: number;
      failed: number;
    };
    reportPath?: string;
    junitPath?: string;
    baseline?: {
      found: boolean;
      passed: boolean;
      sessionId?: string;
      regressions: string[];
    };
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
  const result = evaluateCiRun(session, scenarioPath, options);
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
          ci: {
            passed: result.passed,
            baselineMissing: result.baselineMissing ?? false
          },
          ...(result.comparison ? { comparison: result.comparison } : {})
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  }

  if (junitPath) {
    await mkdir(dirname(junitPath), { recursive: true });
    await writeFile(junitPath, buildJunitReport(session, scenarioPath, result), "utf8");
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
    runs.push(evaluateCiRun(session, scenarioPath, options));
  }

  const passedCount = runs.filter((run) => run.passed).length;
  const passed = passedCount === runs.length;
  const reportPath = options.reportPath ? resolve(options.reportPath) : undefined;
  const junitPath = options.junitPath ? resolve(options.junitPath) : undefined;

  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, buildJsonSuiteReport(runs), "utf8");
  }

  if (junitPath) {
    await mkdir(dirname(junitPath), { recursive: true });
    await writeFile(junitPath, buildJunitSuiteReport(runs), "utf8");
  }

  return {
    passed,
    runs,
    summary: {
      passed,
      total: runs.length,
      passedCount,
      failedCount: runs.length - passedCount,
      scenarios: runs.map((run) => run.summary),
      ...(reportPath ? { reportPath } : {}),
      ...(junitPath ? { junitPath } : {})
    }
  };
}

export function buildJsonSuiteReport(
  runs: CiRunResult[],
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
        failedCount: runs.length - passedCount
      },
      runs: runs.map((run) => ({
        scenarioPath: run.summary.scenarioPath,
        passed: run.passed,
        baselineMissing: run.baselineMissing ?? false,
        ...(run.comparison ? { comparison: run.comparison } : {}),
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
  result?: Pick<CiRunResult, "comparison" | "baselineMissing">
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${junitTestSuite(session, scenarioPath, {
    comparison: result?.comparison,
    baselineMissing: result?.baselineMissing
  }).join("\n")}\n`;
}

export function buildJunitSuiteReport(runs: CiRunResult[]): string {
  const stats = runs.map((run) => junitStats(run.session, run));
  const tests = stats.reduce((total, item) => total + item.tests, 0);
  const failures = stats.reduce((total, item) => total + item.failures, 0);
  const durationSeconds = stats.reduce((total, item) => total + item.durationSeconds, 0);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="AgentPhone scenario suite" tests="${tests}" failures="${failures}" time="${durationSeconds.toFixed(3)}">`
  ];
  for (const run of runs) {
    lines.push(...junitTestSuite(run.session, run.summary.scenarioPath, run).map((line) => `  ${line}`));
  }
  lines.push("</testsuites>");
  return `${lines.join("\n")}\n`;
}

function evaluateCiRun(session: InspectorSession, scenarioPath: string, options: CiRunOptions): CiRunResult {
  const baselineRequested = Boolean(options.baselines);
  const baseline = options.baselines ? findBaselineForScenario(options.baselines, scenarioPath) : undefined;
  const comparison = baseline ? compareRuns(baseline, session, options.comparisonOptions) : undefined;
  const baselineMissing = baselineRequested && !baseline;
  const baselinePassed = !baselineRequested || Boolean(comparison?.passed);
  const passed = session.scenarioResult?.passed === true && baselinePassed;
  return {
    passed,
    session,
    ...(comparison ? { comparison } : {}),
    ...(baselineMissing ? { baselineMissing: true } : {}),
    summary: {
      scenarioPath,
      passed,
      sessionId: session.id,
      assertions: {
        passed: session.scenarioResult?.passedCount ?? 0,
        failed: session.scenarioResult?.failedCount ?? 0
      },
      ...(baselineRequested
        ? {
            baseline: {
              found: Boolean(baseline),
              passed: Boolean(comparison?.passed),
              sessionId: baseline?.id,
              regressions: baselineMissing ? ["No matching baseline was found"] : comparison?.regressions ?? []
            }
          }
        : {})
    }
  };
}

function junitTestSuite(
  session: InspectorSession,
  scenarioPath: string,
  result: Pick<CiRunResult, "comparison" | "baselineMissing">
): string[] {
  const assertions = session.scenarioResult?.assertions ?? [];
  const stats = junitStats(session, result);
  const lines = [
    `<testsuite name="${xmlEscape(`AgentPhone: ${basename(scenarioPath)}`)}" tests="${stats.tests}" failures="${stats.failures}" time="${stats.durationSeconds.toFixed(3)}">`,
    "  <properties>",
    `    <property name="sessionId" value="${xmlEscape(session.id)}"/>`,
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

  if (result.comparison || result.baselineMissing) {
    lines.push('  <testcase classname="agentphone.scenario" name="baseline regression">');
    if (result.baselineMissing) {
      lines.push('    <failure message="No matching baseline was found">Baseline artifact did not contain this scenario</failure>');
    } else if (result.comparison && !result.comparison.passed) {
      lines.push(
        `    <failure message="${xmlEscape(`${result.comparison.regressions.length} baseline regression(s)`)}">${xmlEscape(result.comparison.regressions.join("\n"))}</failure>`
      );
    }
    lines.push("  </testcase>");
  }
  lines.push("</testsuite>");
  return lines;
}

function junitStats(
  session: InspectorSession,
  result: Pick<CiRunResult, "comparison" | "baselineMissing">
) {
  const assertions = session.scenarioResult?.assertions ?? [];
  const hasBaselineTest = Boolean(result.comparison || result.baselineMissing);
  const baselineFailed = Boolean(result.baselineMissing || (result.comparison && !result.comparison.passed));
  return {
    tests: assertions.length + (hasBaselineTest ? 1 : 0),
    failures: assertions.filter((assertion) => !assertion.passed).length + (baselineFailed ? 1 : 0),
    durationSeconds: session.deliveries.reduce((total, delivery) => total + delivery.latencyMs, 0) / 1000
  };
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
