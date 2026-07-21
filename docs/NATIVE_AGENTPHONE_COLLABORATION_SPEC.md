# Native AgentPhone Collaboration Notes

## Purpose

The local product owns the developer workflow for recording a test conversation, reviewing and labeling it, forking it from checkpoints, applying scenario fixtures, and replaying approved paths as regression tests.

Some deeper capabilities require access to AgentPhone's internal telephony and media pipeline. They are intentionally specified here for discussion with AgentPhone, but are not part of the initial implementation.

## Product boundary

### Built in this repository

- Record a human-driven test session.
- Review observed transcripts, responses, actions, warnings, and timing.
- Correct transcripts and label expected outcomes or actions.
- Approve behavior either during the session or afterward.
- Save checkpoints and fork a new path from an earlier turn.
- Compile every approved root-to-leaf path into a replayable scenario.
- Apply scenario fixtures for audio, timing, telephony input, and webhook faults.
- Run the resulting suite locally and in CI.
- Compare candidates with approved baselines.

### Native capabilities specified, not built

- SIP and LiveKit trace access.
- Packet-level media fault injection.
- Breakpoints inside AgentPhone's STT and TTS pipeline.
- Keeping a real call alive while a developer pauses at a breakpoint.
- Carrier-level SMS, iMessage, and RCS delivery diagnostics.

## Proposed native trace contract

AgentPhone would expose an ordered event stream for test-mode calls. Every event should carry stable correlation identifiers and timestamps so a developer UI can assemble a single timeline.

Suggested common fields:

- `callId`
- `sessionId`
- `turnId`
- `eventId`
- `stage`
- `status`
- `startedAt`
- `endedAt` or `durationMs`
- `safePayload` or a reference to redacted details
- `errorCode` and `errorMessage` when applicable

Candidate stages:

- SIP invite, answer, transfer, disconnect, and failure.
- LiveKit room and participant connection state.
- Media received, media sent, jitter, packet loss, and buffering.
- STT speech start, partial transcript, final transcript, and confidence.
- Webhook dispatch, first byte, response chunks, completion, retry, and timeout.
- Hosted-model request, first token, tool proposal, and completion where applicable.
- TTS request, first audio, playback completion, and interruption.
- DTMF received.
- Final call action and termination reason.

The contract should clearly separate developer-visible payloads from internal or sensitive data. Redaction and retention must be configurable.

## Proposed breakpoint contract

Breakpoints would only operate on explicit test-mode calls. Useful pause locations include:

- After final transcription, before webhook or hosted-model processing.
- Before a proposed tool or external action executes.
- After a tool result, before model continuation.
- Before TTS begins speaking a response.
- Before transfer or hangup.

A paused event should return a short-lived `pauseToken`. The debugging client could then:

- Continue unchanged.
- Replace the transcript, tool result, response text, or action.
- Cancel the current action.
- End the test call.

AgentPhone would own the behavior that keeps the call connected, including a maximum pause duration and optional hold message or audio. Debug pauses must be excluded from normal latency measurements.

## Proposed native fault controls

Native media faults must be restricted to test sessions and must never affect production traffic.

Potential controls:

- Packet loss, jitter, delay, reordering, and temporary disconnects.
- Inbound or outbound audio clipping and reduced bandwidth.
- LiveKit participant disconnect and reconnect.
- STT or TTS provider delay, timeout, malformed result, or failure.
- SIP rejection, failed transfer, no-answer, busy, and voicemail paths.

The local scenario suite would request these controls through a capability-negotiated adapter. Unsupported faults would be reported as skipped rather than silently approximated.

## Carrier diagnostics: separate future surface

Carrier delivery diagnostics are useful to AgentPhone but are not part of the call-scenario product. A future trace could correlate:

- AgentPhone acceptance.
- Compliance and registration status.
- Upstream provider submission.
- Carrier acceptance, filtering, or rejection.
- Delivery receipt when available.
- Recipient capability and channel fallback.

This remains a platform-owned diagnostic surface, not an initial repository deliverable.

## Collaboration questions for Manav

1. Which SIP, LiveKit, STT, webhook, hosted-model, and TTS stages already emit stable internal events?
2. Is there an existing test-call or web-call mode that could safely support pause tokens?
3. How long can a call remain paused, and what should the caller hear during the pause?
4. Can internal trace events share stable `callId` and `turnId` identifiers with public API objects?
5. Which payloads may be exposed after redaction, and what retention rules are required?
6. Which native faults are feasible without risking shared production infrastructure?
7. Should the trace be delivered through SSE, WebSocket, webhooks, or a historical API?
8. Can AgentPhone provide a non-billable sandbox or test-project capability for contract validation?
9. Which capabilities should remain internal support tools rather than public developer APIs?

## Collaboration ask

AgentPhone would help validate and eventually own the native event, breakpoint, and fault contracts. This repository would own the developer-facing record, review, label, fork, fixture, replay, and regression workflow.

