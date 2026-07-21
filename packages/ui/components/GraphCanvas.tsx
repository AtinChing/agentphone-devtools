"use client";

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GraphCoverageReport, LoadedGraphFamily } from "@/lib/types";
import { edgeKey, layoutConversationGraph, NODE_HEIGHT, NODE_WIDTH, type SemanticZoom } from "@/lib/graph-layout";

interface GraphCanvasProps {
  family: LoadedGraphFamily;
  coverage: GraphCoverageReport | null;
  selectedPath: string | null;
  selectedNodeId: string | null;
  coverageFilter: CoverageFilterOption;
  onCoverageFilterChange: (filter: CoverageFilterOption) => void;
  onSelectNode: (nodeId: string) => void;
  onSelectPath: (pathName: string) => void;
}

export type CoverageFilterOption =
  | "all"
  | "approved_paths"
  | "pending_paths"
  | "uncovered_edges"
  | "pairwise_gaps"
  | "cap_omitted"
  | "unsupported";

const ZOOM_LABELS: Record<SemanticZoom, string> = {
  overview: "Overview",
  structure: "Structure",
  detail: "Detail"
};

export function GraphCanvas(props: GraphCanvasProps) {
  const [zoom, setZoom] = useState<SemanticZoom>("structure");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const focusedRoute = useMemo(() => {
    if (!props.selectedPath) return new Set<string>();
    return new Set(props.family.graph.paths[props.selectedPath]?.route ?? []);
  }, [props.family, props.selectedPath]);

  const focusedEdgeKeys = useMemo(() => {
    const keys = new Set<string>();
    const route = props.selectedPath ? props.family.graph.paths[props.selectedPath]?.route ?? [] : [];
    for (let index = 1; index < route.length; index += 1) {
      keys.add(edgeKey(route[index - 1], route[index]));
    }
    return keys;
  }, [props.family, props.selectedPath]);

  const coveredEdgeKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const edge of props.coverage?.edges ?? []) {
      if (edge.covered) keys.add(edgeKey(edge.from, edge.to));
    }
    return keys;
  }, [props.coverage]);

  const highlightedPathNames = useMemo(() => {
    if (!props.coverage) return new Set(Object.keys(props.family.graph.paths));
    return new Set(filterPathNames(props.coverage, props.coverageFilter));
  }, [props.coverage, props.coverageFilter, props.family.graph.paths]);

  const layout = useMemo(
    () => layoutConversationGraph(props.family, coveredEdgeKeys),
    [props.family, coveredEdgeKeys]
  );

  const scale = zoom === "overview" ? 0.55 : zoom === "structure" ? 0.85 : 1.15;
  const viewportWidth = 640;
  const viewportHeight = 420;
  const minimapScale = Math.min(180 / layout.width, 120 / layout.height);

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.panX + (event.clientX - dragRef.current.x),
      y: dragRef.current.panY + (event.clientY - dragRef.current.y)
    });
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-line bg-white p-1">
          {(Object.keys(ZOOM_LABELS) as SemanticZoom[]).map((level) => (
            <button
              key={level}
              onClick={() => setZoom(level)}
              className={`rounded px-2 py-1 text-[11px] font-medium ${
                zoom === level ? "bg-ink text-white" : "text-slate-600 hover:bg-mist"
              }`}
            >
              {ZOOM_LABELS[level]}
            </button>
          ))}
        </div>
        <select
          value={props.coverageFilter}
          onChange={(event) => props.onCoverageFilterChange(event.target.value as CoverageFilterOption)}
          className="h-8 rounded-md border border-line bg-white px-2 text-[11px] text-ink outline-none focus:border-fern"
          aria-label="Coverage filter"
        >
          <option value="all">All coverage</option>
          <option value="approved_paths">Approved paths</option>
          <option value="pending_paths">Pending paths</option>
          <option value="uncovered_edges">Uncovered edges</option>
          <option value="pairwise_gaps">Pairwise gaps</option>
          <option value="cap_omitted">Cap omitted</option>
          <option value="unsupported">Unsupported fixtures</option>
        </select>
        {props.coverage ? (
          <div className="text-[11px] text-slate-500">
            {props.coverage.approvedPathCount}/{props.coverage.paths.length} paths · {props.coverage.coveredEdgeCount}/
            {props.coverage.edges.length} edges · {props.coverage.coveredPairCount}/{props.coverage.pairwise.length} pairs
          </div>
        ) : null}
      </div>

      <div className="relative overflow-hidden rounded-lg border border-line bg-[#f8fafc]">
        <svg
          width="100%"
          height={viewportHeight}
          viewBox={`0 0 ${viewportWidth} ${viewportHeight}`}
          className="cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <g transform={`translate(${pan.x + 24}, ${pan.y + 24}) scale(${scale})`}>
            {layout.edges.map((edge) => {
              const onFocusedPath = focusedEdgeKeys.has(edgeKey(edge.from, edge.to));
              const dimmed =
                props.selectedPath !== null && !onFocusedPath
                  ? true
                  : props.coverageFilter === "uncovered_edges"
                    ? edge.covered
                    : false;
              return (
                <g key={edge.id} opacity={dimmed ? 0.25 : 1}>
                  <line
                    x1={edge.points.x1}
                    y1={edge.points.y1}
                    x2={edge.points.x2}
                    y2={edge.points.y2}
                    stroke={edge.covered ? "#1f7a4d" : onFocusedPath ? "#0f172a" : "#94a3b8"}
                    strokeWidth={onFocusedPath ? 2.5 : 1.5}
                    markerEnd="url(#arrow)"
                  />
                  {zoom !== "overview" ? (
                    <text
                      x={(edge.points.x1 + edge.points.x2) / 2}
                      y={(edge.points.y1 + edge.points.y2) / 2 - 6}
                      textAnchor="middle"
                      className="fill-slate-500"
                      fontSize={10}
                    >
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {layout.nodes.map((node) => {
              const onPath = focusedRoute.size === 0 || focusedRoute.has(node.id);
              const selected = props.selectedNodeId === node.id;
              const fill =
                node.reviewStatus === "approved"
                  ? "#ecfdf5"
                  : node.reviewStatus === "rejected"
                    ? "#fef2f2"
                    : "#ffffff";
              const stroke = selected ? "#1f7a4d" : onPath ? "#0f172a" : "#cbd5e1";
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  opacity={onPath ? 1 : 0.28}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onSelectNode(node.id);
                    const owningPath =
                      props.selectedPath && focusedRoute.has(node.id)
                        ? props.selectedPath
                        : Object.entries(props.family.graph.paths).find(([, path]) => path.route.includes(node.id))?.[0];
                    if (owningPath) props.onSelectPath(owningPath);
                  }}
                  className="cursor-pointer"
                >
                  <rect
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={10}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={selected ? 2.5 : 1.5}
                  />
                  <text x={12} y={22} className="fill-slate-500" fontSize={10}>
                    {zoom === "overview" ? node.reviewStatus : node.label}
                  </text>
                  {zoom === "overview" ? (
                    <text x={12} y={40} className="fill-ink" fontSize={11} fontWeight={600}>
                      {truncate(node.label, 16)}
                    </text>
                  ) : (
                    <text x={12} y={40} className="fill-ink" fontSize={11}>
                      {truncate(node.excerpt, zoom === "detail" ? 28 : 20)}
                    </text>
                  )}
                  {zoom === "detail" && node.reviewStatus !== "pending" ? (
                    <text x={12} y={52} className="fill-slate-500" fontSize={9}>
                      {node.reviewStatus}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8" />
            </marker>
          </defs>
        </svg>

        <div className="absolute bottom-3 right-3 overflow-hidden rounded-md border border-line bg-white/95 shadow-soft">
          <svg width={180} height={120} viewBox={`0 0 ${layout.width} ${layout.height}`}>
            <rect width={layout.width} height={layout.height} fill="#f8fafc" />
            {layout.edges.map((edge) => (
              <line
                key={edge.id}
                x1={edge.points.x1}
                y1={edge.points.y1}
                x2={edge.points.x2}
                y2={edge.points.y2}
                stroke={edge.covered ? "#1f7a4d" : "#cbd5e1"}
                strokeWidth={2 / Math.max(minimapScale, 0.01)}
              />
            ))}
            {layout.nodes.map((node) => (
              <rect
                key={node.id}
                x={node.x}
                y={node.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={8}
                fill={focusedRoute.has(node.id) || focusedRoute.size === 0 ? "#d1fae5" : "#e2e8f0"}
                stroke="#94a3b8"
                strokeWidth={1 / Math.max(minimapScale, 0.01)}
              />
            ))}
            <rect
              x={Math.max(0, (-pan.x - 24) / scale)}
              y={Math.max(0, (-pan.y - 24) / scale)}
              width={viewportWidth / scale}
              height={viewportHeight / scale}
              fill="rgba(15, 23, 42, 0.08)"
              stroke="#0f172a"
              strokeWidth={2 / Math.max(minimapScale, 0.01)}
            />
          </svg>
        </div>
      </div>

      {props.coverage ? (
        <div className="grid gap-2 md:grid-cols-3">
          <CoverageCard
            title="Paths"
            body={`${props.coverage.approvedPathCount} approved · ${props.coverage.pendingPathCount} pending`}
            items={props.coverage.paths.map((path) => `${path.pathName}: ${path.status}`)}
            active={highlightedPathNames}
          />
          <CoverageCard
            title="Edges"
            body={`${props.coverage.coveredEdgeCount}/${props.coverage.edges.length} covered`}
            items={props.coverage.edges.map((edge) => `${edge.label}: ${edge.covered ? "covered" : "gap"}`)}
          />
          <CoverageCard
            title="Pairwise / fixtures"
            body={
              props.coverage.pairwise.length
                ? `${props.coverage.coveredPairCount}/${props.coverage.pairwise.length} pairs · ${props.coverage.unsupported.length} fixture notes`
                : `${props.coverage.unsupported.length} fixture notes`
            }
            items={[
              ...props.coverage.pairwise.map((pair) => `${pair.left} × ${pair.right}: ${pair.covered ? "ok" : "gap"}`),
              ...props.coverage.unsupported.map((item) => `${item.kind} @ ${item.location} (${item.support})`),
              ...props.coverage.cap.omitted.map((item) => `omitted ${item.pathName}`)
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

function CoverageCard(props: { title: string; body: string; items: string[]; active?: Set<string> }) {
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{props.title}</div>
      <div className="mt-1 text-xs text-ink">{props.body}</div>
      <div className="mt-2 max-h-24 space-y-1 overflow-auto text-[11px] text-slate-500">
        {props.items.length ? (
          props.items.map((item) => {
            const pathName = item.split(":")[0];
            const muted = props.active && !props.active.has(pathName);
            return (
              <div key={item} className={muted ? "opacity-40" : undefined}>
                {item}
              </div>
            );
          })
        ) : (
          <div>None</div>
        )}
      </div>
    </div>
  );
}

function filterPathNames(coverage: GraphCoverageReport, filter: CoverageFilterOption): string[] {
  switch (filter) {
    case "approved_paths":
      return coverage.paths.filter((path) => path.status === "approved").map((path) => path.pathName);
    case "pending_paths":
      return coverage.paths.filter((path) => path.status !== "approved").map((path) => path.pathName);
    case "uncovered_edges":
      return [
        ...new Set(
          coverage.edges
            .filter((edge) => !edge.covered)
            .flatMap((edge) =>
              coverage.paths
                .filter((path) => path.route.includes(edge.from) && path.route.includes(edge.to))
                .map((path) => path.pathName)
            )
        )
      ];
    case "pairwise_gaps":
      return coverage.pairwise.some((pair) => !pair.covered) ? [...coverage.selectedPathNames] : [];
    case "cap_omitted":
      return [...new Set(coverage.cap.omitted.map((item) => item.pathName))];
    case "unsupported":
      return coverage.unsupported.length ? coverage.paths.map((path) => path.pathName) : [];
    case "all":
    default:
      return coverage.paths.map((path) => path.pathName);
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
