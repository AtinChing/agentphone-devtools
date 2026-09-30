import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { isCallerTurn, loadScenarioFile, type SessionChannel } from "@agentphone-devtools/core";

export interface ScenarioListing {
  /** Path relative to the process working directory (what the CLI accepts). */
  path: string;
  group: string;
  name: string;
  description?: string;
  channel: SessionChannel;
  turns: number;
  callerTurns: number;
  hasAssertions: boolean;
  error?: string;
}

const SCENARIO_EXTENSIONS = new Set([".yaml", ".yml", ".json"]);

/**
 * Discover scenario files under the given directories (recursively) so the
 * Inspector can offer a picker instead of a typed path.
 */
export async function listScenarios(directories: string[], cwd = process.cwd()): Promise<ScenarioListing[]> {
  const listings: ScenarioListing[] = [];
  for (const directory of directories) {
    const absolute = resolve(cwd, directory);
    for (const file of walk(absolute)) {
      const path = relative(cwd, file);
      try {
        const scenario = await loadScenarioFile(file);
        listings.push({
          path,
          group: groupName(directory),
          name: scenario.name,
          ...(scenario.description ? { description: scenario.description } : {}),
          channel: scenario.channel,
          turns: scenario.turns.length,
          callerTurns: scenario.turns.filter(isCallerTurn).length,
          hasAssertions: scenario.turns.some((turn) => isCallerTurn(turn) && turn.expect !== undefined)
        });
      } catch (error) {
        listings.push({
          path,
          group: groupName(directory),
          name: path,
          channel: "voice",
          turns: 0,
          callerTurns: 0,
          hasAssertions: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  return listings.sort((a, b) => a.path.localeCompare(b.path));
}

function walk(directory: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries.sort()) {
    const full = join(directory, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) files.push(...walk(full));
    else if ([...SCENARIO_EXTENSIONS].some((extension) => entry.endsWith(extension))) files.push(full);
  }
  return files;
}

/** Last path segment of a scenario directory: "examples/messaging" → "messaging". */
function groupName(directory: string): string {
  const trimmed = directory.replace(/\/+$/, "");
  return trimmed.split("/").filter(Boolean).at(-1) ?? trimmed;
}
