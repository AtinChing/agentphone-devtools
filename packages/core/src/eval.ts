import type { AgentResponseChunk, EvalInput, EvalResult } from "./types.js";

export function evaluateConversation(input: EvalInput): EvalResult {
  const responses = input.responses ?? [];
  const deadAirTurns = input.deadAirTurns ?? countDeadAir(responses);
  const reasons: string[] = [];
  const handedOff = responses.some(isTransfer);
  const explicitHangup = responses.some((response) => response.action === "hangup" || response.hangup === true);
  const callSuccessful = input.callEnded?.callSuccessful;

  let outcome: EvalResult["outcome"];
  if (handedOff) {
    outcome = "handed_off";
    reasons.push("handler requested transfer");
  } else if (callSuccessful === true) {
    outcome = "resolved";
    reasons.push("call-ended analysis marked callSuccessful=true");
  } else if (callSuccessful === false) {
    outcome = "failed";
    reasons.push("call-ended analysis marked callSuccessful=false");
  } else if (deadAirTurns > 0) {
    outcome = "failed";
    reasons.push(`${deadAirTurns} turn(s) produced dead air`);
  } else if (explicitHangup && hasResolutionLanguage(input)) {
    outcome = "resolved";
    reasons.push("handler ended the call after resolution language");
  } else if (hasResolutionLanguage(input)) {
    outcome = "resolved";
    reasons.push("transcript contains resolution language");
  } else {
    outcome = "failed";
    reasons.push("no resolution, handoff, or success signal was found");
  }

  const stayedOnTask = inferStayedOnTask(input);
  if (!stayedOnTask) reasons.push("transcript appears to drift off the user's stated task");

  const correctActions = scoreExpectedActions(input.expectedActions, responses);
  if (correctActions === false) reasons.push("expected action was not observed in handler responses");

  if (input.expectedOutcome && input.expectedOutcome !== outcome) {
    reasons.push(`expected outcome was ${input.expectedOutcome}, observed ${outcome}`);
  }

  const score = scoreResult({ outcome, stayedOnTask, correctActions, expectedOutcome: input.expectedOutcome, deadAirTurns });

  return {
    outcome,
    stayedOnTask,
    correctActions,
    score,
    reasons,
    metrics: {
      turnCount: input.transcript.length,
      agentTurns: input.transcript.filter((turn) => turn.role === "agent").length,
      userTurns: input.transcript.filter((turn) => turn.role === "user").length,
      deadAirTurns,
      durationSeconds: input.callEnded?.durationSeconds
    }
  };
}

export function maybeEvaluateWithLlm(input: EvalInput): EvalResult & { judge: "deterministic" | "llm_unavailable" } {
  const result = evaluateConversation(input);
  const hasProvider = Boolean(process.env.AGENTPHONE_DEVTOOLS_LLM_PROVIDER && process.env.AGENTPHONE_DEVTOOLS_LLM_API_KEY);
  return {
    ...result,
    judge: hasProvider ? "llm_unavailable" : "deterministic",
    reasons: hasProvider
      ? [...result.reasons, "LLM judge is intentionally not called by default in this local zero-cost build"]
      : result.reasons
  };
}

function countDeadAir(responses: AgentResponseChunk[]): number {
  return responses.filter((response) => !response.text && !response.action && !response.hangup && !response.digits && !response.press_digit && !response.dtmf).length;
}

function isTransfer(response: AgentResponseChunk): boolean {
  return response.action === "transfer" || typeof response.transferNumber === "string";
}

function hasResolutionLanguage(input: EvalInput): boolean {
  const text = [
    ...input.transcript.map((turn) => turn.content),
    ...(input.responses ?? []).map((response) => String(response.text ?? ""))
  ]
    .join(" ")
    .toLowerCase();
  return /\b(resolved|all set|fixed|scheduled|confirmed|complete|done|you're good|you are good|thanks|thank you)\b/.test(text);
}

function inferStayedOnTask(input: EvalInput): boolean {
  const userText = input.transcript
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content.toLowerCase())
    .join(" ");
  const agentText = input.transcript
    .filter((turn) => turn.role === "agent")
    .map((turn) => turn.content.toLowerCase())
    .join(" ");

  if (!userText || !agentText) return true;
  const taskWords = importantWords(userText);
  if (taskWords.length === 0) return true;
  const overlap = taskWords.filter((word) => agentText.includes(word)).length;
  return overlap / taskWords.length >= 0.25;
}

function importantWords(text: string): string[] {
  const stop = new Set(["the", "and", "for", "with", "that", "this", "need", "help", "please", "about", "have", "from", "your", "you"]);
  return Array.from(
    new Set(
      text
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 3 && !stop.has(word))
    )
  ).slice(0, 12);
}

function scoreExpectedActions(expectedActions: string[] | undefined, responses: AgentResponseChunk[]): boolean | null {
  if (!expectedActions || expectedActions.length === 0) return null;
  const observed = responses.flatMap((response) => [response.action, response.digits, response.press_digit, response.dtmf]).filter(Boolean).map(String);
  return expectedActions.every((expected) => observed.includes(expected));
}

function scoreResult(input: {
  outcome: EvalResult["outcome"];
  stayedOnTask: boolean;
  correctActions: boolean | null;
  expectedOutcome?: EvalResult["outcome"];
  deadAirTurns: number;
}): number {
  let score = 0;
  if (input.outcome === "resolved") score += 50;
  if (input.outcome === "handed_off") score += 30;
  if (input.expectedOutcome && input.outcome === input.expectedOutcome) score += 20;
  if (input.stayedOnTask) score += 20;
  if (input.correctActions === true) score += 10;
  if (input.correctActions === null) score += 5;
  score -= Math.min(20, input.deadAirTurns * 10);
  return Math.max(0, Math.min(100, score));
}
