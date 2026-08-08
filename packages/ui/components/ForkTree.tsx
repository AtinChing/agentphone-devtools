"use client";

import { useMemo } from "react";
import type { InspectorSessionSummary } from "@/lib/types";

interface TreeRow {
  run: InspectorSessionSummary;
  depth: number;
  row: number;
  parent?: TreeRow;
  forkTurn?: number;
}

const ROW_HEIGHT = 34;
const INDENT = 18;
const LEFT_PAD = 14;
const DOT_RADIUS = 5;

// Status colors follow the reserved status palette. Green vs red alone fails
// CVD separation (validated: deutan dE 4.1), so state is double-encoded:
// passed = filled dot, failed = dot with a cross, no scenario = hollow dot.
const COLOR = {
  passed: "#0ca30c",
  failed: "#d03b3b",
  none: "#a8a69e",
  ink: "#0b0b0b",
  edge: "#c3c2b7",
  label: "#52514e",
  muted: "#898781",
  live: "#077a10",
  wash: "#edf7ea"
};

/**
 * Git-graph-style lineage view: every run is a node, forks hang off their
 * source run with the fork turn on the elbow. Rows are clickable and mirror
 * the Runs list (which remains the accessible table view of the same data).
 */
export function ForkTree({
  runs,
  liveSessionId,
  viewingSessionId,
  onOpen
}: {
  runs: InspectorSessionSummary[];
  liveSessionId: string | null;
  viewingSessionId: string | null;
  onOpen: (run: InspectorSessionSummary) => void;
}) {
  const rows = useMemo(() => layoutForest(runs), [runs]);
  const hasForks = rows.some((row) => row.parent);
  const height = rows.length * ROW_HEIGHT + 6;

  if (!rows.length) {
    return <div className="grid min-h-[160px] place-items-center text-sm text-slate-400">No runs yet</div>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-2 text-[10px] text-slate-500">
        <LegendDot kind="passed" label="passed" />
        <LegendDot kind="failed" label="failed" />
        <LegendDot kind="none" label="no scenario" />
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full border-2" style={{ borderColor: COLOR.live }} />
          live
        </span>
      </div>
      {!hasForks ? (
        <div className="px-1 pb-2 text-xs text-slate-400">No forks yet — use the branch button on any transcript turn.</div>
      ) : null}
      <svg width="100%" height={height} role="list" aria-label="Run lineage tree">
        {rows.map((row) => {
          if (!row.parent) return null;
          const parentX = LEFT_PAD + row.parent.depth * INDENT;
          const x = LEFT_PAD + row.depth * INDENT;
          const parentY = row.parent.row * ROW_HEIGHT + ROW_HEIGHT / 2;
          const y = row.row * ROW_HEIGHT + ROW_HEIGHT / 2;
          return (
            <g key={`edge-${row.run.id}`}>
              <path
                d={`M ${parentX} ${parentY + DOT_RADIUS + 2} L ${parentX} ${y - 9} Q ${parentX} ${y} ${parentX + 9} ${y} L ${x - DOT_RADIUS - 2} ${y}`}
                fill="none"
                stroke={COLOR.edge}
                strokeWidth={1.5}
              />
              {row.forkTurn !== undefined ? (
                <text x={parentX + 4} y={y - 5} fontSize={9} fill={COLOR.muted} className="data">
                  t{row.forkTurn}
                </text>
              ) : null}
            </g>
          );
        })}
        {rows.map((row) => {
          const x = LEFT_PAD + row.depth * INDENT;
          const y = row.row * ROW_HEIGHT + ROW_HEIGHT / 2;
          const live = row.run.id === liveSessionId;
          const selected = row.run.id === (viewingSessionId ?? liveSessionId);
          const status = row.run.scenarioPassed === undefined ? "none" : row.run.scenarioPassed ? "passed" : "failed";
          const dotColor = COLOR[status];
          const detail = [
            `${row.run.channel}, ${row.run.transcriptTurns} turns, ${row.run.deliveries} deliveries`,
            status === "none" ? row.run.status : `scenario ${status}`,
            row.forkTurn !== undefined ? `forked after turn ${row.forkTurn}` : null,
            row.run.baselineName ? `baseline: ${row.run.baselineName}` : null
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <g
              key={row.run.id}
              onClick={() => onOpen(row.run)}
              role="listitem"
              aria-label={`${formatTime(row.run.startedAt)} — ${detail}`}
              className="cursor-pointer"
            >
              <title>{detail}</title>
              <rect
                x={2}
                y={row.row * ROW_HEIGHT + 2}
                width="100%"
                height={ROW_HEIGHT - 4}
                rx={6}
                fill={selected ? COLOR.wash : "transparent"}
                className="hover:fill-[#f4f3ef]"
              />
              {live ? <circle cx={x} cy={y} r={DOT_RADIUS + 3.5} fill="none" stroke={COLOR.live} strokeWidth={1.5} /> : null}
              {status === "none" ? (
                <circle cx={x} cy={y} r={DOT_RADIUS} fill="#fcfcfb" stroke={dotColor} strokeWidth={2} />
              ) : (
                <circle cx={x} cy={y} r={DOT_RADIUS} fill={dotColor} />
              )}
              {status === "failed" ? (
                <path
                  d={`M ${x - 2.4} ${y - 2.4} L ${x + 2.4} ${y + 2.4} M ${x + 2.4} ${y - 2.4} L ${x - 2.4} ${y + 2.4}`}
                  stroke="#fcfcfb"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                />
              ) : null}
              <text x={x + 13} y={y - 1} fontSize={11} fill={selected ? COLOR.ink : COLOR.label} className="data">
                {formatTime(row.run.startedAt)}
                {live ? "  · live" : ""}
              </text>
              <text x={x + 13} y={y + 11} fontSize={9.5} fill={COLOR.muted} className="data">
                {row.run.transcriptTurns}t · {row.run.deliveries}d{row.run.baselineName ? " · baseline" : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function LegendDot({ kind, label }: { kind: "passed" | "failed" | "none"; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <svg width={10} height={10} aria-hidden="true">
        {kind === "none" ? (
          <circle cx={5} cy={5} r={3.4} fill="#fcfcfb" stroke={COLOR.none} strokeWidth={1.8} />
        ) : (
          <circle cx={5} cy={5} r={4} fill={COLOR[kind]} />
        )}
        {kind === "failed" ? (
          <path d="M 3.2 3.2 L 6.8 6.8 M 6.8 3.2 L 3.2 6.8" stroke="#fcfcfb" strokeWidth={1.3} strokeLinecap="round" />
        ) : null}
      </svg>
      {label}
    </span>
  );
}

/**
 * Depth-first forest layout, git-log style: one row per run, indent = fork
 * depth. Roots newest-first; a run whose fork source was deleted renders as
 * a root.
 */
function layoutForest(runs: InspectorSessionSummary[]): TreeRow[] {
  const byId = new Map(runs.map((run) => [run.id, run]));
  const children = new Map<string, InspectorSessionSummary[]>();
  const roots: InspectorSessionSummary[] = [];

  for (const run of runs) {
    const parentId = run.forkedFrom?.sessionId;
    if (parentId && byId.has(parentId) && parentId !== run.id) {
      const siblings = children.get(parentId) ?? [];
      siblings.push(run);
      children.set(parentId, siblings);
    } else {
      roots.push(run);
    }
  }
  roots.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const siblings of children.values()) siblings.sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const rows: TreeRow[] = [];
  const visited = new Set<string>();
  const visit = (run: InspectorSessionSummary, depth: number, parent?: TreeRow) => {
    if (visited.has(run.id)) return;
    visited.add(run.id);
    const row: TreeRow = { run, depth, row: rows.length, parent, forkTurn: parent ? run.forkedFrom?.turnIndex : undefined };
    rows.push(row);
    for (const child of children.get(run.id) ?? []) visit(child, depth + 1, row);
  };
  for (const root of roots) visit(root, 0);
  return rows;
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(timestamp)
  );
}
