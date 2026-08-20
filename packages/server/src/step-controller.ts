import {
  collectObservedActions,
  type ConversationState,
  type Scenario,
  type ScenarioTurn
} from "@agentphone-devtools/core";
import type { DevtoolsRuntime, InspectorDelivery } from "./index.js";

export interface StepQueueTurn {
  caller: string;
  expect?: ScenarioTurn["expect"];
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
  channel: "sms" | "voice";
  sessionId: string | null;
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
}

/**
 * Turn-by-turn scenario stepping, shared by the CLI debugger and the
 * Inspector API. The controller never advances on its own: it holds a queue
 * of pending caller turns and only sends one when explicitly told to. That
 * makes "pause" the default state rather than a state machine — the same
 * design the CLI proved, lifted so both frontends drive identical logic.
 */
export class StepController {
  private active = false;
  private scenarioName: string | null = null;
  private channel: "sms" | "voice";
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
      completedTurns: this.active ? countCallerTurns(session.transcript) : 0,
      queue: this.queue.map((turn) => ({ ...turn })),
      sending: this.sending,
      ...(this.lastResult ? { lastResult: this.lastResult } : {}),
      checkpoint: snapshot
        ? { recentHistoryTurns: snapshot.recentHistory.length, conversationState: snapshot.conversationState }
        : null
    };
  }

  /** Begin stepping a scenario on a fresh session. */
  startFromScenario(scenario: Scenario): StepState {
    this.assertNotSending();
    this.runtime.reset({
      channel: scenario.channel,
      timeoutSeconds: scenario.timeoutSeconds,
      contextLimit: scenario.contextLimit,
      conversationState: scenario.conversationState
    });
    this.active = true;
    this.scenarioName = scenario.name;
    this.channel = scenario.channel;
    this.queue = scenario.turns.map((turn) => ({
      caller: turn.caller,
      ...(turn.expect ? { expect: turn.expect } : {})
    }));
    this.lastResult = undefined;
    this.notify();
    return this.state();
  }

  /**
   * Step-replay a saved run: its caller turns become the queue, with
   * expectations scaffolded from the actions the run actually observed.
   */
  startFromSession(sessionId: string): StepState {
    const scenario = this.runtime.getScenarioExport(sessionId, { scaffoldAssertions: true });
    if (!scenario) throw new Error(`No run found with id ${sessionId}`);
    if (!scenario.turns.length) throw new Error("Run has no caller turns to step through");
    return this.startFromScenario(scenario);
  }

  /** Send the next queued caller turn. */
  async sendNext(): Promise<{ delivery: InspectorDelivery; state: StepState }> {
    this.assertActive();
    this.assertNotSending();
    const pending = this.queue[0];
    if (!pending) throw new Error("Nothing queued. Add a turn first.");
    this.sending = true;
    this.notify();
    try {
      const delivery = await this.runtime.sendCallerTurn(pending.caller, this.channel);
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

  /** Replace the next queued caller text before it is sent. */
  editNext(caller: string): StepState {
    this.assertActive();
    if (!this.queue.length) throw new Error("Nothing queued to edit");
    const text = caller.trim();
    if (!text) throw new Error("Caller text must not be empty");
    this.queue[0] = { ...this.queue[0], caller: text, edited: true };
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
    this.scenarioName = this.scenarioName ?? `Fork of ${sourceId}`;
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
  const expectedActions = turn.expect?.actions ?? [];
  if (expectedActions.length) {
    const observed = collectObservedActions(delivery.response.parsed.chunks);
    results.push(...expectedActions.map((action) => ({ action, passed: observed.includes(action), observed })));
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
