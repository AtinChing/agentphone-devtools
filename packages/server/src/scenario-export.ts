import {
  collectObservedActions,
  formatDuration,
  isCallerTurn,
  type ConversationState,
  type Scenario,
  type ScenarioCallerTurn,
  type ScenarioTurn
} from "@agentphone-devtools/core";
import type { InspectorSession } from "./index.js";

export interface ScenarioExportDefaults {
  contextLimit: number;
  timeoutSeconds: number;
  conversationState?: ConversationState;
}

export interface ScenarioExportOptions {
  /**
   * Scaffold per-turn assertions from what actually happened: the actions
   * observed in each caller turn's handler response become that turn's
   * expected actions. Approving the export turns the recorded behavior into
   * a regression contract.
   */
  scaffoldAssertions?: boolean;
}

/** Gaps shorter than this are conversational latency, not simulated time. */
const MIN_EXPORTED_GAP_MS = 60_000;

export function buildScenarioFromSession(
  session: InspectorSession,
  defaults: ScenarioExportDefaults,
  options: ScenarioExportOptions = {}
): Scenario {
  // One agent.message delivery per caller turn, in order. Inherited prefix
  // deliveries (from a fork's source run) count: they are the record of what
  // the handler returned on those turns. Replays are ad-hoc and excluded.
  const turnDeliveries = session.deliveries.filter(
    (delivery) => delivery.event === "agent.message" && !delivery.replayOf
  );
  const seeds = new Set(session.outboundSeeds ?? []);
  const times = session.turnTimes ?? [];

  const turns: ScenarioTurn[] = [];
  let callerCursor = 0;
  session.transcript.forEach((entry, index) => {
    const isSeed = entry.role === "agent" && seeds.has(index);
    if (entry.role !== "user" && !isSeed) return;

    // Reproduce simulated time: the gap since the previous conversation
    // event, when it is large enough to have been deliberate.
    const previousAt = index > 0 ? times[index - 1] : undefined;
    const at = times[index];
    let after: string | undefined;
    if (previousAt && at) {
      const gap = Date.parse(at) - Date.parse(previousAt);
      if (Number.isFinite(gap) && gap >= MIN_EXPORTED_GAP_MS) after = formatDuration(gap);
    }

    if (isSeed) {
      turns.push({ agent: entry.content, ...(after ? { after } : {}) });
      return;
    }

    const turn: ScenarioCallerTurn = { caller: entry.content, ...(after ? { after } : {}) };
    if (options.scaffoldAssertions) {
      const delivery = turnDeliveries[callerCursor];
      const actions = delivery ? collectObservedActions(delivery.response.parsed.chunks) : [];
      if (actions.length) turn.expect = { actions };
    }
    callerCursor += 1;
    turns.push(turn);
  });

  const lineage = session.forkedFrom
    ? ` Forked from run ${session.forkedFrom.sessionId} after turn ${session.forkedFrom.turnIndex}.`
    : "";
  const who = session.contact ? ` Contact: ${session.contact.name} (${session.contact.number}).` : "";
  const startAt = times[0];

  return {
    name: `Recorded run ${session.id}`,
    description: `Recorded from AgentPhone DevTools run ${session.id}.${lineage}${who}`,
    channel: session.channel,
    ...(startAt ? { startAt } : {}),
    agentId: "agt_local",
    numberId: "num_local",
    from: session.contact?.number ?? "+15559876543",
    to: "+15551234567",
    conversationState: defaults.conversationState ?? null,
    contextLimit: defaults.contextLimit,
    timeoutSeconds: defaults.timeoutSeconds,
    turns
  };
}

export function stringifyScenarioJson(scenario: Scenario): string {
  return `${JSON.stringify(scenario, null, 2)}\n`;
}

export function stringifyScenarioYaml(scenario: Scenario): string {
  const lines: string[] = [
    `name: ${yamlScalar(scenario.name)}`,
    `description: ${yamlScalar(scenario.description ?? "")}`,
    `channel: ${scenario.channel}`,
    ...(scenario.startAt ? [`startAt: ${yamlScalar(scenario.startAt)}`] : []),
    `agentId: ${yamlScalar(scenario.agentId)}`,
    `numberId: ${yamlScalar(scenario.numberId)}`,
    `from: ${yamlScalar(scenario.from)}`,
    `to: ${yamlScalar(scenario.to)}`,
    "conversationState:",
    ...yamlValueLines(scenario.conversationState, 2),
    `contextLimit: ${scenario.contextLimit}`,
    `timeoutSeconds: ${scenario.timeoutSeconds}`,
    "turns:"
  ];

  for (const turn of scenario.turns) {
    if (!isCallerTurn(turn)) {
      lines.push(`  - agent: ${yamlScalar(turn.agent)}`);
      if (turn.after !== undefined) lines.push(`    after: ${yamlScalar(turn.after)}`);
      continue;
    }
    lines.push(`  - caller: ${yamlScalar(turn.caller)}`);
    if (turn.after !== undefined) lines.push(`    after: ${yamlScalar(turn.after)}`);
    if (turn.waitMs !== undefined) lines.push(`    waitMs: ${turn.waitMs}`);
    if (turn.fault && Object.keys(turn.fault).length) {
      lines.push("    fault:");
      for (const [key, value] of Object.entries(turn.fault)) {
        if (value !== undefined) lines.push(`      ${key}: ${yamlScalar(value)}`);
      }
    }
    if (turn.expect) {
      const expect = turn.expect;
      lines.push("    expect:");
      if (expect.actions?.length) {
        lines.push("      actions:");
        for (const action of expect.actions) lines.push(`        - ${yamlScalar(action)}`);
      }
      if (expect.forbiddenActions?.length) {
        lines.push("      forbiddenActions:");
        for (const action of expect.forbiddenActions) lines.push(`        - ${yamlScalar(action)}`);
      }
      if (expect.replyMatches !== undefined) lines.push(`      replyMatches: ${yamlScalar(expect.replyMatches)}`);
      if (expect.status !== undefined) lines.push(`      status: ${expect.status}`);
      if (expect.timedOut !== undefined) lines.push(`      timedOut: ${expect.timedOut}`);
      if (expect.retries !== undefined) lines.push(`      retries: ${expect.retries}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function yamlValueLines(value: unknown, indent: number): string[] {
  const prefix = " ".repeat(indent);
  if (value === null || value === undefined) return [`${prefix}null`];
  if (Array.isArray(value)) {
    if (!value.length) return [`${prefix}[]`];
    return value.flatMap((item) => {
      if (isPlainObject(item) || Array.isArray(item)) return [`${prefix}-`, ...yamlValueLines(item, indent + 2)];
      return [`${prefix}- ${yamlScalar(item)}`];
    });
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (!entries.length) return [`${prefix}{}`];
    return entries.flatMap(([key, entry]) => {
      if (isPlainObject(entry) || Array.isArray(entry)) return [`${prefix}${key}:`, ...yamlValueLines(entry, indent + 2)];
      return [`${prefix}${key}: ${yamlScalar(entry)}`];
    });
  }
  return [`${prefix}${yamlScalar(value)}`];
}

function yamlScalar(value: unknown): string {
  return JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
