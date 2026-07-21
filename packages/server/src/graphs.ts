import { access, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  applyNodeReview,
  buildGraphCoverageReport,
  compileConversationGraphCases,
  draftGraphFromCallerTurns,
  forkPathFromNode,
  loadConversationGraphFile,
  rawLooksLikeConversationGraph,
  stringifyConversationGraphYaml,
  summarizeGraphPaths,
  validateConversationGraph,
  type ApplyNodeReviewInput,
  type ConversationGraph,
  type ConversationGraphCompileOptions,
  type ForkPathInput,
  type PathReviewSummary
} from "@agentphone-devtools/core";

const GRAPH_EXTENSIONS = new Set([".yaml", ".yml", ".json"]);

export interface GraphFamilySummary {
  id: string;
  name: string;
  channel: "sms" | "voice";
  path: string;
  pathCount: number;
  paths: PathReviewSummary[];
}

export interface LoadedGraphFamily {
  id: string;
  path: string;
  graph: ConversationGraph;
  paths: PathReviewSummary[];
}

export class GraphAuthoringStore {
  constructor(private readonly graphsDirectory: string) {}

  async listFamilies(): Promise<GraphFamilySummary[]> {
    const directory = resolve(this.graphsDirectory);
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory, { withFileTypes: true });
    const families: GraphFamilySummary[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !GRAPH_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      const path = join(directory, entry.name);
      try {
        const raw = await readFile(path, "utf8");
        if (!rawLooksLikeConversationGraph(raw, path)) continue;
        const graph = await loadConversationGraphFile(path);
        families.push({
          id: familyIdFromPath(path),
          name: graph.metadata.name,
          channel: graph.metadata.channel,
          path,
          pathCount: Object.keys(graph.paths).length,
          paths: summarizeGraphPaths(graph)
        });
      } catch {
        // Skip unreadable or invalid graph documents during listing.
      }
    }
    return families;
  }

  async loadFamily(id: string): Promise<LoadedGraphFamily | null> {
    const path = await resolveFamilyPath(this.graphsDirectory, id);
    if (!path) return null;
    const graph = await loadConversationGraphFile(path);
    return {
      id,
      path,
      graph,
      paths: summarizeGraphPaths(graph)
    };
  }

  async saveFamily(id: string, graph: ConversationGraph): Promise<LoadedGraphFamily> {
    const existing = await resolveFamilyPath(this.graphsDirectory, id);
    const path = existing ?? join(resolve(this.graphsDirectory), `${id}.yaml`);
    await mkdir(dirname(path), { recursive: true });
    const validated = validateConversationGraph(graph);
    if (path.endsWith(".json")) {
      await atomicWrite(path, `${JSON.stringify(validated, null, 2)}\n`);
    } else {
      await atomicWrite(path, stringifyConversationGraphYaml(validated));
    }
    return {
      id: familyIdFromPath(path),
      path,
      graph: validated,
      paths: summarizeGraphPaths(validated)
    };
  }

  async reviewNode(id: string, nodeId: string, input: ApplyNodeReviewInput): Promise<LoadedGraphFamily> {
    const loaded = await this.requireFamily(id);
    return this.saveFamily(id, applyNodeReview(loaded.graph, nodeId, input));
  }

  async forkPath(id: string, input: ForkPathInput): Promise<LoadedGraphFamily> {
    const loaded = await this.requireFamily(id);
    return this.saveFamily(id, forkPathFromNode(loaded.graph, input));
  }

  async compileFamily(
    id: string,
    options: { runs?: string[]; paths?: string[]; tags?: string[] } = {}
  ): Promise<{ id: string; path: string; cases: ReturnType<typeof compileConversationGraphCases> }> {
    const loaded = await this.requireFamily(id);
    return {
      id: loaded.id,
      path: loaded.path,
      cases: compileConversationGraphCases(loaded.graph, options)
    };
  }

  async coverage(id: string, options: ConversationGraphCompileOptions = {}) {
    const loaded = await this.requireFamily(id);
    return {
      id: loaded.id,
      path: loaded.path,
      coverage: buildGraphCoverageReport(loaded.graph, options)
    };
  }

  async createFromCallerTurns(
    input: Parameters<typeof draftGraphFromCallerTurns>[0] & { fileName?: string }
  ): Promise<LoadedGraphFamily> {
    const graph = draftGraphFromCallerTurns(input);
    const fileName = sanitizeFileName(input.fileName ?? input.name);
    const path = join(resolve(this.graphsDirectory), `${fileName}.yaml`);
    await mkdir(dirname(path), { recursive: true });
    await atomicWrite(path, stringifyConversationGraphYaml(graph));
    return {
      id: familyIdFromPath(path),
      path,
      graph,
      paths: summarizeGraphPaths(graph)
    };
  }

  private async requireFamily(id: string): Promise<LoadedGraphFamily> {
    const loaded = await this.loadFamily(id);
    if (!loaded) throw new Error(`Conversation graph was not found: ${id}`);
    return loaded;
  }
}

export function familyIdFromPath(path: string): string {
  return basename(path).replace(/\.(yaml|yml|json)$/i, "");
}

async function resolveFamilyPath(directory: string, id: string): Promise<string | null> {
  const root = resolve(directory);
  for (const extension of [".yaml", ".yml", ".json"]) {
    const path = join(root, `${id}${extension}`);
    try {
      await access(path);
      return path;
    } catch {
      // try next extension
    }
  }
  return null;
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function sanitizeFileName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `graph-${Date.now()}`;
}
