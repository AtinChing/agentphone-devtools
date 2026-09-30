"use client";

import { useEffect, useState } from "react";
import { Server } from "lucide-react";
import { SERVER_URL } from "@/lib/api";
import { useLive } from "@/lib/live";
import { Card, EmptyState } from "@/components/dashboard/ui";

/**
 * True when the devtools server is unreachable and nothing is cached yet.
 * Waits briefly on first mount so the page doesn't flash "offline" while
 * the event stream is still connecting.
 */
export function useServerOffline(): boolean {
  const { connected, session } = useLive();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), 1500);
    return () => window.clearTimeout(timer);
  }, []);
  return settled && !connected && !session;
}

export function EnvironmentOffline() {
  return (
    <Card>
      <EmptyState
        icon={<Server size={26} />}
        title="Devtools server offline"
        description={
          <>
            <span>
              Nothing is answering at <span className="data text-slate-700">{SERVER_URL}</span>. Start the simulator and this page
              reconnects on its own:
            </span>
            <code className="console-pane data mt-4 block rounded-xl border border-line px-4 py-3 text-left text-[13px]">
              npx agentphone-devtools --target http://localhost:3000/webhook --secret whsec_demo
            </code>
          </>
        }
      />
    </Card>
  );
}
