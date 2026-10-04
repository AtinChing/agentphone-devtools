import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { Page, PageBody, PageHeader } from "@/components/dashboard/ui";
import { DocsBlock, DocsCode, DocsSection, DocsSubheading, DocsTable, DocsToc } from "@/components/dashboard/DocsBlocks";

const REPO_URL = "https://github.com/AtinChing/agentphone-devtools";

const SECTIONS = [
  { id: "quickstart", title: "Quickstart" },
  { id: "webhook-contract", title: "The webhook contract" },
  { id: "scenarios", title: "Scenario files" },
  { id: "simulated-time", title: "Simulated time" },
  { id: "messaging", title: "Messaging & campaigns" },
  { id: "step-debugger", title: "Step debugger & forking" },
  { id: "cli", title: "CLI reference" },
  { id: "http-api", title: "HTTP API" }
];

const VERIFY_SNIPPET = `import crypto from "node:crypto";
import express from "express";

const app = express();
const secret = process.env.AGENTPHONE_WEBHOOK_SECRET;

function verifyWebhook(rawBody, signature, timestamp, secret) {
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false; // replay window
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(\`\${ts}.\${rawBody}\`).digest("hex");
  const actual = Buffer.from(signature);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, Buffer.from(expected));
}

// express.raw keeps the exact bytes that were signed; never re-stringify parsed JSON.
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const rawBody = req.body.toString("utf8");
  if (!verifyWebhook(rawBody, req.get("X-Webhook-Signature") ?? "", req.get("X-Webhook-Timestamp") ?? "", secret)) {
    return res.status(401).json({ error: "invalid signature" });
  }
  const event = JSON.parse(rawBody);
  res.json({ text: \`You said: \${event.data.message ?? event.data.transcript}\` });
});`;

const SCENARIO_SNIPPET = `name: Campaign reply — interested          # shown in pickers, reports, and JUnit
description: Opener goes out via the API; the customer replies YES two hours later.
channel: imessage                          # sms | imessage | whatsapp | voice (default: voice)
startAt: "2026-10-01T09:00:00Z"            # optional: pin the simulated clock before turn 1
conversationState:                         # sent as-is in every envelope (or null)
  customerName: Jordan Reyes
  tier: standard
contextLimit: 10                           # recentHistory size, 0–50 (default 10)
timeoutSeconds: 30                         # per-delivery timeout, 5–120 (default 30)
turns:
  # Outbound business message sent outside the webhook (campaign opener).
  # Seeded into the transcript and recentHistory; never delivered.
  - agent: "Hi Jordan, it's North Lot EV Charging. Fall tune-up special: 20% off any service booked this week. Reply YES to claim, or STOP to opt out."

  - caller: "YES"
    after: 2h                              # advance the simulated clock first
    expect:
      actions: [issue_promo_code]          # every one must appear in the reply
      forbiddenActions: [opt_out]          # none of these may appear
      replyMatches: "FALL20"               # case-insensitive regex on the reply text

  - caller: "Thanks!"
    expect:
      actions: [campaign_closed]

  - caller: "This copy arrives with a forged signature."
    fault:
      invalidSignature: true               # break this one delivery on purpose
    expect:
      status: 401                          # the rejection is the pass condition
      retries: 0`;

const NDJSON_SNIPPET = `{"text":"One moment while I check that.","interim":true}
{"text":"Bay 4 is back online. Anything else?"}`;

export default function DocumentationPage() {
  return (
    <Page>
      <PageHeader
        title="Documentation"
        subtitle="Run your AgentPhone agent against the local simulator: the contract, scenarios, time travel, and the debugger."
        actions={
          <a
            href={`${REPO_URL}#readme`}
            target="_blank"
            rel="noreferrer"
            className="focus-ring flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-white/[0.06] px-3.5 text-[14px] font-medium leading-none text-white transition-colors hover:bg-white/[0.1] active:scale-[0.96]"
          >
            README on GitHub
            <ArrowSquareOut size={14} weight="bold" className="text-white/50" />
          </a>
        }
      />

      <PageBody>
        <div className="grid gap-8 lg:grid-cols-[210px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <DocsToc items={SECTIONS} />
          </aside>

          <article className="min-w-0 max-w-[880px] space-y-10 rounded-[18px] bg-card px-6 py-8 shadow-card backdrop-blur-[2px] md:px-8">
            <DocsSection id="quickstart" title="Quickstart">
              <p>Everything runs locally: no AgentPhone account, no real numbers, no carrier traffic.</p>
              <DocsBlock label="1 · Install and build" code={"npm install\nnpm run build"} />
              <DocsBlock
                label="2 · Start a handler (the reference one verifies signatures and implements the campaign rules)"
                code="npm --workspace examples/handler-express start"
              />
              <DocsBlock
                label="3 · Start the simulator and open this dashboard"
                code="npx agentphone-devtools --target http://localhost:3000/webhook --secret whsec_demo"
              />
              <p>
                The API listens on <DocsCode>4318</DocsCode> and the dashboard on <DocsCode>4319</DocsCode> (the next free port if either is taken).
                To gate a build on a whole suite, run headlessly; the process exits <DocsCode>1</DocsCode> if any assertion fails:
              </p>
              <DocsBlock
                label="4 · Run a suite in CI"
                code="npx agentphone-devtools --ci --target http://localhost:3000/webhook --secret whsec_demo --scenario-dir examples/messaging"
              />
            </DocsSection>

            <DocsSection id="webhook-contract" title="The webhook contract">
              <p>
                Every caller turn becomes one signed <DocsCode>POST</DocsCode> of an AgentPhone event envelope to your target. The body is serialized
                once, signed, and sent byte for byte.
              </p>
              <DocsTable
                head={["Field", "Meaning"]}
                rows={[
                  [
                    "event",
                    <span>
                      <DocsCode>agent.message</DocsCode> per inbound message or utterance; <DocsCode>agent.call_ended</DocsCode> once when a call
                      ends.
                    </span>
                  ],
                  ["channel", "sms, mms, imessage, whatsapp, or voice."],
                  ["timestamp", "ISO time of the event, on the simulated clock."],
                  ["agentId", "The agent receiving the event (agt_local)."],
                  ["data (messages)", "conversationId, numberId, from, to, message, mediaUrl, direction, receivedAt."],
                  ["data (voice)", "callId, numberId, from, to, status (in-progress), transcript, confidence, direction."],
                  [
                    "data (call ended)",
                    "callId, startedAt, endedAt, durationSeconds, disconnectionReason, transcript[], summary, userSentiment, callSuccessful."
                  ],
                  ["conversationState", "What the business already knows about the customer, or null."],
                  ["recentHistory", "The last N messages (the context limit) as { content, direction, channel, at }."]
                ]}
              />
              <DocsSubheading>Signing headers</DocsSubheading>
              <DocsTable
                head={["Header", "Value"]}
                rows={[
                  [
                    "X-Webhook-Signature",
                    <span>
                      <DocsCode>sha256=</DocsCode> + hex HMAC-SHA256(secret, <DocsCode>{"`${timestamp}.${rawBody}`"}</DocsCode>)
                    </span>
                  ],
                  ["X-Webhook-Timestamp", "Unix seconds at signing. Always real time, even when the simulated clock is warped."],
                  ["X-Webhook-ID", "wh_<uuid>, unique per delivery and reused on retries: dedupe on it."],
                  ["X-Webhook-Event", "Same as the envelope's event."]
                ]}
              />
              <DocsBlock label="Verify, then answer (Node + Express)" code={VERIFY_SNIPPET} />
              <DocsSubheading>Reply formats</DocsSubheading>
              <p>
                For every channel, answer <DocsCode>200</DocsCode> with a JSON object. <DocsCode>text</DocsCode> is the reply;{" "}
                <DocsCode>action</DocsCode> is a free-form label scenarios assert on; <DocsCode>hangup: true</DocsCode> ends a call (and counts as the
                action <DocsCode>hangup</DocsCode>); <DocsCode>transferNumber</DocsCode> transfers it (counts as <DocsCode>transfer</DocsCode>).
                Message channels also accept a plain-text body or a JSON string.
              </p>
              <DocsBlock label="JSON reply (all channels)" code={'{ "text": "Here\'s your code: FALL20", "action": "issue_promo_code" }'} />
              <p>
                Voice handlers can stream with <DocsCode>Content-Type: application/x-ndjson</DocsCode>, one object per line. Chunks marked{" "}
                <DocsCode>interim</DocsCode> are filler; the first non-interim chunk is the final reply.
              </p>
              <DocsBlock label="NDJSON streaming (voice)" code={NDJSON_SNIPPET} />
              <p>
                A non-2xx response or a timeout is a failed delivery and produces no agent reply. With <DocsCode>--retry-on-non-200</DocsCode> the
                same signed request is retried after 250 ms, 750 ms, 1.5 s, 3 s, and 5 s.
              </p>
            </DocsSection>

            <DocsSection id="scenarios" title="Scenario files">
              <p>
                A scenario is a YAML or JSON conversation script with assertions. Schemas are strict: unknown keys are errors, and a scenario needs at
                least one <DocsCode>caller</DocsCode> turn.
              </p>
              <DocsBlock label="Annotated example" code={SCENARIO_SNIPPET} />
              <DocsTable
                head={["Key", "Meaning"]}
                rows={[
                  ["caller", "Inbound text (the transcript, on voice) delivered to your webhook."],
                  ["agent", "Outbound business message recorded without a delivery."],
                  ["after", "Simulated delay before the turn: 90s, 45m, 3h, 2d, 1h30m, or milliseconds."],
                  ["waitMs", "Real wall-clock pause after a caller turn is sent."],
                  ["expect.actions", "Actions that must all appear in the reply."],
                  ["expect.forbiddenActions", "Actions that must not appear."],
                  ["expect.replyMatches", "Case-insensitive regex the reply text must match. Reserve it for mandated wording (STOP/HELP language)."],
                  ["expect.status · timedOut · retries", "Expected delivery outcome, so a deliberate rejection passes."],
                  [
                    "fault",
                    "invalidSignature, omitSignature, staleTimestampSeconds (301–86400), tamperBody, malformedJson, duplicateWebhookId, simulateTimeout."
                  ],
                  ["agentId · numberId · from · to", "Identity defaults: agt_local, num_local, +15559876543, +15551234567."]
                ]}
              />
              <DocsBlock
                label="Replay one scenario in the dashboard"
                code="npx agentphone-devtools --target http://localhost:3000/webhook --secret whsec_demo --scenario examples/messaging/campaign-interested.yaml"
              />
              <p>
                Any live or saved run can be exported back to a scenario (Inspector export, or <DocsCode>x</DocsCode> in the step debugger) with
                assertions scaffolded from the actions it observed.
              </p>
            </DocsSection>

            <DocsSection id="simulated-time" title="Simulated time">
              <p>
                The simulator keeps a virtual clock: real time plus an offset. It only moves when told to, via a turn&apos;s{" "}
                <DocsCode>after</DocsCode>, a scenario&apos;s <DocsCode>startAt</DocsCode>, <DocsCode>warp</DocsCode> in the step debugger, or{" "}
                <DocsCode>POST /api/clock/advance</DocsCode>. Nothing actually waits, so a 10-day gap costs nothing.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[12px] bg-white/[0.04] px-4 py-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">Moves with the clock</div>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-text-secondary marker:text-primary">
                    <li>
                      Envelope <DocsCode>timestamp</DocsCode> and <DocsCode>data.receivedAt</DocsCode>
                    </li>
                    <li>
                      <DocsCode>recentHistory[].at</DocsCode>
                    </li>
                    <li>Message times in Messages and the Inspector</li>
                  </ul>
                </div>
                <div className="rounded-[12px] bg-white/[0.04] px-4 py-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">Stays on real time</div>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-text-secondary marker:text-blue-500">
                    <li>
                      <DocsCode>X-Webhook-Timestamp</DocsCode> and the HMAC, so your 5-minute replay window keeps working after a 10-day warp
                    </li>
                    <li>Delivery latency and timeouts</li>
                  </ul>
                </div>
              </div>
              <p>
                Durations are one or more <DocsCode>{"<number><unit>"}</DocsCode> parts with units <DocsCode>ms</DocsCode>, <DocsCode>s</DocsCode>,{" "}
                <DocsCode>m</DocsCode>, <DocsCode>h</DocsCode>, <DocsCode>d</DocsCode>, <DocsCode>w</DocsCode>: <DocsCode>90s</DocsCode>,{" "}
                <DocsCode>45m</DocsCode>, <DocsCode>1h30m</DocsCode>, <DocsCode>1.5h</DocsCode>, <DocsCode>2d</DocsCode>. A bare number is
                milliseconds. Anything else is an error, never a silent zero.
              </p>
              <p>
                Handlers should read &quot;now&quot; from the event&apos;s <DocsCode>timestamp</DocsCode>, not the wall clock. The reference handler
                does, which is how <DocsCode>campaign-late-reply</DocsCode> proves an expired offer is refused ten days later. Each fresh session
                starts back on real time; Settings can also reset the clock.
              </p>
            </DocsSection>

            <DocsSection id="messaging" title="Messaging & campaigns">
              <p>
                Messaging runs in both directions. <strong className="font-semibold text-white">Outbound</strong> messages (campaign openers,
                follow-ups) go through AgentPhone&apos;s send API, not your webhook, so the simulator records them without a delivery:{" "}
                <DocsCode>agent:</DocsCode> turns, <DocsCode>say</DocsCode> in the step debugger, or <DocsCode>POST /api/seed-agent-message</DocsCode>
                . They still appear in <DocsCode>recentHistory</DocsCode>. <strong className="font-semibold text-white">Inbound</strong> replies
                arrive as <DocsCode>agent.message</DocsCode> deliveries, and your webhook&apos;s response is the reply.
              </p>
              <DocsSubheading>The four campaign archetypes · examples/messaging</DocsSubheading>
              <DocsTable
                head={["Scenario", "What it proves"]}
                rows={[
                  [
                    "campaign-interested",
                    "iMessage. YES two hours after the opener earns issue_promo_code with FALL20; “Thanks!” closes with campaign_closed."
                  ],
                  ["campaign-question", "SMS. A question 25 minutes in gets campaign_info; the YES that follows gets issue_promo_code."],
                  ["campaign-declined", "SMS. “No thanks” gets campaign_declined, with no promo code and no opt-out."],
                  ["campaign-late-reply", "iMessage. YES ten days later is past the 7-day window: promo_expired, never issue_promo_code."]
                ]}
              />
              <DocsSubheading>Compliance keywords · examples/compliance</DocsSubheading>
              <DocsTable
                head={["Scenario", "Rule"]}
                rows={[
                  ["messaging-stop-keyword", "STOP → opt_out, confirmed with “unsubscribed … reply START”."],
                  ["messaging-help-keyword", "HELP → help, naming the sender and how to opt out."],
                  ["messaging-start-resubscribe", "START two days after STOP → resubscribe; marketing may resume."],
                  ["messaging-post-stop-no-marketing", "Five days after STOP → opt_out_reminder pointing to START; no promo, no campaign info."],
                  [
                    "opt-out · ai-disclosure · human-escalation",
                    "Voice: honor opt-outs mid-call, disclose automation when asked, transfer on request."
                  ]
                ]}
              />
              <DocsBlock
                label="Gate a release on compliance"
                code="npx agentphone-devtools --ci --target http://localhost:3000/webhook --secret whsec_demo --scenario-dir examples/compliance --report-junit .agentphone-devtools/ci/compliance.xml"
              />
            </DocsSection>

            <DocsSection id="step-debugger" title="Step debugger & forking">
              <p>
                Step mode pauses before every turn and never auto-advances. Start it from the CLI, or from the Inspector with any scenario or saved
                run; both drive the same engine.
              </p>
              <DocsBlock code="npx agentphone-devtools --target http://localhost:3000/webhook --secret whsec_demo --step --scenario examples/messaging/campaign-interested.yaml" />
              <DocsTable
                head={["CLI command", "What it does · HTTP equivalent"]}
                rows={[
                  [
                    "c",
                    <span>
                      Send the next queued turn (an agent turn is seeded, not delivered) · <DocsCode>POST /api/step/send</DocsCode>
                    </span>
                  ],
                  [
                    "e [text]",
                    <span>
                      Rewrite the next caller turn · <DocsCode>POST /api/step/edit</DocsCode>
                    </span>
                  ],
                  [
                    "t <text>",
                    <span>
                      Queue a new caller turn · <DocsCode>POST /api/step/add</DocsCode>
                    </span>
                  ],
                  [
                    "say <text>",
                    <span>
                      Queue an outbound business message · <DocsCode>POST /api/step/agent</DocsCode>
                    </span>
                  ],
                  [
                    "drop",
                    <span>
                      Remove the next queued turn · <DocsCode>POST /api/step/drop</DocsCode>
                    </span>
                  ],
                  [
                    "warp <duration>",
                    <span>
                      Advance the simulated clock · <DocsCode>POST /api/step/warp</DocsCode>
                    </span>
                  ],
                  [
                    "fork <n>",
                    <span>
                      Branch after completed turn n with a new caller line · <DocsCode>POST /api/step/fork</DocsCode>
                    </span>
                  ],
                  [
                    "g / b [note]",
                    <span>
                      Label the last turn good or bad · <DocsCode>POST /api/history/:id/labels</DocsCode>
                    </span>
                  ],
                  ["x [path]", "Export the run as scenario YAML with scaffolded assertions"],
                  ["v", "Dictate the next turn (local whisper.cpp); hold space in the browser"],
                  ["state · help", "Print the checkpoint (queue, clock, conversationState) · list commands"],
                  [
                    "q",
                    <span>
                      End the call and leave step mode · <DocsCode>POST /api/step/end</DocsCode>
                    </span>
                  ]
                ]}
              />
              <p>
                A fork copies the run up to completed caller turn <DocsCode>n</DocsCode> (transcript, recentHistory, and conversationState) into a new
                run linked by <DocsCode>forkedFrom</DocsCode>, and makes it the live, stepped session. Fork at turn <DocsCode>0</DocsCode> is allowed
                when the run opens with an outbound message, so you can try every possible reply to the same campaign opener. Branches show as a tree
                in the Inspector.
              </p>
            </DocsSection>

            <DocsSection id="cli" title="CLI reference">
              <DocsTable
                head={["Flag", "Meaning"]}
                rows={[
                  ["--target <url>", "Webhook URL that receives simulated AgentPhone events"],
                  ["--secret <secret>", "Webhook signing secret"],
                  ["--channel <channel>", "sms, imessage, whatsapp, or voice (default voice)"],
                  ["--scenario <path>", "Scenario to replay; repeat in CI mode to build a suite"],
                  ["--scenario-dir <path>", "Recursively run every YAML/JSON scenario (CI mode)"],
                  ["--step", "Step through one --scenario turn by turn"],
                  ["--timeout <seconds>", "Webhook timeout, 5–120 (default 30)"],
                  ["--context-limit <0-50>", "recentHistory size (default 10)"],
                  ["--server-port <port>", "Simulator API port (default 4318; --port also works)"],
                  ["--ui-port <port>", "Dashboard port (default 4319)"],
                  ["--history-path <path>", "Run history file (default .agentphone-devtools/history.json)"],
                  ["--history-limit <count>", "Runs to retain, 1–1000 (default 100)"],
                  ["--retry-on-non-200", "Retry non-200 responses with compressed backoff"],
                  ["--no-open", "Don't open the browser"],
                  ["--exit-after-scenario", "Exit once the scenario completes"],
                  ["--ci", "Run one or more scenarios headlessly"],
                  ["--report-json <path>", "Write the full run report (CI mode)"],
                  ["--report-junit <path>", "Write JUnit XML, one test per assertion (CI mode)"],
                  ["--baseline <report.json>", "Fail CI when behavior regresses from a prior report"],
                  ["--max-latency-increase <%>", "Allowed latency increase against the baseline (default 25)"]
                ]}
              />
              <p>
                Environment variables <DocsCode>AGENTPHONE_DEVTOOLS_TARGET</DocsCode>, <DocsCode>AGENTPHONE_WEBHOOK_SECRET</DocsCode>,{" "}
                <DocsCode>AGENTPHONE_DEVTOOLS_CHANNEL</DocsCode>, <DocsCode>AGENTPHONE_DEVTOOLS_HISTORY_PATH</DocsCode>, and{" "}
                <DocsCode>AGENTPHONE_DEVTOOLS_HISTORY_LIMIT</DocsCode> set the same defaults.
              </p>
            </DocsSection>

            <DocsSection id="http-api" title="HTTP API">
              <p>
                Everything in this dashboard goes through the local API, so you can script it too. POST bodies are JSON; send{" "}
                <DocsCode>{"{}"}</DocsCode> when a route takes no parameters. Live updates stream from <DocsCode>GET /api/events</DocsCode>{" "}
                (server-sent events).
              </p>
              <DocsTable
                head={["Route", "Purpose"]}
                rows={[
                  ["GET /api/state", "The live session"],
                  ["POST /api/send", "Send a caller turn { text, channel?, fault? }"],
                  ["POST /api/reset", "Fresh session; optionally change targetUrl, secret, channel, timeoutSeconds, contextLimit, retryOnNon200"],
                  ["POST /api/scenario", "Run a scenario file end to end { path }"],
                  ["POST /api/replay", "Re-send a recorded delivery, optionally edited"],
                  ["POST /api/end-call", "End the call (sends agent.call_ended on voice)"],
                  ["POST /api/conversations/start", "Fresh session bound to a contact { contactId?, channel? }"],
                  ["POST /api/seed-agent-message", "Record an outbound business message { text }"],
                  ["GET /api/history · /:id", "Saved runs (summaries) · one full run"],
                  ["DELETE /api/history · /:id", "Clear all saved runs except the live one · delete one"],
                  ["GET /api/history/:id/report.json · .md", "Run report downloads"],
                  ["GET /api/history/:id/scenario.yaml · .json", "Export a run as a scenario"],
                  ["POST /api/history/:id/export", "Write the scenario to .agentphone-devtools/exports/"],
                  ["POST · DELETE /api/history/:id/baseline", "Mark or unmark a baseline"],
                  ["GET /api/compare/:baseline/:candidate", "Regression comparison"],
                  ["POST /api/history/:id/labels", "Label a turn good or bad"],
                  ["GET /api/step · POST /api/step/*", "Step debugger: start, send, add, edit, agent, drop, warp, fork, end"],
                  ["GET /api/clock · POST /api/clock/advance · /set", "Read, advance, or pin the simulated clock"],
                  ["GET /api/scenarios", "Discovered scenario files"],
                  ["/api/contacts", "GET, POST, PUT /:id, DELETE /:id"],
                  ["/api/environments", "Sub-accounts: GET, POST, PUT /:id, DELETE /:id, POST /:id/activate"],
                  ["GET /api/stats", "Usage aggregates"],
                  ["GET /api/voice · POST /api/voice/transcribe", "Local dictation support and transcription"],
                  ["GET /health", "Liveness"]
                ]}
              />
            </DocsSection>
          </article>
        </div>
      </PageBody>
    </Page>
  );
}
