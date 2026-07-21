# Record, Review, Fork, and Fixture Plan

## Goal

Let developers build a local regression suite by acting out test conversations rather than hand-writing every flat scenario. The approved authoring artifact is one readable YAML conversation graph for each scenario family. The existing runner continues to receive flat scenarios, compiled in memory only for a selected run or export.

The workflow is:

1. Record a human-driven local test session.
2. Review it live or after completion, correct observations, and label expected behavior.
3. Save checkpoints at meaningful turns and fork alternative continuations.
4. Consolidate the approved shared history, branches, paths, fixture profiles, and selectors into the family graph.
5. Run selected approved paths and bounded fixture cases through the local deterministic adapter.
6. Compare the compiled cases with baselines; export flat YAML only when a developer explicitly asks for review, interchange, or a committed artifact.

No production or native AgentPhone work, access, credentials, credits, or paid API calls are in scope for this plan.

## Terminology

- **Scenario family:** One consolidated YAML graph covering a related intent and its approved alternatives.
- **Recorded session:** The observed conversation and delivery data from one human-driven local run.
- **Annotation:** A correction, review state, note, or expected behavior attached to a node, edge, or named path.
- **Node:** A reusable caller turn, agent observation, checkpoint, or annotated state in a family graph.
- **Edge:** A labeled, directed transition between nodes. It may name a choice, condition, or observed outcome.
- **Named approved path:** A stable route reference, such as `identity_retry`, that selects an ordered root-to-leaf path through the graph. It does not duplicate its nodes in YAML.
- **Checkpoint:** A restorable snapshot at a node boundary, with conversation state and recent history.
- **Fork:** A new continuation beginning from a checkpoint and reusing its shared upstream nodes.
- **Fixture profile:** A reusable named set of controlled inputs or failures, applied to one or more nodes.
- **Run selector:** A request that chooses approved paths, tags, fixture profiles, and case-generation policy for a run.
- **Compiled scenario:** One explicit flat scenario produced in memory from a graph route and a bounded fixture assignment for the existing runner.

## Scope

### Included

- Local live and post-session review.
- Per-turn states: unreviewed, approved, incorrect, and corrected.
- Original and corrected transcripts retained side by side.
- Expected outcomes, actions, delivery behavior, and reviewer notes.
- Checkpoint creation, fork lineage, shared nodes, and labeled edges.
- One consolidated, version-controlled YAML graph per scenario family.
- Reusable fixture profiles, run selectors, bounded case generation, local replay, reports, baselines, and CI suites.
- Audio assets stored separately and referenced by the graph.

### Excluded from the initial implementation

- Native AgentPhone integrations, calls, credentials, contract tests, or paid-credit workflows.
- SIP or LiveKit internals, carrier delivery diagnostics, and packet-level network faults.
- Native STT or TTS breakpoints and holding a real call during a debug pause.
- Automatic acceptance of an observed result as correct.
- Persisting generated flat scenarios as an automatic side effect of recording, reviewing, or running.

## Data model and storage direction

Preserve the existing flat `Scenario` format as the runner contract. Add the version-controlled YAML scenario-family graph as the authored source of truth. The compiler resolves graph routes and fixture profiles to flat scenarios in memory; it does not require a graph-aware runner or CI engine.

Each family graph contains:

- Family metadata: ID, name, description, channel, and tags.
- Reusable nodes, each with a stable ID and turn/state data.
- Labeled edges that connect nodes and describe the allowable continuation.
- Checkpoint state and source-session/branch lineage where applicable.
- Review status and expected behavior on the relevant node, edge, or path.
- Named approved paths as ordered route references to node/edge IDs.
- Reusable fixture profiles and node-level profile references.
- Run-selector defaults and generation limits.

### Consolidated YAML graph

The YAML deliberately makes shared history and divergent outcomes visible without copying a full scenario for every leaf:

```yaml
version: 1
metadata:
  name: Appointment cancellation
  channel: voice
fixtureProfiles:
  cafe_audio:
    apply:
      invalid_code:
        audio:
          path: audio/cancel-noisy.wav
          transcript: My confirmation code is 4812.
          noiseProfile: cafe
  delayed_confirmation:
    apply:
      retry_success:
        timing:
          leadingSilenceMs: 800
nodes:
  cancel_request:
    caller: I need to cancel my appointment.
    expect:
      actions: [request_confirmation_code]
    review: { status: approved }
  valid_code:
    caller: My confirmation code is 4821.
    expect:
      actions: [cancel_appointment]
      outcome: resolved
    review: { status: approved }
  invalid_code:
    caller: My confirmation code is 4812.
    expect:
      actions: [request_confirmation_code]
    review: { status: approved }
  retry_success:
    caller: Sorry, it is actually 4821.
    expect:
      actions: [cancel_appointment]
      outcome: resolved
    review: { status: approved }
edges:
  - { from: cancel_request, to: valid_code, label: gives valid code }
  - { from: cancel_request, to: invalid_code, label: gives invalid code }
  - { from: invalid_code, to: retry_success, label: retries successfully }
paths:
  cancellation_success:
    route: [cancel_request, valid_code]
    tags: [happy_path]
  identity_retry:
    route: [cancel_request, invalid_code, retry_success]
    tags: [retry]
runs:
  smoke:
    paths: [cancellation_success, identity_retry]
    fixtureProfiles: [cafe_audio, delayed_confirmation]
    maxGeneratedCases: 24
```

Graph validation must ensure route continuity, valid IDs, acyclic approved routes unless a supported loop policy is explicitly added, approved review status, fixture/profile validity, and a nonzero bounded case set.

### Authoring state, assets, and export

- `graph.yaml` is the durable, reviewable source for a scenario family. It contains stable node, edge, path, profile, and selector references.
- `graph.json` is temporary local UI authoring state only: layout positions, pan/zoom, selection, draft edits, and other recoverable workspace data. It is not a runner input, source of truth, or required repository artifact.
- Store audio as separate `.wav` or supported source files, never as base64 in YAML or JSON. Reference assets with a relative path and optional content hash; keep transcript sidecars or graph metadata with the asset.
- Compilation happens in memory for every local/CI run. Write `exports/*.yaml` or JSON only after an explicit export command. Exports are derived, can be regenerated, and must record their family/path/profile provenance.
- Keep observed transcripts and reviewer corrections separately. Never overwrite the original observation.
- Keep the current flat scenario schema backward compatible. New fixture fields are optional, and existing YAML or JSON scenarios remain valid.

Suggested local layout:

```text
.agentphone-devtools/
  history.json
  families/
    appointment-cancellation/
      graph.yaml
      audio/
        <content-hash>.wav
        <content-hash>.transcript.txt
      graph.json                 # local, temporary UI state
      exports/                   # explicit, derived exports only
        cancellation-success.yaml
```

### Compilation and run selection

A run selector identifies the family and can filter named paths by explicit ID, `approved`, tags, or a saved suite selector. It can add or exclude fixture profiles and choose a generation policy. The compiler resolves the selector, traverses each selected route, overlays profile fixtures on the referenced nodes, and yields explicit flat scenarios to the existing runner. A generated case name includes the family, named path, and fixture assignment so reports remain traceable.

The compiler must be deterministic: stable route order, stable profile order, and a recorded seed for any sampling. If a selector is ambiguous, invalid, exceeds its maximum, or selects an unapproved route, fail before running rather than silently widening or truncating without a report.

## Scenario fixture model

Use `fixtures` as the umbrella, with typed categories. A node may reference zero or more reusable fixture profiles; a path or run selector can add profiles where compatible. Local overrides are explicit and take precedence over a profile value, with conflicts rejected unless the fixture schema defines a merge rule.

### Audio fixtures

- Prerecorded audio asset with a transcript sidecar.
- Noise profile and intensity.
- Gain, clipping, or reduced-bandwidth transformations.
- Speaking-rate variants where supported.

### Timing fixtures

- Silence before speech.
- Silence inside an utterance.
- Interruption at a specified response offset.
- Delayed caller response.

### Telephony-input fixtures

- DTMF digits and timing.
- Local simulated no-answer, busy, voicemail, or disconnect where the adapter supports them.

### Delivery and dependency fixtures

- Webhook delay, timeout, non-200 response, malformed response, and retry.
- Existing signature, timestamp, body, and ID faults.
- Mocked tool results and tool failures where the target handler supports them.

Fixtures unsupported by the active local adapter must be reported per case as skipped or unsupported; they must not be presented as passed.

### Bounded case generation

Case generation is a deliberate, bounded expansion rather than an implicit full Cartesian product. A selector may request these sources, in this order:

1. **All approved paths:** one base case per approved named path matching the selector (or every approved path when no path/tag filter is supplied).
2. **Edge coverage:** add the minimum eligible route cases needed to cover each selected labeled edge at least once.
3. **Tag selection:** include or exclude paths and profiles by tags before expansion.
4. **Pairwise fixture combinations:** generate covering pairs across compatible fixture dimensions/profiles, not every combination.
5. **Fuzz sampling:** add a deterministic seeded sample from declared fuzzable values.

The selector must declare `maxCases`; family defaults supply a conservative cap. Before execution, report base cases, coverage additions, pairwise additions, fuzz additions, seed, and cases omitted because of the cap. Prioritize explicitly named paths, then uncovered edges, then pairwise coverage, then fuzz samples. A run may never exceed `maxCases`; a strict selector fails if its requested coverage cannot fit, while a non-strict selector runs the prioritized subset and reports the unmet coverage.

## Visualization direction

Extend the existing Inspector rather than create a separate application. The graph view is for authoring and review; the transcript remains the detailed turn editor.

- **Focused path:** selecting a named approved path highlights its route, dims unrelated branches, and opens the same route as a familiar transcript timeline with audio playback and waveform where available.
- **Collapsed subflows:** collapse shared prefixes or named subflows into a summary node with path count, review state, fixture badges, and coverage status; expand without duplicating underlying nodes.
- **Semantic zoom:** at wide zoom show route labels, status, coverage, and aggregate badges; at medium zoom show nodes and edge labels; at close zoom show transcript excerpts, expectations, and fixture controls.
- **Coverage view:** distinguish approved-path coverage, labeled-edge coverage, fixture pairwise coverage, unsupported cases, and cap-omitted cases. Let a user filter the graph and suite by these states.
- **Minimap:** provide an always-available overview for large families, with the focused viewport and selected route visible.
- **Inspector panels:** the left panel lists named paths, tags, review status, and run state; the center shows graph or focused transcript; the right panel shows observed/corrected transcript, expectations, notes, request/response details, and fixtures for the selected node or edge.
- **Fork action:** select a checkpoint and choose `Fork from here`; the draft continuation inherits shared upstream nodes and lineage, then becomes a labeled edge and named approved path only after review.

## Local-first adapter strategy

Define one local deterministic test-call adapter for this plan.

- Use the existing simulator and local webhook handler.
- Accept transcripts and prerecorded audio fixtures with transcript sidecars.
- Produce deterministic stage events for automated tests.
- Use local or browser speech playback only as optional presentation.
- Use local Whisper provisionally for human-recorded audio, behind an adapter boundary.

Deterministic prerecorded fixtures and transcript sidecars are the source of truth for automated tests. Whisper output is an observation that may vary by model or platform. Native AgentPhone adapters and compatibility work are explicitly deferred and must not be required by any command, test, UI state, or data schema in this delivery.

## Testing without AgentPhone credits

### Unit tests

- Family-graph schema validation: node/edge IDs, route continuity, review eligibility, profiles, and selector bounds.
- Checkpoint restoration, fork lineage, and immutable shared history.
- Deterministic in-memory compilation from named paths and selectors to existing flat scenarios.
- Case-generation priorities, edge coverage, pairwise coverage, fuzz seeds, cap reporting, and strict-cap failure.
- Annotation/review-state transitions, fixture validation, deterministic transformations, and backward compatibility with current scenario files.

### Integration tests

- Record a local multi-turn handler session and consolidate it into a family graph.
- Mark an observed turn incorrect, add corrected expectations, fork an earlier checkpoint, and approve two named routes sharing their prefix.
- Apply reusable timing and webhook-fault profiles to selected nodes.
- Run approved-path, edge-coverage, pairwise, and seeded fuzz selectors under a small cap; verify compiled cases, assertions, baselines, coverage, and omitted-case reporting.
- Explicitly export a selected path and verify that no export is written by normal compilation or execution.

### UI tests

- Review and label turns; create a fork from a selected checkpoint.
- Navigate a focused path, collapse and expand a shared subflow, use semantic zoom, and navigate via minimap.
- Attach reusable profiles; filter by tags and coverage; display unsupported and cap-omitted cases.
- Confirm that only reviewed named paths are eligible for approved regression selectors.

## Demonstration

The zero-credit demonstration should show:

1. A developer performs or replays a human-driven local conversation.
2. The UI records it as unreviewed graph data, then the developer approves shared nodes and labels edges.
3. The developer marks one response incorrect, records corrected expectations, and forks from an earlier checkpoint.
4. Both outcomes appear as named approved routes in one family YAML graph, without duplicate shared turns.
5. The developer attaches noisy-audio, interruption, and webhook-timeout profiles to selected nodes.
6. A run selector generates approved-path, edge-coverage, pairwise, and seeded fuzz cases within a visible cap.
7. The suite compiles in memory, runs locally, and reports regression and coverage results.
8. The developer explicitly exports one chosen flat scenario only if it is needed for review or interchange.

The demo must clearly label local simulation boundaries and must not imply native AgentPhone support.

## Delivery phases

### Phase 0: contracts and UX design

- Finalize consolidated YAML family-graph, node, edge, route, profile, selector, and provenance schemas.
- Define graph validation, priority/cap policy, coverage accounting, and unsupported-fixture behavior.
- Sketch focused-path, collapsed-subflow, semantic-zoom, coverage, and minimap interaction flows.
- Establish flat-scenario compatibility, in-memory compilation, explicit-export, and temporary-`graph.json` rules.

Exit criterion: schema examples and UI flows cover a shared-prefix happy path, an incorrect path, two forks, reusable profiles, and a capped selector without ambiguity.

### Phase 1: family graph and compiler core

- Add family graph, node, edge, checkpoint, annotation, lineage, profile, selector, and provenance types.
- Implement validation, route resolution, and deterministic in-memory flat-scenario compilation.
- Add explicit export only; ensure normal recording and runs do not write derived scenarios.
- Extend persistence and reports without breaking existing history or scenario files.

Exit criterion: selected approved routes compile deterministically into existing runner scenarios while shared nodes remain represented once in YAML.

### Phase 2: record, review, and fork workflow

- Save manual local runs as unreviewed graph data and retain original/corrected values.
- Add review states, expectations, actions, delivery, notes, checkpoints, and fork lineage.
- Consolidate reviewed continuations into labeled edges and named approved paths.
- Add focused-path review and graph navigation.

Exit criterion: a developer can turn one local run and a fork into two approved named paths without hand-editing or automatically exporting flat YAML.

### Phase 3: reusable fixture profiles and bounded generation

- Add typed fixture profiles, node/profile references, compatibility/conflict validation, and local deterministic handling.
- Reuse and generalize existing webhook fault injection; add audio, timing, DTMF, and interruption events through local adapter capabilities.
- Implement approved-path, edge-coverage, tag, pairwise, and seeded fuzz generation with caps and reports.

Exit criterion: selected routes run under a predictable, capped set of fixture cases with traceable coverage and unsupported states.

### Phase 4: visualization and suite integration

- Deliver focused route, collapsed subflow, semantic zoom, coverage filtering, and minimap for large family graphs.
- Run compiled cases through existing CI, reports, and baseline comparison paths.
- Add family/path/fixture provenance and generation summaries to reports.
- Polish the zero-credit demonstration and explicit export flow.

Exit criterion: one local command runs a selected bounded suite with no AgentPhone account, and the UI explains graph structure, selection, and coverage at scale.

## Decisions to settle before implementation

1. Whether checkpoints are stored before a caller turn, after an agent turn, or both.
2. Whether corrected transcripts replace replay input by default or remain an explicit profile/selector choice.
3. Which local audio transformations are implemented now versus reported as unsupported.
4. The exact fixture dimensions and compatibility/merge rules used for pairwise coverage.
5. Default and maximum `maxCases` values, and whether CI selectors are strict when coverage cannot fit.
6. The canonical YAML route syntax and whether a named subflow is only a UI collapse unit or also a reusable route fragment.
7. Which temporary `graph.json` fields are recoverable drafts versus disposable layout state, while keeping `graph.yaml` authoritative.
