"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowClockwise, ArrowSquareOut, BookOpen, CaretRight, Check, Copy, GithubLogo } from "@phosphor-icons/react";
import { api, errorMessage, SERVER_URL } from "@/lib/api";
import { useLive } from "@/lib/live";
import type { ClockState, ScenarioListing } from "@/lib/types";
import { Badge, Button, Card, Page, PageBody, PageHeader, StatusDot, formatRelative } from "@/components/dashboard/ui";
import { EnvironmentOffline, useServerOffline } from "@/components/dashboard/EnvironmentOffline";

const REPO_URL = "https://github.com/AtinChing/agentphone-devtools";

type Health = { state: "checking" } | { state: "ok"; latencyMs: number } | { state: "down"; error: string };

function DiagnosticRow({ label, ok, children }: { label: string; ok: boolean | null; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-white/[0.06] py-3 first:pt-0 last:border-b-0 last:pb-0">
      <StatusDot ok={ok} className="mt-1.5 shrink-0" />
      <div className="grid min-w-0 flex-1 gap-1 md:grid-cols-[200px_minmax(0,1fr)] md:gap-6">
        <div className="text-sm text-text">{label}</div>
        <div className="min-w-0 text-sm text-text-secondary">{children}</div>
      </div>
    </div>
  );
}

/** Inline code in troubleshooting answers. */
function C({ children }: { children: ReactNode }) {
  return <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[12.5px] text-text">{children}</code>;
}

const TROUBLESHOOTING: { title: string; body: ReactNode }[] = [
  {
    title: "My handler returns 401 on every delivery",
    body: (
      <>
        The secret the simulator signs with doesn&apos;t match the one your handler verifies with. Compare the preview above with your handler&apos;s
        secret (the example handler reads <C>AGENTPHONE_WEBHOOK_SECRET</C>, default <C>whsec_demo</C>), then fix it on the Webhooks tab. Also verify
        the HMAC over the <em>raw</em> request bytes: parsing the JSON and re-stringifying it changes the body and breaks the signature.
      </>
    )
  },
  {
    title: "Deliveries time out",
    body: (
      <>
        A delivery times out when the handler hasn&apos;t finished responding within the timeout (default 30 s, adjustable 5–120 s on the Webhooks or
        SIP Trunks tab). Check the handler is running and reachable from this machine; voice handlers streaming NDJSON must end the stream. With retry
        on non-200 enabled, a failing handler is retried up to 5 times, so a slow failure takes longer to report.
      </>
    )
  },
  {
    title: "Port already in use",
    body: (
      <>
        The CLI starts the API on 4318 and this dashboard on 4319; if either is taken it moves to the next free port (up to 20 attempts) and points
        the dashboard at the port it actually got. Pass <C>--server-port</C> or <C>--ui-port</C> to pin them, or stop the other process.
      </>
    )
  },
  {
    title: "Voice dictation is unavailable",
    body: (
      <>
        Dictation runs locally with whisper.cpp and ffmpeg. On macOS: <C>brew install whisper-cpp ffmpeg</C>, then download <C>ggml-tiny.en.bin</C>{" "}
        into <C>.agentphone-devtools/models/</C> and restart the CLI. The reason reported above says which piece is missing. Typed input always works.
      </>
    )
  },
  {
    title: "API calls fail with 400 and an empty body",
    body: (
      <>
        The simulator API rejects a JSON POST without a body. Commands that take no parameters still need <C>{"{}"}</C>:{" "}
        <C>{`curl -X POST -H 'Content-Type: application/json' -d '{}' ${SERVER_URL}/api/step/send`}</C>.
      </>
    )
  },
  {
    title: "How do I reset history and start clean?",
    body: (
      <>
        Settings → Data → Clear run history deletes every saved run except the live session. To wipe everything, stop the CLI and delete{" "}
        <C>.agentphone-devtools/history.json</C>. Settings also resets the simulated clock.
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

      <PageBody className="!gap-6">
        {/* Diagnostics stay visible offline: that's when they matter most. */}
        {offline ? <EnvironmentOffline /> : null}
        <Card
          title="Diagnostics"
          subtitle="Live checks against the devtools server and your webhook."
          actions={
            <>
              <Button variant="secondary" size="sm" onClick={() => void runChecks()} busy={health.state === "checking"}>
                {health.state === "checking" ? null : <ArrowClockwise size={14} weight="bold" />}
                Re-run
              </Button>
              <Button size="sm" onClick={() => void copyDiagnostics()}>
                {copied === "copied" ? <Check size={14} weight="bold" /> : <Copy size={14} weight="bold" />}
                {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy diagnostics"}
              </Button>
            </>
          }
        >
          <DiagnosticRow label="Devtools server" ok={health.state === "checking" ? null : health.state === "ok"}>
            <span className="font-mono text-text">{SERVER_URL}</span>
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
                  <span className="font-mono text-text">{session.targetUrl}</span>
                  <span className="ml-2 text-text-dim">
                    secret <span className="font-mono text-text-secondary">{session.secretPreview}</span>
                  </span>
                </div>
                <div className="text-text-dim">
                  {delivery ? (
                    <>
                      Last delivery {formatRelative(delivery.timestamp)}:{" "}
                      <span className={deliveryOk ? "text-primary" : "text-red-400"}>
                        {delivery.timedOut
                          ? "timed out"
                          : delivery.response.status
                            ? `HTTP ${delivery.response.status}`
                            : delivery.response.statusText}
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
            {voice.available ? "Available (local whisper.cpp)" : (voice.reason ?? "Not available")}
          </DiagnosticRow>
          <DiagnosticRow label="Simulated clock" ok={clock ? true : null}>
            {clock ? (
              <>
                <span className="font-mono text-text">{clock.now}</span>
                <span className="ml-2 text-text-dim">{Math.abs(clock.offsetMs) < 1000 ? "real time" : "warped (reset in Settings)"}</span>
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
              <span className="text-red-400">Could not list scenarios: {scenarioError}</span>
            ) : !scenarios ? (
              "Loading…"
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {Object.keys(groups).length ? (
                    Object.entries(groups).map(([group, count]) => (
                      <Badge key={group}>
                        <span className="font-mono">{group}</span> · {count}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-text-dim">No scenario files found.</span>
                  )}
                </div>
                {broken.map((listing) => (
                  <div key={listing.path} className="text-xs text-red-400">
                    <span className="font-mono">{listing.path}</span>: {listing.error}
                  </div>
                ))}
              </div>
            )}
          </DiagnosticRow>
        </Card>

        <Card title="Troubleshooting" subtitle="The problems people hit most, and the fix for each." padded={false}>
          <div className="space-y-1 p-4">
            {TROUBLESHOOTING.map((item) => (
              <details key={item.title} className="group rounded-[12px] px-4 py-3 transition-colors hover:bg-card-hover open:bg-white/[0.02]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-white [&::-webkit-details-marker]:hidden">
                  {item.title}
                  <CaretRight size={14} weight="bold" className="shrink-0 text-white/40 transition-transform group-open:rotate-90" />
                </summary>
                <div className="pt-2 text-sm leading-relaxed text-text-dim">{item.body}</div>
              </details>
            ))}
          </div>
        </Card>

        <Card title="Contact" subtitle="Found a bug or need a feature? Open an issue with your copied diagnostics.">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`${REPO_URL}/issues`}
              target="_blank"
              rel="noreferrer"
              className="focus-ring flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] bg-primary px-3.5 text-[14px] font-medium leading-none text-white transition-[transform,background-color] duration-200 hover:bg-primary/90 active:scale-[0.96]"
            >
              <GithubLogo size={16} weight="bold" />
              Open an issue
              <ArrowSquareOut size={13} weight="bold" className="text-white/70" />
            </a>
            <a
              href={`${REPO_URL}#readme`}
              target="_blank"
              rel="noreferrer"
              className="focus-ring flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-white/[0.06] px-3.5 text-[14px] font-medium leading-none text-white transition-colors hover:bg-white/[0.1] active:scale-[0.96]"
            >
              Read the README
              <ArrowSquareOut size={13} weight="bold" className="text-white/50" />
            </a>
            <Button variant="ghost" href="/documentation">
              <BookOpen size={16} />
              In-app documentation
            </Button>
          </div>
        </Card>
      </PageBody>
    </Page>
  );
}
