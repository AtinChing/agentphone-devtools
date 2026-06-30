# AgentPhone DevTools

AgentPhone DevTools is a local simulator, inspector, and lightweight eval loop for developers building on [AgentPhone](https://agentphone.ai). It makes AgentPhone agents easier to build without placing real calls, sending real texts, spending money, or hurting number reputation while debugging.

![AgentPhone DevTools demo](docs/demo.gif)

## Quickstart

```bash
npm install
npm run build
npm --workspace examples/handler-express start
npx agentphone-devtools --target http://localhost:3000/webhook --secret whsec_demo --scenario examples/scenarios/ev-support.yaml
```

The CLI starts the simulator API and the inspector UI together, opens the inspector, replays the scenario against your local webhook, and renders the transcript, signed requests, responses, latency, call-ended summary, and eval result.

## What Ships

- Simulator for `agent.message` over SMS and voice, `agent.call_ended`, and `agent.reaction` builders.
- HMAC-SHA256 signing over the exact raw request bytes sent to the webhook.
- Required AgentPhone security headers: `X-Webhook-Signature`, `X-Webhook-Timestamp`, `X-Webhook-ID`, and `X-Webhook-Event`.
- Voice response parsing for JSON and NDJSON, including interim chunks and final chunks.
- Live inspector with timeline, transcript, request/response payloads, latency flags, call-ended panel, warnings, and eval card.
- Persistent run history with read-only session inspection, report exports, bounded retention, and deletion controls.
- Scenario replay from YAML or JSON with Zod validation.
- Deterministic eval rubric for resolved / handed off / failed, task focus, expected actions, turn counts, and dead air.
- Reference Express handler that verifies signatures before replying.

## CLI

```bash
npx agentphone-devtools \
  --target http://localhost:3000/webhook \
  --secret whsec_demo \
  --channel voice
```

Useful options:

```text
--scenario <path>          Replay a YAML or JSON scenario
--timeout <seconds>        Voice webhook timeout, 5 to 120 seconds
--context-limit <0-50>     recentHistory size
--retry-on-non-200         Retry failed deliveries with compressed backoff
--history-path <path>      Override the local run history file
--history-limit <count>    Runs to retain, 1 to 1000 (default 100)
--no-open                  Keep the browser closed
--exit-after-scenario      Exit after scenario replay, useful for CI
```

## How Fidelity Is Guaranteed

The simulator signs the exact raw JSON string it sends:

```text
signedString = `${timestamp}.${rawBody}`
signature = `sha256=${HMAC_SHA256(webhookSecret, signedString)}`
```

That matches AgentPhone's documented Node verifier. The signer tests run the generated delivery through the documented verifier shape, and payload builder tests assert the SMS, voice, and call-ended envelopes match the documented contract.

Critical detail: the simulator serializes once, signs that exact string, and sends that same string as the request body. It does not re-serialize after signing.

## Zero-Cost Defaults

The default workflow uses no AgentPhone account, no real number, no carrier traffic, and no paid model call. Optional model-judge eval is intentionally disabled unless a provider key is explicitly configured.

## Run History

Sessions are saved locally as they change and remain available in the inspector after restarting the CLI. Open the **Runs** tab to inspect a previous transcript, delivery timeline, payloads, warnings, and eval result without affecting the live session.

By default, history is stored at `.agentphone-devtools/history.json` in the directory where the CLI starts. Writes use a temporary file and atomic rename, the file is created with owner-only permissions, and only the masked secret preview is stored. The signing secret is never written to history.

The default retention limit is 100 runs. Override the location or limit with CLI flags or environment variables. Completely untouched idle sessions are omitted from the Runs list.

## Run Reports

Open any live or saved run in the inspector and use the JSON or Markdown export buttons in the header. Reports include the session summary, transcript, deliveries, response parsing, warnings, call-ended summary, and eval result. They keep the same secret handling as history: only the masked `secretPreview` is included.

The same reports are available from the local API:

```text
GET /api/history/:sessionId/report.json
GET /api/history/:sessionId/report.md
```

## Repo Layout

```text
packages/core      payload builders, signer, dispatcher, scenarios, eval
packages/server    Fastify simulator API and SSE stream
packages/ui        Next.js inspector
packages/cli       npx-runnable entrypoint
examples/handler-express
examples/scenarios
```

## Demo Script

```bash
npm install
npm run build
npm --workspace examples/handler-express start
```

In another shell:

```bash
npx agentphone-devtools \
  --target http://localhost:3000/webhook \
  --secret whsec_demo \
  --scenario examples/scenarios/ev-support.yaml
```

The EV support scenario completes locally and the eval card should read `resolved`.

## Environment

Use `.env.example` values in your shell or pass options directly to the CLI:

```text
AGENTPHONE_DEVTOOLS_TARGET=http://localhost:3000/webhook
AGENTPHONE_WEBHOOK_SECRET=whsec_demo
AGENTPHONE_DEVTOOLS_CHANNEL=voice
AGENTPHONE_DEVTOOLS_HISTORY_PATH=.agentphone-devtools/history.json
AGENTPHONE_DEVTOOLS_HISTORY_LIMIT=100
```

These defaults keep the simulator fully local. They do not place calls, send texts, or require paid services.

## License

MIT.
