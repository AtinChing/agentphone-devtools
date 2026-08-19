"use client";

import { useMemo } from "react";
import { GitBranch } from "lucide-react";
import type { InspectorSession } from "@/lib/types";

/**
 * One node = one completed caller turn: a frozen conversation checkpoint.
 * Forked runs share their inherited prefix, so a family of runs collapses
 * into a single tree — trunk plus branches at each fork point. The canvas is
 * the workbench: selecting a node inspects that state, and forking happens
 * from the node itself.
 */
export interface TurnNode {
  /** Stable key: owning run id + caller-turn ordinal. */
  key: string;
  /** Run that actually sent this turn (owns its delivery + labels). */
  runId: string;
  /** 1-based caller-turn ordinal within the full path. */
  turnNumber: number;
  caller: string;
  agentReply?: string;
  actions: string[];
  latencyMs?: number;
  failed: boolean;
  label?: { verdict?: "good" | "bad"; note?: string };
  /** Runs whose path passes through this node (prefix sharing). */
  runIds: string[];
  children: TurnNode[];
  /** Present when this node begins a forked branch. */
  forkOf?: { sessionId: string; turnIndex: number };
}

interface PlacedNode {
  node: TurnNode;
  x: number;
  y: number;
  parent?: PlacedNode;
}

export const NODE_W = 208;
export const NODE_H = 74;
const COL_GAP = 56;
const ROW_GAP = 18;
const PAD = 28;

const INK = "#f0efe9";
const MUTED = "#8a8981";
const EDGE = "#4a4945";
const GOOD = "#0ca30c";
const BAD = "#d03b3b";
const LIVE = "#5abc6e";
const FORK = "#a78bfa";

export function buildTurnForest(sessions: InspectorSession[]): TurnNode[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const nodeIndex = new Map<string, TurnNode[]>(); // runId -> its path of nodes (inherited included)
  const roots: TurnNode[] = [];

  const pathFor = (session: InspectorSession): TurnNode[] => {
    const cached = nodeIndex.get(session.id);
    if (cached) return cached;

    const turns = callerTurns(session);
    let path: TurnNode[] = [];
    let attach: TurnNode[] = roots;
    let start = 0;

    const source = session.forkedFrom ? byId.get(session.forkedFrom.sessionId) : undefined;
    if (session.forkedFrom && source) {
      const sourcePath = pathFor(source);
      const shared = Math.min(session.forkedFrom.turnIndex, sourcePath.length, turns.length);
      path = sourcePath.slice(0, shared);
      for (const node of path) if (!node.runIds.includes(session.id)) node.runIds.push(session.id);
      attach = shared > 0 ? path[shared - 1].children : roots;
      start = shared;
    }

    for (let index = start; index < turns.length; index += 1) {
      const turn = turns[index];
      const node: TurnNode = {
        key: `${session.id}:${index + 1}`,
        runId: session.id,
        turnNumber: index + 1,
        caller: turn.caller,
        agentReply: turn.agentReply,
        actions: turn.actions,
        latencyMs: turn.latencyMs,
        failed: turn.failed,
        label: session.turnLabels?.find((label) => label.turnIndex === index),
        runIds: [session.id],
        children: [],
        ...(index === start && session.forkedFrom ? { forkOf: session.forkedFrom } : {})
      };
      attach.push(node);
      path = [...path, node];
      attach = node.children;
    }

    nodeIndex.set(session.id, path);
    return path;
  };

  // Parents before children so prefixes exist to merge into.
  for (const session of [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) pathFor(session);
  return roots;
}

function callerTurns(session: InspectorSession) {
  const deliveries = session.deliveries.filter((delivery) => delivery.event === "agent.message" && !delivery.replayOf);
  const turns: Array<{ caller: string; agentReply?: string; actions: string[]; latencyMs?: number; failed: boolean }> = [];
  for (let index = 0; index < session.transcript.length; index += 1) {
    const turn = session.transcript[index];
    if (turn.role !== "user") continue;
    const next = session.transcript[index + 1];
    const delivery = deliveries[turns.length];
    turns.push({
      caller: turn.content,
      agentReply: next?.role === "agent" ? next.content : undefined,
      actions: delivery ? observedActions(delivery.response.parsed.chunks) : [],
      latencyMs: delivery?.latencyMs,
      failed: delivery ? delivery.timedOut || !delivery.ok : false
    });
  }
  return turns;
}

function observedActions(chunks: Array<Record<string, unknown>>): string[] {
  const actions = new Set<string>();
  for (const chunk of chunks) {
    for (const field of ["action", "digits", "press_digit", "dtmf"]) {
      const value = chunk[field];
      if (typeof value === "string" && value) actions.add(value);
    }
    if (typeof chunk.transferNumber === "string") actions.add("transfer");
    if (chunk.hangup === true) actions.add("hangup");
  }
  return [...actions];
}

/** Tidy layout: x = depth, y = center of subtree rows. Returns placed nodes + total size. */
function layout(roots: TurnNode[]): { placed: PlacedNode[]; width: number; height: number } {
  const placed: PlacedNode[] = [];
  let nextRow = 0;
  let maxDepth = 0;

  const visit = (node: TurnNode, depth: number, parent?: PlacedNode): PlacedNode => {
    maxDepth = Math.max(maxDepth, depth);
    const entry: PlacedNode = { node, x: PAD + depth * (NODE_W + COL_GAP), y: 0, parent };
    placed.push(entry);
    if (!node.children.length) {
      entry.y = PAD + nextRow * (NODE_H + ROW_GAP);
      nextRow += 1;
    } else {
      const childEntries = node.children.map((child) => visit(child, depth + 1, entry));
      entry.y = (childEntries[0].y + childEntries[childEntries.length - 1].y) / 2;
    }
    return entry;
  };

  for (const root of roots) visit(root, 0);
  return {
    placed,
    width: PAD * 2 + (maxDepth + 1) * NODE_W + maxDepth * COL_GAP,
    height: PAD * 2 + Math.max(nextRow, 1) * (NODE_H + ROW_GAP) - ROW_GAP
  };
}

export function flattenForest(roots: TurnNode[]): TurnNode[] {
  const all: TurnNode[] = [];
  const visit = (node: TurnNode) => {
    all.push(node);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return all;
}

export function ConversationTree({
  roots,
  liveSessionId,
  selectedKey,
  onSelect
}: {
  roots: TurnNode[];
  liveSessionId: string | null;
  selectedKey: string | null;
  onSelect: (node: TurnNode) => void;
}) {
  const { placed, width, height } = useMemo(() => layout(roots), [roots]);

  if (!placed.length) {
    return (
      <div className="grid h-full min-h-[300px] place-items-center px-8 text-center text-sm text-slate-400">
        Send a caller turn and the conversation will grow here, one checkpoint per turn.
      </div>
    );
  }

  return (
    <div className="tree-canvas h-full overflow-auto">
      <svg width={Math.max(width, 640)} height={Math.max(height, 320)} className="block">
        {placed.map((entry) =>
          entry.parent ? (
            <g key={`e-${entry.node.key}`}>
              <path
                d={curve(entry.parent.x + NODE_W, entry.parent.y + NODE_H / 2, entry.x, entry.y + NODE_H / 2)}
                fill="none"
                stroke={entry.node.forkOf ? FORK : EDGE}
                strokeWidth={entry.node.forkOf ? 1.8 : 1.5}
                strokeDasharray={entry.node.forkOf ? "5 4" : undefined}
              />
              {entry.node.forkOf ? (
                <text
                  x={(entry.parent.x + NODE_W + entry.x) / 2}
                  y={(entry.parent.y + entry.y + NODE_H) / 2 - 6}
                  fontSize={9.5}
                  fill={FORK}
                  textAnchor="middle"
                  className="data"
                >
                  fork
                </text>
              ) : null}
            </g>
          ) : null
        )}
        {placed.map((entry) => {
          const node = entry.node;
          const live = liveSessionId !== null && node.runIds.includes(liveSessionId);
          const selected = node.key === selectedKey;
          const leafOfLive = live && !node.children.some((child) => child.runIds.includes(liveSessionId));
          return (
            <g key={node.key} transform={`translate(${entry.x}, ${entry.y})`} onClick={() => onSelect(node)} className="cursor-pointer" role="button" aria-label={`Turn ${node.turnNumber}: ${node.caller}`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={10}
                fill="#202020"
                stroke={selected ? INK : node.failed ? BAD : "#383834"}
                strokeWidth={selected ? 2 : 1.2}
              />
              {leafOfLive ? (
                <rect x={-4} y={-4} width={NODE_W + 8} height={NODE_H + 8} rx={13} fill="none" stroke={LIVE} strokeWidth={1.6} strokeDasharray="4 3" />
              ) : null}
              <text x={12} y={17} fontSize={9.5} fill={MUTED} className="data">
                t{node.turnNumber}
                {node.latencyMs !== undefined ? ` · ${node.latencyMs}ms` : ""}
                {live ? " · live" : ""}
              </text>
              {node.label?.verdict ? (
                <circle cx={NODE_W - 14} cy={13} r={4} fill={node.label.verdict === "good" ? GOOD : BAD} />
              ) : null}
              {node.label?.verdict === "bad" ? (
                <path d={`M ${NODE_W - 16} 11 L ${NODE_W - 12} 15 M ${NODE_W - 12} 11 L ${NODE_W - 16} 15`} stroke="#fff" strokeWidth={1.1} strokeLinecap="round" />
              ) : null}
              <text x={12} y={33} fontSize={11.5} fill={INK} fontWeight={500}>
                {truncate(node.caller, 30)}
              </text>
              <text x={12} y={49} fontSize={10.5} fill="#9c9b93">
                {node.agentReply ? truncate(node.agentReply, 32) : "…"}
              </text>
              {node.actions.length ? (
                <text x={12} y={64} fontSize={9.5} fill={node.actions.includes("hangup") ? "#5abc6e" : FORK} className="data">
                  {truncate(node.actions.join(", "), 32)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2 - 6} ${y2}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function TreeLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded border border-line bg-panel" /> checkpoint
      </span>
      <span className="flex items-center gap-1.5 text-indigo-400">
        <GitBranch size={11} /> fork
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-0 w-5 border-t-2 border-dashed" style={{ borderColor: "#5abc6e" }} /> live path
      </span>
    </div>
  );
}
