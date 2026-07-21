import {
  DEFAULT_MAX_GENERATED_CASES,
  validateConversationGraph,
  type ConversationGraph,
  type ConversationGraphCompileOptions
} from "./conversation-graph.js";
import { summarizePathReview, type PathReviewSummary } from "./graph-authoring.js";

export type CoverageFilter =
  | "all"
  | "approved_paths"
  | "pending_paths"
  | "uncovered_edges"
  | "pairwise_gaps"
  | "cap_omitted"
  | "unsupported";

export interface EdgeCoverageItem {
  from: string;
  to: string;
  label: string;
  coveredBy: string[];
  covered: boolean;
}

export interface PairwiseCoverageItem {
  left: string;
  right: string;
  covered: boolean;
  coveringPaths: string[];
}

export interface UnsupportedFixtureItem {
  kind: "audio" | "timing" | "telephony" | "delivery";
  location: string;
  detail: string;
  support: "locally-simulated" | "metadata-only" | "unsupported";
}

export interface CapOmittedCase {
  pathName: string;
  runName?: string;
  fixtureProfiles: string[];
  reason: string;
}

export interface GraphCoverageReport {
  paths: PathReviewSummary[];
  approvedPathCount: number;
  pendingPathCount: number;
  edges: EdgeCoverageItem[];
  coveredEdgeCount: number;
  pairwise: PairwiseCoverageItem[];
  coveredPairCount: number;
  unsupported: UnsupportedFixtureItem[];
  cap: {
    limit: number;
    selectedCount: number;
    omitted: CapOmittedCase[];
  };
  selectedPathNames: string[];
  selectedProfileNames: string[];
}

/**
 * Build a deterministic coverage report for visualization and CI summaries.
 * Pairwise coverage treats each run's fixtureProfiles list as a covering set:
 * every unordered pair among those profiles is marked covered for the selected paths.
 */
export function buildGraphCoverageReport(
  input: ConversationGraph,
  options: ConversationGraphCompileOptions = {}
): GraphCoverageReport {
  const graph = validateConversationGraph(input);
  const pathSummaries = Object.keys(graph.paths).map((pathName) => summarizePathReview(graph, pathName));
  const selectedPathNames = selectPathNames(graph, options.paths, options.tags, options.runs);
  const selectedProfileNames = collectSelectedProfiles(graph, options);
  const edges = buildEdgeCoverage(graph, selectedPathNames);
  const pairwise = buildPairwiseCoverage(selectedPathNames, selectedProfileNames);
  const unsupported = collectUnsupportedFixtures(graph);
  const capLimit = smallestCap(graph.maxGeneratedCases, options.maxGeneratedCases, DEFAULT_MAX_GENERATED_CASES);
  const desired = expandDesiredCases(graph, options);
  const omitted = desired.length > capLimit ? desired.slice(capLimit) : [];

  return {
    paths: pathSummaries,
    approvedPathCount: pathSummaries.filter((path) => path.status === "approved").length,
    pendingPathCount: pathSummaries.filter((path) => path.status !== "approved").length,
    edges,
    coveredEdgeCount: edges.filter((edge) => edge.covered).length,
    pairwise,
    coveredPairCount: pairwise.filter((pair) => pair.covered).length,
    unsupported,
    cap: {
      limit: capLimit,
      selectedCount: Math.min(desired.length, capLimit),
      omitted
    },
    selectedPathNames,
    selectedProfileNames
  };
}

export function filterCoveragePaths(report: GraphCoverageReport, filter: CoverageFilter): string[] {
  switch (filter) {
    case "approved_paths":
      return report.paths.filter((path) => path.status === "approved").map((path) => path.pathName);
    case "pending_paths":
      return report.paths.filter((path) => path.status !== "approved").map((path) => path.pathName);
    case "uncovered_edges":
      return [
        ...new Set(
          report.edges
            .filter((edge) => !edge.covered)
            .flatMap((edge) => report.paths.filter((path) => path.route.includes(edge.from) && path.route.includes(edge.to)).map((path) => path.pathName))
        )
      ];
    case "pairwise_gaps":
      return report.pairwise.some((pair) => !pair.covered) ? [...report.selectedPathNames] : [];
    case "cap_omitted":
      return [...new Set(report.cap.omitted.map((item) => item.pathName))];
    case "unsupported":
      return report.unsupported.length ? Object.keys(Object.fromEntries(report.paths.map((path) => [path.pathName, true]))) : [];
    case "all":
    default:
      return report.paths.map((path) => path.pathName);
  }
}

function buildEdgeCoverage(graph: ConversationGraph, selectedPathNames: string[]): EdgeCoverageItem[] {
  return graph.edges.map((edge) => {
    const coveredBy = selectedPathNames.filter((pathName) => {
      const route = graph.paths[pathName]?.route ?? [];
      for (let index = 1; index < route.length; index += 1) {
        if (route[index - 1] === edge.from && route[index] === edge.to) return true;
      }
      return false;
    });
    return {
      from: edge.from,
      to: edge.to,
      label: edge.label,
      coveredBy,
      covered: coveredBy.length > 0
    };
  });
}

function buildPairwiseCoverage(pathNames: string[], profileNames: string[]): PairwiseCoverageItem[] {
  const pairs: PairwiseCoverageItem[] = [];
  for (let left = 0; left < profileNames.length; left += 1) {
    for (let right = left + 1; right < profileNames.length; right += 1) {
      pairs.push({
        left: profileNames[left],
        right: profileNames[right],
        covered: pathNames.length > 0,
        coveringPaths: pathNames.length > 0 ? [...pathNames] : []
      });
    }
  }
  return pairs;
}

function collectUnsupportedFixtures(graph: ConversationGraph): UnsupportedFixtureItem[] {
  const items: UnsupportedFixtureItem[] = [];
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.fixtures?.audio) {
      items.push({
        kind: "audio",
        location: `node:${nodeId}`,
        detail: node.fixtures.audio.noiseProfile
          ? `noiseProfile=${node.fixtures.audio.noiseProfile}`
          : node.fixtures.audio.path ?? "audio fixture",
        support: "metadata-only"
      });
    }
    if (node.fixtures?.timing?.interruptions?.length) {
      items.push({
        kind: "timing",
        location: `node:${nodeId}`,
        detail: `${node.fixtures.timing.interruptions.length} interruption(s)`,
        support: "locally-simulated"
      });
    }
    if (node.fixtures?.telephony?.dtmf?.length) {
      items.push({
        kind: "telephony",
        location: `node:${nodeId}`,
        detail: `dtmf=${node.fixtures.telephony.dtmf.join(",")}`,
        support: "metadata-only"
      });
    }
  }
  for (const [profileName, profile] of Object.entries(graph.fixtureProfiles ?? {})) {
    for (const [selector, fixtures] of Object.entries(profile.apply)) {
      if (fixtures.audio) {
        items.push({
          kind: "audio",
          location: `profile:${profileName}:${selector}`,
          detail: fixtures.audio.noiseProfile ?? fixtures.audio.path ?? "audio fixture",
          support: "metadata-only"
        });
      }
    }
  }
  return items;
}

function expandDesiredCases(
  graph: ConversationGraph,
  options: ConversationGraphCompileOptions
): CapOmittedCase[] {
  const optionProfiles = options.fixtureProfiles ?? [];
  if (options.runs?.length) {
    const cases: CapOmittedCase[] = [];
    for (const runName of options.runs) {
      const run = graph.runs?.[runName];
      if (!run) continue;
      const pathNames = selectPathNames(graph, run.paths, run.tags);
      const profiles = [...(run.fixtureProfiles ?? []), ...optionProfiles];
      for (const pathName of pathNames) {
        cases.push({
          pathName,
          runName,
          fixtureProfiles: profiles,
          reason: "exceeds maxGeneratedCases"
        });
      }
    }
    return cases;
  }
  return selectPathNames(graph, options.paths, options.tags).map((pathName) => ({
    pathName,
    fixtureProfiles: optionProfiles,
    reason: "exceeds maxGeneratedCases"
  }));
}

function collectSelectedProfiles(graph: ConversationGraph, options: ConversationGraphCompileOptions): string[] {
  const names = new Set<string>(options.fixtureProfiles ?? []);
  for (const runName of options.runs ?? []) {
    for (const profileName of graph.runs?.[runName]?.fixtureProfiles ?? []) names.add(profileName);
  }
  if (names.size === 0) {
    for (const profileName of Object.keys(graph.fixtureProfiles ?? {})) names.add(profileName);
  }
  return [...names];
}

function selectPathNames(
  graph: ConversationGraph,
  explicitPaths?: string[],
  tags?: string[],
  runs?: string[]
): string[] {
  if (runs?.length) {
    const selected = new Set<string>();
    for (const runName of runs) {
      const run = graph.runs?.[runName];
      if (!run) continue;
      for (const pathName of selectPathNames(graph, run.paths, run.tags)) selected.add(pathName);
    }
    return [...selected];
  }
  const selected = new Set<string>();
  for (const pathName of explicitPaths ?? []) {
    if (pathName in graph.paths) selected.add(pathName);
  }
  if (tags?.length) {
    for (const [pathName, path] of Object.entries(graph.paths)) {
      if (path.tags?.some((tag) => tags.includes(tag))) selected.add(pathName);
    }
  }
  if (selected.size === 0 && (explicitPaths?.length ?? 0) === 0 && (tags?.length ?? 0) === 0) {
    return Object.keys(graph.paths);
  }
  return [...selected];
}

function smallestCap(...caps: Array<number | undefined>): number {
  return Math.min(...caps.filter((cap): cap is number => cap !== undefined), Number.POSITIVE_INFINITY);
}
