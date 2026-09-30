"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { CircleCheck, CircleX, Loader2 } from "lucide-react";
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
    <div className="rounded-xl border border-line bg-frame">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <Eyebrow>Compliance suite</Eyebrow>
        <span className={`text-[13px] font-semibold ${running ? "text-slate-500" : allPassed ? "text-fern" : "text-danger"}`}>
          {running ? `Running ${Math.min(finished + 1, rows.length)} of ${rows.length}…` : `${passed}/${rows.length} passed`}
        </span>
      </div>
      <ul>
        {rows.map((row) => {
          const bad = row.state === "failed" || row.state === "error";
          const content = (
            <>
              <span className="mt-0.5 shrink-0">
                {row.state === "running" ? (
                  <Loader2 size={15} className="animate-spin text-slate-500" />
                ) : row.state === "passed" ? (
                  <CircleCheck size={15} className="text-fern" />
                ) : bad ? (
                  <CircleX size={15} className="text-danger" />
                ) : (
                  <span className="block h-[15px] w-[15px] rounded-full border border-slate-300" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate ${bad ? "text-[#f08080]" : "text-bright"}`}>{row.name}</span>
                {row.message && bad ? <span className="mt-0.5 block text-[12px] text-[#f08080]/80">{row.message}</span> : null}
              </span>
              <ChannelBadge channel={row.channel} />
              {row.assertions ? (
                <span className="data w-10 shrink-0 text-right text-[12px] text-slate-500">
                  {row.assertions.passed}/{row.assertions.total}
                </span>
              ) : null}
            </>
          );
          const className = `flex items-start gap-3 border-b border-line/70 px-4 py-2.5 text-[13.5px] last:border-b-0 ${bad ? "bg-red-50" : ""}`;
          return (
            <li key={row.path}>
              {row.sessionId ? (
                <Link href={runHref({ id: row.sessionId, channel: row.channel })} className={`${className} hover:bg-mist`} title="Open this run">
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
