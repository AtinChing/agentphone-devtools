import { describe, expect, it } from "vitest";
import { compareRuns } from "../src/comparison.js";
import type { InspectorSession } from "../src/index.js";

describe("run baseline comparison", () => {
  it("passes equivalent or improved candidate runs", () => {
    const baseline = session({ id: "baseline", score: 80, latencyMs: 100, action: "transfer" });
    const candidate = session({ id: "candidate", score: 90, latencyMs: 120, action: "transfer" });

    const comparison = compareRuns(baseline, candidate);

    expect(comparison).toMatchObject({ passed: true, regressions: [], score: { delta: 10 }, actions: { missing: [] } });
  });

  it("reports outcome, score, action, transcript, latency, and warning regressions", () => {
    const baseline = session({ id: "baseline", score: 95, latencyMs: 100, action: "transfer" });
    const candidate = session({
      id: "candidate",
      outcome: "failed",
      score: 40,
      latencyMs: 250,
      transcriptText: "Something changed",
      warning: "New parser warning"
    });

    const comparison = compareRuns(baseline, candidate, { requireTranscriptMatch: true });

    expect(comparison.passed).toBe(false);
    expect(comparison).toMatchObject({
      outcome: { regressed: true },
      score: { regressed: true, delta: -55 },
      actions: { regressed: true, missing: ["transfer"] },
      transcript: { regressed: true, changed: true },
      latency: { regressed: true, deltaMs: 150 },
      warnings: { regressed: true, added: ["New parser warning"] }
    });
    expect(comparison.regressions).toHaveLength(6);
  });
});

function session(options: {
  id: string;
  outcome?: "resolved" | "handed_off" | "failed";
  score: number;
  latencyMs: number;
  action?: string;
  transcriptText?: string;
  warning?: string;
}): InspectorSession {
  return {
    id: options.id,
    targetUrl: "http://localhost/webhook",
    secretPreview: "***",
    channel: "voice",
    status: "ended",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:01:00.000Z",
    conversationId: "conv_test",
    callId: "call_test",
    transcript: [
      { role: "user", content: "I need billing help" },
      { role: "agent", content: options.transcriptText ?? "I will transfer you" }
    ],
    deliveries: [
      {
        id: `delivery_${options.id}`,
        event: "agent.message",
        channel: "voice",
        direction: "inbound",
        timestamp: "2026-01-01T00:00:01.000Z",
        webhookId: `wh_${options.id}`,
        request: { headers: {}, rawBody: "{}", body: {} as never },
        response: {
          status: 200,
          statusText: "OK",
          headers: {},
          rawBody: "{}",
          parsed: { mode: "json", chunks: options.action ? [{ action: options.action }] : [], warnings: [] }
        },
        latencyMs: options.latencyMs,
        timedOut: false,
        ok: true,
        warnings: [],
        retries: 0
      }
    ],
    evalResult: {
      outcome: options.outcome ?? "handed_off",
      stayedOnTask: true,
      correctActions: null,
      score: options.score,
      reasons: [],
      metrics: { turnCount: 2, agentTurns: 1, userTurns: 1, deadAirTurns: 0 }
    },
    warnings: options.warning ? [options.warning] : []
  };
}
