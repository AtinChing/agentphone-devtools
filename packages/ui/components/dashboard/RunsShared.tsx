"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle, CloudSlash, GitBranch, MagnifyingGlass, XCircle } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { InspectorDelivery, InspectorSession, InspectorSessionSummary, SessionChannel } from "@/lib/types";
import { Avatar, Badge, EmptyState, StatusDot, formatNumber, formatPhone, inputClass } from "./ui";

/** The simulated account's own number: the `to` on every webhook. */
export const BUSINESS_NUMBER = "+15551234567";

/** The live session is listed before it has any traffic; tables skip that empty shell. */
export function hasTraffic(run: InspectorSessionSummary): boolean {
  return run.transcriptTurns > 0 || run.deliveries > 0;
}

export function runHref(run: { id: string; channel: SessionChannel }): string {
  return `${run.channel === "voice" ? "/voice-calls" : "/messages"}?session=${encodeURIComponent(run.id)}`;
}

/** Changes whenever a run gains turns or deliveries or changes status, so cached detail is refetched. */
export function runVersion(run: InspectorSessionSummary): string {
  return `${run.status}:${run.transcriptTurns}:${run.deliveries}:${run.lastActivityAt ?? ""}`;
}

export function formatLatency(ms: number | undefined): string {
  return ms === undefined ? "—" : `${formatNumber(Math.round(ms))} ms`;
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "—";
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}m ${String(whole % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Call length: the call_ended payload's duration, else the session's wall-clock span. */
export function callDurationSeconds(session: Pick<InspectorSession, "callEnded" | "startedAt" | "endedAt">): number | undefined {
  if (session.callEnded) return session.callEnded.durationSeconds;
  if (!session.endedAt) return undefined;
  return (Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 1000;
}

/** Distinct handler actions across deliveries, in first-seen order. */
export function deliveryActions(deliveries: InspectorDelivery[]): string[] {
  const actions = new Set<string>();
  for (const delivery of deliveries) {
    for (const chunk of delivery.response?.parsed?.chunks ?? []) {
      if (typeof chunk.action === "string" && chunk.action) actions.add(chunk.action);
    }
  }
  return [...actions];
}

export function isFailedDelivery(delivery: InspectorDelivery): boolean {
  return delivery.timedOut || !delivery.ok;
}

/** Run count and most recent activity per contact id. */
export function activityByContact(runs: InspectorSessionSummary[]): Map<string, { runs: number; lastActivityAt?: string }> {
  const byContact = new Map<string, { runs: number; lastActivityAt?: string }>();
  for (const run of runs) {
    if (!run.contact || !hasTraffic(run)) continue;
    const entry = byContact.get(run.contact.id) ?? { runs: 0 };
    entry.runs += 1;
    const at = run.lastActivityAt ?? run.startedAt;
    if (!entry.lastActivityAt || at > entry.lastActivityAt) entry.lastActivityAt = at;
    byContact.set(run.contact.id, entry);
  }
  return byContact;
}

/** Case-insensitive match on the contact, number, run id and last message. */
export function runMatches(run: InspectorSessionSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const digits = needle.replace(/\D/g, "");
  return (
    [run.contact?.name ?? "caller", run.id, run.lastMessage ?? ""].some((text) => text.toLowerCase().includes(needle)) ||
    (digits.length > 2 && (run.contact?.number ?? "").includes(digits))
  );
}

/** Search box with the console's magnifier; `className` replaces the default max-w-xs width cap. */
export function RunsSearch({
  value,
  onChange,
  placeholder,
  className = "max-w-xs"
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={`relative w-full ${className}`}>
      <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
      <input
        aria-label={placeholder}
        className={`${inputClass} pl-9`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

/** Console pill group (Activity range / channel filters). */
export function PillGroup<T extends string>({
  options,
  value,
  onChange,
  className = ""
}: {
  options: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-1 rounded-[10px] bg-white/[0.04] p-1 ${className}`} role="group">
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={active}
            className={`focus-ring rounded-[6px] px-3 py-1.5 text-[13px] leading-none transition-[transform,background-color,color] duration-150 active:scale-[0.96] ${
              active ? "bg-white/10 font-medium text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            {option.label}
            {option.count !== undefined ? <span className={`ml-1.5 tabular-nums ${active ? "text-white/60" : "text-white/30"}`}>{option.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function ActionChip({ action }: { action: string }) {
  return <span className="rounded bg-white/[0.05] px-2 py-0.5 font-mono text-[11px] text-text-secondary">{action}</span>;
}

export function RunContact({ run }: { run: InspectorSessionSummary }) {
  const name = run.contact?.name ?? "Caller";
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={name} size={36} plain />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-white">{name}</div>
        <div className="truncate text-xs text-text-dim">
          {run.contact ? <span className="tabular-nums">{formatPhone(run.contact.number)}</span> : <span className="font-mono">{run.id}</span>}
        </div>
        {run.forkedFrom ? (
          <Badge tone="purple" className="mt-1">
            <GitBranch size={11} weight="bold" />
            branch of <span className="font-mono">{run.forkedFrom.sessionId}</span>
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

/** Running / ended, plus the scenario verdict when the run was a scenario. */
export function RunStatus({ run }: { run: InspectorSessionSummary }) {
  const running = run.status === "running";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-secondary">
      <span className="inline-flex items-center gap-1.5">
        <StatusDot ok={running ? true : null} className={running ? "animate-pulse" : ""} />
        {running ? "Running" : run.status === "ended" ? "Ended" : "Idle"}
      </span>
      {run.scenarioPassed !== undefined ? (
        <span
          className={`inline-flex items-center gap-1.5 ${run.scenarioPassed ? "text-primary" : "text-red-400"}`}
          title={run.scenarioPassed ? "Scenario assertions passed" : "Scenario assertions failed"}
        >
          <StatusDot ok={run.scenarioPassed} />
          {run.scenarioPassed ? "pass" : "fail"}
        </span>
      ) : null}
    </div>
  );
}

export function SentimentBadge({ sentiment }: { sentiment?: string }) {
  if (!sentiment) return <span className="text-text-dim">—</span>;
  const value = sentiment.toLowerCase();
  const tone = value.includes("pos") ? "green" : value.includes("neg") ? "red" : "neutral";
  return <Badge tone={tone}>{sentiment}</Badge>;
}

export function SuccessMark({ value }: { value?: boolean }) {
  if (value === undefined) return <span className="text-text-dim">—</span>;
  return value ? (
    <span className="inline-flex items-center gap-1.5 text-primary">
      <CheckCircle size={16} weight="fill" /> Yes
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-red-400">
      <XCircle size={16} weight="fill" /> No
    </span>
  );
}

/**
 * True once the event stream has been down for a moment, so pages don't
 * flash the offline state while the first connection is still opening.
 */
export function useServerOffline(): boolean {
  const { connected } = useLive();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (connected) {
      setOffline(false);
      return;
    }
    const timer = window.setTimeout(() => setOffline(true), 1500);
    return () => window.clearTimeout(timer);
  }, [connected]);
  return offline;
}

export function ServerOffline() {
  return (
    <EmptyState
      icon={<CloudSlash size={24} />}
      title="Devtools server offline"
      description={
        <>
          Start the simulator with <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-text">npx agentphone-devtools</code> and this
          page reconnects on its own.
        </>
      }
    />
  );
}

/** The run open in a detail drawer, mirrored into `?session=` so it can be deep-linked. */
export function useDeepLinkedSession(): [string | null, (sessionId: string | null) => void] {
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("session");
    if (fromUrl) setSelected(fromUrl);
  }, []);
  const select = useCallback((sessionId: string | null) => {
    setSelected(sessionId);
    const url = new URL(window.location.href);
    if (sessionId) url.searchParams.set("session", sessionId);
    else url.searchParams.delete("session");
    window.history.replaceState(null, "", url);
  }, []);
  return [selected, select];
}

/**
 * Full sessions for the given runs. Summaries don't carry deliveries or
 * call_ended data; each run is refetched only when its summary changes.
 */
export function useRunDetails(runs: InspectorSessionSummary[]): { details: Map<string, InspectorSession>; loading: boolean } {
  const cache = useRef(new Map<string, { version: string; session: InspectorSession }>());
  const [details, setDetails] = useState<Map<string, InspectorSession>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const key = runs.map((run) => `${run.id}@${runVersion(run)}`).join("|");

  useEffect(() => {
    let cancelled = false;
    const publish = () => {
      const next = new Map<string, InspectorSession>();
      for (const run of runs) {
        const hit = cache.current.get(run.id);
        if (hit) next.set(run.id, hit.session);
      }
      setDetails(next);
      setLoading(false);
    };
    const stale = runs.filter((run) => cache.current.get(run.id)?.version !== runVersion(run));
    if (!stale.length) {
      publish();
      return;
    }
    setLoading(true);
    void Promise.all(
      stale.map(async (run) => {
        try {
          const session = await api.get<InspectorSession>(`/api/history/${encodeURIComponent(run.id)}`);
          cache.current.set(run.id, { version: runVersion(run), session });
        } catch {
          /* deleted or unreachable: the row renders without detail */
        }
      })
    ).then(() => {
      if (!cancelled) publish();
    });
    return () => {
      cancelled = true;
    };
    // `key` encodes every run's identity and version; `runs` itself is a new array each render.
  }, [key]);

  return { details, loading };
}
