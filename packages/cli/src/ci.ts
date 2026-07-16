import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildJsonReport,
  DevtoolsRuntime,
  type DevtoolsServerConfig,
  type InspectorSession
} from "@agentphone-devtools/server";

export interface CiRunOptions {
  minimumScore: number;
  reportPath?: string;
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
      ...(reportPath ? { reportPath } : {})
    }
  };
}
