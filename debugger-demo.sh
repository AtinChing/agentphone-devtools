#!/usr/bin/env bash
#
# AgentPhone DevTools step-debugger demo: explore, fork, then lock it in.
#
#   1. Step through the appointment-cancellation scenario turn by turn,
#      editing turn 2's caller text mid-run (code -> deposit gate -> yes ->
#      cancelled -> hangup).
#   2. Label the closing turn good.
#   3. Fork from the turn-1 checkpoint into the wrong-code path and keep
#      giving bad codes until the agent escalates to a human transfer —
#      the attempt count is derived from the checkpoint's recentHistory,
#      so the escalation proves the state carry is exact.
#   4. Save the forked path as a scenario with assertions scaffolded from
#      the actions the handler actually returned (including the transfer).
#   5. Replay that exported scenario in the normal CI suite — it passes.
#
# The step session is driven by piped input so the run is deterministic.
# To drive it BY HAND instead, start the handler and run:
#
#   node packages/cli/dist/index.js --step \
#     --target http://localhost:<port>/webhook --secret whsec_demo \
#     --scenario examples/scenarios/appointment-cancellation.yaml
#
# Commands at the step> prompt:
#   c            send the next caller turn
#   e [text]     edit the next caller text before it is sent
#   t <text>     queue a new custom caller turn
#   g/b [note]   label the last turn good/bad (persisted in run history)
#   fork <n>     branch from the checkpoint after completed turn n
#   x [path]     export the current path as scenario YAML with assertions
#   state        dump the full checkpoint (recentHistory + conversationState)
#   q            end the call and quit

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

DESIRED_PORT="${DEMO_HANDLER_PORT:-41900}"
HANDLER_PORT="$DESIRED_PORT"
SECRET="whsec_demo"
SCENARIO="examples/scenarios/appointment-cancellation.yaml"
OUT_DIR=".agentphone-devtools/demo"
EXPORT_PATH="$OUT_DIR/fork-from-checkpoint.yaml"
CLI=(node "${REPO_ROOT}/packages/cli/dist/index.js")

HANDLER_PID=""

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }
step()  { echo; printf '\033[1;36m━━ %s ━━\033[0m\n' "$*"; echo; }

find_free_port() {
  node -e '
    const net = require("node:net");
    const start = Number(process.argv[1]);
    (async () => {
      for (let port = start; port < start + 50; port += 1) {
        const free = await new Promise((resolve) => {
          const probe = net.createServer();
          probe.once("error", () => resolve(false));
          probe.once("listening", () => probe.close(() => resolve(true)));
          probe.listen({ port, exclusive: true });
        });
        if (free) { console.log(port); return; }
      }
      process.exit(1);
    })();
  ' "$1"
}

cleanup() {
  if [[ -n "$HANDLER_PID" ]]; then
    kill "$HANDLER_PID" 2>/dev/null || true
    wait "$HANDLER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# ── Preflight ────────────────────────────────────────────────────────────────

if [[ ! -f packages/cli/dist/index.js || ! -f examples/handler-express/dist/index.js ]]; then
  step "Building (no dist/ found)"
  npm run build || { red "Build failed."; exit 1; }
fi

if ! HANDLER_PORT="$(find_free_port "$DESIRED_PORT")"; then
  red "No free port near ${DESIRED_PORT}. Re-run with DEMO_HANDLER_PORT=<port> ./debugger-demo.sh"
  exit 1
fi
[[ "$HANDLER_PORT" != "$DESIRED_PORT" ]] && dim "Port ${DESIRED_PORT} busy; handler will use ${HANDLER_PORT}."
TARGET_URL="http://localhost:${HANDLER_PORT}/webhook"

mkdir -p "$OUT_DIR"
rm -f "$EXPORT_PATH"

PORT="$HANDLER_PORT" AGENTPHONE_WEBHOOK_SECRET="$SECRET" \
  node examples/handler-express/dist/index.js >/dev/null 2>&1 &
HANDLER_PID=$!
for _ in $(seq 1 40); do
  curl -sf -m 1 "http://localhost:${HANDLER_PORT}/health" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -sf -m 1 "http://localhost:${HANDLER_PORT}/health" >/dev/null 2>&1 || { red "Handler did not start."; exit 1; }

# ── 1. The step session ──────────────────────────────────────────────────────

step "Step session: walk the happy path, then fork the wrong-code path"
dim "Scripted keystrokes are echoed after each step> prompt."
echo

printf '%s\n' \
  'c' \
  'e The code should be 4821.' \
  'c' \
  'c' \
  'c' \
  'g clean close' \
  'fork 1' \
  'My confirmation code is 4812.' \
  'c' \
  'b agent must not cancel on a wrong code' \
  't Maybe it is 9999.' \
  'c' \
  't Could it be 1234?' \
  'c' \
  "x ${EXPORT_PATH}" \
  'q' \
| "${CLI[@]}" --step --target "$TARGET_URL" --secret "$SECRET" --scenario "$SCENARIO"
STEP_EXIT=$?

if (( STEP_EXIT != 0 )) || [[ ! -f "$EXPORT_PATH" ]]; then
  red "Step session failed (exit ${STEP_EXIT}) or export missing."
  exit 1
fi

# ── 2. The exported fork ─────────────────────────────────────────────────────

step "The forked path, saved as a regression scenario"
cat "$EXPORT_PATH"
dim "Assertions were scaffolded from the actions the handler actually returned."

# ── 3. Replay it in the normal suite ─────────────────────────────────────────

step "Replaying the exported fork in the normal CI suite"
"${CLI[@]}" --ci --target "$TARGET_URL" --secret "$SECRET" --scenario "$EXPORT_PATH"
CI_EXIT=$?

echo
if (( CI_EXIT == 0 )); then
  green "exit ${CI_EXIT} — the forked path is now a passing regression scenario."
  echo
  green "Done: stepped the happy path (deposit gate included), forked from the"
  green "turn-1 checkpoint, escalated to a human transfer after three wrong"
  green "codes, saved the branch, and replayed it green in CI."
else
  red "Expected the exported scenario to pass (exit was ${CI_EXIT})."
  exit 1
fi
