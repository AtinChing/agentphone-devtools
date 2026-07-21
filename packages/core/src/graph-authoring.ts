import { randomUUID } from "node:crypto";
import type {
  ConversationGraph,
  ConversationGraphNode,
  ConversationGraphPath,
  NodeFixtures,
  NodeReview,
  ReviewStatus
} from "./conversation-graph.js";
import { validateConversationGraph } from "./conversation-graph.js";

export interface PathReviewSummary {
  pathName: string;
  route: string[];
  tags: string[];
  description?: string;
  expectedOutcome?: ConversationGraphPath["expectedOutcome"];
  nodeCount: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  status: "approved" | "pending" | "rejected" | "mixed";
}

export interface ApplyNodeReviewInput {
  status: ReviewStatus;
  correctedTranscript?: string;
  annotations?: string[];
  /** When true, also replace the node caller text with correctedTranscript. */
  applyCorrectionToCaller?: boolean;
}

export interface ForkPathInput {
  sourcePath: string;
  fromNodeId: string;
  newPathName: string;
  edgeLabel?: string;
  /** Optional new continuation node appended after the fork point. */
  continuation?: {
    nodeId?: string;
    caller: string;
    expect?: ConversationGraphNode["expect"];
    fixtures?: NodeFixtures;
  };
  description?: string;
  tags?: string[];
}

export interface DraftGraphFromTurnsInput {
  name: string;
  channel: "sms" | "voice";
  turns: Array<{ caller: string }>;
  agentId?: string;
  numberId?: string;
  from?: string;
  to?: string;
  contextLimit?: number;
  timeoutSeconds?: number;
  pathName?: string;
}

/** Summarize review coverage for one named path. */
export function summarizePathReview(graph: ConversationGraph, pathName: string): PathReviewSummary {
  const path = graph.paths[pathName];
  if (!path) throw new Error(`Conversation graph has no path named "${pathName}"`);
  let approvedCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;
  for (const nodeId of path.route) {
    const status = graph.nodes[nodeId]?.review?.status ?? "pending";
    if (status === "approved") approvedCount += 1;
    else if (status === "rejected") rejectedCount += 1;
    else pendingCount += 1;
  }
  const status =
    rejectedCount > 0 && approvedCount === 0 && pendingCount === 0
      ? "rejected"
      : approvedCount === path.route.length
        ? "approved"
        : pendingCount === path.route.length
          ? "pending"
          : "mixed";
  return {
    pathName,
    route: [...path.route],
    tags: [...(path.tags ?? [])],
    ...(path.description ? { description: path.description } : {}),
    ...(path.expectedOutcome ? { expectedOutcome: path.expectedOutcome } : {}),
    nodeCount: path.route.length,
    approvedCount,
    pendingCount,
    rejectedCount,
    status
  };
}

export function summarizeGraphPaths(graph: ConversationGraph): PathReviewSummary[] {
  return Object.keys(graph.paths).map((pathName) => summarizePathReview(graph, pathName));
}

/** Update review metadata for a node while preserving other node fields. */
export function applyNodeReview(graph: ConversationGraph, nodeId: string, input: ApplyNodeReviewInput): ConversationGraph {
  const node = graph.nodes[nodeId];
  if (!node) throw new Error(`Conversation graph has no node named "${nodeId}"`);
  const previous: NodeReview = node.review ?? { status: "pending" };
  const review: NodeReview = {
    status: input.status,
    ...(input.annotations ? { annotations: [...input.annotations] } : previous.annotations ? { annotations: [...previous.annotations] } : {}),
    originalTranscript: previous.originalTranscript ?? node.caller,
    ...(input.correctedTranscript !== undefined
      ? { correctedTranscript: input.correctedTranscript }
      : previous.correctedTranscript
        ? { correctedTranscript: previous.correctedTranscript }
        : {})
  };
  const nextNode: ConversationGraphNode = {
    ...node,
    review,
    ...(input.applyCorrectionToCaller && input.correctedTranscript ? { caller: input.correctedTranscript } : {})
  };
  return validateConversationGraph({
    ...graph,
    nodes: {
      ...graph.nodes,
      [nodeId]: nextNode
    }
  });
}

/**
 * Fork a new named path from a checkpoint node on an existing approved route.
 * Shared upstream nodes stay referenced; an optional continuation node is appended.
 */
export function forkPathFromNode(graph: ConversationGraph, input: ForkPathInput): ConversationGraph {
  if (input.newPathName in graph.paths) {
    throw new Error(`Conversation graph already has a path named "${input.newPathName}"`);
  }
  const source = graph.paths[input.sourcePath];
  if (!source) throw new Error(`Conversation graph has no path named "${input.sourcePath}"`);
  const checkpointIndex = source.route.indexOf(input.fromNodeId);
  if (checkpointIndex < 0) {
    throw new Error(`Path "${input.sourcePath}" does not contain checkpoint node "${input.fromNodeId}"`);
  }

  const sharedRoute = source.route.slice(0, checkpointIndex + 1);
  let nodes = { ...graph.nodes };
  let edges = [...graph.edges];
  const route = [...sharedRoute];

  if (input.continuation) {
    const continuationId = input.continuation.nodeId ?? `fork_${stableToken()}`;
    if (continuationId in nodes) throw new Error(`Conversation graph already has a node named "${continuationId}"`);
    nodes = {
      ...nodes,
      [continuationId]: {
        caller: input.continuation.caller,
        ...(input.continuation.expect ? { expect: input.continuation.expect } : {}),
        ...(input.continuation.fixtures ? { fixtures: input.continuation.fixtures } : {}),
        review: { status: "pending", originalTranscript: input.continuation.caller }
      }
    };
    edges = [
      ...edges,
      {
        from: input.fromNodeId,
        to: continuationId,
        label: input.edgeLabel ?? "fork continuation"
      }
    ];
    route.push(continuationId);
  }

  const paths = {
    ...graph.paths,
    [input.newPathName]: {
      route,
      ...(input.tags ? { tags: [...input.tags] } : source.tags ? { tags: [...source.tags] } : {}),
      ...(input.description
        ? { description: input.description }
        : { description: `Forked from ${input.sourcePath} at ${input.fromNodeId}` }),
      ...(source.expectedOutcome ? { expectedOutcome: source.expectedOutcome } : {})
    } satisfies ConversationGraphPath
  };

  return validateConversationGraph({
    ...graph,
    nodes,
    edges,
    paths
  });
}

/** Build a pending single-path draft graph from observed caller turns. */
export function draftGraphFromCallerTurns(input: DraftGraphFromTurnsInput): ConversationGraph {
  if (input.turns.length === 0) throw new Error("At least one caller turn is required to draft a graph");
  const nodes: Record<string, ConversationGraphNode> = {};
  const edges: ConversationGraph["edges"] = [];
  const route: string[] = [];
  input.turns.forEach((turn, index) => {
    const nodeId = `turn_${index + 1}`;
    nodes[nodeId] = {
      caller: turn.caller,
      review: { status: "pending", originalTranscript: turn.caller }
    };
    route.push(nodeId);
    if (index > 0) {
      edges.push({ from: route[index - 1], to: nodeId, label: `turn ${index + 1}` });
    }
  });
  const pathName = input.pathName ?? "recorded";
  return validateConversationGraph({
    version: 1,
    metadata: {
      name: input.name,
      channel: input.channel,
      agentId: input.agentId ?? "agt_local",
      numberId: input.numberId ?? "num_local",
      from: input.from ?? "+15559876543",
      to: input.to ?? "+15551234567",
      conversationState: null,
      contextLimit: input.contextLimit ?? 10,
      timeoutSeconds: input.timeoutSeconds ?? 30
    },
    nodes,
    edges,
    paths: {
      [pathName]: {
        route,
        tags: ["recorded"],
        description: "Draft path recorded from a local session"
      }
    },
    maxGeneratedCases: 24
  });
}

function stableToken(): string {
  return randomUUID().replace(/-/g, "").slice(0, 10);
}
