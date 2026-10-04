"use client";

import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { PencilSimple, Plus, Power, Trash, UsersThree } from "@phosphor-icons/react";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { EnvironmentView, EnvironmentsResponse, InspectorSession } from "@/lib/types";
import { Badge, Button, ChannelBadge, Modal, Notice, Page, PageBody, PageHeader } from "@/components/dashboard/ui";
import { EnvironmentEditor } from "@/components/dashboard/EnvironmentEditor";
import { EnvironmentOffline, useServerOffline } from "@/components/dashboard/EnvironmentOffline";

type Active = EnvironmentsResponse["active"];
type Editing = { kind: "edit"; environment: EnvironmentView } | { kind: "new"; name: string };

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

/** One right-aligned stat column, as on the console's sub-account rows. */
function RowStat({ label, children, width = "min-w-[64px]" }: { label: string; children: ReactNode; width?: string }) {
  return (
    <div className={`text-right ${width}`}>
      <div className="text-sm text-white tabular-nums">{children}</div>
      <div className="text-[10px] text-text-dim">{label}</div>
    </div>
  );
}

export default function SubAccountsPage() {
  const { session, refreshSession } = useLive();
  const offline = useServerOffline();
  const [data, setData] = useState<EnvironmentsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
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
    : (data?.active ?? null);

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

  function cancelCreate() {
    setCreating(false);
    setDraftName("");
  }

  /** The inline row only names the sub-account; the modal collects its webhook target and secret. */
  function continueCreate() {
    const name = draftName.trim();
    if (!name) return;
    setEditing({ kind: "new", name });
    cancelCreate();
  }

  function onDraftKey(event: KeyboardEvent<HTMLInputElement>) {
    // preventDefault keeps this Enter from also submitting the modal form that opens under the cursor.
    if (event.key === "Enter") {
      event.preventDefault();
      continueCreate();
    }
    if (event.key === "Escape") cancelCreate();
  }

  const environments = data?.environments ?? [];

  return (
    <Page>
      <PageHeader title="Sub-accounts" subtitle="Create isolated accounts for separate campaigns." />

      {offline && !data ? (
        <PageBody>
          <EnvironmentOffline />
        </PageBody>
      ) : (
        <PageBody className="!gap-6">
          {notice ? (
            notice.tone === "error" ? (
              <div className="rounded-[12px] border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-400">{notice.text}</div>
            ) : (
              <Notice tone="good">{notice.text}</Notice>
            )
          ) : null}

          <section className="overflow-hidden rounded-[18px] bg-card shadow-card backdrop-blur-[2px]">
            <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Sub-accounts</h2>
                <p className="text-sm text-text-dim">Create isolated accounts for separate campaigns</p>
              </div>
              <div className="flex items-center gap-3">
                {creating ? null : (
                  <Button plus onClick={() => setCreating(true)}>
                    Create
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-1 p-4">
              {creating ? (
                <div className="flex items-center gap-3 px-2 pb-3">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Sub-account name (e.g. Marketing)"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onKeyDown={onDraftKey}
                    className="focus-ring flex-1 rounded-[10px] bg-input px-3 py-2 text-sm text-white placeholder:text-white/30"
                  />
                  <button
                    type="button"
                    onClick={continueCreate}
                    disabled={!draftName.trim()}
                    className="focus-ring rounded-[10px] bg-primary px-3 py-2 text-sm font-medium text-white transition hover:bg-primary/90 disabled:opacity-50"
                  >
                    Create
                  </button>
                  <button type="button" onClick={cancelCreate} className="px-3 py-2 text-sm text-text-dim transition hover:text-white">
                    Cancel
                  </button>
                </div>
              ) : null}

              {loadError && !data ? (
                <div className="px-4 py-3 text-sm text-red-400">Failed to load sub-accounts: {loadError}</div>
              ) : !data ? (
                <div className="px-4 py-3 text-sm text-text-dim">Loading...</div>
              ) : environments.length === 0 && !creating ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.04]">
                    <UsersThree size={24} className="text-text-dim" />
                  </div>
                  <p className="mt-4 text-sm font-medium text-white">No sub-accounts yet</p>
                  <p className="mt-1 text-sm text-text-dim">Create one to run a separate campaign with its own numbers, agents, and messages.</p>
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="focus-ring mt-4 flex items-center gap-1.5 rounded-[8px] bg-primary px-3.5 py-2 text-[14px] font-medium text-white transition hover:bg-primary/90"
                  >
                    <Plus size={16} weight="bold" />
                    Create sub-account
                  </button>
                </div>
              ) : (
                environments.map((environment) => {
                  const current = isActive(environment, active);
                  return (
                    <div
                      key={environment.id}
                      onClick={() => setEditing({ kind: "edit", environment })}
                      className="flex cursor-pointer items-center justify-between gap-4 rounded-[12px] px-4 py-3 transition-colors hover:bg-card-hover"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-sm font-medium text-white/50">
                          {environment.name[0]?.toUpperCase() ?? "?"}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-white">{environment.name}</span>
                            {current ? <Badge tone="green">Active</Badge> : null}
                          </div>
                          <div className="mt-0.5 text-xs text-text-dim">
                            Created {new Date(environment.createdAt).toLocaleDateString()}
                            <span className="md:hidden">
                              {" "}
                              · <span className="font-mono">{environment.targetUrl}</span>
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="ml-auto mr-6 hidden items-center gap-6 md:flex">
                        <RowStat label="webhook" width="min-w-[64px] max-w-[300px]">
                          <span className="block truncate font-mono text-[13px]" title={environment.targetUrl}>
                            {environment.targetUrl}
                          </span>
                        </RowStat>
                        <RowStat label="secret" width="min-w-[96px]">
                          <span className="font-mono text-[13px] text-white/70">{environment.secretPreview}</span>
                        </RowStat>
                        <RowStat label="channel" width="min-w-[64px]">
                          {environment.channel ? <ChannelBadge channel={environment.channel} /> : <span className="text-white/50">Any</span>}
                        </RowStat>
                      </div>

                      <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
                        {current ? null : (
                          <Button variant="secondary" size="sm" onClick={() => void activate(environment)} busy={busyId === environment.id}>
                            {busyId === environment.id ? null : <Power size={14} weight="bold" />}
                            Activate
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setEditing({ kind: "edit", environment })} title="Edit">
                          <PencilSimple size={14} weight="bold" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Delete"
                          className="hover:!text-red-400"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleting(environment);
                          }}
                        >
                          <Trash size={14} weight="bold" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {active ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-surface-border px-6 py-4 text-[13px] text-text-dim">
                <span>Simulator is sending to</span>
                <span className="font-mono text-text-secondary">{active.targetUrl}</span>
                <span className="text-[#3a3a4a]">·</span>
                <span>
                  secret <span className="font-mono text-text-secondary">{active.secretPreview}</span>
                </span>
                <span className="text-[#3a3a4a]">·</span>
                <ChannelBadge channel={active.channel} />
              </div>
            ) : null}
          </section>
        </PageBody>
      )}

      {editing ? (
        <EnvironmentEditor
          environment={editing.kind === "edit" ? editing.environment : undefined}
          initialName={editing.kind === "new" ? editing.name : undefined}
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
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void confirmDelete()} busy={busyId === deleting.id}>
                Delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-text-secondary">
            Delete <span className="font-semibold text-white">{deleting.name}</span>? Its saved target and secret are removed. The simulator keeps
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
