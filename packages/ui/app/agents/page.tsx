"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { EnvironmentsResponse } from "@/lib/types";
import { Button, Card, EmptyState, Notice, Page, PageBody, PageHeader, formatRelative } from "@/components/dashboard/ui";
import { AgentCard, type AgentProfile } from "@/components/dashboard/AgentCard";
import { AgentCreateModal } from "@/components/dashboard/AgentCreateModal";
import { RunsSearch, ServerOffline, hasTraffic, useRunDetails, useServerOffline } from "@/components/dashboard/RunsShared";

/** How many recent runs are fetched in full to read deliveries and actions. */
const DETAIL_SAMPLE = 30;

export default function AgentsPage() {
  const router = useRouter();
  const { connected, session, runs, refreshSession } = useLive();
  const offline = useServerOffline();
  const [environments, setEnvironments] = useState<EnvironmentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  const trafficRuns = useMemo(() => runs.filter(hasTraffic), [runs]);
  const sample = useMemo(() => trafficRuns.slice(0, DETAIL_SAMPLE), [trafficRuns]);
  const { details, loading } = useRunDetails(sample);

  const loadEnvironments = useCallback(async () => {
    try {
      setEnvironments(await api.get<EnvironmentsResponse>("/api/environments"));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  // Reload when the target changes, including activations from other tabs.
  const target = session ? `${session.targetUrl}|${session.secretPreview}|${session.channel}` : "";
  useEffect(() => {
    if (connected) void loadEnvironments();
  }, [connected, target, loadEnvironments]);

  const agents = useMemo<AgentProfile[]>(() => {
    const active = session
      ? { targetUrl: session.targetUrl, secretPreview: session.secretPreview, channel: session.channel }
      : environments?.active;
    let activeFound = false;
    const saved = (environments?.environments ?? []).map((environment): AgentProfile => {
      const isActive = !activeFound && Boolean(active && environment.targetUrl === active.targetUrl && environment.secretPreview === active.secretPreview);
      if (isActive) activeFound = true;
      return {
        key: environment.id,
        name: environment.name,
        description: `Environment · added ${formatRelative(environment.createdAt)}`,
        targetUrl: environment.targetUrl,
        secretPreview: environment.secretPreview,
        channel: isActive && active ? active.channel : environment.channel,
        active: isActive,
        environmentId: environment.id
      };
    });
    if (active && !activeFound) {
      saved.unshift({
        key: "active",
        name: "Local handler",
        description: "Current simulator target",
        targetUrl: active.targetUrl,
        secretPreview: active.secretPreview,
        channel: active.channel,
        active: true
      });
    }
    return saved.sort((a, b) => Number(b.active) - Number(a.active));
  }, [environments, session]);

  async function activate(agent: AgentProfile): Promise<boolean> {
    if (agent.active || !agent.environmentId) return true;
    setBusyKey(agent.key);
    setError(null);
    try {
      await api.post(`/api/environments/${encodeURIComponent(agent.environmentId)}/activate`);
      await Promise.all([refreshSession(), loadEnvironments()]);
      return true;
    } catch (err) {
      setError(`Couldn't activate ${agent.name}: ${errorMessage(err)}`);
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function open(agent: AgentProfile, path: string) {
    if (await activate(agent)) router.push(path);
  }

  async function remove(agent: AgentProfile) {
    if (!agent.environmentId) return;
    setBusyKey(agent.key);
    setError(null);
    try {
      await api.delete(`/api/environments/${encodeURIComponent(agent.environmentId)}`);
      await loadEnvironments();
    } catch (err) {
      setError(`Couldn't remove ${agent.name}: ${errorMessage(err)}`);
    } finally {
      setBusyKey(null);
    }
  }

  const needle = query.trim().toLowerCase();
  const visible = needle ? agents.filter((agent) => [agent.name, agent.targetUrl, agent.description].some((text) => text.toLowerCase().includes(needle))) : agents;

  let body;
  if (!session && offline) {
    body = (
      <Card>
        <ServerOffline />
      </Card>
    );
  } else if (!session) {
    body = (
      <div className="flex flex-col gap-3">
        {[0, 1].map((index) => (
          <div key={index} className="h-24 animate-pulse rounded-[12px] bg-card-content" />
        ))}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-text-secondary">
          <RunsSearch value={query} onChange={setQuery} placeholder="Search by name or webhook URL" />
          <span className="tabular-nums">
            {visible.length} of {agents.length} {agents.length === 1 ? "agent" : "agents"}
          </span>
        </div>
        {visible.length ? (
          <div className="flex flex-col gap-3">
            {visible.map((agent) => (
              <AgentCard
                key={agent.key}
                agent={agent}
                runs={trafficRuns}
                details={details}
                detailsLoading={loading}
                busy={busyKey === agent.key}
                onActivate={() => void activate(agent)}
                onOpen={(path) => void open(agent, path)}
                onRemove={() => void remove(agent)}
              />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              title={`No agents match “${query.trim()}”`}
              action={
                <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              }
            />
          </Card>
        )}
      </div>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Agents"
        subtitle="Manage agents for calls and messages"
        actions={
          <Button plus onClick={() => setCreating(true)} disabled={!connected}>
            New agent
          </Button>
        }
      />
      <PageBody>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {body}
      </PageBody>
      {creating ? (
        <AgentCreateModal
          defaultChannel={session?.channel ?? "imessage"}
          onClose={() => setCreating(false)}
          onCreated={() => void Promise.all([refreshSession(), loadEnvironments()])}
        />
      ) : null}
    </Page>
  );
}
