"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Power, Trash2, Users } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { EnvironmentView, EnvironmentsResponse, InspectorSession } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  Cell,
  ChannelBadge,
  EmptyState,
  Modal,
  Notice,
  Page,
  PageHeader,
  Row,
  Table,
  formatRelative
} from "@/components/dashboard/ui";
import { EnvironmentEditor } from "@/components/dashboard/EnvironmentEditor";
import { EnvironmentOffline, useServerOffline } from "@/components/dashboard/EnvironmentOffline";

type Active = EnvironmentsResponse["active"];

/**
 * Whether the simulator currently targets this sub-account. The live and
 * stored previews mask short secrets differently, so previews are only
 * compared when both are the long "abcdef...wxyz" form.
 */
function isActive(environment: EnvironmentView, active: Active | null): boolean {
  if (!active || environment.targetUrl !== active.targetUrl) return false;
  const comparable = environment.secretPreview.includes("...") && active.secretPreview.includes("...");
  return !comparable || environment.secretPreview === active.secretPreview;
}

export default function SubAccountsPage() {
  const { session, refreshSession } = useLive();
  const offline = useServerOffline();
  const [data, setData] = useState<EnvironmentsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EnvironmentView | "new" | null>(null);
  const [deleting, setDeleting] = useState<EnvironmentView | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "good" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<EnvironmentsResponse>("/api/environments"));
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The live session is the source of truth for "active": it follows target
  // changes made anywhere (Webhooks tab, another browser tab) over SSE.
  const active: Active | null = session
    ? { targetUrl: session.targetUrl, secretPreview: session.secretPreview, channel: session.channel }
    : data?.active ?? null;

  async function activate(environment: EnvironmentView) {
    setBusyId(environment.id);
    setNotice(null);
    try {
      const next = await api.post<InspectorSession>(`/api/environments/${encodeURIComponent(environment.id)}/activate`, {});
      await refreshSession();
      setNotice({ tone: "good", text: `Activated "${environment.name}". Webhooks now go to ${next.targetUrl} in a fresh ${next.channel} session.` });
    } catch (error) {
      setNotice({ tone: "error", text: `Could not activate "${environment.name}": ${errorMessage(error)}` });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusyId(deleting.id);
    setDeleteError(null);
    try {
      await api.delete(`/api/environments/${encodeURIComponent(deleting.id)}`);
      setNotice({ tone: "good", text: `Deleted "${deleting.name}".` });
      setDeleting(null);
      await load();
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  const environments = data?.environments ?? [];
  const createButton = (label: string) => (
    <Button variant="bright" onClick={() => setEditing("new")}>
      <Plus size={16} />
      {label}
    </Button>
  );

  return (
    <Page>
      <PageHeader title="Sub-accounts" subtitle="Create isolated accounts for separate campaigns." />

      {offline && !data ? (
        <EnvironmentOffline />
      ) : (
        <div className="space-y-4">
          {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
          <Card title="Sub-accounts" subtitle="Create isolated accounts for separate campaigns" actions={createButton("Create")} padded={false}>
            {loadError && !data ? (
              <div className="px-6 pb-6">
                <Notice tone="error">Could not load sub-accounts: {loadError}</Notice>
              </div>
            ) : !data ? (
              <div className="px-6 pb-6 text-[14px] text-slate-500">Loading…</div>
            ) : environments.length === 0 ? (
              <EmptyState
                icon={<Users size={26} />}
                title="No sub-accounts yet"
                description="Create one to run a separate campaign with its own numbers, agents, and messages."
                action={createButton("Create sub-account")}
              />
            ) : (
              <Table head={["Name", "Webhook URL", "Secret", "Channel", "Created", ""]}>
                {environments.map((environment) => {
                  const current = isActive(environment, active);
                  return (
                    <Row key={environment.id}>
                      <Cell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-bright">{environment.name}</span>
                          {current ? <Badge tone="green">Active</Badge> : null}
                        </div>
                      </Cell>
                      <Cell mono className="text-[13px]">
                        <span className="block max-w-[320px] truncate" title={environment.targetUrl}>
                          {environment.targetUrl}
                        </span>
                      </Cell>
                      <Cell mono className="text-[13px] text-slate-500">
                        {environment.secretPreview}
                      </Cell>
                      <Cell>{environment.channel ? <ChannelBadge channel={environment.channel} /> : <span className="text-slate-500">Any</span>}</Cell>
                      <Cell className="whitespace-nowrap text-slate-500">{formatRelative(environment.createdAt)}</Cell>
                      <Cell>
                        <div className="flex justify-end gap-1">
                          {current ? null : (
                            <Button variant="secondary" size="sm" onClick={() => void activate(environment)} busy={busyId === environment.id}>
                              {busyId === environment.id ? null : <Power size={14} />}
                              Activate
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => setEditing(environment)}>
                            <Pencil size={14} />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleting(environment);
                            }}
                          >
                            <Trash2 size={14} />
                            Delete
                          </Button>
                        </div>
                      </Cell>
                    </Row>
                  );
                })}
              </Table>
            )}
            {active ? (
              <div className="border-t border-line px-6 py-4 text-[13px] text-slate-500">
                Simulator is sending to <span className="data text-slate-700">{active.targetUrl}</span> · secret{" "}
                <span className="data text-slate-700">{active.secretPreview}</span> · <ChannelBadge channel={active.channel} />
              </div>
            ) : null}
          </Card>
        </div>
      )}

      {editing ? (
        <EnvironmentEditor
          environment={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setNotice({ tone: "good", text: `Saved "${saved.name}".` });
            void load();
          }}
        />
      ) : null}

      {deleting ? (
        <Modal
          title="Delete sub-account"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void confirmDelete()} busy={busyId === deleting.id}>
                Delete
              </Button>
            </>
          }
        >
          <p className="text-[14px] text-slate-600">
            Delete <span className="font-semibold text-bright">{deleting.name}</span>? Its saved target and secret are removed. The simulator keeps
            sending to its current target until you activate another sub-account.
          </p>
          {deleteError ? (
            <div className="mt-4">
              <Notice tone="error">{deleteError}</Notice>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </Page>
  );
}
