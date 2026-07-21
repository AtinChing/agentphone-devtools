import { describe, expect, it } from "vitest";
import { parseScenario } from "../src/index.js";

describe("flat scenario parsing", () => {
  it("accepts the per-turn outcome expectation exposed by the Scenario type", () => {
    const scenario = parseScenario(`
name: Outcome expectation
turns:
  - caller: Thanks, that fixed it.
    expect:
      outcome: resolved
`);

    expect(scenario.turns[0].expect?.outcome).toBe("resolved");
  });
});
