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

export async function runScenarioInCi(
  config: DevtoolsServerConfig,
  scenarioPath: string,
  options: CiRunOptions
): Promise<CiRunResult> {
  const runtime = new DevtoolsRuntime(config);
  const session = await runtime.runScenario(scenarioPath);
  const scorePassed = Boolean(session.evalResult && session.evalResult.score >= options.minimumScore);
  const passed = session.scenarioResult?.passed === true && scorePassed;
  const reportPath = options.reportPath ? resolve(options.reportPath) : undefined;
  const junitPath = options.junitPath ? resolve(options.junitPath) : undefined;

  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(
      reportPath,
      `${JSON.stringify(
        {
          ...buildJsonReport(session),
          ci: { passed, scorePassed, minimumScore: options.minimumScore }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  }

  if (junitPath) {
    await mkdir(dirname(junitPath), { recursive: true });
    await writeFile(junitPath, buildJunitReport(session, scenarioPath, options.minimumScore, scorePassed), "utf8");
  }

  return {
    passed,
    scorePassed,
    session,
    summary: {
      passed,
      sessionId: session.id,
      outcome: session.evalResult?.outcome,
      score: session.evalResult?.score,
      minimumScore: options.minimumScore,
      assertions: {
        passed: session.scenarioResult?.passedCount ?? 0,
        failed: session.scenarioResult?.failedCount ?? 0
      },
      ...(reportPath ? { reportPath } : {}),
      ...(junitPath ? { junitPath } : {})
    }
  };
}

export function buildJunitReport(
  session: InspectorSession,
  scenarioPath: string,
  minimumScore: number,
  scorePassed = Boolean(session.evalResult && session.evalResult.score >= minimumScore)
): string {
  const assertions = session.scenarioResult?.assertions ?? [];
  const failures = assertions.filter((assertion) => !assertion.passed).length + (scorePassed ? 0 : 1);
  const durationSeconds = session.deliveries.reduce((total, delivery) => total + delivery.latencyMs, 0) / 1000;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="${xmlEscape(`AgentPhone: ${basename(scenarioPath)}`)}" tests="${assertions.length + 1}" failures="${failures}" time="${durationSeconds.toFixed(3)}">`,
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
  return `${lines.join("\n")}\n`;
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
