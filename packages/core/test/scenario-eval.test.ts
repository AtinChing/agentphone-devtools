import { describe, expect, it } from "vitest";
import { evaluateScenario, type EvalResult, type Scenario } from "../src/index.js";

const evalResult: EvalResult = {
  outcome: "handed_off",
  stayedOnTask: true,
  correctActions: true,
  score: 80,
  reasons: ["handler requested transfer"],
  metrics: { turnCount: 2, agentTurns: 1, userTurns: 1, deadAirTurns: 0 }
};

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
  expectedOutcome: "handed_off",
  turns: [{ caller: "I need a billing specialist", expect: { actions: ["transfer"] } }]
};

describe("scenario assertions", () => {
  it("passes successful deliveries, per-turn actions, and the final outcome", () => {
    const result = evaluateScenario(scenario, {
      turns: [{ ok: true, status: 200, responses: [{ action: "transfer", transferNumber: "+15551234567" }] }],
      callEnded: { ok: true, status: 204, responses: [] },
      evalResult
    });

    expect(result).toMatchObject({ passed: true, passedCount: 4, failedCount: 0 });
    expect(result.assertions.map((assertion) => assertion.kind)).toEqual(["delivery", "action", "delivery", "outcome"]);
  });

  it("explains failed deliveries, missing actions, and outcome mismatches", () => {
    const result = evaluateScenario(scenario, {
      turns: [{ ok: false, status: 500, responses: [{ text: "Try again later" }] }],
      evalResult: { ...evalResult, outcome: "failed", correctActions: false }
    });

    expect(result).toMatchObject({ passed: false, passedCount: 0, failedCount: 3 });
    expect(result.assertions.map((assertion) => assertion.observed)).toEqual(["HTTP 500", "none", "failed"]);
  });

  it("recognizes hangup and transfer aliases", () => {
    const result = evaluateScenario(
      { ...scenario, turns: [{ caller: "Done", expect: { actions: ["hangup", "transfer"] } }] },
      {
        turns: [{ ok: true, status: 200, responses: [{ hangup: true, transferNumber: "+15551234567" }] }],
        evalResult
      }
    );

    expect(result.assertions.filter((assertion) => assertion.kind === "action").every((assertion) => assertion.passed)).toBe(true);
  });
});
