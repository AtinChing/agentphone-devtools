import { collectObservedActions, type ConversationState, type Scenario } from "@agentphone-devtools/core";
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

  const turns = session.transcript
    .filter((turn) => turn.role === "user")
    .map((turn, index) => {
      if (!options.scaffoldAssertions) return { caller: turn.content };
      const delivery = turnDeliveries[index];
      const actions = delivery ? collectObservedActions(delivery.response.parsed.chunks) : [];
      return actions.length ? { caller: turn.content, expect: { actions } } : { caller: turn.content };
    });

  const lineage = session.forkedFrom
    ? ` Forked from run ${session.forkedFrom.sessionId} after turn ${session.forkedFrom.turnIndex}.`
    : "";

  return {
    name: `Recorded run ${session.id}`,
    description: `Recorded from AgentPhone DevTools run ${session.id}.${lineage}`,
    channel: session.channel,
    agentId: "agt_local",
    numberId: "num_local",
    from: "+15559876543",
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
    lines.push(`  - caller: ${yamlScalar(turn.caller)}`);
    if (turn.waitMs !== undefined) lines.push(`    waitMs: ${turn.waitMs}`);
    if (turn.expect) {
      lines.push("    expect:");
      if (turn.expect.actions?.length) {
        lines.push("      actions:");
        for (const action of turn.expect.actions) lines.push(`        - ${yamlScalar(action)}`);
      }
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
