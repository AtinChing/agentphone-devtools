#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import open from "open";
import { startDevtoolsServer, type DevtoolsServerConfig } from "@agentphone-devtools/server";

interface CliOptions {
  targetUrl: string;
  secret: string;
  channel: "sms" | "voice";
  timeoutSeconds: number;
  contextLimit: number;
  port: number;
  uiPort: number;
  scenario?: string;
  noOpen: boolean;
  exitAfterScenario: boolean;
  retryOnNon200: boolean;
  interactive: boolean;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const uiDir = join(repoRoot, "packages/ui");
const nextBin = join(repoRoot, "node_modules/next/dist/bin/next");

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(nextBin)) {
    throw new Error("Next.js binary was not found. Run `npm install` in this repo before starting AgentPhone DevTools.");
  }

  const serverConfig: DevtoolsServerConfig = {
    targetUrl: options.targetUrl,
    secret: options.secret,
    channel: options.channel,
    timeoutSeconds: options.timeoutSeconds,
    contextLimit: options.contextLimit,
    port: options.port,
    retryOnNon200: options.retryOnNon200
  };

  const server = await startDevtoolsServer(serverConfig);
  const ui = startUi(options.uiPort, server.url);
  const uiUrl = `http://127.0.0.1:${options.uiPort}`;

  await waitForHttp(uiUrl, 30_000);
  console.log(`AgentPhone DevTools server: ${server.url}`);
  console.log(`AgentPhone DevTools inspector: ${uiUrl}`);
  console.log(`Target webhook: ${options.targetUrl}`);

  if (!options.noOpen) {
    await open(uiUrl);
  }

  const shutdown = async () => {
    ui.kill("SIGTERM");
    await server.close();
  };

  process.once("SIGINT", async () => {
    await shutdown();
    process.exit(0);
  });
  process.once("SIGTERM", async () => {
    await shutdown();
    process.exit(0);
  });

  if (options.scenario) {
    const scenarioPath = resolve(process.cwd(), options.scenario);
    const finalState = await server.runtime.runScenario(scenarioPath);
    if (finalState.evalResult) {
      console.log(JSON.stringify({ eval: finalState.evalResult }, null, 2));
    }
    if (options.exitAfterScenario) {
      await shutdown();
      return;
    }
  } else if (options.interactive) {
    await runInteractive(server.runtime, options.channel);
  }

  await new Promise(() => undefined);
}

function startUi(uiPort: number, serverUrl: string): ChildProcess {
  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(uiPort), "-H", "127.0.0.1"], {
    cwd: uiDir,
    env: {
      ...process.env,
      NEXT_PUBLIC_AGENTPHONE_DEVTOOLS_SERVER_URL: serverUrl
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    if (/ready|started server|local:/i.test(text)) process.stdout.write(text);
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    if (!/wait compiling|compiled/i.test(text)) process.stderr.write(text);
  });
  child.on("exit", (code) => {
    if (code && code !== 0) console.error(`Inspector UI exited with code ${code}`);
  });

  return child;
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function runInteractive(runtime: Awaited<ReturnType<typeof startDevtoolsServer>>["runtime"], channel: "sms" | "voice") {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("Interactive caller prompt. Type `end call` to emit call-ended, `quit` to stop.");
  try {
    while (true) {
      const answer = (await rl.question("caller > ")).trim();
      if (!answer) continue;
      if (answer === "quit" || answer === "exit") break;
      if (answer === "end call") {
        await runtime.endCall();
        continue;
      }
      const delivery = await runtime.sendCallerTurn(answer, channel);
      const text = delivery.response.parsed.final?.text ?? delivery.response.rawBody.trim();
      if (text) console.log(`agent > ${text}`);
      for (const warning of delivery.warnings) console.warn(`warning > ${warning}`);
    }
  } finally {
    rl.close();
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    targetUrl: process.env.AGENTPHONE_DEVTOOLS_TARGET ?? "http://localhost:3000/webhook",
    secret: process.env.AGENTPHONE_WEBHOOK_SECRET ?? "whsec_demo",
    channel: parseChannel(process.env.AGENTPHONE_DEVTOOLS_CHANNEL ?? "voice"),
    timeoutSeconds: Number(process.env.AGENTPHONE_DEVTOOLS_TIMEOUT_SECONDS ?? 30),
    contextLimit: Number(process.env.AGENTPHONE_DEVTOOLS_CONTEXT_LIMIT ?? 10),
    port: Number(process.env.AGENTPHONE_DEVTOOLS_SERVER_PORT ?? 4318),
    uiPort: Number(process.env.AGENTPHONE_DEVTOOLS_UI_PORT ?? 4319),
    noOpen: false,
    exitAfterScenario: false,
    retryOnNon200: false,
    interactive: true
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--target":
        options.targetUrl = requireValue(args, ++i, arg);
        break;
      case "--secret":
        options.secret = requireValue(args, ++i, arg);
        break;
      case "--channel":
        options.channel = parseChannel(requireValue(args, ++i, arg));
        break;
      case "--timeout":
        options.timeoutSeconds = Number(requireValue(args, ++i, arg));
        break;
      case "--context-limit":
        options.contextLimit = Number(requireValue(args, ++i, arg));
        break;
      case "--port":
      case "--server-port":
        options.port = Number(requireValue(args, ++i, arg));
        break;
      case "--ui-port":
        options.uiPort = Number(requireValue(args, ++i, arg));
        break;
      case "--scenario":
        options.scenario = requireValue(args, ++i, arg);
        options.interactive = false;
        break;
      case "--no-open":
        options.noOpen = true;
        break;
      case "--exit-after-scenario":
        options.exitAfterScenario = true;
        break;
      case "--retry-on-non-200":
        options.retryOnNon200 = true;
        break;
      case "--interactive":
        options.interactive = true;
        break;
      default:
        if (arg.startsWith("--target=")) options.targetUrl = arg.slice("--target=".length);
        else if (arg.startsWith("--secret=")) options.secret = arg.slice("--secret=".length);
        else if (arg.startsWith("--scenario=")) {
          options.scenario = arg.slice("--scenario=".length);
          options.interactive = false;
        } else {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }

  if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds < 5 || options.timeoutSeconds > 120) {
    throw new Error("--timeout must be between 5 and 120 seconds");
  }
  return options;
}

function parseChannel(value: string): "sms" | "voice" {
  if (value === "sms" || value === "voice") return value;
  throw new Error("channel must be sms or voice");
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function printHelp() {
  console.log(`AgentPhone DevTools

Usage:
  npx agentphone-devtools --target http://localhost:3000/webhook --secret whsec_demo
  npx agentphone-devtools --target http://localhost:3000/webhook --secret whsec_demo --scenario examples/scenarios/ev-support.yaml

Options:
  --target <url>             Webhook URL to receive simulated AgentPhone events
  --secret <secret>          Webhook signing secret
  --channel <sms|voice>      Interactive channel, default voice
  --scenario <path>          YAML or JSON scenario to replay
  --timeout <seconds>        Voice webhook timeout, default 30
  --context-limit <0-50>     recentHistory limit, default 10
  --server-port <port>       Simulator API port, default 4318
  --ui-port <port>           Inspector UI port, default 4319
  --retry-on-non-200         Retry non-200 responses with compressed backoff
  --no-open                  Do not open the browser
  --exit-after-scenario      Exit after scenario completes
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
