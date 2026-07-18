import type { AgentResponseChunk, EvalResult, Scenario, ScenarioAssertion, ScenarioResult } from "./types.js";

export interface ScenarioTurnObservation {
  ok: boolean;
  status: number;
  timedOut?: boolean;
  retries?: number;
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
    const hasDeliveryExpectation =
      turn.expect?.status !== undefined || turn.expect?.timedOut !== undefined || turn.expect?.retries !== undefined;
    if (!hasDeliveryExpectation) {
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
    }

    if (turn.expect?.status !== undefined) {
      const passed = observed?.status === turn.expect.status;
      assertions.push({
        kind: "delivery",
        passed,
        expected: `HTTP ${turn.expect.status}`,
        observed: observed ? deliveryObservation(observed) : "no delivery",
        turnIndex: index,
        message: passed
          ? `Turn ${index + 1} returned expected HTTP ${turn.expect.status}`
          : `Turn ${index + 1} expected HTTP ${turn.expect.status}, observed ${observed ? deliveryObservation(observed) : "no delivery"}`
      });
    }

    if (turn.expect?.timedOut !== undefined) {
      const passed = Boolean(observed?.timedOut) === turn.expect.timedOut;
      assertions.push({
        kind: "delivery",
        passed,
        expected: turn.expect.timedOut ? "timeout" : "no timeout",
        observed: observed?.timedOut ? "timeout" : "no timeout",
        turnIndex: index,
        message: passed
          ? `Turn ${index + 1} ${turn.expect.timedOut ? "timed out as expected" : "did not time out"}`
          : `Turn ${index + 1} timeout expectation was not met`
      });
    }

    if (turn.expect?.retries !== undefined) {
      const observedRetries = observed?.retries ?? 0;
      const passed = observedRetries === turn.expect.retries;
      assertions.push({
        kind: "delivery",
        passed,
        expected: `${turn.expect.retries} retries`,
        observed: `${observedRetries} retries`,
        turnIndex: index,
        message: passed
          ? `Turn ${index + 1} retried ${observedRetries} time(s) as expected`
          : `Turn ${index + 1} expected ${turn.expect.retries} retries, observed ${observedRetries}`
      });
    }

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
