import { collectObservedActions } from "@agentphone-devtools/core";
import type { InspectorSession } from "./index.js";

export interface RunComparisonOptions {
  maxLatencyIncreasePercent?: number;
  latencyGraceMs?: number;
}

export interface RunComparison {
  baselineSessionId: string;
  candidateSessionId: string;
  passed: boolean;
  regressions: string[];
  actions: {
    baseline: string[];
    candidate: string[];
    missing: string[];
    added: string[];
    regressed: boolean;
  };
  transcript: {
    baselineTurns: number;
    candidateTurns: number;
    changed: boolean;
    regressed: boolean;
  };
  latency: {
    baselineAverageMs: number;
    candidateAverageMs: number;
    deltaMs: number;
    deltaPercent: number;
    regressed: boolean;
  };
  warnings: {
    baseline: string[];
    candidate: string[];
    added: string[];
    regressed: boolean;
  };
}

export function compareRuns(
  baseline: InspectorSession,
  candidate: InspectorSession,
  options: RunComparisonOptions = {}
): RunComparison {
  const maxLatencyIncreasePercent = options.maxLatencyIncreasePercent ?? 25;
  const latencyGraceMs = options.latencyGraceMs ?? 50;
  const regressions: string[] = [];

  const baselineActions = sessionActions(baseline);
  const candidateActions = sessionActions(candidate);
  const missingActions = baselineActions.filter((action) => !candidateActions.includes(action));
  const addedActions = candidateActions.filter((action) => !baselineActions.includes(action));
  if (missingActions.length) regressions.push(`Missing baseline action(s): ${missingActions.join(", ")}`);

  const transcriptChanged = normalizeTranscript(baseline) !== normalizeTranscript(candidate);
  const baselineLatency = averageLatency(baseline);
  const candidateLatency = averageLatency(candidate);
  const latencyDelta = candidateLatency - baselineLatency;
  const latencyDeltaPercent = baselineLatency === 0 ? (candidateLatency === 0 ? 0 : 100) : (latencyDelta / baselineLatency) * 100;
  const latencyRegressed = latencyDelta > latencyGraceMs && latencyDeltaPercent > maxLatencyIncreasePercent;
  if (latencyRegressed) {
    regressions.push(
      `Average latency increased from ${baselineLatency}ms to ${candidateLatency}ms (${latencyDeltaPercent.toFixed(1)}%)`
    );
  }

  const baselineWarnings = sessionWarnings(baseline);
  const candidateWarnings = sessionWarnings(candidate);
  const addedWarnings = candidateWarnings.filter((warning) => !baselineWarnings.includes(warning));
  if (addedWarnings.length) regressions.push(`${addedWarnings.length} new warning(s) appeared`);

  return {
    baselineSessionId: baseline.id,
    candidateSessionId: candidate.id,
    passed: regressions.length === 0,
    regressions,
    actions: {
      baseline: baselineActions,
      candidate: candidateActions,
      missing: missingActions,
      added: addedActions,
      regressed: missingActions.length > 0
    },
    transcript: {
      baselineTurns: baseline.transcript.length,
      candidateTurns: candidate.transcript.length,
      changed: transcriptChanged,
      regressed: false
    },
    latency: {
      baselineAverageMs: baselineLatency,
      candidateAverageMs: candidateLatency,
      deltaMs: latencyDelta,
      deltaPercent: Number(latencyDeltaPercent.toFixed(2)),
      regressed: latencyRegressed
    },
    warnings: {
      baseline: baselineWarnings,
      candidate: candidateWarnings,
      added: addedWarnings,
      regressed: addedWarnings.length > 0
    }
  };
}

function sessionActions(session: InspectorSession): string[] {
  return collectObservedActions(session.deliveries.flatMap((delivery) => delivery.response.parsed.chunks)).sort();
}

function normalizeTranscript(session: InspectorSession): string {
  return session.transcript.map((turn) => `${turn.role}:${turn.content.trim().replace(/\s+/g, " ")}`).join("\n");
}

function averageLatency(session: InspectorSession): number {
  if (!session.deliveries.length) return 0;
  return Math.round(session.deliveries.reduce((total, delivery) => total + delivery.latencyMs, 0) / session.deliveries.length);
}

function sessionWarnings(session: InspectorSession): string[] {
  return Array.from(new Set([...session.warnings, ...session.deliveries.flatMap((delivery) => delivery.warnings)])).sort();
}
