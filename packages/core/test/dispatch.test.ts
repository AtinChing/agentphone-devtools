import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { buildMessageEvent, buildVoiceMessageEvent, dispatchWebhook } from "../src/index.js";

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("channel response parsing", () => {
  it("normalizes plain-text SMS replies into agent response chunks", async () => {
    const targetUrl = await webhookTarget("text/plain", "Your charger is fixed and ready.");
    const chunks: unknown[] = [];

    const result = await dispatchWebhook(buildMessageEvent({ message: "Check charger 12", channel: "sms" }), {
      targetUrl,
      secret: "whsec_test",
      onChunk: (chunk) => chunks.push(chunk)
    });

    expect(result.parsed).toEqual({
      mode: "text",
      final: { text: "Your charger is fixed and ready." },
      chunks: [{ text: "Your charger is fixed and ready." }],
      warnings: []
    });
    expect(chunks).toEqual([{ text: "Your charger is fixed and ready." }]);
  });

  it("normalizes JSON-string SMS replies", async () => {
    const targetUrl = await webhookTarget("application/json", JSON.stringify("Your charger is ready."));

    const result = await dispatchWebhook(buildMessageEvent({ message: "Check charger 12", channel: "sms" }), {
      targetUrl,
      secret: "whsec_test"
    });

    expect(result.parsed).toMatchObject({
      mode: "json",
      final: { text: "Your charger is ready." },
      warnings: []
    });
  });

  it("keeps plain-text voice replies invalid for the voice contract", async () => {
    const targetUrl = await webhookTarget("text/plain", "This should not be spoken.");

    const result = await dispatchWebhook(buildVoiceMessageEvent({ transcript: "Hello" }), {
      targetUrl,
      secret: "whsec_test"
    });

    expect(result.parsed).toEqual({
      mode: "text",
      chunks: [],
      warnings: ["Non-object response ignored by voice contract; caller hears silence"]
    });
  });
});

async function webhookTarget(contentType: string, body: string): Promise<string> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": contentType });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test webhook did not bind to a TCP port");
  return `http://127.0.0.1:${address.port}/webhook`;
}
