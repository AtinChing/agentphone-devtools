"use client";

import { useMemo, useState } from "react";
import { MessageCircle } from "lucide-react";
import { useLive } from "@/lib/live";
import type { SessionChannel } from "@/lib/types";
import { Button, Card, Cell, ChannelBadge, EmptyState, Page, PageHeader, Row, Table, formatRelative } from "@/components/dashboard/ui";
import { RunsDrawer } from "@/components/dashboard/RunsDrawer";
import {
  RunContact,
  RunStatus,
  RunsSearch,
  ServerOffline,
  formatLatency,
  hasTraffic,
  runMatches,
  useDeepLinkedSession,
  useServerOffline
} from "@/components/dashboard/RunsShared";

type ChannelFilter = "all" | Exclude<SessionChannel, "voice">;

const FILTERS: { id: ChannelFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "imessage", label: "iMessage" },
  { id: "sms", label: "SMS" },
  { id: "whatsapp", label: "WhatsApp" }
];

export default function MessagesPage() {
  const { connected, runs } = useLive();
  const offline = useServerOffline();
  const [filter, setFilter] = useState<ChannelFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, select] = useDeepLinkedSession();

  const threads = useMemo(() => runs.filter((run) => run.channel !== "voice" && hasTraffic(run)), [runs]);
  const visible = useMemo(
    () => threads.filter((run) => (filter === "all" || run.channel === filter) && runMatches(run, query)),
    [threads, filter, query]
  );
  const counts = useMemo(() => {
    const byChannel: Record<ChannelFilter, number> = { all: threads.length, imessage: 0, sms: 0, whatsapp: 0 };
    for (const run of threads) if (run.channel !== "voice") byChannel[run.channel] += 1;
    return byChannel;
  }, [threads]);

  let body;
  if (!runs.length && offline) body = <ServerOffline />;
  else if (!runs.length && !connected) body = <p className="px-6 py-10 text-center text-[14px] text-slate-500">Loading…</p>;
  else if (!threads.length)
    body = (
      <EmptyState
        icon={<MessageCircle size={26} />}
        title="No conversations yet"
        description="Text your agent from the iMessage tab or run a messaging scenario; every thread shows up here with its deliveries."
        action={<Button href="/imessage">Open iMessage</Button>}
      />
    );
  else if (!visible.length) body = <EmptyState title="No matching conversations" description="Try another channel or search term." />;
  else
    body = (
      <Table head={["Contact", "Channel", "Last message", "Turns", "Deliveries", "Avg latency", "Status", "Started"]}>
        {visible.map((run) => (
          <Row key={run.id} onClick={() => select(run.id)} className={run.id === selected ? "bg-mist" : ""}>
            <Cell className="min-w-[200px]">
              <RunContact run={run} />
            </Cell>
            <Cell>
              <ChannelBadge channel={run.channel} />
            </Cell>
            <Cell className="max-w-[320px]">
              <div className="truncate text-slate-600" title={run.lastMessage}>
                {run.lastMessage ?? "—"}
              </div>
            </Cell>
            <Cell mono>{run.transcriptTurns}</Cell>
            <Cell mono>{run.deliveries}</Cell>
            <Cell mono className="whitespace-nowrap">
              {formatLatency(run.averageLatencyMs)}
            </Cell>
            <Cell>
              <RunStatus run={run} />
            </Cell>
            <Cell className="whitespace-nowrap text-slate-500">{formatRelative(run.startedAt)}</Cell>
          </Row>
        ))}
      </Table>
    );

  return (
    <Page>
      <PageHeader title="Messages" subtitle="Every simulated SMS, iMessage and WhatsApp conversation." />
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                className={`rounded-full border px-3 py-1 text-[13px] transition ${
                  filter === option.id ? "border-[#2e5a37] bg-[#173322] text-fern" : "border-line text-slate-600 hover:text-bright"
                }`}
              >
                {option.label}
                <span className="ml-1.5 text-[12px] opacity-70">{counts[option.id]}</span>
              </button>
            ))}
          </div>
          <RunsSearch value={query} onChange={setQuery} placeholder="Search contact or message" />
        </div>
        {body}
      </Card>
      {selected ? <RunsDrawer runId={selected} run={runs.find((run) => run.id === selected)} onClose={() => select(null)} onOpenRun={select} /> : null}
    </Page>
  );
}
