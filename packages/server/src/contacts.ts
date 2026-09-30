import { id, isoNow, type ConversationState, type SessionChannel } from "@agentphone-devtools/core";
import { JsonFileStore } from "./json-store.js";

/**
 * A simulated customer. Contacts give message conversations a "who": the
 * `from` number on every payload, a preferred channel, and the
 * conversationState the business already knows about them.
 */
export interface Contact {
  id: string;
  name: string;
  number: string;
  channel: SessionChannel;
  conversationState: ConversationState;
  notes?: string;
  createdAt: string;
}

export type ContactInput = Omit<Contact, "id" | "createdAt"> & { id?: string };

const PHONE = /^\+\d{8,15}$/;

/** Seeded on first run so the iMessage tab has someone to talk to. */
const DEFAULT_CONTACTS: ContactInput[] = [
  {
    name: "Maya Chen",
    number: "+15559876543",
    channel: "imessage",
    conversationState: { customerName: "Maya Chen", stationGroup: "North Lot", tier: "gold" },
    notes: "EV charging member. Existing appointment on file."
  },
  {
    name: "Jordan Reyes",
    number: "+15559876544",
    channel: "sms",
    conversationState: { customerName: "Jordan Reyes", tier: "standard" },
    notes: "Signed up last week via the fall promo landing page."
  },
  {
    name: "Priya Natarajan",
    number: "+15559876545",
    channel: "imessage",
    conversationState: { customerName: "Priya Natarajan", tier: "gold", lastVisit: "2026-06-14" },
    notes: "Frequent visitor; asks detailed questions."
  },
  {
    name: "Sam Okafor",
    number: "+15559876546",
    channel: "whatsapp",
    conversationState: { customerName: "Sam Okafor", tier: "standard" },
    notes: "Replies late, usually days later."
  }
];

export class ContactsStore {
  private readonly store: JsonFileStore<Contact>;

  constructor(filePath: string) {
    this.store = new JsonFileStore<Contact>(filePath);
    if (this.store.size() === 0) {
      for (const contact of DEFAULT_CONTACTS) this.upsert(contact);
    }
  }

  list(): Contact[] {
    return this.store.list().sort((a, b) => a.name.localeCompare(b.name));
  }

  get(contactId: string): Contact | undefined {
    return this.store.get(contactId);
  }

  upsert(input: ContactInput): Contact {
    const name = input.name?.trim();
    if (!name) throw new Error("Contact name is required");
    if (!PHONE.test(input.number ?? "")) throw new Error("Contact number must be E.164, e.g. +15551234567");
    const channel = input.channel ?? "sms";
    if (!["sms", "imessage", "whatsapp", "voice"].includes(channel)) throw new Error("Contact channel must be sms, imessage, whatsapp, or voice");
    const existing = input.id ? this.store.get(input.id) : undefined;
    const contact: Contact = {
      id: existing?.id ?? input.id ?? id("ct"),
      name,
      number: input.number,
      channel,
      conversationState: input.conversationState ?? null,
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      createdAt: existing?.createdAt ?? isoNow()
    };
    return this.store.upsert(contact);
  }

  delete(contactId: string): boolean {
    return this.store.delete(contactId);
  }
}
