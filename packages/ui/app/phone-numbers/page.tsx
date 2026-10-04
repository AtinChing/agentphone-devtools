"use client";

import { useEffect, useMemo, useState } from "react";
import { ChatCircle, Phone } from "@phosphor-icons/react";
import { useLive } from "@/lib/live";
import { Avatar, Badge, Button, Card, Cell, ChannelBadge, Eyebrow, Page, PageBody, PageHeader, Row, Table, formatPhone, formatRelative } from "@/components/dashboard/ui";
import { ContactEditor } from "@/components/dashboard/ContactEditor";
import { BUSINESS_NUMBER, ServerOffline, activityByContact, hasTraffic, useServerOffline } from "@/components/dashboard/RunsShared";

const BUSINESS_CHANNELS = ["sms", "imessage", "whatsapp", "voice"];

export default function PhoneNumbersPage() {
  const { connected, contacts, runs, refreshContacts } = useLive();
  const offline = useServerOffline();
  const [adding, setAdding] = useState(false);
  const activity = useMemo(() => activityByContact(runs), [runs]);
  const business = useMemo(() => {
    const active = runs.filter(hasTraffic);
    const lastActivityAt = active.reduce<string | undefined>((latest, run) => {
      const at = run.lastActivityAt ?? run.startedAt;
      return !latest || at > latest ? at : latest;
    }, undefined);
    return { runs: active.length, lastActivityAt };
  }, [runs]);

  // Contacts aren't pushed over the event stream; reload whenever it (re)connects.
  useEffect(() => {
    if (connected) void refreshContacts();
  }, [connected, refreshContacts]);

  const total = contacts.length + 1;

  return (
    <Page>
      <PageHeader
        title="Phone Numbers"
        subtitle={`${total} total`}
        actions={
          <Button plus onClick={() => setAdding(true)} disabled={offline}>
            Add number
          </Button>
        }
      />
      <PageBody>
        <div className="rounded-[18px] bg-card p-4 shadow-card backdrop-blur-[2px]">
          <Eyebrow className="mb-2">How numbers work in the simulator</Eyebrow>
          <p className="text-sm text-text-dim">
            Every webhook is signed as if it came from this account&apos;s number; contacts are the customers who text or call it.
          </p>
        </div>

        <Card padded={false}>
          {offline && !contacts.length && !runs.length ? (
            <ServerOffline />
          ) : (
            <Table head={["Number", "Name", "Channels", "Runs", "Last activity", ""]}>
              <Row>
                <Cell className="whitespace-nowrap font-mono text-[13px] tabular-nums text-white">{formatPhone(BUSINESS_NUMBER)}</Cell>
                <Cell className="min-w-[240px]">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <Phone size={16} weight="fill" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white">Business · agent number</div>
                      <div className="text-xs text-text-dim">
                        The <span className="font-mono">to</span> on every webhook
                      </div>
                    </div>
                  </div>
                </Cell>
                <Cell>
                  <div className="flex flex-wrap gap-1">
                    {BUSINESS_CHANNELS.map((channel) => (
                      <ChannelBadge key={channel} channel={channel} />
                    ))}
                  </div>
                </Cell>
                <Cell className="tabular-nums">{business.runs}</Cell>
                <Cell className="whitespace-nowrap text-text-secondary">{formatRelative(business.lastActivityAt)}</Cell>
                <Cell>
                  <div className="flex justify-end">
                    <Badge tone="green">Agent</Badge>
                  </div>
                </Cell>
              </Row>
              {contacts.map((contact) => {
                const stats = activity.get(contact.id);
                return (
                  <Row key={contact.id}>
                    <Cell className="whitespace-nowrap font-mono text-[13px] tabular-nums">{formatPhone(contact.number)}</Cell>
                    <Cell>
                      <div className="flex items-center gap-3">
                        <Avatar name={contact.name} size={36} plain />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-white">{contact.name}</div>
                          <div className="text-xs text-text-dim">Customer</div>
                        </div>
                      </div>
                    </Cell>
                    <Cell>
                      <ChannelBadge channel={contact.channel} />
                    </Cell>
                    <Cell className="tabular-nums">{stats?.runs ?? 0}</Cell>
                    <Cell className="whitespace-nowrap text-text-secondary">{formatRelative(stats?.lastActivityAt)}</Cell>
                    <Cell>
                      <div className="flex justify-end">
                        <Button href={`/imessage?contact=${encodeURIComponent(contact.id)}`} size="sm" variant="secondary">
                          <ChatCircle size={14} weight="bold" /> Message
                        </Button>
                      </div>
                    </Cell>
                  </Row>
                );
              })}
            </Table>
          )}
        </Card>
      </PageBody>

      {adding ? <ContactEditor onClose={() => setAdding(false)} /> : null}
    </Page>
  );
}
