"use client";

import { useEffect, useMemo, useState } from "react";
import { AddressBook, ChatCircle, PencilSimple, Trash } from "@phosphor-icons/react";
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
  PageBody,
  PageHeader,
  Row,
  Table,
  formatPhone,
  formatRelative
} from "@/components/dashboard/ui";
import { ContactEditor } from "@/components/dashboard/ContactEditor";
import { RunsSearch, ServerOffline, activityByContact, useServerOffline } from "@/components/dashboard/RunsShared";

function contactMatches(contact: Contact, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const digits = needle.replace(/\D/g, "");
  return (
    [contact.name, contact.notes ?? ""].some((text) => text.toLowerCase().includes(needle)) || (digits.length > 2 && contact.number.includes(digits))
  );
}

export default function ContactsPage() {
  const { connected, contacts, runs, refreshContacts } = useLive();
  const offline = useServerOffline();
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const activity = useMemo(() => activityByContact(runs), [runs]);
  const visible = useMemo(() => contacts.filter((contact) => contactMatches(contact, query)), [contacts, query]);

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
  else if (!contacts.length && !connected) body = <p className="px-6 py-10 text-center text-sm text-text-dim">Loading…</p>;
  else if (!contacts.length)
    body = (
      <EmptyState
        icon={<AddressBook size={24} />}
        title="No contacts yet"
        description="Contacts are the customers who text or call your agent. Each one gives conversations a real from-number and conversationState."
        action={
          <Button plus onClick={() => setEditing("new")}>
            Add your first contact
          </Button>
        }
      />
    );
  else if (!visible.length) body = <EmptyState title="No contacts found" description="Try a different search term." />;
  else
    body = (
      <Table head={["Name", "Number", "Channel", "State", "Notes", "Runs", "Last activity", ""]}>
        {visible.map((contact) => {
          const stats = activity.get(contact.id);
          const fields = contact.conversationState ? Object.keys(contact.conversationState).length : 0;
          return (
            <Row key={contact.id}>
              <Cell className="min-w-[180px]">
                <div className="flex items-center gap-3">
                  <Avatar name={contact.name} size={36} plain />
                  <span className="text-sm font-medium text-white">{contact.name}</span>
                </div>
              </Cell>
              <Cell className="whitespace-nowrap font-mono text-[13px] tabular-nums">{formatPhone(contact.number)}</Cell>
              <Cell>
                <ChannelBadge channel={contact.channel} />
              </Cell>
              <Cell className="whitespace-nowrap">
                {contact.conversationState ? (
                  <span
                    className="cursor-help border-b border-dotted border-white/30 text-text-secondary"
                    title={JSON.stringify(contact.conversationState, null, 2)}
                  >
                    {fields} {fields === 1 ? "field" : "fields"}
                  </span>
                ) : (
                  <span className="text-text-dim">—</span>
                )}
              </Cell>
              <Cell className="max-w-[260px]">
                <div className="truncate text-text-secondary" title={contact.notes}>
                  {contact.notes || "—"}
                </div>
              </Cell>
              <Cell className="tabular-nums">{stats?.runs ?? 0}</Cell>
              <Cell className="whitespace-nowrap text-text-secondary">{formatRelative(stats?.lastActivityAt)}</Cell>
              <Cell>
                <div className="flex items-center justify-end gap-1">
                  <Button href={`/imessage?contact=${encodeURIComponent(contact.id)}`} size="sm" variant="secondary" className="mr-1">
                    <ChatCircle size={14} weight="bold" /> Message
                  </Button>
                  <button
                    type="button"
                    onClick={() => setEditing(contact)}
                    title={`Edit ${contact.name}`}
                    aria-label={`Edit ${contact.name}`}
                    className="focus-ring rounded-[8px] p-1.5 text-text-dim transition-colors hover:text-white"
                  >
                    <PencilSimple size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(contact);
                    }}
                    title={`Delete ${contact.name}`}
                    aria-label={`Delete ${contact.name}`}
                    className="focus-ring rounded-[8px] p-1.5 text-text-dim transition-colors hover:text-red-400"
                  >
                    <Trash size={16} />
                  </button>
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
        subtitle={`${contacts.length} contact${contacts.length === 1 ? "" : "s"}`}
        actions={
          <Button plus onClick={() => setEditing("new")} disabled={offline}>
            Add Contact
          </Button>
        }
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          {contacts.length || query ? <RunsSearch value={query} onChange={setQuery} placeholder="Search by name or phone number…" className="" /> : null}
          <Card padded={false}>{body}</Card>
        </div>
      </PageBody>

      {editing ? <ContactEditor contact={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <Modal
          title={`Delete ${deleting.name}?`}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmDelete} busy={deleteBusy}>
                Delete contact
              </Button>
            </>
          }
        >
          <p className="text-sm leading-snug text-text-secondary">
            {deleting.name} (<span className="tabular-nums">{formatPhone(deleting.number)}</span>) is removed from your contacts. Saved runs keep their
            transcripts and still show this name.
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
