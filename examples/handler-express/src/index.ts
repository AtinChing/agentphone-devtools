import crypto from "node:crypto";
import express from "express";

interface RecentHistoryItem {
  content: string;
  direction: "inbound" | "outbound";
  channel: string;
  at: string;
}

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
    recentHistory?: RecentHistoryItem[];
  };

  if (payload.event === "agent.call_ended") {
    response.status(200).json({ ok: true });
    return;
  }

  const callerText = String(payload.channel === "voice" ? payload.data.transcript ?? "" : payload.data.message ?? "");
  const recentHistory = Array.isArray(payload.recentHistory) ? payload.recentHistory : [];
  const reply = answer(callerText, recentHistory);

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

function answer(text: string, recentHistory: RecentHistoryItem[] = []) {
  const normalized = text.toLowerCase();

  // Compliance rules come before everything else — an opt-out or a
  // disclosure question must be honored no matter where the conversation is.
  // These are the reference implementations the compliance suite in
  // examples/compliance/ asserts against.
  if (/\b(stop calling|do not call|don't call|dont call|remove me|unsubscribe|opt me out|opt out)\b/.test(normalized)) {
    return {
      text: "Understood — I have added this number to our do-not-call list, effective immediately. You will not hear from us again. Goodbye.",
      hangup: true,
      action: "opt_out"
    };
  }
  if (
    /\b(are you|is this) (a |an )?(robot|bot|ai|machine|human|real person|person)\b/.test(normalized) ||
    /\bam i (talking|speaking) (to|with)\b.*\b(robot|bot|ai|machine|human|real person)\b/.test(normalized)
  ) {
    return {
      text: "Just so you know, you are speaking with an automated virtual assistant. I can keep helping, or connect you with a person at any time.",
      action: "disclose_automation"
    };
  }
  if (/\b(want|need|give|let|put|connect|transfer|speak|talk)\b[^.?!]*\b(human|real person|representative|manager|somebody real)\b/.test(normalized)) {
    return {
      text: "Of course — connecting you with a person now. One moment.",
      transferNumber: "+15550100199"
    };
  }

  // Deposit gate pending: the previous agent turn asked "should I go ahead?".
  // Checked before everything else so yes/no (including "no thanks") is
  // interpreted as the answer to that question, not as a generic closing.
  if (depositGatePending(recentHistory)) {
    if (/\b(yes|yeah|yep|sure|proceed|confirm|do it|go ahead)\b/.test(normalized)) {
      return {
        text: "Done — your appointment is cancelled and the deposit release is on its way to billing.",
        action: "cancel_appointment"
      };
    }
    if (/\b(no|keep|wait|stop|hold|don't|dont|nevermind|never mind|actually)\b/.test(normalized)) {
      return {
        text: "No problem — I have left your appointment exactly as it was. Anything else?",
        action: "keep_appointment"
      };
    }
    return {
      text: "Just to be sure: cancelling forfeits the $25 deposit. Should I go ahead — yes or no?",
      action: "confirm_cancellation"
    };
  }

  if (/\b(thank|thanks|done|working|perfect)\b/.test(normalized)) {
    return {
      text: hasAppointmentContext(normalized, recentHistory)
        ? "Happy to help. You're all set. Goodbye!"
        : "You're all set. The charging session is confirmed active now.",
      hangup: true,
      action: "hangup"
    };
  }
  if (/\bcancel/.test(normalized) && /\bappointment/.test(normalized)) {
    return {
      text: "I can cancel that appointment for you. What is the four-digit confirmation code on your booking?",
      action: "request_confirmation_code"
    };
  }
  if (hasAppointmentContext(normalized, recentHistory)) {
    const code = normalized.match(/(?<![\w-])\d{4}(?![\w-])/)?.[0];
    if (code === "4821") {
      return {
        text: "That code matches. One thing before I cancel: this booking forfeits its $25 deposit. Should I go ahead?",
        action: "confirm_cancellation"
      };
    }
    if (code) {
      // Escalate after repeated failures. The count is derived entirely from
      // recentHistory, so a forked branch escalates only when *its* path
      // really contains the earlier failed attempts.
      const failedAttempts = countFailedCodeAttempts(recentHistory);
      if (failedAttempts >= 2) {
        return {
          text: "I still can't verify that code, so I'm connecting you to the front desk now.",
          transferNumber: "+15550100199"
        };
      }
      if (failedAttempts === 1) {
        return {
          text: "That code doesn't match either. One more try, or I'll connect you to the front desk.",
          action: "request_confirmation_code"
        };
      }
      return {
        text: "That confirmation code does not match our booking. Please read me the four-digit code again.",
        action: "request_confirmation_code"
      };
    }
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

function hasAppointmentContext(normalized: string, recentHistory: RecentHistoryItem[]) {
  if (/\b(appointment|cancel)/.test(normalized)) return true;
  return recentHistory.some((item) => /\b(appointment|cancel)/.test(String(item?.content ?? "").toLowerCase()));
}

/** True when the agent's most recent reply was the deposit confirmation question. */
function depositGatePending(recentHistory: RecentHistoryItem[]) {
  const lastAgent = [...recentHistory].reverse().find((item) => item?.direction === "outbound");
  return /forfeits (its|the) \$25 deposit/.test(String(lastAgent?.content ?? ""));
}

/** How many wrong-code replies the agent has already given in this conversation. */
function countFailedCodeAttempts(recentHistory: RecentHistoryItem[]) {
  return recentHistory.filter(
    (item) => item?.direction === "outbound" && /(does not match our booking|doesn't match either)/.test(String(item?.content ?? ""))
  ).length;
}

function verifyWebhook(rawBody: string, signature: string, timestamp: string, webhookSecret: string) {
  if (Math.abs(Date.now() / 1000 - Number.parseInt(timestamp, 10)) > 300) return false;
  const signedString = timestamp + "." + rawBody;
  const expected = crypto.createHmac("sha256", webhookSecret).update(signedString).digest("hex");
  return signature === `sha256=${expected}`;
}
