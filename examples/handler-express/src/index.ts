import crypto from "node:crypto";
import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const secret = process.env.AGENTPHONE_WEBHOOK_SECRET ?? "whsec_demo";

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/webhook", express.raw({ type: "application/json" }), (request, response) => {
  const rawBody = Buffer.isBuffer(request.body) ? request.body.toString("utf8") : "";
  const signature = String(request.header("X-Webhook-Signature") ?? "");
  const timestamp = String(request.header("X-Webhook-Timestamp") ?? "");

  if (!verifyWebhook(rawBody, signature, timestamp, secret)) {
    response.status(401).json({ error: "invalid signature" });
    return;
  }

  const payload = JSON.parse(rawBody) as {
    event: "agent.message" | "agent.call_ended";
    channel: "sms" | "voice";
    data: Record<string, unknown>;
  };

  if (payload.event === "agent.call_ended") {
    response.status(200).json({ ok: true });
    return;
  }

  const callerText = String(payload.channel === "voice" ? payload.data.transcript ?? "" : payload.data.message ?? "");
  const reply = answer(callerText);

  if (payload.channel === "voice") {
    response.json(reply);
  } else {
    response.type("text/plain").send(reply.text);
  }
});

app.listen(port, () => {
  console.log(`Example AgentPhone handler listening on http://localhost:${port}/webhook`);
  console.log(`Webhook secret: ${secret}`);
});

function answer(text: string) {
  const normalized = text.toLowerCase();
  if (/\b(thank|thanks|done|working|perfect)\b/.test(normalized)) {
    return {
      text: "You're all set. The charging session is confirmed active now.",
      hangup: true,
      action: "hangup"
    };
  }
  if (/\b(ev-?2204|station 12|stall 12|connector 12)\b/.test(normalized)) {
    return {
      text: "I found EV-2204 at stall 12 and reset the connector. Please unplug, plug back in, and start the session again."
    };
  }
  if (/\b(charg|ev|stall|station|connector)\b/.test(normalized)) {
    return {
      text: "I can help with that. What station, stall, or session ID is on the charger?"
    };
  }
  return {
    text: "I can help with AgentPhone's local demo handler. Share the charging station or session ID and I will check it."
  };
}

function verifyWebhook(rawBody: string, signature: string, timestamp: string, webhookSecret: string) {
  if (Math.abs(Date.now() / 1000 - Number.parseInt(timestamp, 10)) > 300) return false;
  const signedString = timestamp + "." + rawBody;
  const expected = crypto.createHmac("sha256", webhookSecret).update(signedString).digest("hex");
  return signature === `sha256=${expected}`;
}
