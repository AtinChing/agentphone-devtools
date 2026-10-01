"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ClockCounterClockwise, Trash } from "@phosphor-icons/react";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { ClockState, SessionChannel } from "@/lib/types";
import { Button, Card, Field, Modal, Notice, Page, PageBody, PageHeader, Toggle, inputClass } from "@/components/dashboard/ui";
import { EnvironmentOffline, useServerOffline } from "@/components/dashboard/EnvironmentOffline";
import { AppearancePreferences, useAppearance } from "@/components/dashboard/EnvironmentPreferences";
import { ContextLimitField, RetryField, RuntimeResultNotice, TimeoutField, useRuntimeSettings } from "@/components/dashboard/EnvironmentRuntime";

const CHANNELS: { value: SessionChannel; label: string }[] = [
  { value: "sms", label: "SMS" },
  { value: "imessage", label: "iMessage" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "voice", label: "Voice" }
];

function describeOffset(offsetMs: number): string {
  const abs = Math.abs(offsetMs);
  if (abs < 1000) return "Real time";
  const units: [number, string][] = [
    [86_400_000, "d"],
    [3_600_000, "h"],
    [60_000, "m"],
    [1000, "s"]
  ];
  const [size, unit] = units.find(([unitMs]) => abs >= unitMs) ?? units[units.length - 1];
  return `${offsetMs < 0 ? "−" : "+"}${Math.round(abs / size)}${unit} from real time`;
}

function SettingRow({ title, description, children }: { title: string; description: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="min-w-0 max-w-xl">
        <div className="text-sm font-medium text-text">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-text-dim">{description}</div>
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}

export default function SettingsPage() {
  const { session, runs, step, refreshRuns } = useLive();
  const offline = useServerOffline();
  const form = useRuntimeSettings();
  const [appearance, setAppearance] = useAppearance();
  const [channel, setChannel] = useState<SessionChannel>("sms");

  const [clock, setClock] = useState<ClockState | null>(null);
  const [clockBusy, setClockBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [dataNotice, setDataNotice] = useState<{ tone: "good" | "error"; text: string } | null>(null);

  const liveChannel = session?.channel;
  useEffect(() => {
    if (!form.dirty && liveChannel) setChannel(liveChannel);
  }, [form.dirty, liveChannel]);

  // Step state and the live session both carry the clock offset over SSE,
  // so re-reading on either change keeps this current after warps and resets.
  const stepOffset = step?.clockOffsetMs;
  const sessionOffset = session?.clockOffsetMs;
  useEffect(() => {
    api
      .get<ClockState>("/api/clock")
      .then(setClock)
      .catch(() => setClock(null));
  }, [stepOffset, sessionOffset]);

  async function resetClock() {
    setClockBusy(true);
    setDataNotice(null);
    try {
      const next = await api.post<ClockState>("/api/clock/set", { at: new Date().toISOString() });
      setClock(next);
      setDataNotice({ tone: "good", text: "Simulated clock is back on real time." });
    } catch (error) {
      setDataNotice({ tone: "error", text: `Could not reset the clock: ${errorMessage(error)}` });
    } finally {
      setClockBusy(false);
    }
  }

  async function clearHistory() {
    setClearing(true);
    try {
      const { removed } = await api.delete<{ removed: number }>("/api/history");
      await refreshRuns();
      setDataNotice({ tone: "good", text: `Removed ${removed} saved run${removed === 1 ? "" : "s"}. The live session was kept.` });
      setConfirmClear(false);
    } catch (error) {
      setDataNotice({ tone: "error", text: `Could not clear history: ${errorMessage(error)}` });
      setConfirmClear(false);
    } finally {
      setClearing(false);
    }
  }

  const savedRuns = runs.filter((run) => run.id !== session?.id).length;

  return (
    <Page>
      <AppearancePreferences />
      <PageHeader title="Settings" subtitle="Simulator defaults and data." />

      {offline ? (
        <PageBody>
          <EnvironmentOffline />
        </PageBody>
      ) : (
        <PageBody className="!gap-6">
          <Card title="Defaults" subtitle="Applied to the live simulator and every conversation after it.">
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Default channel" hint="Channel for new conversations that don't pick their own.">
                <select
                  value={channel}
                  onChange={(event) => {
                    setChannel(event.target.value as SessionChannel);
                    form.touch();
                  }}
                  className={inputClass}
                >
                  {CHANNELS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <TimeoutField form={form} />
              <ContextLimitField form={form} />
              <RetryField form={form} />
            </div>
            <div className="mt-6 space-y-4">
              <RuntimeResultNotice result={form.result} />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void form.save({ channel })}
                  disabled={form.saving || !session}
                  className="focus-ring rounded-[10px] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground-strong transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {form.saving ? "Saving..." : "Save defaults"}
                </button>
                <span className="text-xs text-text-dim">
                  Saving starts a fresh session with these defaults; the current conversation stays in history.
                </span>
              </div>
            </div>
          </Card>

          <Card title="Appearance" subtitle="Stored in this browser only.">
            <SettingRow title="Compact tables" description="Tighter rows in run, delivery, and contact tables.">
              <Toggle checked={appearance.compact} onChange={(value) => setAppearance("compact", value)} />
            </SettingRow>
            <SettingRow title="Reduce motion" description="Turn off transitions and animations such as typing indicators.">
              <Toggle checked={appearance.reduceMotion} onChange={(value) => setAppearance("reduceMotion", value)} />
            </SettingRow>
          </Card>

          <Card title="Data" subtitle="Danger zone: these actions can't be undone.">
            {dataNotice ? (
              <div className="mb-4">
                <Notice tone={dataNotice.tone}>{dataNotice.text}</Notice>
              </div>
            ) : null}
            <SettingRow
              title="Clear run history"
              description={`Delete ${savedRuns} saved run${savedRuns === 1 ? "" : "s"}, including baselines and forks. The live session is kept.`}
            >
              <Button variant="danger" size="sm" onClick={() => setConfirmClear(true)} disabled={savedRuns === 0}>
                <Trash size={14} weight="bold" />
                Clear run history
              </Button>
            </SettingRow>
            <SettingRow
              title="Reset simulated clock"
              description={
                <>
                  Currently: <span className="font-mono text-text-secondary">{clock ? describeOffset(clock.offsetMs) : "unknown"}</span>. Warps and
                  scenario <span className="font-mono text-text-secondary">startAt</span> move it; resetting pins it to now.
                </>
              }
            >
              <Button variant="secondary" size="sm" onClick={() => void resetClock()} busy={clockBusy}>
                {clockBusy ? null : <ClockCounterClockwise size={14} weight="bold" />}
                Reset clock
              </Button>
            </SettingRow>
            <SettingRow
              title="Where data lives"
              description={
                <>
                  Runs are saved to <span className="font-mono text-text-secondary">.agentphone-devtools/history.json</span> in the directory the CLI
                  was started from (override with <span className="font-mono text-text-secondary">--history-path</span>). Contacts and sub-accounts
                  sit beside it in <span className="font-mono text-text-secondary">contacts.json</span> and{" "}
                  <span className="font-mono text-text-secondary">environments.json</span>. Signing secrets are never written to history.
                </>
              }
            />
          </Card>
        </PageBody>
      )}

      {confirmClear ? (
        <Modal
          title="Clear run history"
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void clearHistory()} busy={clearing}>
                Delete {savedRuns} run{savedRuns === 1 ? "" : "s"}
              </Button>
            </>
          }
        >
          <p className="text-sm text-text-secondary">
            This permanently deletes every saved run except the live session, including baselines, labels, and forks. Exported scenario files are not
            touched.
          </p>
        </Modal>
      ) : null}
    </Page>
  );
}
