import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { z } from "zod";
import type { Scenario } from "./types.js";

const scenarioSchema = z
  .object({
    name: z.string().min(1).default("Untitled scenario"),
    description: z.string().optional(),
    channel: z.enum(["sms", "voice"]).default("voice"),
    agentId: z.string().min(1).default("agt_local"),
    numberId: z.string().min(1).default("num_local"),
    from: z.string().regex(/^\+\d{8,15}$/).default("+15559876543"),
    to: z.string().regex(/^\+\d{8,15}$/).default("+15551234567"),
    conversationState: z.record(z.unknown()).nullable().default(null),
    contextLimit: z.number().int().min(0).max(50).default(10),
    timeoutSeconds: z.number().int().min(5).max(120).default(30),
    turns: z
      .array(
        z
          .object({
            caller: z.string().min(1),
            expect: z
              .object({
                outcome: z.enum(["resolved", "handed_off", "failed"]).optional(),
                actions: z.array(z.string()).optional(),
                status: z.number().int().min(100).max(599).optional(),
                timedOut: z.boolean().optional(),
                retries: z.number().int().min(0).max(10).optional()
              })
              .strict()
              .optional(),
            fault: z
              .object({
                invalidSignature: z.boolean().optional(),
                omitSignature: z.boolean().optional(),
                staleTimestampSeconds: z.number().int().min(301).max(86_400).optional(),
                tamperBody: z.boolean().optional(),
                malformedJson: z.boolean().optional(),
                duplicateWebhookId: z.boolean().optional(),
                simulateTimeout: z.boolean().optional()
              })
              .strict()
              .optional(),
            waitMs: z.number().int().nonnegative().optional()
          })
          .strict()
      )
      .min(1),
    expectedOutcome: z.enum(["resolved", "handed_off", "failed"]).optional()
  })
  .strict();

export async function loadScenarioFile(path: string): Promise<Scenario> {
  const raw = await readFile(path, "utf8");
  return parseScenario(raw, path);
}

export function parseScenario(raw: string, source = "scenario"): Scenario {
  const parsed = source.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);
  const scenario = scenarioSchema.parse(parsed);
  return {
    ...scenario,
    expectedOutcome: scenario.expectedOutcome ?? scenario.turns.find((turn) => turn.expect?.outcome)?.expect?.outcome
  };
}

export function scenarioToRecentHistory(
  turns: Array<{ role: "user" | "agent"; content: string; at: string; channel: "sms" | "voice" }>,
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
