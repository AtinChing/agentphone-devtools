"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatCircle, ChatsCircle, PaperPlaneTilt, Prohibit, WhatsappLogo } from "@phosphor-icons/react";
import { useLive } from "@/lib/live";
import type { InspectorSessionSummary } from "@/lib/types";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Field,
  Notice,
  Page,
  PageBody,
  PageHeader,
  StatTile,
  formatNumber,
  formatPhone,
  formatRelative,
  inputClass
} from "@/components/dashboard/ui";
import { EnvironmentOffline, useServerOffline } from "@/components/dashboard/EnvironmentOffline";
import { deliveryActions, useRunDetails } from "@/components/dashboard/WebhookSessions";

const STATUS: Record<InspectorSessionSummary["status"], { label: string; tone: "green" | "neutral" }> = {
  running: { label: "Open", tone: "green" },
  idle: { label: "Idle", tone: "neutral" },
  ended: { label: "Closed", tone: "neutral" }
};

export default function WhatsAppPage() {
  const router = useRouter();
  const { runs, contacts } = useLive();
  const offline = useServerOffline();
  const whatsappRuns = useMemo(() => runs.filter((run) => run.channel === "whatsapp"), [runs]);
  const { sessions, loading, error } = useRunDetails(whatsappRuns);

  // WhatsApp contacts first, then everyone else: any contact can be messaged on WhatsApp.
  const orderedContacts = useMemo(
    () => [...contacts].sort((a, b) => Number(b.channel === "whatsapp") - Number(a.channel === "whatsapp") || a.name.localeCompare(b.name)),
    [contacts]
  );
  const [contactId, setContactId] = useState("");
  useEffect(() => {
    if (orderedContacts[0] && !orderedContacts.some((contact) => contact.id === contactId)) setContactId(orderedContacts[0].id);
  }, [contactId, orderedContacts]);

  const messages = whatsappRuns.reduce((total, run) => total + run.transcriptTurns, 0);
  const optOuts = sessions.reduce(
    // Forks copy their source's deliveries (inheritedFrom); count each opt-out once.
    (total, session) =>
      total + session.deliveries.filter((delivery) => !delivery.inheritedFrom && deliveryActions(delivery).includes("opt_out")).length,
    0
  );
  const startHref = contactId ? `/imessage?contact=${encodeURIComponent(contactId)}&channel=whatsapp` : "/contacts";

  return (
    <Page>
      <PageHeader title="WhatsApp" subtitle="WhatsApp Business conversations, simulated." />

      {offline ? (
        <PageBody>
          <EnvironmentOffline />
        </PageBody>
      ) : (
        <PageBody>
          <div className="flex items-start gap-3 rounded-[14px] border border-[#25D366]/20 bg-gradient-to-br from-[#25D366]/10 to-[#25D366]/[0.03] p-4">
            <span className="mt-0.5 shrink-0 rounded-full bg-[#25D366]/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#25D366]">
              Beta
            </span>
            <p className="text-sm leading-relaxed text-text-dim">
              <span className="font-medium text-text">WhatsApp runs through the same webhook contract as SMS.</span> Each customer message reaches
              your handler with <code className="text-[#25D366]">channel: &quot;whatsapp&quot;</code>. Message templates and 24-hour session windows
              are not simulated yet.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatTile
              label="WhatsApp conversations"
              value={formatNumber(whatsappRuns.length)}
              icon={<ChatCircle size={20} />}
              hint="Saved runs on the WhatsApp channel"
            />
            <StatTile
              label="Messages"
              value={formatNumber(messages)}
              icon={<ChatsCircle size={20} />}
              hint="Inbound and outbound, all conversations"
            />
            <StatTile
              label="Opt-outs"
              value={loading && whatsappRuns.length ? "…" : formatNumber(optOuts)}
              icon={<Prohibit size={20} />}
              hint="Replies where your handler returned opt_out"
            />
          </div>

          <section className="overflow-hidden rounded-[18px] bg-card shadow-card backdrop-blur-[2px]">
            <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Conversations</h2>
                <p className="text-sm text-text-dim">Every WhatsApp run the simulator has recorded, newest first.</p>
              </div>
              {whatsappRuns.length ? <span className="text-xs text-text-dim">{formatNumber(whatsappRuns.length)} total</span> : null}
            </div>
            <div className="space-y-1 p-4">
              {error ? (
                <div className="px-2 pb-3">
                  <Notice tone="error">Could not load conversation details: {error}</Notice>
                </div>
              ) : null}
              {whatsappRuns.length === 0 ? (
                <EmptyState
                  icon={<WhatsappLogo size={24} />}
                  title="No WhatsApp conversations yet"
                  description={
                    <>
                      Start one below. Each customer message reaches your webhook with{" "}
                      <span className="font-mono text-text-secondary">channel: &quot;whatsapp&quot;</span>.
                    </>
                  }
                  action={
                    <Button href={startHref}>
                      <PaperPlaneTilt size={16} weight="bold" />
                      Start a conversation
                    </Button>
                  }
                />
              ) : (
                whatsappRuns.map((run) => {
                  const status = STATUS[run.status];
                  const href = `/imessage?session=${encodeURIComponent(run.id)}`;
                  return (
                    <div
                      key={run.id}
                      onClick={() => router.push(href)}
                      className="flex cursor-pointer items-center justify-between gap-4 rounded-[12px] px-4 py-3 transition-colors hover:bg-card-hover"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Avatar plain name={run.contact?.name ?? "?"} size={36} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white">{run.contact ? run.contact.name : "No contact bound"}</div>
                          <div className="mt-0.5 truncate text-xs text-text-dim">
                            {run.contact ? <span className="font-mono">{formatPhone(run.contact.number)}</span> : null}
                            {run.contact ? " · " : null}Started {formatRelative(run.startedAt)}
                          </div>
                        </div>
                      </div>
                      <div className="hidden min-w-0 flex-[1.4] truncate text-sm text-text-secondary lg:block" title={run.lastMessage}>
                        {run.lastMessage ?? <span className="text-text-dim">—</span>}
                      </div>
                      <div className="hidden min-w-[56px] text-right md:block">
                        <div className="text-sm tabular-nums text-white">{run.transcriptTurns}</div>
                        <div className="text-[10px] text-text-dim">turns</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3" onClick={(event) => event.stopPropagation()}>
                        <Badge tone={status.tone}>{status.label}</Badge>
                        <Button variant="secondary" size="sm" href={href}>
                          Open
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="rounded-[18px] bg-card p-6 shadow-card backdrop-blur-[2px]">
            <h2 className="text-lg font-semibold text-text">Start a WhatsApp conversation</h2>
            <p className="mb-4 text-sm text-text-dim">Opens the thread in Messages with the channel set to WhatsApp.</p>
            {orderedContacts.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-text-dim">No contacts yet. Add a customer to message them.</span>
                <Button variant="secondary" href="/contacts">
                  Go to Contacts
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Contact" className="min-w-[280px] flex-1">
                  <select value={contactId} onChange={(event) => setContactId(event.target.value)} className={inputClass}>
                    {orderedContacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name} · {formatPhone(contact.number)}
                        {contact.channel === "whatsapp" ? " · WhatsApp" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button variant="submit" href={startHref} className="h-10 px-4">
                  <PaperPlaneTilt size={16} weight="bold" />
                  Start conversation
                </Button>
              </div>
            )}
          </section>
        </PageBody>
      )}
    </Page>
  );
}
