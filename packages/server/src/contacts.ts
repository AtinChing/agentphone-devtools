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

/**
 * The simulated customer base: three people per channel, each with the
 * state a business would already hold about them. Seeded on first run and
 * restored (by number) when sample conversations are loaded.
 */
export const DEFAULT_CONTACTS: ContactInput[] = [
  // iMessage
  {
    name: "Maya Chen",
    number: "+15559876543",
    channel: "imessage",
    conversationState: { customerName: "Maya Chen", stationGroup: "North Lot", tier: "gold" },
    notes: "EV charging member. Existing appointment on file."
  },
  {
    name: "Priya Natarajan",
    number: "+15559876545",
    channel: "imessage",
    conversationState: { customerName: "Priya Natarajan", tier: "gold", lastVisit: "2026-06-14" },
    notes: "Frequent visitor; asks detailed questions."
  },
  {
    name: "Diego Alvarez",
    number: "+15559876552",
    channel: "imessage",
    conversationState: { customerName: "Diego Alvarez", tier: "standard", vehicle: "Ioniq 5" },
    notes: "On the fall promo list. Usually replies days later."
  },
  // SMS
  {
    name: "Jordan Reyes",
    number: "+15559876544",
    channel: "sms",
    conversationState: { customerName: "Jordan Reyes", tier: "standard" },
    notes: "Signed up last week via the fall promo landing page."
  },
  {
    name: "Aisha Rahman",
    number: "+15559876550",
    channel: "sms",
    conversationState: { customerName: "Aisha Rahman", tier: "standard", appointment: "2026-09-17T09:00" },
    notes: "Has a tune-up booked; prefers texts over calls."
  },
  {
    name: "Tom Becker",
    number: "+15559876551",
    channel: "sms",
    conversationState: null,
    notes: "Number came in from a lead list. Not a customer yet."
  },
  // WhatsApp
  {
    name: "Sam Okafor",
    number: "+15559876546",
    channel: "whatsapp",
    conversationState: { customerName: "Sam Okafor", tier: "standard" },
    notes: "Replies late, usually days later."
  },
  {
    name: "Lucía Fernández",
    number: "+15559876553",
    channel: "whatsapp",
    conversationState: { customerName: "Lucía Fernández", tier: "gold", language: "es" },
    notes: "Writes in Spanish."
  },
  {
    name: "Wei Zhang",
    number: "+15559876554",
    channel: "whatsapp",
    conversationState: { customerName: "Wei Zhang", tier: "standard" },
    notes: "New to the area; asks for directions."
  },
  // Voice
  {
    name: "Grace O'Neill",
    number: "+15559876547",
    channel: "voice",
    conversationState: { customerName: "Grace O'Neill", tier: "gold", appointment: "2026-09-18T14:00" },
    notes: "Calls to reschedule; has an appointment on file."
  },
  {
    name: "Marcus Hill",
    number: "+15559876548",
    channel: "voice",
    conversationState: { customerName: "Marcus Hill", tier: "standard", cardLast4: "4242" },
    notes: "Disputed a duplicate charge last month."
  },
  {
    name: "Hannah Park",
    number: "+15559876549",
    channel: "voice",
    conversationState: { customerName: "Hannah Park", tier: "standard" },
    notes: "Night-shift nurse; calls after hours."
  }
];

export class ContactsStore {
  private readonly store: JsonFileStore<Contact>;

  constructor(filePath: string) {
    this.store = new JsonFileStore<Contact>(filePath);
    if (this.store.size() === 0) this.ensureDefaults();
  }

  /** Add any default contact whose number is missing. Returns how many were added. */
  ensureDefaults(): number {
    const known = new Set(this.store.list().map((contact) => contact.number));
    let added = 0;
    for (const contact of DEFAULT_CONTACTS) {
      if (known.has(contact.number)) continue;
      this.upsert(contact);
      added += 1;
    }
    return added;
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
