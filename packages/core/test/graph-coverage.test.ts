import { describe, expect, it } from "vitest";
import { buildGraphCoverageReport, filterCoveragePaths, type ConversationGraph } from "../src/index.js";

const graph: ConversationGraph = {
  version: 1,
  metadata: {
    name: "Coverage demo",
    channel: "voice",
    agentId: "agt_local",
    numberId: "num_local",
    from: "+15559876543",
    to: "+15551234567",
    conversationState: null,
    contextLimit: 10,
    timeoutSeconds: 30
  },
  nodes: {
    start: { caller: "Hi", review: { status: "approved" } },
    happy: { caller: "Thanks", review: { status: "approved" }, fixtures: { audio: { noiseProfile: "cafe" } } },
    retry: { caller: "Again", review: { status: "pending" } }
  },
  edges: [
    { from: "start", to: "happy", label: "success" },
    { from: "start", to: "retry", label: "retry" }
  ],
  paths: {
    success: { route: ["start", "happy"], tags: ["smoke"] },
    retry: { route: ["start", "retry"], tags: ["retry"] }
  },
  fixtureProfiles: {
    cafe: { apply: { happy: { audio: { noiseProfile: "cafe" } } } },
    delayed: { apply: { happy: { timing: { leadingSilenceMs: 200 } } } }
  },
  runs: {
    smoke: { paths: ["success"], fixtureProfiles: ["cafe", "delayed"], maxGeneratedCases: 1 }
  },
  maxGeneratedCases: 1
};

describe("graph coverage", () => {
  it("reports path, edge, pairwise, unsupported, and cap-omitted coverage", () => {
    const report = buildGraphCoverageReport(graph, { runs: ["smoke"] });
    expect(report.approvedPathCount).toBe(1);
    expect(report.edges.find((edge) => edge.label === "success")?.covered).toBe(true);
    expect(report.edges.find((edge) => edge.label === "retry")?.covered).toBe(false);
    expect(report.pairwise).toEqual([
      expect.objectContaining({ left: "cafe", right: "delayed", covered: true })
    ]);
    expect(report.unsupported.some((item) => item.kind === "audio")).toBe(true);
    expect(report.cap.omitted).toHaveLength(0);
    expect(filterCoveragePaths(report, "approved_paths")).toEqual(["success"]);
    expect(filterCoveragePaths(report, "uncovered_edges")).toEqual(["retry"]);
  });

  it("records cap-omitted cases when selection exceeds the limit", () => {
    const report = buildGraphCoverageReport(graph, { paths: ["success", "retry"], maxGeneratedCases: 1 });
    expect(report.cap.selectedCount).toBe(1);
    expect(report.cap.omitted).toEqual([
      expect.objectContaining({ pathName: "retry", reason: "exceeds maxGeneratedCases" })
    ]);
    expect(filterCoveragePaths(report, "cap_omitted")).toEqual(["retry"]);
  });
});
