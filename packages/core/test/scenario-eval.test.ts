import { describe, expect, it } from "vitest";
import { evaluateScenario, type Scenario } from "../src/index.js";

const scenario: Scenario = {
  name: "Escalate billing issue",
  channel: "voice",
  agentId: "agt_local",
  numberId: "num_local",
  from: "+15559876543",
  to: "+15551234567",
  conversationState: null,
  contextLimit: 10,
  timeoutSeconds: 30,
  turns: [{ caller: "I need a billing specialist", expect: { actions: ["transfer"] } }]
};

describe("scenario assertions", () => {
  it("passes successful deliveries and per-turn actions", () => {
    const result = evaluateScenario(scenario, {
      turns: [{ ok: true, status: 200, responses: [{ action: "transfer", transferNumber: "+15551234567" }] }],
      callEnded: { ok: true, status: 204, responses: [] }
    });

    expect(result).toMatchObject({ passed: true, passedCount: 3, failedCount: 0 });
    expect(result.assertions.map((assertion) => assertion.kind)).toEqual(["delivery", "action", "delivery"]);
  });

  it("explains failed deliveries and missing actions", () => {
    const result = evaluateScenario(scenario, {
      turns: [{ ok: false, status: 500, responses: [{ text: "Try again later" }] }]
    });

    expect(result).toMatchObject({ passed: false, passedCount: 0, failedCount: 2 });
    expect(result.assertions.map((assertion) => assertion.observed)).toEqual(["HTTP 500", "none"]);
  });

  it("recognizes hangup and transfer aliases", () => {
    const result = evaluateScenario(
      { ...scenario, turns: [{ caller: "Done", expect: { actions: ["hangup", "transfer"] } }] },
      {
        turns: [{ ok: true, status: 200, responses: [{ hangup: true, transferNumber: "+15551234567" }] }]
      }
    );

    expect(result.assertions.filter((assertion) => assertion.kind === "action").every((assertion) => assertion.passed)).toBe(true);
  });
});
