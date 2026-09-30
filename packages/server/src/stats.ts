import type { InspectorSession } from "./index.js";

export interface DailyActivity {
  date: string; // YYYY-MM-DD
  messages: number;
  calls: number;
  deliveries: number;
}

export interface UsageStats {
  totals: {
    runs: number;
    deliveries: number;
    messages: number;
    calls: number;
    failedDeliveries: number;
    averageLatencyMs: number;
    scenarioRuns: number;
    scenarioPassRate: number;
    contacts: number;
    forks: number;
    optOuts: number;
  };
  windows: {
    last24h: { messages: number; calls: number };
    last7d: { messages: number; calls: number };
    last30d: { messages: number; calls: number };
  };
  byDay: DailyActivity[];
  webhookHealth: {
    successRate: number;
    lastDeliveryAt?: string;
    lastStatus?: number;
    timeouts: number;
  };
}

const DAY_MS = 86_400_000;

/** Aggregate the local run history into the numbers the dashboard tiles show. */
export function computeUsageStats(sessions: InspectorSession[], now = new Date(), days = 30): UsageStats {
  const deliveries = sessions.flatMap((session) => session.deliveries.map((delivery) => ({ session, delivery })));
  const messageDeliveries = deliveries.filter(({ delivery }) => delivery.event === "agent.message" && delivery.channel !== "voice");
  const voiceSessions = sessions.filter((session) => session.channel === "voice" && session.deliveries.length > 0);
  const failed = deliveries.filter(({ delivery }) => delivery.timedOut || !delivery.ok);
  const latencyTotal = deliveries.reduce((total, { delivery }) => total + delivery.latencyMs, 0);
  const scenarioRuns = sessions.filter((session) => session.scenarioResult);
  const scenarioPassed = scenarioRuns.filter((session) => session.scenarioResult?.passed).length;
  const optOuts = deliveries.filter(({ delivery }) =>
    delivery.response.parsed.chunks.some((chunk) => chunk.action === "opt_out")
  ).length;

  const dayKey = (iso: string) => iso.slice(0, 10);
  const byDayMap = new Map<string, DailyActivity>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
    byDayMap.set(date, { date, messages: 0, calls: 0, deliveries: 0 });
  }
  for (const { delivery } of deliveries) {
    const bucket = byDayMap.get(dayKey(delivery.timestamp));
    if (!bucket) continue;
    bucket.deliveries += 1;
    if (delivery.event === "agent.message" && delivery.channel !== "voice") bucket.messages += 1;
  }
  for (const session of voiceSessions) {
    const bucket = byDayMap.get(dayKey(session.startedAt));
    if (bucket) bucket.calls += 1;
  }

  const within = (iso: string, ms: number) => now.getTime() - Date.parse(iso) <= ms;
  const window = (ms: number) => ({
    messages: messageDeliveries.filter(({ delivery }) => within(delivery.timestamp, ms)).length,
    calls: voiceSessions.filter((session) => within(session.startedAt, ms)).length
  });

  const lastDelivery = deliveries
    .map(({ delivery }) => delivery)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];

  return {
    totals: {
      runs: sessions.length,
      deliveries: deliveries.length,
      messages: messageDeliveries.length,
      calls: voiceSessions.length,
      failedDeliveries: failed.length,
      averageLatencyMs: deliveries.length ? Math.round(latencyTotal / deliveries.length) : 0,
      scenarioRuns: scenarioRuns.length,
      scenarioPassRate: scenarioRuns.length ? Math.round((scenarioPassed / scenarioRuns.length) * 100) : 0,
      contacts: new Set(sessions.map((session) => session.contact?.number).filter(Boolean)).size,
      forks: sessions.filter((session) => session.forkedFrom).length,
      optOuts
    },
    windows: {
      last24h: window(DAY_MS),
      last7d: window(7 * DAY_MS),
      last30d: window(30 * DAY_MS)
    },
    byDay: [...byDayMap.values()],
    webhookHealth: {
      successRate: deliveries.length ? Math.round(((deliveries.length - failed.length) / deliveries.length) * 100) : 100,
      ...(lastDelivery ? { lastDeliveryAt: lastDelivery.timestamp, lastStatus: lastDelivery.response.status } : {}),
      timeouts: deliveries.filter(({ delivery }) => delivery.timedOut).length
    }
  };
}
