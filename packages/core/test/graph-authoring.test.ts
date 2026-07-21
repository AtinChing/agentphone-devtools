import { describe, expect, it } from "vitest";
import {
  applyNodeReview,
  draftGraphFromCallerTurns,
  forkPathFromNode,
  summarizeGraphPaths,
  type ConversationGraph
} from "../src/index.js";

const graph: ConversationGraph = {
  version: 1,
  metadata: {
    name: "Support tree",
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
    greeting: { caller: "Hello", review: { status: "approved" } },
    billing: { caller: "My bill is wrong", review: { status: "pending" } }
  },
  edges: [{ from: "greeting", to: "billing", label: "billing" }],
  paths: {
    billing: { route: ["greeting", "billing"], tags: ["smoke"] }
  }
};

describe("graph authoring helpers", () => {
  it("summarizes path review coverage", () => {
    expect(summarizeGraphPaths(graph)[0]).toMatchObject({
      pathName: "billing",
      approvedCount: 1,
      pendingCount: 1,
      status: "mixed"
    });
  });

  it("applies review corrections without mutating unrelated nodes", () => {
    const next = applyNodeReview(graph, "billing", {
      status: "rejected",
      correctedTranscript: "My bill is incorrect",
      annotations: ["ASR miss"]
    });
    expect(next.nodes.billing.review).toMatchObject({
      status: "rejected",
      correctedTranscript: "My bill is incorrect",
      originalTranscript: "My bill is wrong"
    });
    expect(next.nodes.greeting.review?.status).toBe("approved");
  });

  it("forks a new path from a shared checkpoint", () => {
    const next = forkPathFromNode(graph, {
      sourcePath: "billing",
      fromNodeId: "greeting",
      newPathName: "outage",
      edgeLabel: "reports outage",
      continuation: { nodeId: "outage", caller: "Power is out" },
      tags: ["fork"]
    });
    expect(next.paths.outage.route).toEqual(["greeting", "outage"]);
    expect(next.paths.billing.route).toEqual(["greeting", "billing"]);
    expect(next.nodes.outage.review?.status).toBe("pending");
    expect(next.edges).toEqual(
      expect.arrayContaining([{ from: "greeting", to: "outage", label: "reports outage" }])
    );
  });

  it("drafts a pending graph from recorded caller turns", () => {
    const drafted = draftGraphFromCallerTurns({
      name: "Recorded cancel",
      channel: "voice",
      turns: [{ caller: "Cancel please" }, { caller: "Code 4821" }]
    });
    expect(Object.keys(drafted.nodes)).toHaveLength(2);
    expect(drafted.paths.recorded.route).toEqual(["turn_1", "turn_2"]);
    expect(drafted.nodes.turn_1.review?.status).toBe("pending");
  });
});
