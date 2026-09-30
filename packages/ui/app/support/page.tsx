"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BookOpen, Check, Copy, ExternalLink, Github, RotateCcw } from "lucide-react";
import { api, errorMessage, SERVER_URL } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { ClockState, ScenarioListing } from "@/lib/types";
import { Badge, Button, Card, Page, PageHeader, StatusDot, formatRelative } from "@/components/dashboard/ui";
import { EnvironmentOffline, useServerOffline } from "@/components/dashboard/EnvironmentOffline";

const REPO_URL = "https://github.com/AtinChing/agentphone-devtools";

type Health = { state: "checking" } | { state: "ok"; latencyMs: number } | { state: "down"; error: string };

function DiagnosticRow({ label, ok, children }: { label: string; ok: boolean | null; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line/70 py-3.5 last:border-b-0 md:grid-cols-[220px_minmax(0,1fr)] md:gap-6">
      <div className="flex items-center gap-2.5 text-[14px] font-medium text-bright">
        <StatusDot ok={ok} />
        {label}
      </div>
      <div className="min-w-0 text-[14px] text-slate-600">{children}</div>
    </div>
  );
}

const TROUBLESHOOTING: { title: string; body: ReactNode }[] = [
  {
    title: "My handler returns 401 on every delivery",
    body: (
      <>
        The secret the simulator signs with doesn&apos;t match the one your handler verifies with. Compare the preview above with your handler&apos;s
        secret (the example handler reads <code className="data">AGENTPHONE_WEBHOOK_SECRET</code>, default <code className="data">whsec_demo</code>),
        then fix it on the Webhooks tab. Also verify the HMAC over the <em>raw</em> request bytes: parsing the JSON and re-stringifying it changes the
        body and breaks the signature.
      </>
    )
  },
  {
    title: "Deliveries time out",
    body: (
      <>
        A delivery times out when the handler hasn&apos;t finished responding within the timeout (default 30 s, adjustable 5–120 s on the Webhooks
        or SIP Trunks tab). Check the handler is running and reachable from this machine; voice handlers streaming NDJSON must end the stream.
        With retry on non-200 enabled, a failing handler is retried up to 5 times, so a slow failure takes longer to report.
      </>
    )
  },
  {
    title: "Port already in use",
    body: (
      <>
        The CLI starts the API on 4318 and this dashboard on 4319; if either is taken it moves to the next free port (up to 20 attempts) and
        points the dashboard at the port it actually got. Pass <code className="data">--server-port</code> or <code className="data">--ui-port</code>{" "}
        to pin them, or stop the other process.
      </>
    )
  },
  {
    title: "Voice dictation is unavailable",
    body: (
      <>
        Dictation runs locally with whisper.cpp and ffmpeg. On macOS: <code className="data">brew install whisper-cpp ffmpeg</code>, then download{" "}
        <code className="data">ggml-tiny.en.bin</code> into <code className="data">.agentphone-devtools/models/</code> and restart the CLI. The
        reason reported above says which piece is missing. Typed input always works.
      </>
    )
  },
  {
    title: "API calls fail with 400 and an empty body",
    body: (
      <>
        The simulator API rejects a JSON POST without a body. Commands that take no parameters still need <code className="data">{"{}"}</code>:{" "}
        <code className="data">{`curl -X POST -H 'Content-Type: application/json' -d '{}' ${SERVER_URL}/api/step/send`}</code>.
      </>
    )
  },
  {
    title: "How do I reset history and start clean?",
    body: (
      <>
        Settings → Data → Clear run history deletes every saved run except the live session. To wipe everything, stop the CLI and delete{" "}
        <code className="data">.agentphone-devtools/history.json</code>. Settings also resets the simulated clock.
      </>
    )
  }
];

export default function SupportPage() {
  const { connected, session, runs, contacts, voice, lastDelivery } = useLive();
  const offline = useServerOffline();
  const [health, setHealth] = useState<Health>({ state: "checking" });
  const [scenarios, setScenarios] = useState<ScenarioListing[] | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [clock, setClock] = useState<ClockState | null>(null);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  const runChecks = useCallback(async () => {
    setHealth({ state: "checking" });
    const started = performance.now();
    try {
      await api.get<{ ok: boolean }>("/health");
      setHealth({ state: "ok", latencyMs: Math.round(performance.now() - started) });
    } catch (error) {
      setHealth({ state: "down", error: errorMessage(error) });
    }
    try {
      setScenarios(await api.get<ScenarioListing[]>("/api/scenarios"));
      setScenarioError(null);
    } catch (error) {
      setScenarioError(errorMessage(error));
    }
    api
      .get<ClockState>("/api/clock")
      .then(setClock)
      .catch(() => setClock(null));
  }, []);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  const delivery = lastDelivery ?? session?.deliveries.at(-1) ?? null;
  const deliveryOk = delivery ? delivery.ok && !delivery.timedOut : null;
  const groups = (scenarios ?? []).reduce<Record<string, number>>((counts, listing) => {
    if (!listing.error) counts[listing.group] = (counts[listing.group] ?? 0) + 1;
    return counts;
  }, {});
  const broken = (scenarios ?? []).filter((listing) => listing.error);

  async function copyDiagnostics() {
    const summary = {
      generatedAt: new Date().toISOString(),
      serverUrl: SERVER_URL,
      health,
      sseConnected: connected,
      session: session
        ? {
            id: session.id,
            targetUrl: session.targetUrl,
            secretPreview: session.secretPreview,
            channel: session.channel,
            status: session.status,
            runSettings: session.runSettings,
            clockOffsetMs: clock?.offsetMs ?? session.clockOffsetMs
          }
        : null,
      lastDelivery: delivery
        ? {
            at: delivery.timestamp,
            event: delivery.event,
            channel: delivery.channel,
            status: delivery.response.status,
            latencyMs: delivery.latencyMs,
            timedOut: delivery.timedOut,
            retries: delivery.retries,
            faults: delivery.faults ?? [],
            warnings: delivery.warnings
          }
        : null,
      voice,
      runs: runs.length,
      contacts: contacts.length,
      scenarios: { byGroup: groups, errors: broken.map((listing) => ({ path: listing.path, error: listing.error })) },
      userAgent: navigator.userAgent
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    window.setTimeout(() => setCopied("idle"), 2000);
  }

  return (
    <Page>
      <PageHeader title="Support" subtitle="Diagnostics for your local simulator." />

      <div className="space-y-6">
        {/* Diagnostics stay visible offline: that's when they matter most. */}
        {offline ? <EnvironmentOffline /> : null}
        <Card
          title="Diagnostics"
          subtitle="Live checks against the devtools server and your webhook."
          actions={
            <>
              <Button variant="secondary" size="sm" onClick={() => void runChecks()} busy={health.state === "checking"}>
                {health.state === "checking" ? null : <RotateCcw size={14} />}
                Re-run
              </Button>
              <Button size="sm" onClick={() => void copyDiagnostics()}>
                {copied === "copied" ? <Check size={14} /> : <Copy size={14} />}
                {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy diagnostics"}
              </Button>
            </>
          }
        >
          <DiagnosticRow label="Devtools server" ok={health.state === "checking" ? null : health.state === "ok"}>
            <span className="data text-slate-700">{SERVER_URL}</span>
            <span className="ml-2">
              {health.state === "checking"
                ? "checking /health…"
                : health.state === "ok"
                  ? `healthy · ${health.latencyMs} ms`
                  : `unreachable: ${health.error}`}
            </span>
          </DiagnosticRow>
          <DiagnosticRow label="Live connection" ok={connected}>
            {connected ? "Streaming events (SSE)" : "Disconnected. Retrying automatically while the server is down."}
          </DiagnosticRow>
          <DiagnosticRow label="Target webhook" ok={session ? deliveryOk : false}>
            {session ? (
              <div className="space-y-1">
                <div>
                  <span className="data text-slate-700">{session.targetUrl}</span>
                  <span className="ml-2 text-slate-500">
                    secret <span className="data">{session.secretPreview}</span>
                  </span>
                </div>
                <div className="text-slate-500">
                  {delivery ? (
                    <>
                      Last delivery {formatRelative(delivery.timestamp)}:{" "}
                      <span className={deliveryOk ? "text-fern" : "text-danger"}>
                        {delivery.timedOut ? "timed out" : delivery.response.status ? `HTTP ${delivery.response.status}` : delivery.response.statusText}
                      </span>{" "}
                      · {delivery.latencyMs} ms
                    </>
                  ) : (
                    "No deliveries yet this session."
                  )}
                </div>
              </div>
            ) : (
              "Unknown until the server is reachable."
            )}
          </DiagnosticRow>
          <DiagnosticRow label="Voice dictation" ok={voice.available}>
            {voice.available ? "Available (local whisper.cpp)" : voice.reason ?? "Not available"}
          </DiagnosticRow>
          <DiagnosticRow label="Simulated clock" ok={clock ? true : null}>
            {clock ? (
              <>
                <span className="data text-slate-700">{clock.now}</span>
                <span className="ml-2 text-slate-500">{Math.abs(clock.offsetMs) < 1000 ? "real time" : "warped (reset in Settings)"}</span>
              </>
            ) : (
              "Unknown"
            )}
          </DiagnosticRow>
          <DiagnosticRow label="History" ok={session ? true : null}>
            {runs.length} run{runs.length === 1 ? "" : "s"} saved
          </DiagnosticRow>
          <DiagnosticRow label="Contacts" ok={session ? true : null}>
            {contacts.length} contact{contacts.length === 1 ? "" : "s"}
          </DiagnosticRow>
          <DiagnosticRow label="Scenarios discovered" ok={scenarioError ? false : scenarios ? broken.length === 0 : null}>
            {scenarioError ? (
              <span className="text-danger">Could not list scenarios: {scenarioError}</span>
            ) : !scenarios ? (
              "Loading…"
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {Object.keys(groups).length ? (
                    Object.entries(groups).map(([group, count]) => (
                      <Badge key={group}>
                        <span className="data">{group}</span> · {count}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-slate-500">No scenario files found.</span>
                  )}
                </div>
                {broken.map((listing) => (
                  <div key={listing.path} className="text-[13px] text-danger">
                    <span className="data">{listing.path}</span>: {listing.error}
                  </div>
                ))}
              </div>
            )}
          </DiagnosticRow>
        </Card>

        <Card title="Troubleshooting" subtitle="The problems people hit most, and the fix for each.">
          <div className="divide-y divide-line/70 rounded-xl border border-line">
            {TROUBLESHOOTING.map((item) => (
              <details key={item.title} className="group px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14.5px] font-medium text-bright [&::-webkit-details-marker]:hidden">
                  {item.title}
                  <span className="text-slate-500 transition group-open:rotate-90">›</span>
                </summary>
                <div className="pt-2 text-[14px] leading-relaxed text-slate-600">{item.body}</div>
              </details>
            ))}
          </div>
        </Card>

        <Card title="Contact" subtitle="Found a bug or need a feature? Open an issue with your copied diagnostics.">
          <div className="flex flex-wrap gap-2">
            <a
              href={`${REPO_URL}/issues`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-cta px-4 text-[14px] font-semibold text-white hover:bg-[#478f52]"
            >
              <Github size={16} />
              Open an issue
              <ExternalLink size={13} />
            </a>
            <a
              href={`${REPO_URL}#readme`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-raised px-4 text-[14px] font-semibold text-bright hover:border-slate-400"
            >
              Read the README
              <ExternalLink size={13} />
            </a>
            <Button variant="ghost" href="/documentation">
              <BookOpen size={15} />
              In-app documentation
            </Button>
          </div>
        </Card>
      </div>
    </Page>
  );
}
