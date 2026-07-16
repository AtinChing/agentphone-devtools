import type { AgentResponseChunk, EvalResult, Scenario, ScenarioAssertion, ScenarioResult } from "./types.js";

export interface ScenarioTurnObservation {
  ok: boolean;
  status: number;
  timedOut?: boolean;
  responses: AgentResponseChunk[];
}

export interface ScenarioObservation {
  turns: ScenarioTurnObservation[];
  callEnded?: ScenarioTurnObservation;
  evalResult: EvalResult;
}

export function evaluateScenario(scenario: Scenario, observation: ScenarioObservation): ScenarioResult {
  const assertions: ScenarioAssertion[] = [];

  scenario.turns.forEach((turn, index) => {
    const observed = observation.turns[index];
    const deliveryPassed = observed?.ok === true && observed.timedOut !== true;
    assertions.push({
      kind: "delivery",
      passed: deliveryPassed,
      expected: "successful webhook delivery",
      observed: observed ? deliveryObservation(observed) : "no delivery",
      turnIndex: index,
      message: deliveryPassed
        ? `Turn ${index + 1} webhook delivery succeeded`
        : `Turn ${index + 1} webhook delivery failed (${observed ? deliveryObservation(observed) : "no delivery"})`
    });

    const expectedActions = turn.expect?.actions ?? [];
    const observedActions = collectObservedActions(observed?.responses ?? []);
    for (const expectedAction of expectedActions) {
      const passed = observedActions.includes(expectedAction);
      assertions.push({
        kind: "action",
        passed,
        expected: expectedAction,
        observed: observedActions.length ? observedActions.join(", ") : "none",
        turnIndex: index,
        message: passed
          ? `Turn ${index + 1} returned expected action ${expectedAction}`
          : `Turn ${index + 1} did not return expected action ${expectedAction}`
      });
    }
  });

  if (observation.callEnded) {
    const passed = observation.callEnded.ok && observation.callEnded.timedOut !== true;
    assertions.push({
      kind: "delivery",
      passed,
      expected: "successful call-ended webhook delivery",
      observed: deliveryObservation(observation.callEnded),
      message: passed
        ? "Call-ended webhook delivery succeeded"
        : `Call-ended webhook delivery failed (${deliveryObservation(observation.callEnded)})`
    });
  }

  if (scenario.expectedOutcome) {
    const passed = observation.evalResult.outcome === scenario.expectedOutcome;
    assertions.push({
      kind: "outcome",
      passed,
      expected: scenario.expectedOutcome,
      observed: observation.evalResult.outcome,
      message: passed
        ? `Observed expected outcome ${scenario.expectedOutcome}`
        : `Expected outcome ${scenario.expectedOutcome}, observed ${observation.evalResult.outcome}`
    });
  }

  const passedCount = assertions.filter((assertion) => assertion.passed).length;
  return {
    passed: passedCount === assertions.length,
    assertions,
    passedCount,
    failedCount: assertions.length - passedCount
  };
}

export function collectObservedActions(responses: AgentResponseChunk[]): string[] {
  return Array.from(
    new Set(
      responses.flatMap((response) => {
        const actions = [response.action, response.digits, response.press_digit, response.dtmf]
          .filter((value): value is string => typeof value === "string" && value.length > 0);
        if (typeof response.transferNumber === "string" && !actions.includes("transfer")) actions.push("transfer");
        if (response.hangup === true && !actions.includes("hangup")) actions.push("hangup");
        return actions;
      })
    )
  );
}

function deliveryObservation(observation: ScenarioTurnObservation): string {
  if (observation.timedOut) return "timeout";
  return observation.status > 0 ? `HTTP ${observation.status}` : "dispatch error";
}
