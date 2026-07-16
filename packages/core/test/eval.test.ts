import { describe, expect, it } from "vitest";
import { evaluateConversation } from "../src/index.js";

describe("deterministic eval", () => {
  it("marks resolved conversations when call-ended analysis succeeds", () => {
    const result = evaluateConversation({
      transcript: [
        { role: "user", content: "My charger stopped at station 12" },
        { role: "agent", content: "I reset station 12. You are all set." }
      ],
      callEnded: {
        callId: "call_test",
        numberId: "num_local",
        from: "+15559876543",
        to: "+15551234567",
        direction: "inbound",
        status: "completed",
        startedAt: "2025-01-15T14:00:00Z",
        endedAt: "2025-01-15T14:01:00Z",
        durationSeconds: 60,
        disconnectionReason: "agent_hangup",
        transcript: [],
        summary: "Resolved charging issue",
        userSentiment: "Positive",
        callSuccessful: true
      },
      expectedOutcome: "resolved"
    });

    expect(result.outcome).toBe("resolved");
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it("marks transfer as handed off", () => {
    const result = evaluateConversation({
      transcript: [{ role: "user", content: "I need a human for billing" }],
      responses: [{ text: "I'll transfer you.", action: "transfer" }]
    });

    expect(result.outcome).toBe("handed_off");
  });

  it("recognizes boolean hangup and transfer-number action aliases", () => {
    const result = evaluateConversation({
      transcript: [{ role: "user", content: "Please transfer me when this is done" }],
      responses: [{ hangup: true }, { transferNumber: "+15551234567" }],
      expectedActions: ["hangup", "transfer"]
    });

    expect(result.correctActions).toBe(true);
  });
});
