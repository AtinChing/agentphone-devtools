import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";
import {
  collectObservedActions,
  loadScenarioFile,
  type Scenario,
  type ScenarioTurn
} from "@agentphone-devtools/core";
import {
  DevtoolsRuntime,
  stringifyScenarioYaml,
  type DevtoolsServerConfig,
  type InspectorDelivery
} from "@agentphone-devtools/server";

interface PendingTurn {
  caller: string;
  expect?: ScenarioTurn["expect"];
  edited?: boolean;
}

const useColor = process.stdout.isTTY === true;
const paint = (code: string) => (text: string) => (useColor ? `[${code}m${text}[0m` : text);
const bold = paint("1");
const dim = paint("2");
const green = paint("32");
const red = paint("31");
const cyan = paint("36");

/**
 * Interactive turn-by-turn scenario runner. Line-based commands so it works
 * both at a TTY and with piped stdin (which is how debugger-demo.sh drives it).
 */
export async function runStepDebugger(config: DevtoolsServerConfig, scenarioPath: string): Promise<number> {
  const scenario = await loadScenarioFile(scenarioPath);
  const runtime = new DevtoolsRuntime(config);
  runtime.reset({
    channel: scenario.channel,
    timeoutSeconds: scenario.timeoutSeconds,
    contextLimit: scenario.contextLimit,
    conversationState: scenario.conversationState
  });

  const queue: PendingTurn[] = scenario.turns.map((turn) => ({
    caller: turn.caller,
    ...(turn.expect ? { expect: turn.expect } : {})
  }));
  const exported: string[] = [];

  console.log(bold(`Step debugger: ${scenario.name}`));
  console.log(dim(`${scenario.channel} -> ${config.targetUrl} | ${queue.length} scripted turn(s)`));
  console.log(dim("Commands: c send | e edit next | t <text> add turn | g/b [note] label last | fork <n> | x [path] export | state | q quit | help"));

  const rl = new LineReader();
  let ended = false;

  try {
    while (!ended) {
      const completed = completedTurns(runtime);
      if (queue.length > 0) {
        console.log(`\n${cyan(`next [turn ${completed + 1}]`)} caller: ${queue[0].caller}${queue[0].edited ? dim(" (edited)") : ""}`);
      } else {
        console.log(`\n${dim("No scripted turns left. `t <text>` adds one; `q` ends the call.")}`);
      }

      const raw = await rl.question("step> ");
      if (raw === null) break;
      const line = raw.trim();
      const [command, ...rest] = line.split(/\s+/);
      const argText = line.slice(command.length).trim();

      switch (command) {
        case "":
          break;
        case "c":
        case "continue": {
          const pending = queue.shift();
          if (!pending) {
            console.log(red("Nothing queued. `t <text>` adds a turn."));
            break;
          }
          await sendTurn(runtime, scenario, pending);
          break;
        }
        case "e":
        case "edit": {
          if (!queue.length) {
            console.log(red("Nothing queued to edit."));
            break;
          }
          const text = argText || (await rl.question("new caller text> "))?.trim();
          if (!text) {
            console.log(red("Kept the original text."));
            break;
          }
          queue[0] = { ...queue[0], caller: text, edited: true };
          break;
        }
        case "t":
        case "turn": {
          if (!argText) {
            console.log(red("Usage: t <caller text>"));
            break;
          }
          queue.push({ caller: argText });
          break;
        }
        case "g":
        case "good":
        case "b":
        case "bad": {
          const turnIndex = completedTurns(runtime) - 1;
          if (turnIndex < 0) {
            console.log(red("No completed turn to label yet."));
            break;
          }
          const verdict = command.startsWith("g") ? "good" : "bad";
          runtime.setTurnLabel(runtime.getState().id, {
            turnIndex,
            verdict,
            ...(argText ? { note: argText } : {})
          });
          console.log(`${verdict === "good" ? green("labeled good") : red("labeled bad")}: turn ${turnIndex + 1}${argText ? ` — ${argText}` : ""}`);
          break;
        }
        case "fork": {
          const at = Number(rest[0]);
          const total = completedTurns(runtime);
          if (!Number.isInteger(at) || at < 1 || at > total) {
            console.log(red(`Usage: fork <1..${total}> (completed turns)`));
            break;
          }
          const text = (await rl.question(`caller text for the new branch after turn ${at}> `))?.trim();
          if (!text) {
            console.log(red("Fork cancelled: a branch needs its next caller text."));
            break;
          }
          const source = runtime.getState().id;
          const forked = runtime.forkFromSession(source, at);
          queue.length = 0; // the branch diverges; scripted turns no longer apply
          queue.push({ caller: text });
          console.log(green(`Forked ${source} after turn ${at} -> new run ${forked.id}`));
          console.log(dim(`Checkpoint carried: ${at * 2} history turn(s) + conversationState. \`c\` sends the branch turn.`));
          break;
        }
        case "x":
        case "export": {
          const state = runtime.getState();
          const exportScenario = runtime.getScenarioExport(state.id, { scaffoldAssertions: true });
          if (!exportScenario) {
            console.log(red("Nothing to export yet."));
            break;
          }
          const path = resolve(
            argText || join(process.cwd(), ".agentphone-devtools", "exports", `${state.id}.yaml`)
          );
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, stringifyScenarioYaml(exportScenario), "utf8");
          exported.push(path);
          console.log(green(`Exported ${countUserTurns(state)} turn(s) with scaffolded assertions -> ${path}`));
          break;
        }
        case "state": {
          printSnapshot(runtime, true);
          break;
        }
        case "help":
        case "?": {
          console.log("c: send next | e [text]: edit next | t <text>: queue turn | g/b [note]: label last turn");
          console.log("fork <n>: branch after completed turn n | x [path]: export scenario | state | q: end call and quit");
          break;
        }
        case "q":
        case "quit": {
          ended = true;
          break;
        }
        default:
          console.log(red(`Unknown command: ${command} (try \`help\`)`));
      }
    }
  } finally {
    rl.close();
  }

  await runtime.endCall();
  const state = runtime.getState();
  console.log(`\n${bold("Session ended:")} ${state.id}`);
  console.log(`  turns: ${countUserTurns(state)} | deliveries: ${state.deliveries.length} | labels: ${state.turnLabels?.length ?? 0}`);
  if (state.forkedFrom) console.log(`  forked from: ${state.forkedFrom.sessionId} after turn ${state.forkedFrom.turnIndex}`);
  for (const path of exported) console.log(`  exported: ${path}`);
  console.log(dim(`  run history: ${config.historyPath}`));
  return 0;
}

async function sendTurn(runtime: DevtoolsRuntime, scenario: Scenario, pending: PendingTurn): Promise<void> {
  const turnNumber = completedTurns(runtime) + 1;
  console.log(dim(`sending turn ${turnNumber}...`));
  const delivery = await runtime.sendCallerTurn(pending.caller, scenario.channel);
  printDelivery(delivery, turnNumber);
  checkExpectations(pending, delivery);
  printSnapshot(runtime, false);
}

function printDelivery(delivery: InspectorDelivery, turnNumber: number): void {
  const status = delivery.timedOut ? red("TIMEOUT") : delivery.ok ? green(`HTTP ${delivery.response.status}`) : red(`HTTP ${delivery.response.status}`);
  console.log(`${bold(`turn ${turnNumber}`)}  ${status}  ${delivery.latencyMs}ms${delivery.retries ? `  retries: ${delivery.retries}` : ""}`);
  const body = delivery.request.body;
  const sentText = body.channel === "voice" ? (body.data as { transcript?: string }).transcript : (body.data as { message?: string }).message;
  console.log(`  sent    ${dim(`${body.event} |`)} ${sentText ?? ""}`);
  console.log(`  payload ${dim(`recentHistory: ${(body.recentHistory ?? []).length} turn(s), conversationState: ${JSON.stringify(body.conversationState)}`)}`);
  const reply = delivery.response.parsed.final?.text ?? delivery.response.parsed.chunks.find((chunk) => chunk.text && !chunk.interim)?.text;
  console.log(`  agent   ${reply ?? dim("(no text)")}`);
  const actions = collectObservedActions(delivery.response.parsed.chunks);
  console.log(`  actions ${actions.length ? actions.join(", ") : dim("none")}`);
  for (const warning of delivery.warnings) console.log(`  ${red("warning")} ${warning}`);
}

function checkExpectations(pending: PendingTurn, delivery: InspectorDelivery): void {
  const expectedActions = pending.expect?.actions;
  if (!expectedActions?.length) return;
  const observed = collectObservedActions(delivery.response.parsed.chunks);
  for (const expected of expectedActions) {
    const hit = observed.includes(expected);
    console.log(`  expect  ${hit ? green("PASS") : red("FAIL")} action ${expected}${hit ? "" : ` (observed: ${observed.join(", ") || "none"})`}`);
  }
}

function printSnapshot(runtime: DevtoolsRuntime, full: boolean): void {
  const snapshot = runtime.conversationSnapshot();
  const state = runtime.getState();
  console.log(`  ${cyan("checkpoint")} ${dim(`recentHistory: ${snapshot.recentHistory.length} turn(s), conversationState: ${JSON.stringify(snapshot.conversationState)}`)}`);
  if (state.forkedFrom) console.log(`  ${cyan("lineage")}    ${dim(`forked from ${state.forkedFrom.sessionId} after turn ${state.forkedFrom.turnIndex}`)}`);
  if (full) {
    for (const entry of snapshot.recentHistory) {
      console.log(`    ${dim(`${entry.direction === "inbound" ? "caller" : "agent "} |`)} ${entry.content}`);
    }
  }
}

function completedTurns(runtime: DevtoolsRuntime): number {
  return countUserTurns(runtime.getState());
}

function countUserTurns(state: { transcript: Array<{ role: string }> }): number {
  return state.transcript.filter((turn) => turn.role === "user").length;
}

/**
 * Buffering line reader. Plain readline drops lines that arrive while no
 * question is pending, which loses most of a piped script (every command
 * after the first arrives while the previous turn's webhook is in flight).
 * This queues early lines and hands them out in order; at a TTY it behaves
 * like a normal prompt. Resolves null on EOF.
 */
class LineReader {
  private readonly rl: Interface;
  private readonly buffered: string[] = [];
  private readonly waiters: Array<(value: string | null) => void> = [];
  private closed = false;

  constructor() {
    this.rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
    this.rl.on("line", (line) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter(line);
      else this.buffered.push(line);
    });
    this.rl.on("close", () => {
      this.closed = true;
      for (const waiter of this.waiters.splice(0)) waiter(null);
    });
  }

  question(prompt: string): Promise<string | null> {
    const next = this.buffered.shift();
    if (next !== undefined) {
      // Echo scripted input after the prompt so a piped transcript reads
      // like an interactive session.
      process.stdout.write(`${prompt}${next}\n`);
      return Promise.resolve(next);
    }
    if (this.closed) return Promise.resolve(null);
    process.stdout.write(prompt);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    this.rl.close();
  }
}
