import { readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const SCENARIO_EXTENSIONS = new Set([".json", ".yaml", ".yml"]);
const SKIPPED_DIRECTORIES = new Set([".agentphone-devtools", ".git", ".next", "dist", "node_modules"]);

export interface ScenarioInputs {
  files: string[];
  directories: string[];
}

export async function resolveScenarioInputs(
  inputs: ScenarioInputs,
  cwd = process.cwd()
): Promise<string[]> {
  const scenarios: string[] = [];
  const seen = new Set<string>();

  for (const input of inputs.files) {
    const path = resolve(cwd, input);
    const metadata = await statOrThrow(path, `Scenario file was not found: ${input}`);
    if (!metadata.isFile()) throw new Error(`Scenario path is not a file: ${input}`);
    if (!isScenarioFile(path)) throw new Error(`Scenario file must use .json, .yaml, or .yml: ${input}`);
    appendUnique(scenarios, seen, path);
  }

  for (const input of inputs.directories) {
    const path = resolve(cwd, input);
    const metadata = await statOrThrow(path, `Scenario directory was not found: ${input}`);
    if (!metadata.isDirectory()) throw new Error(`Scenario directory path is not a directory: ${input}`);
    const discovered = await discoverScenarioDirectory(path);
    if (discovered.length === 0) throw new Error(`Scenario directory contains no .json, .yaml, or .yml files: ${input}`);
    for (const scenario of discovered) appendUnique(scenarios, seen, scenario);
  }

  if (scenarios.length === 0) throw new Error("At least one --scenario or --scenario-dir is required");
  return scenarios;
}

export async function discoverScenarioDirectory(directory: string): Promise<string[]> {
  const scenarios: string[] = [];
  await walk(resolve(directory), scenarios);
  return scenarios.sort((left, right) => left.localeCompare(right));
}

async function walk(directory: string, scenarios: string[]): Promise<void> {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isFile() && isScenarioFile(entry.name)) {
      scenarios.push(path);
    } else if (entry.isDirectory() && !entry.name.startsWith(".") && !SKIPPED_DIRECTORIES.has(entry.name)) {
      await walk(path, scenarios);
    }
  }
}

async function statOrThrow(path: string, message: string) {
  try {
    return await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(message);
    throw error;
  }
}

function isScenarioFile(path: string): boolean {
  return SCENARIO_EXTENSIONS.has(extname(path).toLowerCase());
}

function appendUnique(paths: string[], seen: Set<string>, path: string): void {
  if (seen.has(path)) return;
  seen.add(path);
  paths.push(path);
}
