import type { LoadedGraphFamily } from "@/lib/types";

export type SemanticZoom = "overview" | "structure" | "detail";

export interface GraphLayoutNode {
  id: string;
  x: number;
  y: number;
  label: string;
  excerpt: string;
  reviewStatus: "pending" | "approved" | "rejected";
  depth: number;
}

export interface GraphLayoutEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  covered: boolean;
  points: { x1: number; y1: number; x2: number; y2: number };
}

export interface GraphLayout {
  width: number;
  height: number;
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
}

const NODE_WIDTH = 160;
const NODE_HEIGHT = 56;
const H_GAP = 48;
const V_GAP = 72;

/** Deterministic layered layout from roots using longest-path depth. */
export function layoutConversationGraph(
  family: LoadedGraphFamily,
  coveredEdgeKeys: Set<string> = new Set()
): GraphLayout {
  const graph = family.graph;
  const nodeIds = Object.keys(graph.nodes);
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const id of nodeIds) {
    incoming.set(id, []);
    outgoing.set(id, []);
  }
  for (const edge of graph.edges) {
    incoming.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const depth = new Map<string, number>();
  const roots = nodeIds.filter((id) => (incoming.get(id) ?? []).length === 0);
  const queue = roots.length ? [...roots] : [...nodeIds];
  for (const id of queue) depth.set(id, 0);
  while (queue.length) {
    const current = queue.shift()!;
    const nextDepth = (depth.get(current) ?? 0) + 1;
    for (const child of outgoing.get(current) ?? []) {
      if (!depth.has(child) || (depth.get(child) ?? 0) < nextDepth) {
        depth.set(child, nextDepth);
        queue.push(child);
      }
    }
  }
  for (const id of nodeIds) if (!depth.has(id)) depth.set(id, 0);

  const layers = new Map<number, string[]>();
  for (const id of nodeIds) {
    const layer = depth.get(id) ?? 0;
    const bucket = layers.get(layer) ?? [];
    bucket.push(id);
    layers.set(layer, bucket);
  }
  for (const bucket of layers.values()) bucket.sort((left, right) => left.localeCompare(right));

  const maxLayer = Math.max(0, ...layers.keys());
  const maxWidth = Math.max(1, ...[...layers.values()].map((bucket) => bucket.length));
  const width = Math.max(320, maxWidth * (NODE_WIDTH + H_GAP) + H_GAP);
  const height = Math.max(220, (maxLayer + 1) * (NODE_HEIGHT + V_GAP) + V_GAP);

  const positions = new Map<string, { x: number; y: number }>();
  for (let layer = 0; layer <= maxLayer; layer += 1) {
    const bucket = layers.get(layer) ?? [];
    const rowWidth = bucket.length * NODE_WIDTH + Math.max(0, bucket.length - 1) * H_GAP;
    const startX = (width - rowWidth) / 2;
    bucket.forEach((id, index) => {
      positions.set(id, {
        x: startX + index * (NODE_WIDTH + H_GAP),
        y: V_GAP / 2 + layer * (NODE_HEIGHT + V_GAP)
      });
    });
  }

  const nodes: GraphLayoutNode[] = nodeIds.map((id) => {
    const position = positions.get(id) ?? { x: H_GAP, y: V_GAP };
    const node = graph.nodes[id];
    return {
      id,
      x: position.x,
      y: position.y,
      label: id,
      excerpt: node.caller,
      reviewStatus: node.review?.status ?? "pending",
      depth: depth.get(id) ?? 0
    };
  });

  const edges: GraphLayoutEdge[] = graph.edges.map((edge) => {
    const from = positions.get(edge.from) ?? { x: 0, y: 0 };
    const to = positions.get(edge.to) ?? { x: 0, y: 0 };
    return {
      id: `${edge.from}->${edge.to}`,
      from: edge.from,
      to: edge.to,
      label: edge.label,
      covered: coveredEdgeKeys.has(`${edge.from}\u0000${edge.to}`),
      points: {
        x1: from.x + NODE_WIDTH / 2,
        y1: from.y + NODE_HEIGHT,
        x2: to.x + NODE_WIDTH / 2,
        y2: to.y
      }
    };
  });

  return { width, height, nodes, edges };
}

export function edgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

export { NODE_WIDTH, NODE_HEIGHT };
