import { describe, expect, it } from "vitest";
import { parseRuntimeConfigUpdate, RuntimeConfigValidationError } from "../src/config.js";

describe("scenario override validation", () => {
  it("accepts supported scenario overrides", () => {
    expect(
      parseRuntimeConfigUpdate({
        targetUrl: "http://127.0.0.1:3000/webhook",
        secret: "whsec_new",
        channel: "sms",
        timeoutSeconds: 45,
        contextLimit: 20,
        retryOnNon200: true
      })
    ).toEqual({
      targetUrl: "http://127.0.0.1:3000/webhook",
      secret: "whsec_new",
      channel: "sms",
      timeoutSeconds: 45,
      contextLimit: 20,
      retryOnNon200: true
    });
  });

  it("rejects invalid values and unknown settings together", () => {
    try {
      parseRuntimeConfigUpdate({
        targetUrl: "file:///tmp/webhook",
        secret: "",
        channel: "fax",
        timeoutSeconds: 2,
        contextLimit: 51,
        retryOnNon200: "yes",
        historyPath: "/tmp/escape"
      });
      throw new Error("Expected validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeConfigValidationError);
      expect((error as RuntimeConfigValidationError).issues).toHaveLength(7);
    }
  });
});
