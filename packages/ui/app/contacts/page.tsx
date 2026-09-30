"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Pencil, Plus, Trash2, Users } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { Contact } from "@/lib/types";
import {
  Avatar,
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
  formatPhone,
  formatRelative
} from "@/components/dashboard/ui";
import { ContactEditor } from "@/components/dashboard/ContactEditor";
import { ServerOffline, activityByContact, useServerOffline } from "@/components/dashboard/RunsShared";

export default function ContactsPage() {
  const { connected, contacts, runs, refreshContacts } = useLive();
  const offline = useServerOffline();
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const activity = useMemo(() => activityByContact(runs), [runs]);

  // Contacts aren't pushed over the event stream; reload whenever it (re)connects.
  useEffect(() => {
    if (connected) void refreshContacts();
  }, [connected, refreshContacts]);

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.delete(`/api/contacts/${encodeURIComponent(deleting.id)}`);
      await refreshContacts();
      setDeleting(null);
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleteBusy(false);
    }
  }

  let body;
  if (!contacts.length && offline) body = <ServerOffline />;
  else if (!contacts.length && !connected) body = <p className="px-6 py-10 text-center text-[14px] text-slate-500">Loading…</p>;
  else if (!contacts.length)
    body = (
      <EmptyState
        icon={<Users size={26} />}
        title="No contacts yet"
        description="Contacts are the customers who text or call your agent. Each one gives conversations a real from-number and conversationState."
        action={
          <Button onClick={() => setEditing("new")}>
            <Plus size={15} /> New contact
          </Button>
        }
      />
    );
  else
    body = (
      <Table head={["Name", "Number", "Channel", "State", "Notes", "Runs", "Last activity", ""]}>
        {contacts.map((contact) => {
          const stats = activity.get(contact.id);
          const fields = contact.conversationState ? Object.keys(contact.conversationState).length : 0;
          return (
            <Row key={contact.id}>
              <Cell className="min-w-[180px]">
                <div className="flex items-center gap-3">
                  <Avatar name={contact.name} size={32} />
                  <span className="font-medium text-bright">{contact.name}</span>
                </div>
              </Cell>
              <Cell mono className="whitespace-nowrap">
                {formatPhone(contact.number)}
              </Cell>
              <Cell>
                <ChannelBadge channel={contact.channel} />
              </Cell>
              <Cell className="whitespace-nowrap">
                {contact.conversationState ? (
                  <span className="cursor-help border-b border-dotted border-slate-400" title={JSON.stringify(contact.conversationState, null, 2)}>
                    {fields} {fields === 1 ? "field" : "fields"}
                  </span>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </Cell>
              <Cell className="max-w-[260px]">
                <div className="truncate text-slate-600" title={contact.notes}>
                  {contact.notes ?? "—"}
                </div>
              </Cell>
              <Cell mono>{stats?.runs ?? 0}</Cell>
              <Cell className="whitespace-nowrap text-slate-500">{formatRelative(stats?.lastActivityAt)}</Cell>
              <Cell>
                <div className="flex items-center justify-end gap-1">
                  <Button href={`/imessage?contact=${encodeURIComponent(contact.id)}`} size="sm" variant="secondary">
                    <MessageCircle size={14} /> Message
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(contact)} title={`Edit ${contact.name}`}>
                    <Pencil size={14} /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(contact);
                    }}
                    title={`Delete ${contact.name}`}
                  >
                    <Trash2 size={14} /> Delete
                  </Button>
                </div>
              </Cell>
            </Row>
          );
        })}
      </Table>
    );

  return (
    <Page>
      <PageHeader
        title="Contacts"
        subtitle="Simulated customers who message and call your agent."
        actions={
          <Button onClick={() => setEditing("new")} disabled={offline}>
            <Plus size={15} /> New contact
          </Button>
        }
      />
      <Card padded={false}>{body}</Card>

      {editing ? <ContactEditor contact={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <Modal
          title={`Delete ${deleting.name}?`}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmDelete} busy={deleteBusy}>
                Delete contact
              </Button>
            </>
          }
        >
          <p className="text-[14px] text-slate-600">
            {deleting.name} ({formatPhone(deleting.number)}) is removed from your contacts. Saved runs keep their transcripts and still show this name.
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
