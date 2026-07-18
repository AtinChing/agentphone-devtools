import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { InspectorSession } from "@agentphone-devtools/server";

export interface CiBaselineEntry {
  scenarioPath?: string;
  session: InspectorSession;
}

export async function loadBaselineArtifact(path: string): Promise<CiBaselineEntry[]> {
  const resolved = resolve(path);
  const parsed = JSON.parse(await readFile(resolved, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error(`Baseline report is not a JSON object: ${path}`);
  const report = parsed as Record<string, unknown>;

  if (isInspectorSession(report.session)) {
    return [{ scenarioPath: typeof report.scenarioPath === "string" ? report.scenarioPath : undefined, session: report.session }];
  }

  if (Array.isArray(report.runs)) {
    const entries = report.runs.flatMap((run) => {
      if (!run || typeof run !== "object") return [];
      const item = run as Record<string, unknown>;
      if (!isInspectorSession(item.session)) return [];
      return [{ scenarioPath: typeof item.scenarioPath === "string" ? item.scenarioPath : undefined, session: item.session }];
    });
    if (entries.length) return entries;
  }

  throw new Error(`Baseline report contains no valid run sessions: ${path}`);
}

export function findBaselineForScenario(entries: CiBaselineEntry[], scenarioPath: string): InspectorSession | undefined {
  const exact = entries.find((entry) => entry.scenarioPath && resolve(entry.scenarioPath) === resolve(scenarioPath));
  if (exact) return exact.session;
  const filename = basename(scenarioPath);
  const matchingNames = entries.filter((entry) => entry.scenarioPath && basename(entry.scenarioPath) === filename);
  if (matchingNames.length === 1) return matchingNames[0].session;
  if (entries.length === 1) return entries[0].session;
  return undefined;
}

function isInspectorSession(value: unknown): value is InspectorSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<InspectorSession>;
  return (
    typeof session.id === "string" &&
    typeof session.targetUrl === "string" &&
    Array.isArray(session.transcript) &&
    Array.isArray(session.deliveries) &&
    Array.isArray(session.warnings)
  );
}
