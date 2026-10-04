import {
  collectObservedActions,
  isCallerTurn,
  parseDuration,
  type ConversationState,
  type Scenario,
  type ScenarioCallerTurn,
  type SessionChannel,
  type SimulatedDelay
} from "@agentphone-devtools/core";
import type { DevtoolsRuntime, InspectorDelivery, SessionContact } from "./index.js";

/**
 * A queued step. Either a caller turn (delivered to the webhook) or an
 * outbound agent message (seeded into history, never delivered — a campaign
 * opener or scheduled follow-up sent outside the webhook).
 */
export interface StepQueueTurn {
  caller?: string;
  agent?: string;
  expect?: ScenarioCallerTurn["expect"];
  after?: SimulatedDelay;
  edited?: boolean;
}

export interface StepExpectResult {
  action: string;
  passed: boolean;
  observed: string[];
}

export interface StepState {
  active: boolean;
  scenarioName: string | null;
  channel: SessionChannel;
  sessionId: string | null;
  contact?: SessionContact;
  /** Caller turns completed so far on the stepped session (inherited included). */
  completedTurns: number;
  queue: StepQueueTurn[];
  sending: boolean;
  lastResult?: {
    turnNumber: number;
    expectResults: StepExpectResult[];
  };
  checkpoint: {
    recentHistoryTurns: number;
    conversationState: ConversationState;
  } | null;
  /** Simulated clock: offset from real time and the resulting "now". */
  clockOffsetMs: number;
  virtualNow: string;
}

/**
 * Turn-by-turn scenario stepping, shared by the CLI debugger and the
 * Inspector API. The controller never advances on its own: it holds a queue
 * of pending turns and only sends one when explicitly told to. That makes
 * "pause" the default state rather than a state machine — the same design
 * the CLI proved, lifted so both frontends drive identical logic.
 */
export class StepController {
  private active = false;
  private scenarioName: string | null = null;
  private channel: SessionChannel;
  private queue: StepQueueTurn[] = [];
  private sending = false;
  private lastResult: StepState["lastResult"];

  constructor(
    private readonly runtime: DevtoolsRuntime,
    private readonly notify: () => void = () => undefined
  ) {
    this.channel = runtime.getState().channel;
  }

  state(): StepState {
    const session = this.runtime.getState();
    const snapshot = this.active ? this.runtime.conversationSnapshot() : null;
    return {
      active: this.active,
      scenarioName: this.scenarioName,
      channel: this.channel,
      sessionId: this.active ? session.id : null,
      ...(session.contact ? { contact: session.contact } : {}),
      completedTurns: this.active ? countCallerTurns(session.transcript) : 0,
      queue: this.queue.map((turn) => ({ ...turn })),
      sending: this.sending,
      ...(this.lastResult ? { lastResult: this.lastResult } : {}),
      checkpoint: snapshot
        ? { recentHistoryTurns: snapshot.recentHistory.length, conversationState: snapshot.conversationState }
        : null,
      clockOffsetMs: this.runtime.clockOffset(),
      virtualNow: this.runtime.now()
    };
  }

  /** Begin stepping a scenario on a fresh session. */
  startFromScenario(scenario: Scenario, contact?: SessionContact): StepState {
    this.assertNotSending();
    this.runtime.reset({
      channel: scenario.channel,
      timeoutSeconds: scenario.timeoutSeconds,
      contextLimit: scenario.contextLimit,
      conversationState: scenario.conversationState,
      ...(contact ? { contact } : {}),
      from: scenario.from
    });
    if (scenario.startAt) this.runtime.setClock(scenario.startAt);
    this.active = true;
    this.scenarioName = scenario.name;
    this.channel = scenario.channel;
    this.queue = scenario.turns.map((turn) =>
      isCallerTurn(turn)
        ? {
            caller: turn.caller,
            ...(turn.expect ? { expect: turn.expect } : {}),
            ...(turn.after !== undefined ? { after: turn.after } : {})
          }
        : { agent: turn.agent, ...(turn.after !== undefined ? { after: turn.after } : {}) }
    );
    this.lastResult = undefined;
    this.notify();
    return this.state();
  }

  /**
   * Step-replay a saved run: its turns become the queue, with expectations
   * scaffolded from the actions the run actually observed.
   */
  startFromSession(sessionId: string): StepState {
    const scenario = this.runtime.getScenarioExport(sessionId, { scaffoldAssertions: true });
    if (!scenario) throw new Error(`No run found with id ${sessionId}`);
    if (!scenario.turns.length) throw new Error("Run has no turns to step through");
    const source = this.runtime.getHistorySession(sessionId);
    return this.startFromScenario(scenario, source?.contact);
  }

  /**
   * Start an empty step session on a channel: a blank conversation to type
   * or dictate into, with a simulated contact if one is chosen.
   */
  startBlank(channel: SessionChannel, contact?: SessionContact, conversationState?: ConversationState): StepState {
    this.assertNotSending();
    this.runtime.reset({
      channel,
      conversationState: conversationState ?? contact ? (conversationState ?? null) : null,
      ...(contact ? { contact } : {})
    });
    this.active = true;
    this.scenarioName = contact ? `Conversation with ${contact.name}` : "Conversation";
    this.channel = channel;
    this.queue = [];
    this.lastResult = undefined;
    this.notify();
    return this.state();
  }

  /**
   * Send the next queued turn. Caller turns are delivered to the webhook;
   * agent turns are seeded into history without a delivery. A turn's
   * `after` advances the simulated clock first.
   */
  async sendNext(): Promise<{ delivery?: InspectorDelivery; state: StepState }> {
    this.assertActive();
    this.assertNotSending();
    const pending = this.queue[0];
    if (!pending) throw new Error("Nothing queued. Add a turn first.");
    this.sending = true;
    this.notify();
    try {
      if (pending.after !== undefined) this.runtime.advanceClock(parseDuration(pending.after));
      if (pending.agent !== undefined) {
        this.runtime.seedAgentMessage(pending.agent, this.channel);
        this.queue.shift();
        this.lastResult = undefined;
        this.sending = false;
        return { state: this.state() };
      }
      const delivery = await this.runtime.sendCallerTurn(pending.caller ?? "", this.channel);
      this.queue.shift();
      this.lastResult = {
        turnNumber: countCallerTurns(this.runtime.getState().transcript),
        expectResults: evaluateExpectations(pending, delivery)
      };
      this.sending = false; // before state() so the returned snapshot is settled
      return { delivery, state: this.state() };
    } finally {
      this.sending = false;
      this.notify();
    }
  }

  /** Replace the next queued turn's text before it is sent. */
  editNext(text: string): StepState {
    this.assertActive();
    if (!this.queue.length) throw new Error("Nothing queued to edit");
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Turn text must not be empty");
    const head = this.queue[0];
    this.queue[0] = head.agent !== undefined ? { ...head, agent: trimmed, edited: true } : { ...head, caller: trimmed, edited: true };
    this.notify();
    return this.state();
  }

  /** Append a custom caller turn to the queue. */
  addTurn(caller: string): StepState {
    this.assertActive();
    const text = caller.trim();
    if (!text) throw new Error("Caller text must not be empty");
    this.queue.push({ caller: text });
    this.notify();
    return this.state();
  }

  /** Append an outbound agent message (campaign opener, follow-up) to the queue. */
  addAgentTurn(text: string, after?: SimulatedDelay): StepState {
    this.assertActive();
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Outbound message text must not be empty");
    this.queue.push({ agent: trimmed, ...(after !== undefined ? { after } : {}) });
    this.notify();
    return this.state();
  }

  /** Remove the next queued turn without sending it. */
  dropNext(): StepState {
    this.assertActive();
    this.assertNotSending();
    if (!this.queue.length) throw new Error("Nothing queued to drop");
    this.queue.shift();
    this.notify();
    return this.state();
  }

  /** Advance the simulated clock (e.g. "2d") without sending anything. */
  warp(delay: SimulatedDelay): StepState {
    this.assertNotSending();
    this.runtime.advanceClock(parseDuration(delay));
    this.notify();
    return this.state();
  }

  /**
   * Fork a run (the stepped session by default, or any saved run) from the
   * checkpoint after `turnIndex` completed caller turns, and continue
   * stepping on the new branch. Scripted turns from before the fork no
   * longer apply, so the queue is replaced by the branch's first caller
   * text (or emptied, if none is given yet).
   */
  fork(turnIndex: number, options: { sessionId?: string; caller?: string } = {}): StepState {
    this.assertNotSending();
    const sourceId = options.sessionId ?? this.runtime.getState().id;
    const forked = this.runtime.forkFromSession(sourceId, turnIndex);
    this.active = true;
    this.channel = forked.channel;
    // Name the branch after what was forked, not whatever was stepped before.
    this.scenarioName = forked.contact ? `Branch of the conversation with ${forked.contact.name}` : `Branch of ${sourceId}`;
    this.queue = options.caller?.trim() ? [{ caller: options.caller.trim() }] : [];
    this.lastResult = undefined;
    this.notify();
    return this.state();
  }

  /** End the stepped call and leave step mode. */
  async end(): Promise<StepState> {
    this.assertNotSending();
    if (this.active) await this.runtime.endCall();
    this.active = false;
    this.scenarioName = null;
    this.queue = [];
    this.lastResult = undefined;
    this.notify();
    return this.state();
  }

  private assertActive(): void {
    if (!this.active) throw new Error("No step session is active. Start one first.");
  }

  private assertNotSending(): void {
    if (this.sending) throw new Error("A turn is already in flight");
  }
}

function evaluateExpectations(turn: StepQueueTurn, delivery: InspectorDelivery): StepExpectResult[] {
  const results: StepExpectResult[] = [];
  const observed = collectObservedActions(delivery.response.parsed.chunks);
  for (const action of turn.expect?.actions ?? []) {
    results.push({ action, passed: observed.includes(action), observed });
  }
  for (const action of turn.expect?.forbiddenActions ?? []) {
    results.push({ action: `no ${action}`, passed: !observed.includes(action), observed });
  }
  const replyMatches = turn.expect?.replyMatches;
  if (replyMatches !== undefined) {
    const replyText =
      delivery.response.parsed.chunks.find(
        (chunk) => typeof chunk.text === "string" && chunk.text.length > 0 && chunk.interim !== true
      )?.text ?? "";
    results.push({
      action: `reply~/${replyMatches}/i`,
      passed: new RegExp(replyMatches, "i").test(replyText),
      observed: [replyText || "no reply text"]
    });
  }
  return results;
}

function countCallerTurns(transcript: Array<{ role: string }>): number {
  return transcript.filter((turn) => turn.role === "user").length;
}
