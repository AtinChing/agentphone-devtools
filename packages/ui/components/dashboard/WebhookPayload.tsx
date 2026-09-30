"use client";

import type { InspectorDelivery } from "@/lib/types";
import { Badge, Card, ChannelBadge, Eyebrow, formatDateTime } from "@/components/dashboard/ui";

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
    <Card
      title="Webhook Payload"
      subtitle="When a message is received, we'll POST the following JSON to your endpoint with full conversation context:"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] text-slate-500">
        {delivery ? (
          <>
            <Badge tone="green">Latest delivery</Badge>
            <ChannelBadge channel={delivery.channel} />
            <span className="data">{delivery.event}</span>
            <span>· {formatDateTime(delivery.timestamp)}</span>
          </>
        ) : (
          <>
            <Badge tone="amber">Example</Badge>
            <span>No deliveries yet. Send a message and this shows the real envelope.</span>
          </>
        )}
      </div>
      <pre className="console-pane max-h-[420px] overflow-auto rounded-xl border border-line p-4 text-[12.5px] leading-relaxed">
        {JSON.stringify(body, null, 2)}
      </pre>

      <div className="mt-6">
        <Eyebrow>Signing headers</Eyebrow>
        <p className="mt-2 text-[14px] text-slate-500">
          Every request is signed with HMAC-SHA256 over <code className="data text-slate-700">{"`${timestamp}.${rawBody}`"}</code> using your
          signing secret. Verify against the raw bytes, compare in constant time, and reject timestamps older than 5 minutes.
        </p>
        <div className="mt-3 overflow-hidden rounded-xl border border-line">
          {SIGNING_HEADERS.map((header) => {
            const value = delivery ? delivery.request.headers[header.name] : undefined;
            return (
              <div key={header.name} className="grid gap-1 border-b border-line/70 px-4 py-2.5 last:border-b-0 md:grid-cols-[200px_minmax(0,1fr)] md:gap-4">
                <span className="data text-[13px] text-bright">{header.name}</span>
                <span className="min-w-0 truncate text-[13px] text-slate-500" title={value}>
                  {delivery ? (
                    value ? (
                      <span className="data text-slate-700">{value}</span>
                    ) : (
                      <span className="text-caution">omitted (fault injection)</span>
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
    </Card>
  );
}
