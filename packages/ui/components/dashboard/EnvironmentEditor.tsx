"use client";

import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { EnvironmentInput, EnvironmentView, SessionChannel } from "@/lib/types";
import { Button, Field, Modal, Notice, inputClass } from "@/components/dashboard/ui";

const CHANNELS: { value: SessionChannel; label: string }[] = [
  { value: "sms", label: "SMS" },
  { value: "imessage", label: "iMessage" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "voice", label: "Voice" }
];

/**
 * Create or edit a sub-account: a named webhook target + signing secret
 * (+ optional default channel). The secret never comes back from the
 * server, so a blank secret on edit keeps the stored one.
 */
export function EnvironmentEditor({
  environment,
  onClose,
  onSaved
}: {
  environment?: EnvironmentView;
  onClose: () => void;
  onSaved: (environment: EnvironmentView) => void;
}) {
  const [name, setName] = useState(environment?.name ?? "");
  const [targetUrl, setTargetUrl] = useState(environment?.targetUrl ?? "");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [channel, setChannel] = useState<SessionChannel | "">(environment?.channel ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const body: EnvironmentInput = {
      name: name.trim(),
      targetUrl: targetUrl.trim(),
      ...(secret.trim() ? { secret: secret.trim() } : {}),
      ...(channel ? { channel } : {})
    };
    try {
      const saved = environment
        ? await api.put<EnvironmentView>(`/api/environments/${encodeURIComponent(environment.id)}`, body)
        : await api.post<EnvironmentView>("/api/environments", body);
      onSaved(saved);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={environment ? `Edit ${environment.name}` : "Create sub-account"} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <Field label="Name">
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Fall promo campaign" className={inputClass} />
        </Field>
        <Field label="Webhook URL" hint="Where this sub-account's agents receive events.">
          <input
            value={targetUrl}
            onChange={(event) => setTargetUrl(event.target.value)}
            placeholder="http://localhost:3000/webhook"
            className={`${inputClass} data`}
          />
        </Field>
        <Field
          label="Signing secret"
          hint={environment ? `Leave blank to keep the current secret (${environment.secretPreview}).` : "Used to sign every delivery with HMAC-SHA256."}
        >
          <div className="relative">
            <input
              type={showSecret ? "text" : "password"}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={environment ? environment.secretPreview : "whsec_…"}
              autoComplete="new-password"
              className={`${inputClass} data pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowSecret((current) => !current)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-bright"
              aria-label={showSecret ? "Hide secret" : "Show secret"}
            >
              {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>
        <Field label="Default channel" hint="Activating the sub-account switches the simulator to this channel.">
          <select value={channel} onChange={(event) => setChannel(event.target.value as SessionChannel | "")} className={inputClass}>
            {/* The server keeps a stored channel when none is sent, so "none" is only offered when there is nothing to keep. */}
            {environment?.channel ? null : <option value="">Keep the simulator&apos;s current channel</option>}
            {CHANNELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="-mx-6 mt-2 flex justify-end gap-2 border-t border-line px-6 pt-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={saving}>
            {environment ? "Save changes" : "Create sub-account"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
