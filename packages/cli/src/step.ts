import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { collectObservedActions, loadScenarioFile } from "@agentphone-devtools/core";
import {
  detectVoiceSupport,
  DevtoolsRuntime,
  startPushToTalk,
  StepController,
  stringifyScenarioYaml,
  transcribeWav,
  type DevtoolsServerConfig,
  type InspectorDelivery,
  type StepState
} from "@agentphone-devtools/server";

const useColor = process.stdout.isTTY === true;
const paint = (code: string) => (text: string) => (useColor ? `[${code}m${text}[0m` : text);
const bold = paint("1");
const dim = paint("2");
const green = paint("32");
const red = paint("31");
const cyan = paint("36");

/**
 * Interactive turn-by-turn scenario runner: a readline shell over the same
 * StepController the Inspector API exposes, so the CLI and browser share one
 * stepping implementation. Line-based commands work both at a TTY and with
 * piped stdin (which is how debugger-demo.sh drives it).
 */
export async function runStepDebugger(config: DevtoolsServerConfig, scenarioPath: string): Promise<number> {
  const scenario = await loadScenarioFile(scenarioPath);
  const runtime = new DevtoolsRuntime(config);
  const step = new StepController(runtime);
  let state = step.startFromScenario(scenario);
  const exported: string[] = [];

  // Voice input is a developer convenience for dictating turns, not an
  // AgentPhone STT simulation. Missing tooling degrades to typed input.
  const voice = detectVoiceSupport();

  console.log(bold(`Step debugger: ${scenario.name}`));
  console.log(dim(`${scenario.channel} -> ${config.targetUrl} | ${state.queue.length} scripted turn(s)`));
  console.log(
    dim(
      `Commands: c send | e edit next | t <text> add turn |${voice.available ? " v speak next turn |" : ""} g/b [note] label last | fork <n> | x [path] export | state | q quit | help`
    )
  );

  const rl = new LineReader();
  let ended = false;

  try {
    while (!ended) {
      state = step.state();
      if (state.queue.length > 0) {
        const next = state.queue[0];
        console.log(`\n${cyan(`next [turn ${state.completedTurns + 1}]`)} caller: ${next.caller}${next.edited ? dim(" (edited)") : ""}`);
      } else {
        console.log(`\n${dim("No scripted turns left. `t <text>` adds one; `q` ends the call.")}`);
      }

      const raw = await rl.question("step> ");
      if (raw === null) break;
      const line = raw.trim();
      const [command, ...rest] = line.split(/\s+/);
      const argText = line.slice(command.length).trim();

      try {
        switch (command) {
          case "":
            break;
          case "c":
          case "continue": {
            console.log(dim(`sending turn ${state.completedTurns + 1}...`));
            const result = await step.sendNext();
            printDelivery(result.delivery, result.state.lastResult?.turnNumber ?? state.completedTurns + 1);
            printExpectations(result.state);
            printSnapshot(runtime, result.state, false);
            break;
          }
          case "e":
          case "edit": {
            const text = argText || (await rl.question("new caller text> "))?.trim();
            if (!text) {
              console.log(red("Kept the original text."));
              break;
            }
            step.editNext(text);
            break;
          }
          case "t":
          case "turn": {
            if (!argText) {
              console.log(red("Usage: t <caller text>"));
              break;
            }
            step.addTurn(argText);
            break;
          }
          case "g":
          case "good":
          case "b":
          case "bad": {
            const turnIndex = state.completedTurns - 1;
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
            if (!Number.isInteger(at) || at < 1 || at > state.completedTurns) {
              console.log(red(`Usage: fork <1..${state.completedTurns}> (completed turns)`));
              break;
            }
            const text = (await rl.question(`caller text for the new branch after turn ${at}> `))?.trim();
            if (!text) {
              console.log(red("Fork cancelled: a branch needs its next caller text."));
              break;
            }
            const source = runtime.getState().id;
            const forked = step.fork(at, { caller: text });
            console.log(green(`Forked ${source} after turn ${at} -> new run ${forked.sessionId}`));
            console.log(dim(`Checkpoint carried: ${at * 2} history turn(s) + conversationState. \`c\` sends the branch turn.`));
            break;
          }
          case "x":
          case "export": {
            const session = runtime.getState();
            const exportScenario = runtime.getScenarioExport(session.id, { scaffoldAssertions: true });
            if (!exportScenario || !exportScenario.turns.length) {
              console.log(red("Nothing to export yet."));
              break;
            }
            const path = resolve(argText || join(process.cwd(), ".agentphone-devtools", "exports", `${session.id}.yaml`));
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, stringifyScenarioYaml(exportScenario), "utf8");
            exported.push(path);
            console.log(green(`Exported ${exportScenario.turns.length} turn(s) with scaffolded assertions -> ${path}`));
            break;
          }
          case "v":
          case "voice": {
            if (!voice.available) {
              console.log(red(voice.reason ?? "Voice input is not available; keep typing turns as usual."));
              break;
            }
            // AGENTPHONE_DEVTOOLS_VOICE_WAV bypasses the microphone with a
            // prerecorded file — the scripted-demo and test hook.
            const prerecorded = process.env.AGENTPHONE_DEVTOOLS_VOICE_WAV;
            let wavPath: string;
            if (prerecorded) {
              wavPath = prerecorded;
              console.log(dim(`transcribing prerecorded audio: ${prerecorded}`));
            } else {
              const recording = startPushToTalk(voice);
              await rl.question(cyan("recording — press Enter to stop "));
              try {
                wavPath = await recording.stop();
              } catch (error) {
                console.log(red(error instanceof Error ? error.message : String(error)));
                break;
              }
              console.log(dim("transcribing..."));
            }
            const transcriptText = await transcribeWav(wavPath, voice);
            if (!transcriptText) {
              console.log(red("Heard nothing. Try again, or type the turn instead."));
              break;
            }
            if (step.state().queue.length > 0) step.editNext(transcriptText);
            else step.addTurn(transcriptText);
            console.log(`${green("heard:")} ${transcriptText} ${dim("(now the next turn — edit with `e`, send with `c`)")}`);
            break;
          }
          case "state": {
            printSnapshot(runtime, step.state(), true);
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
      } catch (error) {
        console.log(red(error instanceof Error ? error.message : String(error)));
      }
    }
  } finally {
    rl.close();
  }

  await step.end();
  const session = runtime.getState();
  console.log(`\n${bold("Session ended:")} ${session.id}`);
  console.log(`  turns: ${countUserTurns(session)} | deliveries: ${session.deliveries.length} | labels: ${session.turnLabels?.length ?? 0}`);
  if (session.forkedFrom) console.log(`  forked from: ${session.forkedFrom.sessionId} after turn ${session.forkedFrom.turnIndex}`);
  for (const path of exported) console.log(`  exported: ${path}`);
  console.log(dim(`  run history: ${config.historyPath}`));
  return 0;
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

function printExpectations(state: StepState): void {
  for (const expectation of state.lastResult?.expectResults ?? []) {
    const observed = expectation.observed.join(", ") || "none";
    console.log(
      `  expect  ${expectation.passed ? green("PASS") : red("FAIL")} action ${expectation.action}${expectation.passed ? "" : ` (observed: ${observed})`}`
    );
  }
}

function printSnapshot(runtime: DevtoolsRuntime, state: StepState, full: boolean): void {
  if (!state.checkpoint) return;
  console.log(
    `  ${cyan("checkpoint")} ${dim(`recentHistory: ${state.checkpoint.recentHistoryTurns} turn(s), conversationState: ${JSON.stringify(state.checkpoint.conversationState)}`)}`
  );
  const session = runtime.getState();
  if (session.forkedFrom) {
    console.log(`  ${cyan("lineage")}    ${dim(`forked from ${session.forkedFrom.sessionId} after turn ${session.forkedFrom.turnIndex}`)}`);
  }
  if (full) {
    for (const entry of runtime.conversationSnapshot().recentHistory) {
      console.log(`    ${dim(`${entry.direction === "inbound" ? "caller" : "agent "} |`)} ${entry.content}`);
    }
  }
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
