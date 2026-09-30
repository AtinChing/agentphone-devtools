"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { InspectorSession, InspectorSessionSummary } from "@/lib/types";

interface CacheEntry {
  version: string;
  session: InspectorSession | null;
}

function versionOf(id: string, runs: InspectorSessionSummary[]): string {
  const run = runs.find((candidate) => candidate.id === id);
  if (!run) return "?";
  return [run.transcriptTurns, run.deliveries, run.status, run.lastActivityAt ?? "", run.scenarioPassed ?? "", run.forkedFrom?.sessionId ?? ""].join("|");
}

/**
 * Full sessions for a set of run ids. The live session comes straight from
 * the SSE feed; saved runs are fetched from /api/history/:id and refetched
 * whenever their summary changes. A run that stops being live keeps its last
 * snapshot on screen until the saved copy arrives, so nothing flashes.
 */
export function useRunSessions(ids: string[], runs: InspectorSessionSummary[], live: InspectorSession | null) {
  const [cache, setCache] = useState<Record<string, CacheEntry>>({});
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const inflight = useRef(new Set<string>());

  useEffect(() => {
    if (!live) return;
    setCache((current) => ({ ...current, [live.id]: { version: "live", session: live } }));
  }, [live]);

  const wanted = ids.filter((id) => id !== live?.id).map((id) => [id, versionOf(id, runs)] as const);
  const wantedKey = wanted.map(([id, version]) => `${id}@${version}`).join(",");

  useEffect(() => {
    for (const [id, version] of wanted) {
      const entry = cacheRef.current[id];
      if (entry && entry.version === version) continue;
      const flight = `${id}@${version}`;
      if (inflight.current.has(flight)) continue;
      inflight.current.add(flight);
      api
        .get<InspectorSession>(`/api/history/${encodeURIComponent(id)}`)
        .then((session) => setCache((current) => ({ ...current, [id]: { version, session } })))
        .catch(() =>
          setCache((current) => ({ ...current, [id]: { version, session: current[id]?.session ?? null } }))
        )
        .finally(() => inflight.current.delete(flight));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey]);

  const idsKey = ids.join(",");
  return useMemo(() => {
    const sessions: Record<string, InspectorSession> = {};
    const missing = new Set<string>();
    for (const id of ids) {
      if (live && id === live.id) {
        sessions[id] = live;
        continue;
      }
      const entry = cache[id];
      if (entry?.session) sessions[id] = entry.session;
      else if (entry && entry.version !== "live") missing.add(id);
    }
    return { sessions, missing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, live, idsKey]);
}
