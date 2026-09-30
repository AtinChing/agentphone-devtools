"use client";

import { useMemo, useState } from "react";
import { PhoneCall } from "lucide-react";
import { useLive } from "@/lib/live";
import { Button, Card, Cell, EmptyState, Page, PageHeader, Row, Table, formatRelative } from "@/components/dashboard/ui";
import { RunsDrawer } from "@/components/dashboard/RunsDrawer";
import {
  RunContact,
  RunStatus,
  RunsSearch,
  SentimentBadge,
  ServerOffline,
  SuccessMark,
  callDurationSeconds,
  formatDuration,
  formatLatency,
  hasTraffic,
  runMatches,
  useDeepLinkedSession,
  useRunDetails,
  useServerOffline
} from "@/components/dashboard/RunsShared";

export default function VoiceCallsPage() {
  const { connected, runs } = useLive();
  const offline = useServerOffline();
  const [query, setQuery] = useState("");
  const [selected, select] = useDeepLinkedSession();

  const calls = useMemo(() => runs.filter((run) => run.channel === "voice" && hasTraffic(run)), [runs]);
  const visible = useMemo(() => calls.filter((run) => runMatches(run, query)), [calls, query]);
  // Duration, sentiment and outcome live on the full session's call_ended payload.
  const { details, loading } = useRunDetails(calls);
  const pending = <span className="text-slate-500">{loading ? "…" : "—"}</span>;

  let body;
  if (!runs.length && offline) body = <ServerOffline />;
  else if (!runs.length && !connected) body = <p className="px-6 py-10 text-center text-[14px] text-slate-500">Loading…</p>;
  else if (!calls.length)
    body = (
      <EmptyState
        icon={<PhoneCall size={26} />}
        title="No calls yet"
        description="Voice calls are simulated turn by turn: each caller utterance becomes a signed agent.message delivery, and hanging up sends agent.call_ended."
        action={<Button href="/devtools">Start a call in the Inspector</Button>}
      />
    );
  else if (!visible.length) body = <EmptyState title="No matching calls" description="Try another search term." />;
  else
    body = (
      <Table head={["Caller", "Duration", "Sentiment", "Successful", "Turns", "Deliveries", "Avg latency", "Status", "Started"]}>
        {visible.map((run) => {
          const session = details.get(run.id);
          const duration = session ? callDurationSeconds(session) : callDurationSeconds(run);
          return (
            <Row key={run.id} onClick={() => select(run.id)} className={run.id === selected ? "bg-mist" : ""}>
              <Cell className="min-w-[200px]">
                <RunContact run={run} />
              </Cell>
              <Cell mono className="whitespace-nowrap">
                {duration !== undefined ? formatDuration(duration) : run.status === "running" ? <span className="text-fern">live</span> : "—"}
              </Cell>
              <Cell>{session ? <SentimentBadge sentiment={session.callEnded?.userSentiment} /> : pending}</Cell>
              <Cell className="whitespace-nowrap">{session ? <SuccessMark value={session.callEnded?.callSuccessful} /> : pending}</Cell>
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
          );
        })}
      </Table>
    );

  return (
    <Page>
      <PageHeader
        title="Voice Calls"
        subtitle="Every simulated call, with its outcome and each webhook turn."
        actions={
          <Button href="/devtools" variant="secondary">
            <PhoneCall size={15} /> New call
          </Button>
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="text-[14px] text-slate-500">
            {calls.length} {calls.length === 1 ? "call" : "calls"}
          </div>
          <RunsSearch value={query} onChange={setQuery} placeholder="Search caller or message" />
        </div>
        {body}
      </Card>
      {selected ? <RunsDrawer runId={selected} run={runs.find((run) => run.id === selected)} onClose={() => select(null)} onOpenRun={select} /> : null}
    </Page>
  );
}
