#!/usr/bin/env bash
#
# AgentPhone DevTools demo: catch a real agent regression in CI.
#
#   1. Run a multi-turn scenario against the example webhook handler -> green.
#   2. Approve that run as the regression baseline.
#   3. Break the handler so it stops returning the `hangup` action.
#   4. Re-run -> red, exit 1, with the exact regression named.
#   5. Show the JUnit report a CI system would ingest.
#
# The handler edit is reverted automatically on exit, including Ctrl-C.
#
# Usage:
#   ./demo.sh              # pauses between steps (for presenting)
#   ./demo.sh --no-pause   # runs straight through (for smoke testing)

# Deliberately no `set -e`: step 4 is *expected* to exit non-zero.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

HANDLER_SRC="examples/handler-express/src/index.ts"

# The example handler is the ONLY port this demo binds. `--ci` never starts the
# DevTools API (default 4318) or the inspector UI (default 4319). The default
# below is deliberately in a high, uncommon range so it does not collide with
# whatever else is running on a laptop; it auto-moves if it is busy anyway.
DESIRED_PORT="${DEMO_HANDLER_PORT:-41800}"
HANDLER_PORT="$DESIRED_PORT"  # resolved for real in preflight
TARGET_URL=""                 # set once the port is known
SECRET="whsec_demo"
SCENARIO="examples/scenarios/ev-support.yaml"
OUT_DIR=".agentphone-devtools/demo"

# Call the built CLI directly so the demo never depends on the npm registry.
# Equivalent published invocation: npx agentphone-devtools ...
CLI=(node "${REPO_ROOT}/packages/cli/dist/index.js")

PAUSE=1
[[ "${1:-}" == "--no-pause" ]] && PAUSE=0
[[ -t 0 ]] || PAUSE=0

BACKUP=""
HANDLER_PID=""

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }

step() {
  echo
  printf '\033[1;36m━━ %s ━━\033[0m\n' "$*"
  echo
}

pause() {
  (( PAUSE )) || return 0
  printf '\033[2m   [Enter to continue]\033[0m'
  read -r _ || true
  echo
}

run() {
  dim "\$ $*"
  echo
  "$@"
}

# First free port at or above $1. Probes with the same binding semantics the
# example handler uses (all interfaces), so a free result really is bindable.
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
        if (free) {
          console.log(port);
          return;
        }
      }
      process.exit(1);
    })();
  ' "$1"
}

transcript_of() {
  node -e '
    const fs = require("node:fs");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const turn of report.session.transcript) {
      console.log(`  ${turn.role.padEnd(5)} | ${turn.content}`);
    }
  ' "$1"
}

stop_handler() {
  [[ -n "$HANDLER_PID" ]] || return 0
  kill "$HANDLER_PID" 2>/dev/null || true
  wait "$HANDLER_PID" 2>/dev/null || true
  HANDLER_PID=""
}

start_handler() {
  PORT="$HANDLER_PORT" AGENTPHONE_WEBHOOK_SECRET="$SECRET" \
    node examples/handler-express/dist/index.js >/dev/null 2>&1 &
  HANDLER_PID=$!
  for _ in $(seq 1 40); do
    if curl -sf -m 1 "http://localhost:${HANDLER_PORT}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  red "Example handler did not become healthy on port ${HANDLER_PORT}."
  return 1
}

cleanup() {
  stop_handler
  if [[ -n "$BACKUP" && -f "$BACKUP" ]]; then
    cp "$BACKUP" "$HANDLER_SRC"
    rm -f "$BACKUP"
    npm --workspace examples/handler-express run build >/dev/null 2>&1
    echo
    green "Example handler restored to its original state."
  fi
}
trap cleanup EXIT INT TERM

# ── Preflight ────────────────────────────────────────────────────────────────

if ! HANDLER_PORT="$(find_free_port "$DESIRED_PORT")"; then
  red "No free port between ${DESIRED_PORT} and $((DESIRED_PORT + 49))."
  red "Re-run with an explicit port: DEMO_HANDLER_PORT=45000 ./demo.sh"
  exit 1
fi
if [[ "$HANDLER_PORT" != "$DESIRED_PORT" ]]; then
  dim "Port ${DESIRED_PORT} is busy; the example handler will use ${HANDLER_PORT} instead."
fi
TARGET_URL="http://localhost:${HANDLER_PORT}/webhook"

# dist/ is gitignored, so a fresh clone has no build output yet.
if [[ ! -f packages/cli/dist/index.js || ! -f examples/handler-express/dist/index.js ]]; then
  step "Building (no dist/ found)"
  run npm run build || { red "Build failed."; exit 1; }
fi

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.json "$OUT_DIR"/*.xml 2>/dev/null || true

start_handler || exit 1

# ── 1. Green run ─────────────────────────────────────────────────────────────

step "1/5  Run the scenario against a working handler"
cat "$SCENARIO"
echo
pause

run "${CLI[@]}" --ci \
  --target "$TARGET_URL" \
  --secret "$SECRET" \
  --scenario "$SCENARIO" \
  --report-json "$OUT_DIR/approved-baseline.json" \
  --report-junit "$OUT_DIR/green.xml"
GREEN_EXIT=$?

echo
if (( GREEN_EXIT == 0 )); then
  green "exit ${GREEN_EXIT} — all assertions passed."
else
  red "exit ${GREEN_EXIT} — expected a green run here. Is the example handler healthy?"
  exit 1
fi
pause

# ── 2. Approve as baseline ───────────────────────────────────────────────────

step "2/5  Approve that run as the regression baseline"
dim "The green report is the approved baseline artifact; CI diffs future runs against it."
echo
run ls -la "$OUT_DIR/approved-baseline.json"
pause

# ── 3. Break the handler ─────────────────────────────────────────────────────

step "3/5  Ship a regression: the agent stops hanging up"

BACKUP="$(mktemp)"
cp "$HANDLER_SRC" "$BACKUP"

# Drop only the hangup fields from the closing reply. The reply text is left
# untouched on purpose, so the transcript stays identical and the regression
# is invisible to anyone reading it.
perl -ni -e 'print unless /^\s*hangup: true,$/ || /^\s*action: "hangup"$/' "$HANDLER_SRC"

if grep -q "hangup" "$HANDLER_SRC"; then
  red "Could not apply the demo break to ${HANDLER_SRC}."
  exit 1
fi

run git --no-pager diff -- "$HANDLER_SRC"

dim "The agent still recognizes the caller wrapping up and still says exactly"
dim "the same goodbye. It just never hangs up — the line would stay open."
echo

npm --workspace examples/handler-express run build >/dev/null 2>&1 || { red "Rebuild failed."; exit 1; }
stop_handler
start_handler || exit 1
pause

# ── 4. Red run ───────────────────────────────────────────────────────────────

step "4/5  Re-run against the approved baseline"

run "${CLI[@]}" --ci \
  --target "$TARGET_URL" \
  --secret "$SECRET" \
  --scenario "$SCENARIO" \
  --baseline "$OUT_DIR/approved-baseline.json" \
  --report-json "$OUT_DIR/red.json" \
  --report-junit "$OUT_DIR/red.xml"
RED_EXIT=$?

echo
if (( RED_EXIT != 0 )) && grep -q "Missing baseline action(s): hangup" "$OUT_DIR/red.json" 2>/dev/null; then
  red "exit ${RED_EXIT} — regression caught:"
  echo
  bold "    Missing baseline action(s): hangup"
else
  red "Expected a failing run naming the missing hangup action (exit was ${RED_EXIT})."
  exit 1
fi
pause

step "     ...and here is why a human would have missed it"

echo "Approved run:"
transcript_of "$OUT_DIR/approved-baseline.json"
echo
echo "Regressed run:"
transcript_of "$OUT_DIR/red.json"
echo

if diff -q <(transcript_of "$OUT_DIR/approved-baseline.json") <(transcript_of "$OUT_DIR/red.json") >/dev/null 2>&1; then
  green "The two transcripts are identical, word for word."
  dim "Nothing to spot by reading. The agent said a perfect goodbye and then"
  dim "left the line open. Only the behavioral contract broke, and that is"
  dim "what failed the build."
else
  red "Transcripts differ — the demo break was supposed to leave them identical."
fi
pause

# ── 5. JUnit report ──────────────────────────────────────────────────────────

step "5/5  The JUnit report CI would ingest"
run cat "$OUT_DIR/red.xml"

echo
green "Done. Green -> approved baseline -> regression -> red build, fully local."
dim "No AgentPhone account, no phone number, no carrier traffic, no model calls."
echo
