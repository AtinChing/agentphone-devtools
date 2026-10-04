"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { InspectorSession, RuntimeConfigUpdate } from "@/lib/types";
import { Badge, Field, Notice, Toggle, inputClass } from "@/components/dashboard/ui";

export interface RuntimeResult {
  tone: "good" | "error";
  text: string;
}

/**
 * Form state for the simulator's runtime config. Fields prefill from the
 * live session's runSettings until edited; saving goes through
 * POST /api/reset, which applies the config and starts a fresh session.
 *
 * `retryOnNon200` is not reported by the server, so it stays `null`
 * ("leave the CLI setting alone") until the user flips it.
 */
export function useRuntimeSettings() {
  const { session, refreshSession } = useLive();
  const liveTimeout = session?.runSettings?.timeoutSeconds;
  const liveContext = session?.runSettings?.contextLimit;
  const [timeoutSeconds, setTimeoutSeconds] = useState("30");
  const [contextLimit, setContextLimit] = useState(10);
  const [retryOnNon200, setRetryOnNon200] = useState<boolean | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<RuntimeResult | null>(null);

  useEffect(() => {
    if (dirty) return;
    if (liveTimeout !== undefined) setTimeoutSeconds(String(liveTimeout));
    if (liveContext !== undefined) setContextLimit(liveContext);
  }, [dirty, liveTimeout, liveContext]);

  function edit<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
      setResult(null);
    };
  }

  /** Validate with the server's own bounds, then reset the runtime with `extra` merged in. */
  async function save(extra: RuntimeConfigUpdate = {}): Promise<InspectorSession | null> {
    const timeout = Number(timeoutSeconds);
    const issues: string[] = [];
    if (!Number.isInteger(timeout) || timeout < 5 || timeout > 120) issues.push("Timeout must be a whole number of seconds between 5 and 120.");
    if (!Number.isInteger(contextLimit) || contextLimit < 0 || contextLimit > 50) issues.push("Context limit must be between 0 and 50.");
    if (extra.targetUrl !== undefined && !isHttpUrl(extra.targetUrl)) issues.push("Webhook URL must be an absolute http:// or https:// URL.");
    if (issues.length) {
      setResult({ tone: "error", text: issues.join(" ") });
      return null;
    }
    setSaving(true);
    setResult(null);
    try {
      const next = await api.post<InspectorSession>("/api/reset", {
        ...extra,
        timeoutSeconds: timeout,
        contextLimit,
        ...(retryOnNon200 === null ? {} : { retryOnNon200 })
      });
      await refreshSession();
      setDirty(false);
      setResult({ tone: "good", text: `Saved. Fresh session ${next.id} started against ${next.targetUrl}.` });
      return next;
    } catch (error) {
      setResult({ tone: "error", text: errorMessage(error) });
      return null;
    } finally {
      setSaving(false);
    }
  }

  return {
    session,
    timeoutSeconds,
    setTimeoutSeconds: edit(setTimeoutSeconds),
    contextLimit,
    setContextLimit: edit(setContextLimit),
    retryOnNon200,
    setRetryOnNon200: edit(setRetryOnNon200),
    /** Mark the form edited from a page-owned field (URL, secret, channel). */
    touch: () => {
      setDirty(true);
      setResult(null);
    },
    dirty,
    saving,
    result,
    save
  };
}

export type RuntimeForm = ReturnType<typeof useRuntimeSettings>;

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function TimeoutField({ form }: { form: RuntimeForm }) {
  return (
    <Field label="Timeout (seconds)" hint="How long a delivery may take before it counts as timed out (5–120).">
      <input
        type="number"
        min={5}
        max={120}
        step={1}
        value={form.timeoutSeconds}
        onChange={(event) => form.setTimeoutSeconds(event.target.value)}
        className={inputClass}
      />
    </Field>
  );
}

const RANGE_CLASS =
  "h-2 flex-1 cursor-pointer appearance-none rounded-[10px] bg-white/[0.05] accent-primary " +
  "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(38,182,90,0.2)] " +
  "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary";

export function ContextLimitField({ form, slider }: { form: RuntimeForm; slider?: boolean }) {
  const hint = (
    <>
      Number of recent messages to include in <code className="text-primary">recentHistory</code>. Set to 0 to disable.
    </>
  );
  if (!slider) {
    return (
      <Field label="Context limit" hint={hint}>
        <input
          type="number"
          min={0}
          max={50}
          step={1}
          value={form.contextLimit}
          onChange={(event) => form.setContextLimit(Math.round(Number(event.target.value)))}
          className={inputClass}
        />
      </Field>
    );
  }
  // The console's slider row: track, then the value in mono on the right.
  return (
    <div>
      <label htmlFor="context-limit" className="mb-2 block text-sm text-text-dim">
        Context Limit
      </label>
      <div className="flex items-center gap-3">
        <input
          id="context-limit"
          type="range"
          min={0}
          max={50}
          step={1}
          value={form.contextLimit}
          onChange={(event) => form.setContextLimit(Number(event.target.value))}
          className={RANGE_CLASS}
        />
        <span className="w-8 text-right font-mono text-sm text-text">{form.contextLimit}</span>
      </div>
      <p className="mt-2 text-xs text-text-dim">{hint}</p>
    </div>
  );
}

export function RetryField({ form }: { form: RuntimeForm }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm text-text-dim">
        Retry on non-200
        {form.retryOnNon200 === null ? <Badge>CLI setting</Badge> : null}
      </div>
      <div className="flex h-10 items-center">
        <Toggle
          checked={form.retryOnNon200 ?? false}
          onChange={form.setRetryOnNon200}
          label={form.retryOnNon200 === null ? "Unchanged" : form.retryOnNon200 ? "On" : "Off"}
        />
      </div>
      <div className="mt-1.5 text-xs text-text-dim">
        {form.retryOnNon200 === null
          ? "The server keeps whatever --retry-on-non-200 set; flip to choose explicitly."
          : "Failed deliveries retry up to 5 times with compressed backoff (250 ms → 5 s)."}
      </div>
    </div>
  );
}

export function RuntimeResultNotice({ result }: { result: RuntimeResult | null }) {
  if (!result) return null;
  return <Notice tone={result.tone}>{result.text}</Notice>;
}
