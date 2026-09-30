"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Clock, Save, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { ClockState, SessionChannel } from "@/lib/types";
import { Button, Card, Field, Modal, Notice, Page, PageHeader, Toggle, inputClass } from "@/components/dashboard/ui";
import { EnvironmentOffline, useServerOffline } from "@/components/dashboard/EnvironmentOffline";
import { AppearancePreferences, useAppearance } from "@/components/dashboard/EnvironmentPreferences";
import {
  ContextLimitField,
  RetryField,
  RuntimeResultNotice,
  TimeoutField,
  useRuntimeSettings
} from "@/components/dashboard/EnvironmentRuntime";

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
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line/70 py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="min-w-0 max-w-xl">
        <div className="text-[15px] font-medium text-bright">{title}</div>
        <div className="mt-0.5 text-[13.5px] text-slate-500">{description}</div>
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
        <EnvironmentOffline />
      ) : (
        <div className="space-y-6">
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
            <div className="mt-6 space-y-3">
              <Notice>Saving starts a fresh session with these defaults; the current conversation stays in history.</Notice>
              <RuntimeResultNotice result={form.result} />
              <div className="flex justify-end">
                <Button onClick={() => void form.save({ channel })} busy={form.saving} disabled={!session}>
                  {form.saving ? null : <Save size={15} />}
                  Save defaults
                </Button>
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
              <Button variant="danger" onClick={() => setConfirmClear(true)} disabled={savedRuns === 0}>
                <Trash2 size={15} />
                Clear run history
              </Button>
            </SettingRow>
            <SettingRow
              title="Reset simulated clock"
              description={
                <>
                  Currently: <span className="data text-slate-700">{clock ? describeOffset(clock.offsetMs) : "unknown"}</span>. Warps and scenario{" "}
                  <span className="data">startAt</span> move it; resetting pins it to now.
                </>
              }
            >
              <Button variant="secondary" onClick={() => void resetClock()} busy={clockBusy}>
                {clockBusy ? null : <Clock size={15} />}
                Reset clock
              </Button>
            </SettingRow>
            <SettingRow
              title="Where data lives"
              description={
                <>
                  Runs are saved to <span className="data text-slate-700">.agentphone-devtools/history.json</span> in the directory the CLI was
                  started from (override with <span className="data">--history-path</span>). Contacts and sub-accounts sit beside it in{" "}
                  <span className="data">contacts.json</span> and <span className="data">environments.json</span>. Signing secrets are never
                  written to history.
                </>
              }
            />
          </Card>
        </div>
      )}

      {confirmClear ? (
        <Modal
          title="Clear run history"
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void clearHistory()} busy={clearing}>
                Delete {savedRuns} run{savedRuns === 1 ? "" : "s"}
              </Button>
            </>
          }
        >
          <p className="text-[14px] text-slate-600">
            This permanently deletes every saved run except the live session, including baselines, labels, and forks. Exported scenario files are not
            touched.
          </p>
        </Modal>
      ) : null}
    </Page>
  );
}
