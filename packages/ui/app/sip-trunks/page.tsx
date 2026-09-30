"use client";

import { Save } from "lucide-react";
import { Badge, Button, Card, Notice, Page } from "@/components/dashboard/ui";
import { EnvironmentOffline, useServerOffline } from "@/components/dashboard/EnvironmentOffline";
import {
  ContextLimitField,
  RetryField,
  RuntimeResultNotice,
  TimeoutField,
  useRuntimeSettings
} from "@/components/dashboard/EnvironmentRuntime";
import { FaultsPanel } from "@/components/dashboard/FaultsPanel";

export default function SipTrunksPage() {
  const offline = useServerOffline();
  const form = useRuntimeSettings();

  return (
    <Page>
      <div className="mb-7">
        <div className="flex items-center gap-3">
          <h1 className="text-[30px] font-bold leading-tight tracking-tight text-bright">SIP Trunks</h1>
          <Badge tone="green">BETA</Badge>
        </div>
        <p className="mt-1.5 text-[15px] text-slate-500">Transport settings and fault injection for the simulated carrier link.</p>
      </div>

      {offline ? (
        <EnvironmentOffline />
      ) : (
        <div className="space-y-6">
          <Card title="Transport" subtitle="How the simulated carrier delivers webhooks to your handler.">
            <div className="grid gap-5 md:grid-cols-3">
              <TimeoutField form={form} />
              <ContextLimitField form={form} />
              <RetryField form={form} />
            </div>
            <div className="mt-6 space-y-3">
              <Notice>
                Saving starts a fresh session: the current conversation is kept in history, and the next delivery uses these settings.
              </Notice>
              <RuntimeResultNotice result={form.result} />
              <div className="flex justify-end">
                <Button onClick={() => void form.save()} busy={form.saving} disabled={!form.session}>
                  {form.saving ? null : <Save size={15} />}
                  Save transport
                </Button>
              </div>
            </div>
          </Card>

          <FaultsPanel />
        </div>
      )}
    </Page>
  );
}
