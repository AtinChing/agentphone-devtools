#!/usr/bin/env bash
#
# AgentPhone DevTools compliance demo: regulatory behavior as a red/green gate.
#
#   1. Run the compliance suite (opt-out honoring, AI disclosure, human
#      escalation) against the reference handler -> green, exit 0.
#   2. Break the handler's opt-out rule -- the agent silently stops honoring
#      "stop calling me". A one-line change nobody would catch in review.
#   3. Re-run -> red, exit 1, naming exactly which obligation broke.
#   4. Show the JUnit report a CI system (or an auditor) would ingest.
#
# Compliance for a voice agent is runtime behavior, not a policy document --
# and behavior that is not regression-tested will regress. The handler edit
# is reverted automatically on exit, including Ctrl-C.
#
# Usage:  ./compliance-demo.sh            # pauses between steps
#         ./compliance-demo.sh --no-pause # straight through

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

HANDLER_SRC="examples/handler-express/src/index.ts"
DESIRED_PORT="${DEMO_HANDLER_PORT:-41850}"
HANDLER_PORT="$DESIRED_PORT"
SECRET="whsec_demo"
OUT_DIR=".agentphone-devtools/compliance-demo"
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
step()  { echo; printf '\033[1;36m━━ %s ━━\033[0m\n' "$*"; echo; }
pause() { (( PAUSE )) || return 0; printf '\033[2m   [Enter to continue]\033[0m'; read -r _ || true; echo; }
run()   { dim "\$ $*"; echo; "$@"; }

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
    curl -sf -m 1 "http://localhost:${HANDLER_PORT}/health" >/dev/null 2>&1 && return 0
    sleep 0.25
  done
  red "Handler did not become healthy on port ${HANDLER_PORT}."
  return 1
}

cleanup() {
  stop_handler
  if [[ -n "$BACKUP" && -f "$BACKUP" ]]; then
    cp "$BACKUP" "$HANDLER_SRC"
    rm -f "$BACKUP"
    npm --workspace examples/handler-express run build >/dev/null 2>&1
    echo
    green "Handler restored to its compliant state."
  fi
}
trap cleanup EXIT INT TERM

if [[ ! -f packages/cli/dist/index.js || ! -f examples/handler-express/dist/index.js ]]; then
  step "Building (no dist/ found)"
  run npm run build || { red "Build failed."; exit 1; }
fi

if ! HANDLER_PORT="$(find_free_port "$DESIRED_PORT")"; then
  red "No free port near ${DESIRED_PORT}. Re-run with DEMO_HANDLER_PORT=<port> ./compliance-demo.sh"
  exit 1
fi
TARGET_URL="http://localhost:${HANDLER_PORT}/webhook"
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.json "$OUT_DIR"/*.xml 2>/dev/null || true
start_handler || exit 1

# ── 1. Green: the agent meets its obligations ────────────────────────────────

step "1/4  The compliance suite: opt-out, AI disclosure, human escalation"
run "${CLI[@]}" --ci \
  --target "$TARGET_URL" --secret "$SECRET" \
  --scenario-dir examples/compliance \
  --report-json "$OUT_DIR/compliance.json" \
  --report-junit "$OUT_DIR/compliance.xml"
GREEN_EXIT=$?
echo
if (( GREEN_EXIT == 0 )); then
  green "exit ${GREEN_EXIT} — every obligation verified, artifact written for the audit trail."
else
  red "Expected a green run (exit was ${GREEN_EXIT})."
  exit 1
fi
pause

# ── 2. The regression nobody would catch in review ──────────────────────────

step "2/4  A refactor quietly breaks opt-out handling"
BACKUP="$(mktemp)"
cp "$HANDLER_SRC" "$BACKUP"
perl -pi -e 's/stop calling\|do not call/zzz_optout_disabled/' "$HANDLER_SRC"
grep -q "zzz_optout_disabled" "$HANDLER_SRC" || { red "Could not apply the demo break."; exit 1; }
run git --no-pager diff -- "$HANDLER_SRC"
dim "The agent still answers politely. It just no longer recognizes"
dim "\"stop calling me\" — a TCPA violation on every affected call."
npm --workspace examples/handler-express run build >/dev/null 2>&1 || { red "Rebuild failed."; exit 1; }
stop_handler; start_handler || exit 1
pause

# ── 3. Red: the gate catches it ──────────────────────────────────────────────

step "3/4  Same suite, post-refactor"
run "${CLI[@]}" --ci \
  --target "$TARGET_URL" --secret "$SECRET" \
  --scenario-dir examples/compliance \
  --report-json "$OUT_DIR/red.json" \
  --report-junit "$OUT_DIR/red.xml"
RED_EXIT=$?
echo
if (( RED_EXIT != 0 )) && grep -q "opt_out" "$OUT_DIR/red.json"; then
  red "exit ${RED_EXIT} — compliance regression caught before it shipped:"
  echo
  python3 -c "
import json
report = json.load(open('$OUT_DIR/red.json'))
for run in report['runs']:
    for a in run['session'].get('scenarioResult', {}).get('assertions', []):
        if not a['passed']:
            print('    FAIL  ' + a['message'])
"
else
  red "Expected a failing run naming the opt-out break (exit was ${RED_EXIT})."
  exit 1
fi
pause

# ── 4. The artifact ──────────────────────────────────────────────────────────

step "4/4  The JUnit artifact CI and auditors ingest"
run grep -B1 -A2 "failure" "$OUT_DIR/red.xml" | head -20
echo
green "Done. A one-line refactor became a red build instead of a TCPA violation."
