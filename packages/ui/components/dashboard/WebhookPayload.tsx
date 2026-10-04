"use client";

import type { InspectorDelivery } from "@/lib/types";
import { Badge, ChannelBadge, Eyebrow, formatDateTime } from "@/components/dashboard/ui";

/** Shape of what the simulator sends, used until a real delivery exists. Mirrors core's buildMessageEvent. */
const EXAMPLE_ENVELOPE = {
  event: "agent.message",
  channel: "imessage",
  timestamp: "2026-09-30T17:42:05Z",
  agentId: "agt_local",
  data: {
    conversationId: "conv_8c1f2a9d4b7e",
    numberId: "num_local",
    from: "+15559876543",
    to: "+15551234567",
    message: "Is the fast charger at North Lot working today?",
    mediaUrl: null,
    direction: "inbound",
    receivedAt: "2026-09-30T17:42:05Z"
  },
  conversationState: { customerName: "Maya Chen", stationGroup: "North Lot", tier: "gold" },
  recentHistory: [
    {
      content: "Hi Maya, it's North Lot EV Charging. Your session on Bay 4 finished.",
      direction: "outbound",
      channel: "imessage",
      at: "2026-09-30T17:10:00Z"
    },
    { content: "Thanks! Quick question", direction: "inbound", channel: "imessage", at: "2026-09-30T17:41:30Z" }
  ]
};

const SIGNING_HEADERS: { name: string; description: string }[] = [
  { name: "X-Webhook-Signature", description: "sha256=<hex HMAC>" },
  { name: "X-Webhook-Timestamp", description: "Unix seconds at signing (real time)" },
  { name: "X-Webhook-ID", description: "Unique per delivery; dedupe on it" },
  { name: "X-Webhook-Event", description: "agent.message or agent.call_ended" }
];

/** The exact envelope of the latest delivery (or a representative example) plus the signing headers it carried. */
export function WebhookPayloadCard({ delivery }: { delivery: InspectorDelivery | null }) {
  const body = delivery ? delivery.request.body : EXAMPLE_ENVELOPE;
  return (
    <div className="rounded-[18px] bg-card p-6 shadow-card backdrop-blur-[2px]">
      <h3 className="mb-4 text-lg font-semibold text-text">Webhook Payload</h3>
      <p className="mb-4 text-sm text-text-dim">
        When a message is received, we&apos;ll POST the following JSON to your endpoint with full conversation context:
      </p>
      <div className="overflow-hidden rounded-[12px] bg-card-content">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-4 py-2 text-xs font-medium text-text-dim">
          <span>JSON</span>
          <span className="flex flex-wrap items-center gap-2 font-normal">
            {delivery ? (
              <>
                <Badge tone="green">Latest delivery</Badge>
                <ChannelBadge channel={delivery.channel} />
                <span className="font-mono">{delivery.event}</span>
                <span>· {formatDateTime(delivery.timestamp)}</span>
              </>
            ) : (
              <>
                <Badge tone="amber">Example</Badge>
                <span>No deliveries yet. Send a message and this shows the real envelope.</span>
              </>
            )}
          </span>
        </div>
        <pre className="max-h-[420px] overflow-auto p-4 text-sm leading-relaxed">
          <code className="text-primary">{JSON.stringify(body, null, 2)}</code>
        </pre>
      </div>

      <div className="mt-6">
        <Eyebrow className="mb-2">Signing headers</Eyebrow>
        <p className="text-sm text-text-dim">
          Every request is signed with HMAC-SHA256 over <code className="text-primary">{"`${timestamp}.${rawBody}`"}</code> using your signing secret.
          Verify against the raw bytes, compare in constant time, and reject timestamps older than 5 minutes.
        </p>
        <div className="mt-3 overflow-hidden rounded-[12px] bg-card-content">
          {SIGNING_HEADERS.map((header) => {
            const value = delivery ? delivery.request.headers[header.name] : undefined;
            return (
              <div
                key={header.name}
                className="grid gap-1 border-b border-white/[0.06] px-4 py-3 last:border-b-0 md:grid-cols-[200px_minmax(0,1fr)] md:gap-4"
              >
                <span className="font-mono text-xs text-text">{header.name}</span>
                <span className="min-w-0 truncate text-sm text-text-secondary" title={value}>
                  {delivery ? (
                    value ? (
                      <span className="font-mono text-xs text-text-secondary">{value}</span>
                    ) : (
                      <span className="text-amber-400">omitted (fault injection)</span>
                    )
                  ) : (
                    header.description
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
