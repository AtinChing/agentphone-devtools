import crypto from "node:crypto";
import express from "express";

interface RecentHistoryItem {
  content: string;
  direction: "inbound" | "outbound";
  channel: string;
  at: string;
}

type Channel = "sms" | "mms" | "imessage" | "whatsapp" | "voice";

interface Reply {
  text: string;
  action?: string;
  hangup?: boolean;
  transferNumber?: string;
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
    channel: Channel;
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
  const reply = answer(callerText, recentHistory, nowMs, payload.channel);

  // Message channels accept plain text or a JSON object. Replying with the
  // object form keeps the action fields visible, so message conversations can
  // be asserted on exactly like voice ones.
  response.json(reply);
});

app.listen(port, () => {
  console.log(`Example AgentPhone handler listening on http://localhost:${port}/webhook`);
  console.log(`Webhook secret: ${secret}`);
});

// ── The business this reference agent works for ──────────────────────────────

const BUSINESS = "North Lot EV Charging";
const FRONT_DESK = "+15550100199";
const ON_CALL_TECH = "+15550100911";
const PROMO_OPENER = /fall tune-up special/i;
const PROMO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const BUSINESS_TIMEZONE = "America/Los_Angeles";
const OPEN_HOUR = 8; // Front desk: Mon–Sat, 8 AM – 6 PM Pacific. The agent itself answers 24/7.
const CLOSE_HOUR = 18;
const STATIONS: Record<string, { stall: number; status: string }> = {
  "EV-2204": { stall: 12, status: "available — 2 of 4 connectors free" },
  "EV-1100": { stall: 4, status: "in use — the next connector should free up in about 20 minutes" },
  "EV-3310": { stall: 7, status: "offline for maintenance until 4:00 PM today" }
};

/**
 * Rule-ordered reference agent. Each section documents one behavior the
 * scenario suites assert on; the order matters, and the comments say why.
 */
function answer(text: string, recentHistory: RecentHistoryItem[] = [], nowMs = Date.now(), channel: Channel = "sms"): Reply {
  const normalized = text.toLowerCase();
  const trimmed = normalized.trim();
  const isVoice = channel === "voice";
  const lastAgent = lastOutbound(recentHistory);

  // ── 1. Messaging compliance: carrier keywords and opt-out memory ─────────
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

  // ── 2. Universal compliance: opt-out phrases, disclosure, escalation ─────
  // These come before everything else — an opt-out or a disclosure question
  // must be honored no matter where the conversation is. They are the
  // reference implementations the compliance suite asserts against.
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
  if (/\b(want|need|give|let|put|connect|transfer|speak|talk)\b[^.?!]*\b(human|real person|representative|manager|somebody real|someone|a person)\b/.test(normalized)) {
    // Always a transfer, never a deflection — but the destination depends on
    // the hour: the front desk by day, the on-call line when it is closed.
    if (!isOpen(nowMs)) {
      return {
        text: "Of course. The front desk is closed right now (8 AM to 6 PM Pacific), so I'm connecting you to our on-call line. One moment.",
        transferNumber: ON_CALL_TECH,
        action: "after_hours_transfer"
      };
    }
    return {
      text: "Of course — connecting you with a person now. One moment.",
      transferNumber: FRONT_DESK
    };
  }
  // A charging emergency goes to the on-call technician at any hour.
  if (/\b(emergency|sparking|sparks|smoke|smoking|on fire|burning smell)\b/.test(normalized)) {
    return {
      text: "That sounds urgent — stay clear of the charger. I'm connecting you to the on-call technician right now.",
      transferNumber: ON_CALL_TECH
    };
  }

  // ── 3. Language: answer Spanish in Spanish, and stay in Spanish ──────────
  const spanishTurn = /\b(hola|buenos d[ií]as|buenas tardes|necesito|ayuda|cargador|gracias|cita|estaci[oó]n)\b/.test(normalized);
  const spanishThread = /soy el asistente autom[aá]tico/i.test(lastAgent);
  if (spanishTurn || spanishThread) {
    if (/\bgracias\b/.test(normalized)) {
      return { text: "¡Con gusto! Que tenga un buen día.", action: "language_es", ...(isVoice ? { hangup: true } : {}) };
    }
    const station = stationId(normalized);
    if (station && STATIONS[station]) {
      return {
        text: `Encontré la ${station} en el puesto ${STATIONS[station].stall} y reinicié el conector. Desconecte, vuelva a conectar e inicie la sesión de nuevo.`,
        action: "station_reset"
      };
    }
    return {
      text: `¡Hola! Soy el asistente automático de ${BUSINESS}. ¿Me puede indicar el número de la estación o de la sesión de carga?`,
      action: "language_es"
    };
  }

  // ── 4. Pending questions: the previous agent turn asked something ─────────
  // Checked before new intents so "yes", "no" or a bare number is read as
  // the answer to that question, not as a fresh request.

  // Deposit gate: "should I go ahead?"
  if (/forfeits (its|the) \$25 deposit/.test(lastAgent)) {
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

  // Billing: "last four digits of the card?"
  if (/last four digits of the card/.test(lastAgent)) {
    const digits = normalized.match(/(?<!\d)\d{4}(?!\d)/)?.[0];
    if (digits) {
      return {
        text: `I see two charges of $18.40 on the 14th on the card ending ${digits}. I've opened dispute BD-20417 and the duplicate will be refunded within 3 business days.`,
        action: "open_dispute"
      };
    }
    return { text: "I need the last four digits of the card to find the charge — just the four numbers.", action: "request_card_digits" };
  }

  // Scheduling, step 2: "what day works?"
  if (/what day works/.test(lastAgent)) {
    const day = dayFrom(normalized);
    if (day) {
      return { text: `On ${day} I have 9:00 AM or 2:00 PM. Which works?`, action: "offer_slots" };
    }
    return { text: "Which day would you like — for example Thursday, or tomorrow?", action: schedulingKind(recentHistory) === "booking" ? "request_booking_day" : "request_reschedule_day" };
  }

  // Scheduling, step 3: "9:00 AM or 2:00 PM?"
  if (/9:00 AM or 2:00 PM/.test(lastAgent)) {
    const day = lastAgent.match(/^On (\w+) I have/)?.[1] ?? "that day";
    const slot = /\b(2|two|afternoon|2:00|2 ?pm)\b/.test(normalized) ? "2:00 PM" : /\b(9|nine|morning|9:00|9 ?am)\b/.test(normalized) ? "9:00 AM" : undefined;
    if (!slot) return { text: `9:00 AM or 2:00 PM on ${day} — which one?`, action: "offer_slots" };
    if (schedulingKind(recentHistory) === "booking") {
      return {
        text: `You're booked for ${day} at ${slot} at North Lot, stall 12. Your confirmation code is 7731 — reply R anytime to reschedule.`,
        action: "booking_confirmed"
      };
    }
    return {
      text: `Done — your appointment is moved to ${day} at ${slot}. Your confirmation code is still 4821.`,
      action: "reschedule_confirmed"
    };
  }

  // Appointment reminder: "Reply C to confirm or R to reschedule."
  if (/Reply C to confirm or R to reschedule/.test(lastAgent)) {
    if (/^(c|confirm|confirmed|yes|yep|ok)\W*$/.test(trimmed) || /\b(confirm|i'll be there|see you)\b/.test(normalized)) {
      return { text: "Confirmed — see you tomorrow at 9:00 AM at North Lot, stall 12. Reply R anytime to reschedule.", action: "appointment_confirmed" };
    }
    if (/^r\W*$/.test(trimmed) || /\b(reschedule|move|change)\b/.test(normalized)) {
      return { text: "Sure — what day works for you to move it to?", action: "request_reschedule_day" };
    }
  }

  // ── 5. Campaign replies (the opener was sent outside the webhook) ────────
  const openerAt = campaignOpenerTime(recentHistory);
  if (openerAt !== undefined) {
    if (/your code is fall20/i.test(joinOutbound(recentHistory)) && /\b(how|where)\b.*\b(use|enter|redeem|apply|show)\b|\b(use|redeem|apply) (the|my|this) code\b/.test(normalized)) {
      return {
        text: "Just show FALL20 at check-in — or in the app, go to Payment → Promo code before you start the session and it applies automatically.",
        action: "promo_instructions"
      };
    }
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

  // ── 6. Closings ──────────────────────────────────────────────────────────
  // "Is EV-3310 working?" is a status question, not a closing.
  if (/\b(thank|thanks|done|working|perfect)\b/.test(normalized) && !stationId(normalized)) {
    return {
      text: hasAppointmentContext(normalized, recentHistory)
        ? "Happy to help. You're all set. Goodbye!"
        : "You're all set. The charging session is confirmed active now.",
      hangup: true,
      action: "hangup"
    };
  }

  // ── 7. Appointments: cancel (with code + deposit gate), reschedule, book ──
  if (/\bcancel/.test(normalized) && /\bappointment/.test(normalized)) {
    return {
      text: "I can cancel that appointment for you. What is the four-digit confirmation code on your booking?",
      action: "request_confirmation_code"
    };
  }
  if (/\b(reschedule|move|change|push back|different (day|time))\b/.test(normalized) && /\b(appointment|booking|tune-up|visit|it)\b/.test(normalized)) {
    return { text: "Sure — what day works for you to move it to?", action: "request_reschedule_day" };
  }
  if (/\b(book|schedule|set up|make|get)\b[^.?!]*\b(tune-up|appointment|service|visit|slot)\b/.test(normalized) || /\bcan i book\b/.test(normalized)) {
    return { text: "Happy to book you in — what day works?", action: "request_booking_day" };
  }
  if (/\b(when is|when's|what time is|what day is)\b[^.?!]*\b(appointment|booking|tune-up)\b|\bnext appointment\b/.test(normalized)) {
    return { text: "Your next appointment is Thursday at 9:00 AM at North Lot, stall 12. Reply R to reschedule.", action: "appointment_lookup" };
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
          transferNumber: FRONT_DESK
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

  // ── 8. Account and billing ───────────────────────────────────────────────
  if (/\b(charged twice|double[- ]charg|charged me twice|two charges|duplicate charge|overcharg|refund)\b/.test(normalized)) {
    return { text: "I'm sorry about that. To find the charge, what are the last four digits of the card?", action: "request_card_digits" };
  }
  if (/\b(who is this|who's this|who are you|wrong number|didn'?t sign up|never signed up|how did you get (my|this) number)\b/.test(normalized)) {
    return {
      text: `This is the automated assistant for ${BUSINESS}. You're receiving this because this number was used to book a charging session with us. Reply STOP and you won't hear from us again.`,
      action: "identify_business"
    };
  }
  if (/\b(opt[- ]in|sign me up for (whatsapp )?updates|updates on whatsapp|whatsapp updates|get updates)\b/.test(normalized)) {
    return {
      text: `You're opted in to ${BUSINESS} updates on this channel: booking confirmations, reminders and charger alerts. Reply STOP anytime to opt out.`,
      action: "whatsapp_opt_in"
    };
  }
  if (/\b(where (are|is) (you|the station|north lot)|your address|location|directions|how do i get there)\b/.test(normalized)) {
    return {
      text: `${BUSINESS} is at 1200 North Lot Way, Davis, CA 95616 — the entrance is off Russell Blvd, next to the parking structure. Map: https://maps.example/northlot`,
      action: "send_location"
    };
  }

  // ── 9. Chargers: status lookups and the connector reset ─────────────────
  const station = stationId(normalized);
  if (station && /\b(available|status|free|open|busy|in use|working|up|down|offline)\b/.test(normalized)) {
    const known = STATIONS[station];
    if (!known) {
      return { text: `I don't see a station ${station}. Station IDs look like EV-2204 and are printed above the connector.`, action: "station_unknown" };
    }
    return { text: `${station} (stall ${known.stall}) is ${known.status}.`, action: "station_status" };
  }
  if (station === "EV-2204" || /\b(station 12|stall 12|connector 12)\b/.test(normalized)) {
    return {
      text: "I found EV-2204 at stall 12 and reset the connector. Please unplug, plug back in, and start the session again.",
      action: "station_reset"
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

// ── Conversation memory, derived entirely from recentHistory ─────────────────

function lastOutbound(recentHistory: RecentHistoryItem[]): string {
  const last = [...recentHistory].reverse().find((item) => item?.direction === "outbound");
  return String(last?.content ?? "");
}

function joinOutbound(recentHistory: RecentHistoryItem[]): string {
  return recentHistory
    .filter((item) => item?.direction === "outbound")
    .map((item) => String(item?.content ?? ""))
    .join("\n");
}

function hasAppointmentContext(normalized: string, recentHistory: RecentHistoryItem[]) {
  if (/\b(appointment|cancel)/.test(normalized)) return true;
  return recentHistory.some((item) => /\b(appointment|cancel)/.test(String(item?.content ?? "").toLowerCase()));
}

/** Which scheduling question opened the current flow: a new booking or moving an existing one. */
function schedulingKind(recentHistory: RecentHistoryItem[]): "booking" | "reschedule" {
  const outbound = recentHistory.filter((item) => item?.direction === "outbound").map((item) => String(item?.content ?? ""));
  const opener = [...outbound].reverse().find((content) => /what day works/.test(content));
  return opener && /book you in/.test(opener) ? "booking" : "reschedule";
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

/** How many wrong-code replies the agent has already given in this conversation. */
function countFailedCodeAttempts(recentHistory: RecentHistoryItem[]) {
  return recentHistory.filter(
    (item) => item?.direction === "outbound" && /(does not match our booking|doesn't match either)/.test(String(item?.content ?? ""))
  ).length;
}

// ── Small parsers ────────────────────────────────────────────────────────────

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function dayFrom(normalized: string): string | undefined {
  if (/\btomorrow\b/.test(normalized)) return "tomorrow";
  if (/\btoday\b/.test(normalized)) return "today";
  const day = DAYS.find((name) => new RegExp(`\\b${name.slice(0, 3)}\\w*\\b`).test(normalized));
  return day ? day[0].toUpperCase() + day.slice(1) : undefined;
}

function stationId(normalized: string): string | undefined {
  const match = normalized.match(/\bev[- ]?(\d{4})\b/);
  if (match) return `EV-${match[1]}`;
  if (/\b(station|stall|connector) 12\b/.test(normalized)) return "EV-2204";
  return undefined;
}

/** Business hours in the business's own timezone, from the event timestamp. */
function isOpen(nowMs: number): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIMEZONE, hour: "numeric", hour12: false, weekday: "short" }).formatToParts(new Date(nowMs));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  if (weekday === "Sun") return false;
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

function verifyWebhook(rawBody: string, signature: string, timestamp: string, webhookSecret: string) {
  if (Math.abs(Date.now() / 1000 - Number.parseInt(timestamp, 10)) > 300) return false;
  const signedString = timestamp + "." + rawBody;
  const expected = crypto.createHmac("sha256", webhookSecret).update(signedString).digest("hex");
  return signature === `sha256=${expected}`;
}
