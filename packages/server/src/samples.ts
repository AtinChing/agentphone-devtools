import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { ContactsStore } from "./contacts.js";
import type { DevtoolsRuntime } from "./index.js";

/**
 * The conversations a fresh simulator comes with: one real run per
 * scenario, each bound (by its `from` number) to one of the default
 * contacts, so every tab has something to show the first time it opens.
 * They run against the configured handler — nothing here is canned.
 */
export const SAMPLE_SCENARIOS = [
  "examples/messaging/campaigns/campaign-interested.yaml",
  "examples/messaging/campaigns/campaign-question.yaml",
  "examples/messaging/campaigns/campaign-declined.yaml",
  "examples/messaging/campaigns/campaign-late-reply.yaml",
  "examples/messaging/imessage/booking-via-text.yaml",
  "examples/messaging/imessage/follow-up-after-silence.yaml",
  "examples/messaging/imessage/station-status.yaml",
  "examples/messaging/sms/reminder-confirm.yaml",
  "examples/messaging/sms/reminder-reschedule.yaml",
  "examples/messaging/sms/wrong-number.yaml",
  "examples/messaging/whatsapp/opt-in-and-lookup.yaml",
  "examples/messaging/whatsapp/location.yaml",
  "examples/messaging/whatsapp/spanish.yaml",
  "examples/scenarios/voice/appointment-reschedule.yaml",
  "examples/scenarios/voice/billing-dispute.yaml",
  "examples/scenarios/voice/after-hours-escalation.yaml",
  "examples/scenarios/appointment-cancellation.yaml",
  "examples/scenarios/ev-support.yaml",
  "examples/scenarios/ev-support-sms.yaml"
];

export interface SampleSeedResult {
  runs: number;
  passed: number;
  contactsAdded: number;
  skipped: string[];
}

export class SamplesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SamplesUnavailableError";
  }
}

/**
 * Run every sample scenario against the current target. The first delivery
 * decides whether the handler is reachable at all: if it never answered,
 * the attempt is removed again and nothing else is sent, so a simulator
 * started before its handler does not fill up with connection errors.
 */
export async function seedSampleRuns(runtime: DevtoolsRuntime, contacts: ContactsStore, cwd = process.cwd()): Promise<SampleSeedResult> {
  const contactsAdded = contacts.ensureDefaults();
  const skipped: string[] = [];
  let runs = 0;
  let passed = 0;

  for (const [index, relativePath] of SAMPLE_SCENARIOS.entries()) {
    const absolute = resolve(cwd, relativePath);
    if (!existsSync(absolute)) {
      skipped.push(relativePath);
      continue;
    }
    const session = await runtime.runScenario(absolute);
    const first = session.deliveries[0];
    const unreachable = first !== undefined && !first.ok && first.response.status === 0 && !first.timedOut;
    if (index === 0 && unreachable) {
      runtime.reset();
      runtime.deleteHistorySession(session.id);
      throw new SamplesUnavailableError(`The handler at ${session.targetUrl} did not answer. Start it, then load the sample conversations from Settings.`);
    }
    runs += 1;
    if (session.scenarioResult?.passed) passed += 1;
  }

  // Leave a clean live session behind rather than the last sample's.
  runtime.reset();
  return { runs, passed, contactsAdded, skipped };
}
