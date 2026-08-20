import { describe, expect, it } from "vitest";
import { evaluateScenario, parseScenario, type Scenario } from "../src/index.js";

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

describe("reply assertions", () => {
  const withReply = (replyMatches: string): Scenario => ({
    ...scenario,
    turns: [{ caller: "Am I talking to a robot?", expect: { replyMatches } }]
  });
  const observation = (text: string) => ({
    turns: [{ ok: true, status: 200, responses: [{ text }] }]
  });

  it("passes when the reply matches the pattern, case-insensitively", () => {
    const result = evaluateScenario(withReply("automated VIRTUAL assistant"), observation("You are speaking with an automated virtual assistant."));
    const reply = result.assertions.find((assertion) => assertion.kind === "reply");
    expect(reply).toMatchObject({ passed: true, turnIndex: 0 });
    expect(result.passed).toBe(true);
  });

  it("fails with the observed reply text when the pattern does not match", () => {
    const result = evaluateScenario(withReply("automated virtual assistant"), observation("Great, what is your account number?"));
    const reply = result.assertions.find((assertion) => assertion.kind === "reply");
    expect(reply).toMatchObject({ passed: false, observed: "Great, what is your account number?" });
    expect(result.passed).toBe(false);
  });

  it("ignores interim chunks and reports missing reply text", () => {
    const result = evaluateScenario(withReply("assistant"), {
      turns: [{ ok: true, status: 200, responses: [{ text: "assistant here", interim: true }] }]
    });
    const reply = result.assertions.find((assertion) => assertion.kind === "reply");
    expect(reply).toMatchObject({ passed: false, observed: "no reply text" });
  });

  it("schema accepts replyMatches and rejects invalid regexes", () => {
    const yaml = (pattern: string) => `
name: schema check
channel: voice
turns:
  - caller: "hello"
    expect:
      replyMatches: "${pattern}"
`;
    expect(parseScenario(yaml("do-not-call list"), "s.yaml").turns[0].expect?.replyMatches).toBe("do-not-call list");
    expect(() => parseScenario(yaml("(unclosed"), "s.yaml")).toThrow(/valid regular expression/);
  });
});
