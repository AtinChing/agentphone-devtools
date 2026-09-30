"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Phone, Plus } from "lucide-react";
import { useLive } from "@/lib/live";
import { Avatar, Badge, Button, Card, Cell, ChannelBadge, Notice, Page, PageHeader, Row, Table, formatPhone, formatRelative } from "@/components/dashboard/ui";
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

  return (
    <Page>
      <PageHeader
        title="Phone Numbers"
        subtitle="Numbers in your simulated account"
        actions={
          <Button onClick={() => setAdding(true)} disabled={offline}>
            <Plus size={15} /> Add number
          </Button>
        }
      />
      <div className="mb-5">
        <Notice>The simulator signs every webhook as if it came from this account&apos;s number; contacts are the customers who text or call it.</Notice>
      </div>

      <Card padded={false}>
        {offline && !contacts.length && !runs.length ? (
          <ServerOffline />
        ) : (
          <Table head={["Number", "Name", "Channels", "Runs", "Last activity", ""]}>
            <Row>
              <Cell mono className="whitespace-nowrap text-bright">
                {formatPhone(BUSINESS_NUMBER)}
              </Cell>
              <Cell className="min-w-[220px]">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#173322] text-fern">
                    <Phone size={15} />
                  </span>
                  <div>
                    <div className="font-medium text-bright">Business · agent number</div>
                    <div className="text-[12px] text-slate-500">
                      The <span className="data">to</span> on every webhook
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
              <Cell mono>{business.runs}</Cell>
              <Cell className="whitespace-nowrap text-slate-500">{formatRelative(business.lastActivityAt)}</Cell>
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
                  <Cell mono className="whitespace-nowrap">
                    {formatPhone(contact.number)}
                  </Cell>
                  <Cell>
                    <div className="flex items-center gap-3">
                      <Avatar name={contact.name} size={32} />
                      <div>
                        <div className="font-medium text-bright">{contact.name}</div>
                        <div className="text-[12px] text-slate-500">Customer</div>
                      </div>
                    </div>
                  </Cell>
                  <Cell>
                    <ChannelBadge channel={contact.channel} />
                  </Cell>
                  <Cell mono>{stats?.runs ?? 0}</Cell>
                  <Cell className="whitespace-nowrap text-slate-500">{formatRelative(stats?.lastActivityAt)}</Cell>
                  <Cell>
                    <div className="flex justify-end">
                      <Button href={`/imessage?contact=${encodeURIComponent(contact.id)}`} size="sm" variant="secondary">
                        <MessageCircle size={14} /> Message
                      </Button>
                    </div>
                  </Cell>
                </Row>
              );
            })}
          </Table>
        )}
      </Card>

      {adding ? <ContactEditor onClose={() => setAdding(false)} /> : null}
    </Page>
  );
}
