import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  exportConversationGraphScenarios,
  loadConversationGraphFile,
  type CompiledConversationGraphCase,
  type ConversationGraphCompileOptions,
  type Scenario
} from "@agentphone-devtools/core";

export interface GraphCompileRequest {
  graphPath: string;
  runs?: string[];
  paths?: string[];
  tags?: string[];
  fixtureProfiles?: string[];
  maxGeneratedCases?: number;
  useCorrectedTranscripts?: boolean;
}

export interface CompiledGraphSuiteItem {
  scenario: Scenario;
  sourcePath: string;
  pathName: string;
  runName?: string;
  fixtureProfiles: string[];
  label: string;
}

export async function compileGraphSuite(
  request: GraphCompileRequest,
  cwd = process.cwd()
): Promise<CompiledGraphSuiteItem[]> {
  const sourcePath = resolve(cwd, request.graphPath);
  const graph = await loadConversationGraphFile(sourcePath);
  const options: ConversationGraphCompileOptions = {
    ...(request.runs?.length ? { runs: request.runs } : {}),
    ...(request.paths?.length ? { paths: request.paths } : {}),
    ...(request.tags?.length ? { tags: request.tags } : {}),
    ...(request.fixtureProfiles?.length ? { fixtureProfiles: request.fixtureProfiles } : {}),
    ...(request.maxGeneratedCases !== undefined ? { maxGeneratedCases: request.maxGeneratedCases } : {}),
    ...(request.useCorrectedTranscripts ? { useCorrectedTranscripts: true } : {})
  };
  const cases = exportConversationGraphScenarios(graph, {
    ...options,
    sourcePath: relative(cwd, sourcePath) || basename(sourcePath)
  });
  return cases.map((exported) => toSuiteItem(exported.case, sourcePath));
}

export async function exportGraphSuite(
  request: GraphCompileRequest,
  exportDirectory: string,
  cwd = process.cwd()
): Promise<string[]> {
  const sourcePath = resolve(cwd, request.graphPath);
  const graph = await loadConversationGraphFile(sourcePath);
  const options: ConversationGraphCompileOptions = {
    ...(request.runs?.length ? { runs: request.runs } : {}),
    ...(request.paths?.length ? { paths: request.paths } : {}),
    ...(request.tags?.length ? { tags: request.tags } : {}),
    ...(request.fixtureProfiles?.length ? { fixtureProfiles: request.fixtureProfiles } : {}),
    ...(request.maxGeneratedCases !== undefined ? { maxGeneratedCases: request.maxGeneratedCases } : {}),
    ...(request.useCorrectedTranscripts ? { useCorrectedTranscripts: true } : {})
  };
  const exports = exportConversationGraphScenarios(graph, {
    ...options,
    sourcePath: relative(cwd, sourcePath) || basename(sourcePath)
  });
  const destinationRoot = resolve(cwd, exportDirectory);
  await mkdir(destinationRoot, { recursive: true });
  const written: string[] = [];
  for (const exported of exports) {
    const destination = join(destinationRoot, exported.fileName);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, exported.yaml, "utf8");
    written.push(destination);
  }
  return written;
}

function toSuiteItem(compiled: CompiledConversationGraphCase, sourcePath: string): CompiledGraphSuiteItem {
  const labelParts = [compiled.runName, compiled.pathName, ...compiled.fixtureProfiles].filter(Boolean);
  return {
    scenario: compiled.scenario,
    sourcePath,
    pathName: compiled.pathName,
    ...(compiled.runName ? { runName: compiled.runName } : {}),
    fixtureProfiles: compiled.fixtureProfiles,
    label: `${sourcePath} :: ${labelParts.join(" / ")}`
  };
}
