"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { CheckCircle, CircleNotch, XCircle } from "@phosphor-icons/react";
import { api, errorMessage } from "@/lib/api";
import type { InspectorSession, ScenarioListing, SessionChannel } from "@/lib/types";
import { ChannelBadge, Eyebrow, Notice } from "./ui";
import { runHref } from "./RunsShared";

export interface SuiteRow {
  path: string;
  name: string;
  channel: SessionChannel;
  state: "pending" | "running" | "passed" | "failed" | "error";
  sessionId?: string;
  assertions?: { passed: number; total: number };
  message?: string;
}

export interface ComplianceSuite {
  rows: SuiteRow[];
  running: boolean;
  error: string | null;
  run: () => Promise<void>;
}

function isComplianceScenario(scenario: ScenarioListing): boolean {
  // Groups are the scanned directory, e.g. "examples/compliance".
  return scenario.group.split("/").pop() === "compliance";
}

/**
 * Runs every compliance scenario against the real handler, one at a time
 * (each run resets the live session), publishing results as they arrive.
 */
export function useComplianceSuite(): ComplianceSuite {
  const [rows, setRows] = useState<SuiteRow[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    const patch = (index: number, update: Partial<SuiteRow>) =>
      setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...update } : row)));
    try {
      const suite = (await api.get<ScenarioListing[]>("/api/scenarios")).filter(isComplianceScenario);
      if (!suite.length) {
        setRows([]);
        setError("No compliance scenarios found under examples/compliance.");
        return;
      }
      setRows(
        suite.map((scenario) => ({
          path: scenario.path,
          name: scenario.name,
          channel: scenario.channel,
          ...(scenario.error ? { state: "error" as const, message: scenario.error } : { state: "pending" as const })
        }))
      );
      for (const [index, scenario] of suite.entries()) {
        if (scenario.error) continue;
        patch(index, { state: "running" });
        try {
          const session = await api.post<InspectorSession>("/api/scenario", { path: scenario.path });
          const result = session.scenarioResult;
          const firstFailure = result?.assertions.find((assertion) => !assertion.passed);
          patch(index, {
            state: result && !result.passed ? "failed" : "passed",
            sessionId: session.id,
            ...(result ? { assertions: { passed: result.passedCount, total: result.passedCount + result.failedCount } } : {}),
            ...(firstFailure ? { message: firstFailure.message } : {})
          });
        } catch (err) {
          patch(index, { state: "error", message: errorMessage(err) });
        }
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }, []);

  return { rows, running, error, run };
}

export function ComplianceResults({ suite }: { suite: ComplianceSuite }) {
  const { rows, running, error } = suite;
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!rows.length) return null;
  const passed = rows.filter((row) => row.state === "passed").length;
  const finished = rows.filter((row) => row.state !== "pending" && row.state !== "running").length;
  const allPassed = !running && passed === rows.length;

  return (
    <div className="overflow-hidden rounded-[12px] border border-white/[0.06] bg-white/[0.02]">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <Eyebrow>Compliance suite</Eyebrow>
        <span className={`text-[13px] font-medium tabular-nums ${running ? "text-text-secondary" : allPassed ? "text-primary" : "text-red-400"}`}>
          {running ? `Running ${Math.min(finished + 1, rows.length)} of ${rows.length}…` : `${passed}/${rows.length} passed`}
        </span>
      </div>
      <ul>
        {rows.map((row) => {
          const bad = row.state === "failed" || row.state === "error";
          const content = (
            <>
              <span className="mt-px shrink-0">
                {row.state === "running" ? (
                  <CircleNotch size={16} className="animate-spin text-text-secondary" />
                ) : row.state === "passed" ? (
                  <CheckCircle size={16} weight="fill" className="text-primary" />
                ) : bad ? (
                  <XCircle size={16} weight="fill" className="text-red-400" />
                ) : (
                  <span className="block h-4 w-4 rounded-full border border-white/20" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate ${bad ? "text-red-400" : "text-text"}`}>{row.name}</span>
                {row.message && bad ? <span className="mt-0.5 block text-xs text-red-400/80">{row.message}</span> : null}
              </span>
              <ChannelBadge channel={row.channel} />
              {row.assertions ? (
                <span className="w-10 shrink-0 text-right font-mono text-xs text-text-dim">
                  {row.assertions.passed}/{row.assertions.total}
                </span>
              ) : null}
            </>
          );
          const className = `flex items-start gap-3 border-b border-white/[0.04] px-4 py-2.5 text-[13px] last:border-b-0 ${bad ? "bg-red-500/[0.06]" : ""}`;
          return (
            <li key={row.path}>
              {row.sessionId ? (
                <Link href={runHref({ id: row.sessionId, channel: row.channel })} className={`${className} transition-colors hover:bg-white/[0.03]`} title="Open this run">
                  {content}
                </Link>
              ) : (
                <div className={className}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
