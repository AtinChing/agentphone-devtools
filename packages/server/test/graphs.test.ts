import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GraphAuthoringStore } from "../src/graphs.js";

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

describe("graph authoring store", () => {
  it("lists, reviews, forks, and compiles a family graph", async () => {
    const directory = temporaryDirectory();
    writeFileSync(
      join(directory, "family.yaml"),
      `version: 1
metadata:
  name: Demo family
  channel: voice
nodes:
  greeting:
    caller: Hello
    review: { status: approved }
  billing:
    caller: Billing help
    review: { status: pending }
edges:
  - { from: greeting, to: billing, label: billing }
paths:
  billing:
    route: [greeting, billing]
`,
      "utf8"
    );

    const store = new GraphAuthoringStore(directory);
    const listed = await store.listFamilies();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe("family");

    const reviewed = await store.reviewNode("family", "billing", {
      status: "approved",
      correctedTranscript: "I need billing help"
    });
    expect(reviewed.graph.nodes.billing.review?.status).toBe("approved");

    const forked = await store.forkPath("family", {
      sourcePath: "billing",
      fromNodeId: "greeting",
      newPathName: "outage",
      continuation: { nodeId: "outage", caller: "Outage please" }
    });
    expect(Object.keys(forked.graph.paths).sort()).toEqual(["billing", "outage"]);

    const compiled = await store.compileFamily("family", { paths: ["billing"] });
    expect(compiled.cases).toHaveLength(1);
    expect(compiled.cases[0].scenario.turns.map((turn) => turn.caller)).toEqual(["Hello", "Billing help"]);

    const yaml = readFileSync(join(directory, "family.yaml"), "utf8");
    expect(yaml).toContain("outage");
    expect(yaml).toContain("approved");
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agentphone-graphs-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
