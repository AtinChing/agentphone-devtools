import { describe, expect, it } from "vitest";
import {
  compileConversationGraph,
  compileConversationGraphCases,
  parseConversationGraph,
  validateConversationGraph,
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
    billing: {
      caller: "My bill is wrong",
      expect: { actions: ["transfer"] },
      review: { status: "approved", originalTranscript: "My bell is wrong", correctedTranscript: "My bill is wrong" }
    },
    outage: { caller: "My service is down", review: { status: "approved" } },
    draft: { caller: "Unreviewed", review: { status: "pending" } }
  },
  edges: [
    { from: "greeting", to: "billing", label: "billing" },
    { from: "greeting", to: "outage", label: "outage" },
    { from: "greeting", to: "draft", label: "draft" }
  ],
  paths: {
    billing: { route: ["greeting", "billing"], tags: ["smoke"] },
    outage: { route: ["greeting", "outage"], tags: ["regression"] },
    draft: { route: ["greeting", "draft"] }
  },
  fixtureProfiles: {
    harshNetwork: {
      apply: {
        "*": { delivery: { delayMs: 250 } },
        billing: { delivery: { timeout: true, faults: { invalidSignature: true } }, audio: { noiseProfile: "cafe" } }
      }
    }
  },
  runs: { smoke: { tags: ["smoke"], fixtureProfiles: ["harshNetwork"] } },
  maxGeneratedCases: 5
};

describe("conversation graph", () => {
  it("parses versioned YAML with scenario metadata defaults", () => {
    const parsed = parseConversationGraph(`version: 1\nnodes:\n  first:\n    caller: hello\npaths:\n  only:\n    route: [first]\n`);
    expect(parsed.metadata).toMatchObject({ name: "Untitled scenario", channel: "voice", timeoutSeconds: 30 });
    expect(parsed.edges).toEqual([]);
  });

  it("compiles shared prefixes as independent flat scenarios", () => {
    const scenarios = compileConversationGraph(graph, { paths: ["billing", "outage"] });
    expect(scenarios).toHaveLength(2);
    expect(scenarios.map((scenario) => scenario.turns.map((turn) => turn.caller))).toEqual([
      ["Hello", "My bill is wrong"],
      ["Hello", "My service is down"]
    ]);
  });

  it("applies wildcard and node-specific fixture profile overlays", () => {
    const [compiled] = compileConversationGraphCases(graph, { runs: ["smoke"] });
    expect(compiled.scenario.turns[0].waitMs).toBeUndefined();
    expect(compiled.scenario.turns[1]).toMatchObject({ fault: { simulateTimeout: true, invalidSignature: true } });
    expect(compiled.turns[0].fixtures?.delivery?.delayMs).toBe(250);
    expect(compiled.turns[1].fixtures).toMatchObject({
      delivery: { delayMs: 250, timeout: true },
      audio: { noiseProfile: "cafe" }
    });
  });

  it("uses reviewer corrections only when explicitly requested", () => {
    const changed = {
      ...graph,
      nodes: { ...graph.nodes, billing: { ...graph.nodes.billing, caller: "My bell is wrong" } }
    };
    expect(compileConversationGraph(changed, { paths: ["billing"] })[0].turns[1].caller).toBe("My bell is wrong");
    expect(compileConversationGraph(changed, { paths: ["billing"], useCorrectedTranscripts: true })[0].turns[1].caller).toBe(
      "My bill is wrong"
    );
  });

  it("rejects unsafe fixture asset paths", () => {
    const invalid = {
      ...graph,
      nodes: { ...graph.nodes, greeting: { ...graph.nodes.greeting, fixtures: { audio: { path: "../outside.wav" } } } }
    };
    expect(() => validateConversationGraph(invalid)).toThrow(/safe relative asset path/);
  });

  it("rejects unreviewed paths by default and can filter them", () => {
    expect(() => compileConversationGraph(graph, { paths: ["draft"] })).toThrow(/unreviewed node/);
    expect(compileConversationGraph(graph, { paths: ["billing", "draft"], unreviewed: "skip" })).toHaveLength(1);
  });

  it("rejects routes that do not follow declared edges", () => {
    const invalid = { ...graph, paths: { bad: { route: ["billing", "outage"] } } };
    expect(() => validateConversationGraph(invalid)).toThrow(/has no edge/);
  });

  it("rejects cyclic named paths until an explicit loop policy exists", () => {
    const cyclic = {
      ...graph,
      edges: [...graph.edges, { from: "billing", to: "greeting", label: "retry" }],
      paths: { retry: { route: ["greeting", "billing", "greeting"] } }
    };
    expect(() => validateConversationGraph(cyclic)).toThrow(/loops require an explicit future loop policy/);
  });

  it("enforces generated-case caps", () => {
    expect(() => compileConversationGraph(graph, { paths: ["billing", "outage"], maxGeneratedCases: 1 })).toThrow(/exceeding the cap/);
  });

  it("exports the appointment-cancellation example with provenance", async () => {
    const { loadConversationGraphFile, exportConversationGraphScenarios } = await import("../src/index.js");
    const { fileURLToPath } = await import("node:url");
    const { resolve } = await import("node:path");
    const examplePath = resolve(fileURLToPath(new URL("../../../examples/graphs/appointment-cancellation.yaml", import.meta.url)));
    const example = await loadConversationGraphFile(examplePath);
    const exported = exportConversationGraphScenarios(example, {
      runs: ["smoke"],
      sourcePath: "examples/graphs/appointment-cancellation.yaml"
    });
    expect(exported).toHaveLength(2);
    expect(exported[0].yaml).toContain("# family: Appointment cancellation");
    expect(exported[0].yaml).toContain("expectedOutcome: resolved");
    expect(exported[0].fileName).toContain("cancellation_success");
    expect(exported[1].case.turns.some((turn) => turn.fixtures?.audio?.noiseProfile === "cafe")).toBe(true);
  });
});
