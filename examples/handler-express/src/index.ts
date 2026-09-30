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

  let payload: {
    event: "agent.message" | "agent.call_ended";
    channel: "sms" | "mms" | "imessage" | "whatsapp" | "voice";
    data: Record<string, unknown>;
    timestamp?: string;
    recentHistory?: RecentHistoryItem[];
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // A signed but unparseable body is a client error, not a crash.
    response.status(400).json({ error: "malformed JSON body" });
    return;
  }

  if (payload.event === "agent.call_ended") {
    response.status(200).json({ ok: true });
    return;
  }

  const callerText = String(payload.channel === "voice" ? payload.data.transcript ?? "" : payload.data.message ?? "");
  const recentHistory = Array.isArray(payload.recentHistory) ? payload.recentHistory : [];
  // Time-dependent logic reads the event's own timestamp, never the wall
  // clock, so replayed and simulated conversations behave like the originals.
  const nowMs = Date.parse(String(payload.timestamp ?? "")) || Date.now();
  const reply = answer(callerText, recentHistory, nowMs);

  // Message channels accept plain text or a JSON object. Replying with the
  // object form keeps the action fields visible, so message conversations can
  // be asserted on exactly like voice ones.
  response.json(reply);
});

app.listen(port, () => {
  console.log(`Example AgentPhone handler listening on http://localhost:${port}/webhook`);
  console.log(`Webhook secret: ${secret}`);
});

const BUSINESS = "North Lot EV Charging";
const PROMO_OPENER = /fall tune-up special/i;
const PROMO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function answer(text: string, recentHistory: RecentHistoryItem[] = [], nowMs = Date.now()) {
  const normalized = text.toLowerCase();
  const trimmed = normalized.trim();

  // ── Messaging compliance: carrier keywords and opt-out memory ────────────
  // Bare keywords are exact-match on the whole message so "cancel my
  // appointment" is never mistaken for a CANCEL opt-out.
  if (/^(stop|stopall|unsubscribe|end|quit|cancel)\W*$/.test(trimmed)) {
    return {
      text: `You have been unsubscribed from ${BUSINESS} messages and will not receive more. Reply START to resubscribe.`,
      action: "opt_out"
    };
  }
  if (/^(help|info)\W*$/.test(trimmed)) {
    return {
      text: `${BUSINESS}: automated assistant for service updates and offers. Reply STOP to unsubscribe. Support: help@northlot.example or +1 555 010 0199.`,
      action: "help"
    };
  }
  if (/^(start|unstop|subscribe)\W*$/.test(trimmed)) {
    return {
      text: `You are resubscribed to ${BUSINESS} messages. Reply STOP to opt out anytime.`,
      action: "resubscribe"
    };
  }
  // An opted-out number gets no marketing, however long ago the STOP was —
  // the memory lives in the conversation history the platform carries.
  if (isOptedOut(recentHistory)) {
    return {
      text: "This number is currently unsubscribed, so I can't send offers or details. Reply START to resubscribe.",
      action: "opt_out_reminder"
    };
  }

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

  // ── Campaign replies (the opener was sent outside the webhook) ───────────
  const openerAt = campaignOpenerTime(recentHistory);
  if (openerAt !== undefined) {
    if (/\b(no thanks|no thank you|not (right )?now|not interested|maybe later|pass|no$)\b/.test(normalized)) {
      return {
        text: "No problem — I won't follow up about this offer. Text us anytime if you'd like to book.",
        action: "campaign_declined"
      };
    }
    if (/\b(what|which|how much|include|cover|details|tell me more|more info)\b/.test(normalized)) {
      return {
        text: "The tune-up includes a full connector inspection, cable check, and firmware update — about 45 minutes. Reply YES to claim 20% off.",
        action: "campaign_info"
      };
    }
    if (/\b(yes|yeah|yep|sure|claim|sign me up|i'm in|im in|interested|book)\b/.test(normalized)) {
      if (nowMs - openerAt > PROMO_WINDOW_MS) {
        return {
          text: `That fall special ended on ${new Date(openerAt + PROMO_WINDOW_MS).toDateString()}. Our current offer is 10% off tune-ups booked this month — reply YES if you'd like that instead.`,
          action: "promo_expired"
        };
      }
      return {
        text: "You're in! Your code is FALL20 — show it at check-in for 20% off any service. Offer valid through the end of the week.",
        action: "issue_promo_code"
      };
    }
    if (/\b(thank|thanks|perfect|great)\b/.test(normalized)) {
      return {
        text: "You're welcome! Show code FALL20 at check-in. See you soon.",
        action: "campaign_closed"
      };
    }
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

/** When the campaign opener was sent, from the outbound history the platform carries. */
function campaignOpenerTime(recentHistory: RecentHistoryItem[]): number | undefined {
  const opener = recentHistory.find((item) => item?.direction === "outbound" && PROMO_OPENER.test(String(item?.content ?? "")));
  if (!opener) return undefined;
  const at = Date.parse(String(opener.at ?? ""));
  return Number.isFinite(at) ? at : undefined;
}

/** Opted out = the agent confirmed an unsubscribe and has not confirmed a resubscribe since. */
function isOptedOut(recentHistory: RecentHistoryItem[]): boolean {
  let optedOut = false;
  for (const item of recentHistory) {
    if (item?.direction !== "outbound") continue;
    const content = String(item?.content ?? "");
    if (/have been unsubscribed/i.test(content)) optedOut = true;
    if (/resubscribed to/i.test(content)) optedOut = false;
  }
  return optedOut;
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
