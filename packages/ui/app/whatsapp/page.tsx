"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, MessageSquare, MessagesSquare, Send } from "lucide-react";
import { useLive } from "@/lib/live";
import type { InspectorSessionSummary } from "@/lib/types";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Cell,
  EmptyState,
  Field,
  Notice,
  Page,
  Row,
  StatTile,
  Table,
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
      <div className="mb-7">
        <div className="flex items-center gap-3">
          <h1 className="text-[30px] font-bold leading-tight tracking-tight text-bright">WhatsApp</h1>
          <Badge tone="green">BETA</Badge>
        </div>
        <p className="mt-1.5 text-[15px] text-slate-500">WhatsApp Business conversations, simulated.</p>
      </div>

      {offline ? (
        <EnvironmentOffline />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <StatTile label="WhatsApp conversations" value={formatNumber(whatsappRuns.length)} icon={<MessageSquare size={20} />} hint="Saved runs on the WhatsApp channel" />
            <StatTile label="Messages" value={formatNumber(messages)} icon={<MessagesSquare size={20} />} hint="Inbound and outbound, all conversations" />
            <StatTile
              label="Opt-outs"
              value={loading && whatsappRuns.length ? "…" : formatNumber(optOuts)}
              icon={<Ban size={20} />}
              hint="Replies where your handler returned opt_out"
            />
          </div>

          <Notice>WhatsApp templates and 24-hour session windows are not simulated yet; messages flow through the same webhook contract as SMS.</Notice>

          <Card title="Conversations" subtitle="Every WhatsApp run the simulator has recorded, newest first." padded={false}>
            {error ? (
              <div className="px-6 pb-4">
                <Notice tone="error">Could not load conversation details: {error}</Notice>
              </div>
            ) : null}
            {whatsappRuns.length === 0 ? (
              <EmptyState
                icon={<MessageSquare size={26} />}
                title="No WhatsApp conversations yet"
                description={
                  <>
                    Start one below. Each customer message reaches your webhook with <span className="data text-slate-700">channel: &quot;whatsapp&quot;</span>.
                  </>
                }
                action={
                  <Button variant="bright" href={startHref}>
                    <Send size={15} />
                    Start a conversation
                  </Button>
                }
              />
            ) : (
              <Table head={["Contact", "Last message", "Turns", "Status", "Started", ""]}>
                {whatsappRuns.map((run) => {
                  const status = STATUS[run.status];
                  return (
                    <Row key={run.id}>
                      <Cell>
                        {run.contact ? (
                          <div className="flex items-center gap-3">
                            <Avatar name={run.contact.name} size={32} />
                            <div className="min-w-0">
                              <div className="font-medium text-bright">{run.contact.name}</div>
                              <div className="data text-[12.5px] text-slate-500">{formatPhone(run.contact.number)}</div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500">No contact bound</span>
                        )}
                      </Cell>
                      <Cell>
                        <span className="block max-w-[360px] truncate" title={run.lastMessage}>
                          {run.lastMessage ?? <span className="text-slate-500">—</span>}
                        </span>
                      </Cell>
                      <Cell mono>{run.transcriptTurns}</Cell>
                      <Cell>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </Cell>
                      <Cell className="whitespace-nowrap text-slate-500">{formatRelative(run.startedAt)}</Cell>
                      <Cell className="text-right">
                        <Button variant="secondary" size="sm" href={`/imessage?session=${encodeURIComponent(run.id)}`}>
                          Open
                        </Button>
                      </Cell>
                    </Row>
                  );
                })}
              </Table>
            )}
          </Card>

          <Card title="Start a WhatsApp conversation" subtitle="Opens the thread in Messages with the channel set to WhatsApp.">
            {orderedContacts.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[14px] text-slate-500">No contacts yet. Add a customer to message them.</span>
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
                <Button href={startHref} className="h-11">
                  <Send size={15} />
                  Start conversation
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}
    </Page>
  );
}
