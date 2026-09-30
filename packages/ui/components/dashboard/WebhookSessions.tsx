"use client";

import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { InspectorDelivery, InspectorSession, InspectorSessionSummary } from "@/lib/types";

/** A run's revision: changes whenever the run gains turns or deliveries. */
function revision(run: InspectorSessionSummary): string {
  return `${run.id}@${run.lastActivityAt ?? run.startedAt}#${run.deliveries}#${run.transcriptTurns}#${run.status}`;
}

/**
 * Full sessions (deliveries, transcript) for a set of run summaries, fetched
 * from GET /api/history/:id. Each run is refetched only when its summary
 * changes, so the live run stays current as SSE pushes new history.
 */
export function useRunDetails(runs: InspectorSessionSummary[]) {
  const [sessions, setSessions] = useState<InspectorSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, InspectorSession>());
  const key = runs.map(revision).join("|");

  useEffect(() => {
    let cancelled = false;
    const wanted = key ? key.split("|") : [];
    const missing = wanted.filter((entry) => !cache.current.has(entry));
    Promise.all(
      missing.map(async (entry) => {
        const sessionId = entry.slice(0, entry.indexOf("@"));
        const session = await api.get<InspectorSession>(`/api/history/${encodeURIComponent(sessionId)}`);
        return [entry, session] as const;
      })
    )
      .then((fetched) => {
        for (const [entry, session] of fetched) cache.current.set(entry, session);
        for (const entry of [...cache.current.keys()]) if (!wanted.includes(entry)) cache.current.delete(entry);
        if (cancelled) return;
        setSessions(wanted.map((entry) => cache.current.get(entry)).filter((session): session is InspectorSession => Boolean(session)));
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { sessions, loading, error };
}

/** The handler's actions for one delivery (action, plus hangup/transfer aliases). */
export function deliveryActions(delivery: InspectorDelivery): string[] {
  const actions = new Set<string>();
  for (const chunk of delivery.response.parsed.chunks) {
    if (typeof chunk.action === "string" && chunk.action) actions.add(chunk.action);
    if (chunk.hangup === true) actions.add("hangup");
    if (typeof chunk.transferNumber === "string") actions.add("transfer");
  }
  return [...actions];
}

/** A delivery counts as successful when the handler answered 2xx in time. */
export function deliverySucceeded(delivery: InspectorDelivery): boolean {
  return delivery.ok && !delivery.timedOut;
}
