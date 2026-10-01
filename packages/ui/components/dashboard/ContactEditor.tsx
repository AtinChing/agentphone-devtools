"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { Contact, ContactInput, SessionChannel } from "@/lib/types";
import { Button, Field, Modal, Notice, inputClass, textareaClass } from "./ui";

export const CONTACT_CHANNELS: { id: SessionChannel; label: string }[] = [
  { id: "imessage", label: "iMessage" },
  { id: "sms", label: "SMS" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "voice", label: "Voice" }
];

type ParsedState = { ok: true; value: Record<string, unknown> | null } | { ok: false; message: string };

function parseConversationState(text: string): ParsedState {
  if (!text.trim()) return { ok: true, value: null };
  try {
    const value: unknown = JSON.parse(text);
    if (value === null) return { ok: true, value: null };
    if (typeof value !== "object" || Array.isArray(value)) return { ok: false, message: "conversationState must be a JSON object, e.g. {\"tier\": \"gold\"}" };
    return { ok: true, value: value as Record<string, unknown> };
  } catch (error) {
    return { ok: false, message: `Invalid JSON: ${errorMessage(error)}` };
  }
}

/** Create or edit a simulated customer. Saving refreshes the shared contact list. */
export function ContactEditor({ contact, onClose }: { contact?: Contact; onClose: () => void }) {
  const { refreshContacts } = useLive();
  const [name, setName] = useState(contact?.name ?? "");
  const [number, setNumber] = useState(contact?.number ?? "");
  const [channel, setChannel] = useState<SessionChannel>(contact?.channel ?? "imessage");
  const [stateText, setStateText] = useState(contact?.conversationState ? JSON.stringify(contact.conversationState, null, 2) : "");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseConversationState(stateText);

  async function save() {
    if (!parsed.ok) return;
    setSaving(true);
    setError(null);
    const body: ContactInput = {
      name: name.trim(),
      // Accept "+1 (555) 987-6543" as typed; the server stores strict E.164.
      number: number.replace(/[\s().-]/g, ""),
      channel,
      conversationState: parsed.value,
      notes: notes.trim()
    };
    try {
      if (contact) await api.put<Contact>(`/api/contacts/${encodeURIComponent(contact.id)}`, body);
      else await api.post<Contact>("/api/contacts", body);
      await refreshContacts();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={contact ? `Edit ${contact.name}` : "New contact"}
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="submit" onClick={save} busy={saving} disabled={!parsed.ok || !name.trim() || !number.trim()}>
            {contact ? "Save changes" : "Create contact"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="Maya Chen" autoFocus />
          </Field>
          <Field label="Number" hint="E.164, e.g. +15559876543">
            <input className={`${inputClass} font-mono text-[13px]`} value={number} onChange={(event) => setNumber(event.target.value)} placeholder="+15559876543" />
          </Field>
        </div>
        <Field label="Channel" hint="The default channel when a conversation with this contact starts.">
          <select className={inputClass} value={channel} onChange={(event) => setChannel(event.target.value as SessionChannel)}>
            {CONTACT_CHANNELS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="conversationState"
          hint={parsed.ok ? "JSON object sent as the webhook envelope's conversationState in this contact's conversations. Leave empty for null." : undefined}
        >
          <textarea
            className={`${textareaClass} min-h-[120px] font-mono text-[13px] ${parsed.ok ? "" : "ring-1 ring-red-500/50"}`}
            value={stateText}
            onChange={(event) => setStateText(event.target.value)}
            placeholder={'{\n  "customerName": "Maya Chen",\n  "tier": "gold"\n}'}
            spellCheck={false}
          />
        </Field>
        {!parsed.ok ? <div className="-mt-2 text-[13px] text-red-400">{parsed.message}</div> : null}
        <Field label="Notes">
          <textarea
            className={`${textareaClass} min-h-[72px]`}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Anything worth remembering about this customer"
          />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>
    </Modal>
  );
}
