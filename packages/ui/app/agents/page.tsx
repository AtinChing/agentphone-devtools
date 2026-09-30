"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { EnvironmentsResponse } from "@/lib/types";
import { Button, Card, Notice, Page, PageHeader, formatRelative } from "@/components/dashboard/ui";
import { AgentCard, type AgentProfile } from "@/components/dashboard/AgentCard";
import { AgentCreateModal } from "@/components/dashboard/AgentCreateModal";
import { ServerOffline, hasTraffic, useRunDetails, useServerOffline } from "@/components/dashboard/RunsShared";

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

  let body;
  if (!session && offline) {
    body = (
      <Card>
        <ServerOffline />
      </Card>
    );
  } else if (!session) {
    body = <p className="py-10 text-center text-[14px] text-slate-500">Loading…</p>;
  } else {
    body = (
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {agents.map((agent) => (
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
    );
  }

  return (
    <Page>
      <PageHeader
        title="Agents"
        subtitle="Manage agents for calls and messages"
        actions={
          <Button onClick={() => setCreating(true)} disabled={!connected}>
            <Plus size={15} /> New agent
          </Button>
        }
      />
      {error ? (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      {body}
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
