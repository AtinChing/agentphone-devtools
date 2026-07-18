import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findBaselineForScenario, loadBaselineArtifact } from "../src/baseline.js";
import type { InspectorSession } from "@agentphone-devtools/server";

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

describe("CI baseline artifacts", () => {
  it("loads suite reports and matches moved scenarios by unique filename", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentphone-baseline-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const reportPath = join(directory, "baseline.json");
    const baseline = session("baseline");
    writeFileSync(
      reportPath,
      JSON.stringify({ runs: [{ scenarioPath: "/old/workspace/scenarios/charger.yaml", session: baseline }] }),
      "utf8"
    );

    const entries = await loadBaselineArtifact(reportPath);

    expect(entries).toHaveLength(1);
    expect(findBaselineForScenario(entries, "/new/workspace/scenarios/charger.yaml")?.id).toBe("baseline");
  });

  it("rejects artifacts without run sessions", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentphone-baseline-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const reportPath = join(directory, "invalid.json");
    writeFileSync(reportPath, JSON.stringify({ suite: { passed: true } }), "utf8");

    await expect(loadBaselineArtifact(reportPath)).rejects.toThrow("contains no valid run sessions");
  });
});

function session(id: string): InspectorSession {
  return {
    id,
    targetUrl: "http://localhost/webhook",
    secretPreview: "***",
    channel: "sms",
    status: "ended",
    startedAt: "2026-01-01T00:00:00.000Z",
    conversationId: "conv",
    callId: "call",
    transcript: [],
    deliveries: [],
    warnings: []
  };
}
