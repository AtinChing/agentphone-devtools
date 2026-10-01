"use client";

import { Page, PageBody, PageHeader } from "@/components/dashboard/ui";
import { EnvironmentOffline, useServerOffline } from "@/components/dashboard/EnvironmentOffline";
import { ContextLimitField, RetryField, RuntimeResultNotice, TimeoutField, useRuntimeSettings } from "@/components/dashboard/EnvironmentRuntime";
import { FaultsPanel } from "@/components/dashboard/FaultsPanel";

export default function SipTrunksPage() {
  const offline = useServerOffline();
  const form = useRuntimeSettings();

  return (
    <Page>
      <PageHeader title="SIP Trunks" subtitle="Transport settings and fault injection for the simulated carrier link." />

      {offline ? (
        <PageBody>
          <EnvironmentOffline />
        </PageBody>
      ) : (
        <PageBody>
          <div className="flex items-start gap-3 rounded-[14px] border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 to-cyan-500/[0.03] p-4">
            <span className="mt-0.5 shrink-0 rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-400">
              Beta
            </span>
            <p className="text-sm leading-relaxed text-text-dim">
              <span className="font-medium text-text">SIP trunking is simulated locally, so nothing leaves this machine.</span> Tune how the simulated
              carrier delivers webhooks to your handler, then fire deliberately broken deliveries at it and check every one fails safely.
            </p>
          </div>

          <section className="overflow-hidden rounded-[18px] bg-card shadow-card backdrop-blur-[2px]">
            <div className="border-b border-surface-border px-6 py-4">
              <h2 className="text-lg font-semibold text-text">Transport</h2>
              <p className="text-sm text-text-dim">How the simulated carrier delivers webhooks to your handler.</p>
            </div>
            <div className="space-y-6 p-6">
              <div className="grid gap-5 md:grid-cols-3">
                <TimeoutField form={form} />
                <ContextLimitField form={form} />
                <RetryField form={form} />
              </div>
              <RuntimeResultNotice result={form.result} />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void form.save()}
                  disabled={form.saving || !form.session}
                  className="focus-ring rounded-[10px] bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground-strong transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {form.saving ? "Saving..." : "Save transport"}
                </button>
                <span className="text-xs text-text-dim">
                  Saving starts a fresh session: the current conversation is kept in history, and the next delivery uses these settings.
                </span>
              </div>
            </div>
          </section>

          <FaultsPanel />
        </PageBody>
      )}
    </Page>
  );
}
