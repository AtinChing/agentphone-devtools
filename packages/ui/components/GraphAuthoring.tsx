"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, GitBranch, GitFork, Network, Plus, XCircle } from "lucide-react";
import type { GraphFamilySummary, LoadedGraphFamily, PathReviewSummary } from "@/lib/types";

const SERVER_URL = process.env.NEXT_PUBLIC_AGENTPHONE_DEVTOOLS_SERVER_URL ?? "http://127.0.0.1:4318";

interface GraphAuthoringProps {
  canRecordFromSession: boolean;
  onBusyChange?: (busy: boolean) => void;
}

export function useGraphAuthoring({ canRecordFromSession, onBusyChange }: GraphAuthoringProps) {
  const [families, setFamilies] = useState<GraphFamilySummary[]>([]);
  const [family, setFamily] = useState<LoadedGraphFamily | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forkName, setForkName] = useState("");
  const [forkCaller, setForkCaller] = useState("");
  const [correction, setCorrection] = useState("");

  async function refreshFamilies(preferredId?: string) {
    const response = await fetch(`${SERVER_URL}/api/graphs`);
    if (!response.ok) throw new Error("Could not load conversation graphs");
    const listed = (await response.json()) as GraphFamilySummary[];
    setFamilies(listed);
    const nextId = preferredId ?? family?.id ?? listed[0]?.id;
    if (nextId) await openFamily(nextId, listed);
    else {
      setFamily(null);
      setSelectedPath(null);
      setSelectedNodeId(null);
    }
  }

  async function openFamily(id: string, listed = families) {
    const response = await fetch(`${SERVER_URL}/api/graphs/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error("Graph family not found");
    const loaded = (await response.json()) as LoadedGraphFamily;
    setFamily(loaded);
    const summary = listed.find((item) => item.id === id) ?? {
      id: loaded.id,
      name: loaded.graph.metadata.name,
      channel: loaded.graph.metadata.channel,
      path: loaded.path,
      pathCount: loaded.paths.length,
      paths: loaded.paths
    };
    setFamilies((current) => {
      const without = current.filter((item) => item.id !== id);
      return [...without, { ...summary, paths: loaded.paths, pathCount: loaded.paths.length }].sort((left, right) =>
        left.name.localeCompare(right.name)
      );
    });
    const pathName = selectedPath && loaded.paths.some((path) => path.pathName === selectedPath)
      ? selectedPath
      : loaded.paths[0]?.pathName ?? null;
    setSelectedPath(pathName);
    const route = pathName ? loaded.graph.paths[pathName]?.route ?? [] : [];
    setSelectedNodeId((current) => (current && route.includes(current) ? current : route[0] ?? null));
  }

  useEffect(() => {
    void refreshFamilies().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const focusedPath: PathReviewSummary | null = useMemo(() => {
    if (!family || !selectedPath) return null;
    return family.paths.find((path) => path.pathName === selectedPath) ?? null;
  }, [family, selectedPath]);

  const focusedNodes = useMemo(() => {
    if (!family || !focusedPath) return [];
    return focusedPath.route.map((nodeId) => ({
      nodeId,
      node: family.graph.nodes[nodeId]
    }));
  }, [family, focusedPath]);

  useEffect(() => {
    if (!selectedNodeId || !family) {
      setCorrection("");
      return;
    }
    const node = family.graph.nodes[selectedNodeId];
    setCorrection(node?.review?.correctedTranscript ?? node?.caller ?? "");
  }, [family, selectedNodeId]);

  async function withBusy<T>(work: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function reviewSelected(status: "approved" | "rejected" | "pending") {
    if (!family || !selectedNodeId) return;
    await withBusy(async () => {
      const response = await fetch(
        `${SERVER_URL}/api/graphs/${encodeURIComponent(family.id)}/nodes/${encodeURIComponent(selectedNodeId)}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status,
            ...(correction.trim() && correction.trim() !== family.graph.nodes[selectedNodeId]?.caller
              ? { correctedTranscript: correction.trim() }
              : {})
          })
        }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error("error" in payload && payload.error ? payload.error : "Review failed");
      setFamily(payload as LoadedGraphFamily);
      setFamilies((current) =>
        current.map((item) =>
          item.id === family.id
            ? { ...item, paths: (payload as LoadedGraphFamily).paths, pathCount: (payload as LoadedGraphFamily).paths.length }
            : item
        )
      );
    });
  }

  async function forkFromSelected() {
    if (!family || !selectedPath || !selectedNodeId || !forkName.trim() || !forkCaller.trim()) return;
    await withBusy(async () => {
      const response = await fetch(`${SERVER_URL}/api/graphs/${encodeURIComponent(family.id)}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: selectedPath,
          fromNodeId: selectedNodeId,
          newPathName: forkName.trim(),
          edgeLabel: "fork continuation",
          continuation: { caller: forkCaller.trim() },
          tags: ["fork"]
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error("error" in payload && payload.error ? payload.error : "Fork failed");
      const loaded = payload as LoadedGraphFamily;
      setFamily(loaded);
      setSelectedPath(forkName.trim());
      setSelectedNodeId(loaded.graph.paths[forkName.trim()]?.route.at(-1) ?? selectedNodeId);
      setForkName("");
      setForkCaller("");
      setFamilies((current) =>
        current.map((item) => (item.id === family.id ? { ...item, paths: loaded.paths, pathCount: loaded.paths.length } : item))
      );
    });
  }

  async function recordFromSession() {
    if (!canRecordFromSession) return;
    await withBusy(async () => {
      const response = await fetch(`${SERVER_URL}/api/graphs/from-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const payload = await response.json();
      if (!response.ok) throw new Error("error" in payload && payload.error ? payload.error : "Could not record graph");
      const loaded = payload as LoadedGraphFamily;
      await refreshFamilies(loaded.id);
      setSelectedPath(loaded.paths[0]?.pathName ?? null);
      setSelectedNodeId(loaded.paths[0]?.route[0] ?? null);
    });
  }

  return {
    families,
    family,
    selectedPath,
    selectedNodeId,
    focusedPath,
    focusedNodes,
    error,
    busy,
    forkName,
    forkCaller,
    correction,
    setSelectedPath,
    setSelectedNodeId,
    setForkName,
    setForkCaller,
    setCorrection,
    openFamily,
    refreshFamilies,
    reviewSelected,
    forkFromSelected,
    recordFromSession
  };
}

export function GraphFamilyList(props: {
  families: GraphFamilySummary[];
  family: LoadedGraphFamily | null;
  selectedPath: string | null;
  busy: boolean;
  canRecordFromSession: boolean;
  onSelectFamily: (id: string) => void;
  onSelectPath: (pathName: string) => void;
  onRecordFromSession: () => void;
}) {
  return (
    <div className="space-y-3">
      <button
        onClick={props.onRecordFromSession}
        disabled={!props.canRecordFromSession || props.busy}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-line bg-white text-xs font-medium text-ink hover:border-slate-400 disabled:opacity-50"
      >
        <Plus size={14} />
        Record live session as graph
      </button>
      {props.families.length ? (
        props.families.map((item) => (
          <div key={item.id} className="rounded-md border border-line">
            <button
              onClick={() => props.onSelectFamily(item.id)}
              className={`w-full px-3 py-2 text-left ${props.family?.id === item.id ? "bg-emerald-50" : "bg-white hover:bg-mist"}`}
            >
              <span className="block text-sm font-medium text-ink">{item.name}</span>
              <span className="mt-1 block text-xs text-slate-500">
                {item.channel} · {item.pathCount} path{item.pathCount === 1 ? "" : "s"}
              </span>
            </button>
            {props.family?.id === item.id ? (
              <div className="border-t border-line bg-white px-2 py-2">
                {item.paths.map((path) => (
                  <button
                    key={path.pathName}
                    onClick={() => props.onSelectPath(path.pathName)}
                    className={`mb-1 flex w-full items-center justify-between rounded-md border px-2 py-2 text-left text-xs ${
                      props.selectedPath === path.pathName ? "border-fern bg-emerald-50" : "border-transparent hover:border-line"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{path.pathName}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {path.approvedCount}/{path.nodeCount} approved
                      </span>
                    </span>
                    <StatusPill status={path.status} />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))
      ) : (
        <div className="rounded-md border border-dashed border-line px-3 py-6 text-center text-xs text-slate-500">
          No graphs in examples/graphs yet
        </div>
      )}
    </div>
  );
}

export function FocusedPathTranscript(props: {
  family: LoadedGraphFamily | null;
  focusedPath: PathReviewSummary | null;
  focusedNodes: Array<{ nodeId: string; node: LoadedGraphFamily["graph"]["nodes"][string] }>;
  selectedNodeId: string | null;
  correction: string;
  forkName: string;
  forkCaller: string;
  busy: boolean;
  error: string | null;
  onSelectNode: (nodeId: string) => void;
  onCorrectionChange: (value: string) => void;
  onForkNameChange: (value: string) => void;
  onForkCallerChange: (value: string) => void;
  onReview: (status: "approved" | "rejected" | "pending") => void;
  onFork: () => void;
}) {
  if (!props.family || !props.focusedPath) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-sm text-slate-500">
        <div>
          <Network className="mx-auto mb-3 text-slate-400" size={28} />
          Select a named path to review shared turns, approve corrections, and fork alternatives.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-line bg-mist px-3 py-2">
        <div className="text-sm font-medium text-ink">{props.focusedPath.pathName}</div>
        <div className="mt-1 text-xs text-slate-500">
          {props.family.graph.metadata.name} · {props.focusedPath.approvedCount}/{props.focusedPath.nodeCount} approved
          {props.focusedPath.tags.length ? ` · ${props.focusedPath.tags.join(", ")}` : ""}
        </div>
      </div>

      {props.focusedNodes.map(({ nodeId, node }, index) => {
        const selected = props.selectedNodeId === nodeId;
        const status = node.review?.status ?? "pending";
        return (
          <button
            key={nodeId}
            onClick={() => props.onSelectNode(nodeId)}
            className={`w-full rounded-lg border px-4 py-3 text-left transition ${
              selected ? "border-fern bg-emerald-50" : "border-line bg-white hover:border-slate-400"
            }`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Node {index + 1} · {nodeId}
              </span>
              <StatusPill status={status} />
            </div>
            <div className="text-sm leading-6 text-ink">{node.caller}</div>
            {node.review?.correctedTranscript && node.review.correctedTranscript !== node.caller ? (
              <div className="mt-2 rounded-md border border-line bg-white px-3 py-2 text-xs text-slate-600">
                Corrected: {node.review.correctedTranscript}
              </div>
            ) : null}
          </button>
        );
      })}

      {props.selectedNodeId ? (
        <div className="rounded-lg border border-line bg-white p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Review selected node</div>
          <textarea
            value={props.correction}
            onChange={(event) => props.onCorrectionChange(event.target.value)}
            rows={3}
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-fern"
            placeholder="Corrected caller transcript"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => props.onReview("approved")}
              disabled={props.busy}
              className="inline-flex h-9 items-center gap-1 rounded-md bg-ink px-3 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              <CheckCircle2 size={14} />
              Approve
            </button>
            <button
              onClick={() => props.onReview("rejected")}
              disabled={props.busy}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-line bg-white px-3 text-xs font-medium text-danger hover:border-danger disabled:opacity-50"
            >
              <XCircle size={14} />
              Mark incorrect
            </button>
            <button
              onClick={() => props.onReview("pending")}
              disabled={props.busy}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-line bg-white px-3 text-xs font-medium text-slate-600 hover:border-slate-400 disabled:opacity-50"
            >
              Reset pending
            </button>
          </div>

          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              <GitFork size={14} />
              Fork from here
            </div>
            <div className="grid gap-2">
              <input
                value={props.forkName}
                onChange={(event) => props.onForkNameChange(event.target.value)}
                className="h-9 rounded-md border border-line px-3 text-sm outline-none focus:border-fern"
                placeholder="new_path_name"
              />
              <input
                value={props.forkCaller}
                onChange={(event) => props.onForkCallerChange(event.target.value)}
                className="h-9 rounded-md border border-line px-3 text-sm outline-none focus:border-fern"
                placeholder="Continuation caller text"
              />
              <button
                onClick={props.onFork}
                disabled={props.busy || !props.forkName.trim() || !props.forkCaller.trim()}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-white text-xs font-medium text-ink hover:border-slate-400 disabled:opacity-50"
              >
                <GitBranch size={14} />
                Create forked path
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {props.error ? <div className="text-xs text-danger">{props.error}</div> : null}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "approved"
      ? "bg-emerald-50 text-fern"
      : status === "rejected"
        ? "bg-red-50 text-danger"
        : status === "mixed"
          ? "bg-amber-50 text-caution"
          : "bg-mist text-slate-600";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}>{status}</span>;
}
