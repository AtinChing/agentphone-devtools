import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { z } from "zod";
import { isSafeRelativeAssetPath } from "./audio-fixtures.js";
import type { ConversationState, DeliveryFault, Scenario, ScenarioTurn } from "./types.js";

/** The current on-disk conversation graph format. */
export const CONVERSATION_GRAPH_VERSION = 1 as const;

export type ReviewStatus = "pending" | "approved" | "rejected";

export interface NodeReview {
  status: ReviewStatus;
  annotations?: string[];
  /** Transcript captured before editorial review. */
  originalTranscript?: string;
  /** Transcript expected after editorial review; used as the compiled caller text when present. */
  correctedTranscript?: string;
}

export interface AudioFixture {
  path?: string;
  transcript?: string;
  noiseProfile?: string;
}

export interface TimingInterruption {
  atMs: number;
  transcript?: string;
}

export interface TimingFixture {
  leadingSilenceMs?: number;
  trailingSilenceMs?: number;
  interruptions?: TimingInterruption[];
}

export interface TelephonyFixture {
  dtmf?: string[];
}

export interface DeliveryFixture {
  delayMs?: number;
  timeout?: boolean;
  faults?: DeliveryFault;
}

/** Fixtures are deliberately additive: unsupported fixture kinds remain graph metadata. */
export interface NodeFixtures {
  audio?: AudioFixture;
  timing?: TimingFixture;
  telephony?: TelephonyFixture;
  delivery?: DeliveryFixture;
}

export interface ConversationGraphNode {
  /** The stable ID is the key in ConversationGraph.nodes. */
  caller: string;
  expect?: ScenarioTurn["expect"];
  review?: NodeReview;
  fixtures?: NodeFixtures;
}

export interface ConversationGraphEdge {
  from: string;
  to: string;
  label: string;
}

export interface ConversationGraphPath {
  /** Ordered stable node IDs. A route may consist of one node. */
  route: string[];
  tags?: string[];
  description?: string;
  expectedOutcome?: "resolved" | "handed_off" | "failed";
}

export interface FixtureProfile {
  description?: string;
  /** Keys are exact node IDs or `*` wildcards, such as `billing-*`. */
  apply: Record<string, NodeFixtures>;
}

export interface ConversationGraphRun {
  /** Explicit path names and tag matches are combined when both are supplied. */
  paths?: string[];
  tags?: string[];
  fixtureProfiles?: string[];
  maxGeneratedCases?: number;
}

export interface ConversationGraphMetadata {
  name: string;
  description?: string;
  channel: "sms" | "voice";
  agentId: string;
  numberId: string;
  from: string;
  to: string;
  conversationState: ConversationState;
  contextLimit: number;
  timeoutSeconds: number;
}

export interface ConversationGraph {
  version: typeof CONVERSATION_GRAPH_VERSION;
  metadata: ConversationGraphMetadata;
  nodes: Record<string, ConversationGraphNode>;
  edges: ConversationGraphEdge[];
  paths: Record<string, ConversationGraphPath>;
  fixtureProfiles?: Record<string, FixtureProfile>;
  runs?: Record<string, ConversationGraphRun>;
  maxGeneratedCases?: number;
}

export interface ConversationGraphCompileOptions {
  /** Named runs to compile. When omitted, selected paths compile directly. */
  runs?: string[];
  paths?: string[];
  tags?: string[];
  fixtureProfiles?: string[];
  /** Reject is the safe default: all nodes in a generated path must be approved. */
  unreviewed?: "reject" | "skip" | "include";
  /** Corrections are editorial data and only become replay input by explicit choice. */
  useCorrectedTranscripts?: boolean;
  maxGeneratedCases?: number;
}

export interface CompiledConversationGraphTurn {
  nodeId: string;
  turnIndex: number;
  fixtures?: NodeFixtures;
}

export interface CompiledConversationGraphCase {
  pathName: string;
  runName?: string;
  fixtureProfiles: string[];
  scenario: Scenario;
  turns: CompiledConversationGraphTurn[];
}

export const DEFAULT_MAX_GENERATED_CASES = 24;

const deliveryFaultSchema = z
  .object({
    invalidSignature: z.boolean().optional(),
    omitSignature: z.boolean().optional(),
    staleTimestampSeconds: z.number().int().min(301).max(86_400).optional(),
    tamperBody: z.boolean().optional(),
    malformedJson: z.boolean().optional(),
    duplicateWebhookId: z.boolean().optional(),
    simulateTimeout: z.boolean().optional()
  })
  .strict();

const expectationSchema = z
  .object({
    outcome: z.enum(["resolved", "handed_off", "failed"]).optional(),
    actions: z.array(z.string()).optional(),
    status: z.number().int().min(100).max(599).optional(),
    timedOut: z.boolean().optional(),
    retries: z.number().int().min(0).max(10).optional()
  })
  .strict();

const fixturesSchema = z
  .object({
    audio: z
      .object({
        path: z.string().min(1).refine(isSafeRelativeAssetPath, "path must be a safe relative asset path").optional(),
        transcript: z.string().min(1).optional(),
        noiseProfile: z.string().min(1).optional()
      })
      .strict()
      .optional(),
    timing: z
      .object({
        leadingSilenceMs: z.number().int().nonnegative().optional(),
        trailingSilenceMs: z.number().int().nonnegative().optional(),
        interruptions: z.array(z.object({ atMs: z.number().int().nonnegative(), transcript: z.string().min(1).optional() }).strict()).optional()
      })
      .strict()
      .optional(),
    telephony: z.object({ dtmf: z.array(z.string().min(1)).optional() }).strict().optional(),
    delivery: z
      .object({ delayMs: z.number().int().nonnegative().optional(), timeout: z.boolean().optional(), faults: deliveryFaultSchema.optional() })
      .strict()
      .optional()
  })
  .strict();

const metadataSchema = z
  .object({
    name: z.string().min(1).default("Untitled scenario"),
    description: z.string().optional(),
    channel: z.enum(["sms", "voice"]).default("voice"),
    agentId: z.string().min(1).default("agt_local"),
    numberId: z.string().min(1).default("num_local"),
    from: z.string().regex(/^\+\d{8,15}$/).default("+15559876543"),
    to: z.string().regex(/^\+\d{8,15}$/).default("+15551234567"),
    conversationState: z.record(z.unknown()).nullable().default(null),
    contextLimit: z.number().int().min(0).max(50).default(10),
    timeoutSeconds: z.number().int().min(5).max(120).default(30)
  })
  .strict();

const graphSchema = z
  .object({
    version: z.literal(CONVERSATION_GRAPH_VERSION),
    metadata: metadataSchema.default({}),
    nodes: z
      .record(
        z
          .object({
            caller: z.string().min(1),
            expect: expectationSchema.optional(),
            review: z
              .object({
                status: z.enum(["pending", "approved", "rejected"]),
                annotations: z.array(z.string().min(1)).optional(),
                originalTranscript: z.string().min(1).optional(),
                correctedTranscript: z.string().min(1).optional()
              })
              .strict()
              .optional(),
            fixtures: fixturesSchema.optional()
          })
          .strict()
      )
      .refine((nodes) => Object.keys(nodes).length > 0, "nodes must not be empty"),
    edges: z.array(z.object({ from: z.string().min(1), to: z.string().min(1), label: z.string().min(1) }).strict()).default([]),
    paths: z
      .record(
        z
          .object({
            route: z.array(z.string().min(1)).min(1),
            tags: z.array(z.string().min(1)).optional(),
            description: z.string().optional(),
            expectedOutcome: z.enum(["resolved", "handed_off", "failed"]).optional()
          })
          .strict()
      )
      .refine((paths) => Object.keys(paths).length > 0, "paths must not be empty"),
    fixtureProfiles: z
      .record(
        z
          .object({
            description: z.string().optional(),
            apply: z.record(fixturesSchema).refine((apply) => Object.keys(apply).length > 0, "apply must not be empty")
          })
          .strict()
      )
      .optional(),
    runs: z
      .record(
        z
          .object({
            paths: z.array(z.string().min(1)).min(1).optional(),
            tags: z.array(z.string().min(1)).min(1).optional(),
            fixtureProfiles: z.array(z.string().min(1)).optional(),
            maxGeneratedCases: z.number().int().positive().max(10_000).optional()
          })
          .strict()
          .refine((run) => run.paths !== undefined || run.tags !== undefined, "a run must select paths or tags")
      )
      .optional(),
    maxGeneratedCases: z.number().int().positive().max(10_000).optional()
  })
  .strict();

/** Parses JSON or YAML and verifies references, routes, profiles, and named runs. */
export function parseConversationGraph(raw: string, source = "conversation graph"): ConversationGraph {
  const parsed = source.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);
  return validateConversationGraph(parsed);
}

export async function loadConversationGraphFile(path: string): Promise<ConversationGraph> {
  return parseConversationGraph(await readFile(path, "utf8"), path);
}

/** Validates a graph object that may have been constructed in TypeScript rather than parsed from a file. */
export function validateConversationGraph(input: unknown): ConversationGraph {
  const graph = graphSchema.parse(input) as ConversationGraph;
  const nodeIds = new Set(Object.keys(graph.nodes));

  for (const id of nodeIds) {
    if (!isStableId(id)) throw new Error(`Conversation graph node ID "${id}" is not a stable ID`);
  }

  const edgePairs = new Set<string>();
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(`Conversation graph edge "${edge.from}" -> "${edge.to}" references an unknown node`);
    }
    edgePairs.add(`${edge.from}\u0000${edge.to}`);
  }

  for (const [pathName, path] of Object.entries(graph.paths)) {
    if (!isStableId(pathName)) throw new Error(`Conversation graph path ID "${pathName}" is not a stable ID`);
    if (new Set(path.route).size !== path.route.length) {
      throw new Error(`Conversation graph path "${pathName}" repeats a node; loops require an explicit future loop policy`);
    }
    for (const nodeId of path.route) {
      if (!nodeIds.has(nodeId)) throw new Error(`Conversation graph path "${pathName}" references unknown node "${nodeId}"`);
    }
    for (let index = 1; index < path.route.length; index += 1) {
      const from = path.route[index - 1];
      const to = path.route[index];
      if (!edgePairs.has(`${from}\u0000${to}`)) {
        throw new Error(`Conversation graph path "${pathName}" has no edge from "${from}" to "${to}"`);
      }
    }
  }

  for (const [profileName, profile] of Object.entries(graph.fixtureProfiles ?? {})) {
    if (!isStableId(profileName)) throw new Error(`Fixture profile ID "${profileName}" is not a stable ID`);
    for (const selector of Object.keys(profile.apply)) {
      if (![...nodeIds].some((nodeId) => matchesNodeSelector(nodeId, selector))) {
        throw new Error(`Fixture profile "${profileName}" selector "${selector}" matches no nodes`);
      }
    }
  }

  for (const [runName, run] of Object.entries(graph.runs ?? {})) {
    if (!isStableId(runName)) throw new Error(`Conversation graph run ID "${runName}" is not a stable ID`);
    for (const pathName of run.paths ?? []) {
      if (!(pathName in graph.paths)) throw new Error(`Conversation graph run "${runName}" references unknown path "${pathName}"`);
    }
    for (const profileName of run.fixtureProfiles ?? []) {
      if (!(profileName in (graph.fixtureProfiles ?? {}))) {
        throw new Error(`Conversation graph run "${runName}" references unknown fixture profile "${profileName}"`);
      }
    }
  }

  return graph;
}

/** Compiles graph selections into the existing flat Scenario shape without writing scenario files. */
export function compileConversationGraph(input: ConversationGraph, options: ConversationGraphCompileOptions = {}): Scenario[] {
  return compileConversationGraphCases(input, options).map((compiled) => compiled.scenario);
}

/** Compiles selected routes while retaining fixture and source-node provenance for graph-aware adapters. */
export function compileConversationGraphCases(
  input: ConversationGraph,
  options: ConversationGraphCompileOptions = {}
): CompiledConversationGraphCase[] {
  const graph = validateConversationGraph(input);
  const selection = createSelections(graph, options);
  const cap = smallestCap(graph.maxGeneratedCases, options.maxGeneratedCases, DEFAULT_MAX_GENERATED_CASES);
  if (selection.length > cap) throw new Error(`Conversation graph would generate ${selection.length} cases, exceeding the cap of ${cap}`);

  const policy = options.unreviewed ?? "reject";
  const cases: CompiledConversationGraphCase[] = [];
  for (const item of selection) {
    const path = graph.paths[item.pathName];
    const unreviewed = path.route.filter((nodeId) => graph.nodes[nodeId].review?.status !== "approved");
    if (unreviewed.length > 0) {
      if (policy === "skip") continue;
      if (policy === "reject") {
        throw new Error(`Conversation graph path "${item.pathName}" contains unreviewed node(s): ${unreviewed.join(", ")}`);
      }
    }
    cases.push(compilePath(graph, item.pathName, item.profileNames, item.runName, options.useCorrectedTranscripts === true));
  }
  return cases;
}

function createSelections(graph: ConversationGraph, options: ConversationGraphCompileOptions): Array<{ pathName: string; profileNames: string[]; runName?: string }> {
  const optionProfiles = options.fixtureProfiles ?? [];
  assertProfilesExist(graph, optionProfiles);
  if (options.runs && options.runs.length > 0) {
    const selections: Array<{ pathName: string; profileNames: string[]; runName?: string }> = [];
    for (const runName of options.runs) {
      const run = graph.runs?.[runName];
      if (!run) throw new Error(`Conversation graph has no run named "${runName}"`);
      const pathNames = selectPathNames(graph, run.paths, run.tags);
      const runCap = run.maxGeneratedCases ?? Number.POSITIVE_INFINITY;
      if (pathNames.length > runCap) throw new Error(`Conversation graph run "${runName}" would generate ${pathNames.length} cases, exceeding the cap of ${runCap}`);
      for (const pathName of pathNames) selections.push({ pathName, profileNames: [...(run.fixtureProfiles ?? []), ...optionProfiles], runName });
    }
    return selections;
  }
  return selectPathNames(graph, options.paths, options.tags).map((pathName) => ({ pathName, profileNames: optionProfiles }));
}

function selectPathNames(graph: ConversationGraph, explicitPaths?: string[], tags?: string[]): string[] {
  const selected = new Set<string>();
  for (const pathName of explicitPaths ?? []) {
    if (!(pathName in graph.paths)) throw new Error(`Conversation graph has no path named "${pathName}"`);
    selected.add(pathName);
  }
  if (tags && tags.length > 0) {
    for (const [pathName, path] of Object.entries(graph.paths)) {
      if (path.tags?.some((tag) => tags.includes(tag))) selected.add(pathName);
    }
  }
  if (selected.size === 0 && (explicitPaths?.length ?? 0) === 0 && (tags?.length ?? 0) === 0) return Object.keys(graph.paths);
  return [...selected];
}

function compilePath(
  graph: ConversationGraph,
  pathName: string,
  profileNames: string[],
  runName: string | undefined,
  useCorrectedTranscripts: boolean
): CompiledConversationGraphCase {
  const path = graph.paths[pathName];
  const nameSuffix = runName ? `${runName}: ${pathName}` : pathName;
  const compiledTurns = path.route.map((nodeId, turnIndex) =>
    compileNode(graph.nodes[nodeId], nodeId, turnIndex, graph, profileNames, useCorrectedTranscripts)
  );
  const scenario: Scenario = {
    ...graph.metadata,
    name: `${graph.metadata.name} [${nameSuffix}]`,
    ...(path.expectedOutcome ? { expectedOutcome: path.expectedOutcome } : {}),
    turns: compiledTurns.map((compiled) => compiled.turn)
  };
  return {
    pathName,
    ...(runName ? { runName } : {}),
    fixtureProfiles: [...profileNames],
    scenario,
    turns: compiledTurns.map(({ nodeId, turnIndex, fixtures }) => ({ nodeId, turnIndex, ...(fixtures ? { fixtures } : {}) }))
  };
}

function compileNode(
  node: ConversationGraphNode,
  nodeId: string,
  turnIndex: number,
  graph: ConversationGraph,
  profileNames: string[],
  useCorrectedTranscripts: boolean
): { nodeId: string; turnIndex: number; turn: ScenarioTurn; fixtures?: NodeFixtures } {
  let fixtures = node.fixtures;
  for (const profileName of profileNames) {
    const profile = graph.fixtureProfiles?.[profileName];
    if (!profile) throw new Error(`Conversation graph has no fixture profile named "${profileName}"`);
    // Wildcards establish a baseline; an exact node overlay always wins regardless
    // of property order in the serialized profile.
    const overlays = Object.entries(profile.apply).sort(([left], [right]) => Number(right.includes("*")) - Number(left.includes("*")));
    for (const [selector, overlay] of overlays) {
      if (matchesNodeSelector(nodeId, selector)) fixtures = mergeFixtures(fixtures, overlay);
    }
  }
  const delivery = fixtures?.delivery;
  const fault = mergeFaults(delivery?.faults, delivery?.timeout ? { simulateTimeout: true } : undefined);
  const turn: ScenarioTurn = {
    caller: useCorrectedTranscripts ? (node.review?.correctedTranscript ?? node.caller) : node.caller,
    ...(node.expect ? { expect: { ...node.expect, ...(node.expect.actions ? { actions: [...node.expect.actions] } : {}) } } : {}),
    ...(fault ? { fault } : {}),
    ...(fixtures?.timing?.leadingSilenceMs !== undefined ? { waitMs: fixtures.timing.leadingSilenceMs } : {})
  };
  return { nodeId, turnIndex, turn, ...(fixtures ? { fixtures } : {}) };
}

function mergeFixtures(base: NodeFixtures | undefined, overlay: NodeFixtures): NodeFixtures {
  return {
    ...base,
    ...overlay,
    ...(base?.audio || overlay.audio ? { audio: { ...base?.audio, ...overlay.audio } } : {}),
    ...(base?.timing || overlay.timing ? { timing: { ...base?.timing, ...overlay.timing, ...(base?.timing?.interruptions || overlay.timing?.interruptions ? { interruptions: overlay.timing?.interruptions ?? base?.timing?.interruptions } : {}) } } : {}),
    ...(base?.telephony || overlay.telephony ? { telephony: { ...base?.telephony, ...overlay.telephony, ...(base?.telephony?.dtmf || overlay.telephony?.dtmf ? { dtmf: overlay.telephony?.dtmf ?? base?.telephony?.dtmf } : {}) } } : {}),
    ...(base?.delivery || overlay.delivery ? { delivery: { ...base?.delivery, ...overlay.delivery, faults: mergeFaults(base?.delivery?.faults, overlay.delivery?.faults) } } : {})
  };
}

function mergeFaults(base: DeliveryFault | undefined, overlay: DeliveryFault | undefined): DeliveryFault | undefined {
  const merged = { ...base, ...overlay };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function assertProfilesExist(graph: ConversationGraph, profileNames: string[]): void {
  for (const profileName of profileNames) {
    if (!(profileName in (graph.fixtureProfiles ?? {}))) throw new Error(`Conversation graph has no fixture profile named "${profileName}"`);
  }
}

function smallestCap(...caps: Array<number | undefined>): number {
  return Math.min(...caps.filter((cap): cap is number => cap !== undefined), Number.POSITIVE_INFINITY);
}

function isStableId(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9._:-]*$/.test(value);
}

function matchesNodeSelector(nodeId: string, selector: string): boolean {
  const expression = `^${selector.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*")}$`;
  return new RegExp(expression).test(nodeId);
}

/** True when a parsed document looks like a conversation graph rather than a flat scenario. */
export function isConversationGraphDocument(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const document = value as Record<string, unknown>;
  return document.version === CONVERSATION_GRAPH_VERSION && isPlainObject(document.nodes) && isPlainObject(document.paths);
}

/** Best-effort detection for suite discovery before flat-scenario parsing. */
export function rawLooksLikeConversationGraph(raw: string, source = "conversation graph"): boolean {
  try {
    const parsed = source.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);
    return isConversationGraphDocument(parsed);
  } catch {
    return false;
  }
}

export interface ConversationGraphExportOptions extends ConversationGraphCompileOptions {
  /** Relative path recorded in the exported provenance header. */
  sourcePath?: string;
}

export interface ExportedConversationGraphScenario {
  case: CompiledConversationGraphCase;
  fileName: string;
  yaml: string;
  json: string;
}

/** Compiles selected routes and formats them as explicit flat-scenario exports with provenance. */
export function exportConversationGraphScenarios(
  input: ConversationGraph,
  options: ConversationGraphExportOptions = {}
): ExportedConversationGraphScenario[] {
  return compileConversationGraphCases(input, options).map((compiled) => {
    const fileName = buildExportFileName(compiled);
    const provenance = [
      `family: ${input.metadata.name}`,
      `path: ${compiled.pathName}`,
      ...(compiled.runName ? [`run: ${compiled.runName}`] : []),
      ...(compiled.fixtureProfiles.length ? [`fixtureProfiles: ${compiled.fixtureProfiles.join(", ")}`] : []),
      ...(options.sourcePath ? [`source: ${options.sourcePath}`] : [])
    ];
    return {
      case: compiled,
      fileName,
      yaml: stringifyFlatScenarioYaml(compiled.scenario, provenance),
      json: `${JSON.stringify(
        {
          ...compiled.scenario,
          provenance: {
            family: input.metadata.name,
            path: compiled.pathName,
            ...(compiled.runName ? { run: compiled.runName } : {}),
            fixtureProfiles: compiled.fixtureProfiles,
            ...(options.sourcePath ? { source: options.sourcePath } : {})
          }
        },
        null,
        2
      )}\n`
    };
  });
}

function buildExportFileName(compiled: CompiledConversationGraphCase): string {
  const parts = [compiled.runName, compiled.pathName, ...compiled.fixtureProfiles].filter(Boolean) as string[];
  const slug = parts
    .join("__")
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "compiled-scenario"}.yaml`;
}

function stringifyFlatScenarioYaml(scenario: Scenario, provenance: string[]): string {
  const lines: string[] = [
    "# Generated by AgentPhone DevTools from a conversation graph.",
    "# Re-export after editing the graph; do not treat this file as the source of truth.",
    ...provenance.map((line) => `# ${line}`),
    `name: ${yamlScalar(scenario.name)}`,
    `description: ${yamlScalar(scenario.description ?? "")}`,
    `channel: ${scenario.channel}`,
    `agentId: ${yamlScalar(scenario.agentId)}`,
    `numberId: ${yamlScalar(scenario.numberId)}`,
    `from: ${yamlScalar(scenario.from)}`,
    `to: ${yamlScalar(scenario.to)}`,
    "conversationState:",
    ...yamlValueLines(scenario.conversationState, 2),
    `contextLimit: ${scenario.contextLimit}`,
    `timeoutSeconds: ${scenario.timeoutSeconds}`
  ];
  if (scenario.expectedOutcome) lines.push(`expectedOutcome: ${scenario.expectedOutcome}`);
  lines.push("turns:");
  for (const turn of scenario.turns) {
    lines.push(`  - caller: ${yamlScalar(turn.caller)}`);
    if (turn.waitMs !== undefined) lines.push(`    waitMs: ${turn.waitMs}`);
    if (turn.expect) {
      lines.push("    expect:");
      if (turn.expect.outcome) lines.push(`      outcome: ${turn.expect.outcome}`);
      if (turn.expect.actions?.length) {
        lines.push("      actions:");
        for (const action of turn.expect.actions) lines.push(`        - ${yamlScalar(action)}`);
      }
      if (turn.expect.status !== undefined) lines.push(`      status: ${turn.expect.status}`);
      if (turn.expect.timedOut !== undefined) lines.push(`      timedOut: ${turn.expect.timedOut}`);
      if (turn.expect.retries !== undefined) lines.push(`      retries: ${turn.expect.retries}`);
    }
    if (turn.fault) {
      lines.push("    fault:");
      for (const [key, value] of Object.entries(turn.fault)) {
        if (value !== undefined) lines.push(`      ${key}: ${JSON.stringify(value)}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function yamlValueLines(value: unknown, indent: number): string[] {
  const prefix = " ".repeat(indent);
  if (value === null || value === undefined) return [`${prefix}null`];
  if (Array.isArray(value)) {
    if (!value.length) return [`${prefix}[]`];
    return value.flatMap((item) => {
      if (isPlainObject(item) || Array.isArray(item)) return [`${prefix}-`, ...yamlValueLines(item, indent + 2)];
      return [`${prefix}- ${yamlScalar(item)}`];
    });
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (!entries.length) return [`${prefix}{}`];
    return entries.flatMap(([key, entry]) => {
      if (isPlainObject(entry) || Array.isArray(entry)) return [`${prefix}${key}:`, ...yamlValueLines(entry, indent + 2)];
      return [`${prefix}${key}: ${yamlScalar(entry)}`];
    });
  }
  return [`${prefix}${yamlScalar(value)}`];
}

function yamlScalar(value: unknown): string {
  return JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
