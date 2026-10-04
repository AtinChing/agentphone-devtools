"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { EnvironmentInput, EnvironmentView, SessionChannel } from "@/lib/types";
import { Button, Field, Modal, Notice, inputClass } from "./ui";
import { CONTACT_CHANNELS } from "./ContactEditor";

/**
 * In the simulator an agent is a webhook handler: create it as a named
 * environment, then make it the active delivery target.
 */
export function AgentCreateModal({ defaultChannel, onClose, onCreated }: { defaultChannel: SessionChannel; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [targetUrl, setTargetUrl] = useState("http://localhost:3000/webhook");
  const [secret, setSecret] = useState("");
  const [channel, setChannel] = useState<SessionChannel>(defaultChannel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the environment exists: a retry after a failed activation updates it instead of adding a duplicate.
  const [createdId, setCreatedId] = useState<string | null>(null);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const body: EnvironmentInput = { name: name.trim(), targetUrl: targetUrl.trim(), secret: secret.trim(), channel };
      const environment = createdId
        ? await api.put<EnvironmentView>(`/api/environments/${encodeURIComponent(createdId)}`, body)
        : await api.post<EnvironmentView>("/api/environments", body);
      setCreatedId(environment.id);
      await api.post(`/api/environments/${encodeURIComponent(environment.id)}/activate`);
      onCreated();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="New agent"
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="submit" onClick={create} busy={saving} disabled={!name.trim() || !targetUrl.trim() || !secret.trim()}>
            Create and activate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-text-secondary">
          In the simulator an agent is your webhook handler: the URL AgentPhone would POST events to, and the secret it signs them with. Creating one makes
          it the active target for iMessage, the Inspector and scenario runs.
        </p>
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="Support agent (staging)" autoFocus />
        </Field>
        <Field label="Webhook URL" hint="Absolute http:// or https:// URL of your handler.">
          <input className={`${inputClass} font-mono text-[13px]`} value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} placeholder="http://localhost:3000/webhook" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Signing secret" hint="Used for the HMAC signature header.">
            <input className={`${inputClass} font-mono text-[13px]`} value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="whsec_…" />
          </Field>
          <Field label="Default channel">
            <select className={inputClass} value={channel} onChange={(event) => setChannel(event.target.value as SessionChannel)}>
              {CONTACT_CHANNELS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>
    </Modal>
  );
}
