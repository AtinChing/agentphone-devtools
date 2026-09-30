import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { z } from "zod";
import type { Scenario, ScenarioCallerTurn, ScenarioTurn, SessionChannel } from "./types.js";

const durationSchema = z.union([
  z.number().int().nonnegative(),
  z.string().regex(/^(\s*\d+(?:\.\d+)?(ms|s|m|h|d|w)\s*)+$/, "after must be a duration like 90s, 45m, 3h, 2d, or 1h30m")
]);

const expectSchema = z
  .object({
    actions: z.array(z.string()).optional(),
    forbiddenActions: z.array(z.string()).optional(),
    replyMatches: z
      .string()
      .min(1)
      .refine((pattern) => {
        try {
          new RegExp(pattern);
          return true;
        } catch {
          return false;
        }
      }, "replyMatches must be a valid regular expression")
      .optional(),
    status: z.number().int().min(100).max(599).optional(),
    timedOut: z.boolean().optional(),
    retries: z.number().int().min(0).max(10).optional()
  })
  .strict();

const faultSchema = z
  .object({
    invalidSignature: z.boolean().optional(),
    omitSignature: z.boolean().optional(),
    staleTimestampSeconds: z.number().int().min(301).max(86_400).optional(),
    tamperBody: z.boolean().optional(),
    malformedJson: z.boolean().optional(),
    duplicateWebhookId: z.boolean().optional(),
    simulateTimeout: z.boolean().optional()
  })
  .strict();

const callerTurnSchema = z
  .object({
    caller: z.string().min(1),
    expect: expectSchema.optional(),
    fault: faultSchema.optional(),
    waitMs: z.number().int().nonnegative().optional(),
    after: durationSchema.optional()
  })
  .strict();

// An outbound message the business sent outside the webhook (campaign
// opener, scheduled follow-up). Seeded into history, never delivered.
const agentTurnSchema = z
  .object({
    agent: z.string().min(1),
    after: durationSchema.optional()
  })
  .strict();

const scenarioSchema = z
  .object({
    name: z.string().min(1).default("Untitled scenario"),
    description: z.string().optional(),
    channel: z.enum(["sms", "imessage", "whatsapp", "voice"]).default("voice"),
    startAt: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), "startAt must be an ISO datetime")
      .optional(),
    agentId: z.string().min(1).default("agt_local"),
    numberId: z.string().min(1).default("num_local"),
    from: z.string().regex(/^\+\d{8,15}$/).default("+15559876543"),
    to: z.string().regex(/^\+\d{8,15}$/).default("+15551234567"),
    conversationState: z.record(z.unknown()).nullable().default(null),
    contextLimit: z.number().int().min(0).max(50).default(10),
    timeoutSeconds: z.number().int().min(5).max(120).default(30),
    turns: z
      .array(z.union([callerTurnSchema, agentTurnSchema]))
      .min(1)
      .refine((turns) => turns.some((turn) => "caller" in turn), "a scenario needs at least one caller turn")
  })
  .strict();

export function isCallerTurn(turn: ScenarioTurn): turn is ScenarioCallerTurn {
  return "caller" in turn;
}

export async function loadScenarioFile(path: string): Promise<Scenario> {
  const raw = await readFile(path, "utf8");
  return parseScenario(raw, path);
}

export function parseScenario(raw: string, source = "scenario"): Scenario {
  const parsed = source.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);
  return scenarioSchema.parse(parsed);
}

export function scenarioToRecentHistory(
  turns: Array<{ role: "user" | "agent"; content: string; at: string; channel: SessionChannel }>,
  contextLimit: number
) {
  if (contextLimit === 0) return [];
  return turns.slice(-contextLimit).map((turn) => ({
    content: turn.content,
    direction: turn.role === "user" ? ("inbound" as const) : ("outbound" as const),
    channel: turn.channel,
    at: turn.at
  }));
}
