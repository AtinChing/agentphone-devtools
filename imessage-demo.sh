#!/usr/bin/env bash
#
# AgentPhone DevTools iMessage demo: campaign forks, simulated time, and
# messaging compliance as a red/green gate.
#
#   1. Run the campaign suite -- one outbound opener, four customer
#      archetypes (interested, has a question, declines, replies 10 days
#      late), each a branch off the same send -> green, exit 0.
#   2. Step one branch turn by turn and time-travel: seed the opener, jump
#      the simulated clock 10 days, reply YES, watch the promo expire.
#   3. Break the handler's promo window -- a one-line change that only shows
#      up a week after launch. Re-run -> red, exit 1, naming the break.
#   4. Run the messaging compliance pack (STOP / HELP / START, no marketing
#      after opt-out) and show the JUnit artifact.
#
# Outbound campaign sends never hit the webhook: they go out through the
# send API and only the customer's reply reaches the handler, with the
# opener in recentHistory. The simulator models exactly that. The handler
# edit is reverted automatically on exit, including Ctrl-C.
#
# Usage:  ./imessage-demo.sh            # pauses between steps
#         ./imessage-demo.sh --no-pause # straight through

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

HANDLER_SRC="examples/handler-express/src/index.ts"
DESIRED_PORT="${DEMO_HANDLER_PORT:-41950}"
HANDLER_PORT="$DESIRED_PORT"
SECRET="whsec_demo"
OUT_DIR=".agentphone-devtools/imessage-demo"
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

restore_handler() {
  [[ -n "$BACKUP" && -f "$BACKUP" ]] || return 0
  cp "$BACKUP" "$HANDLER_SRC"
  rm -f "$BACKUP"
  BACKUP=""
  npm --workspace examples/handler-express run build >/dev/null 2>&1
}

cleanup() {
  stop_handler
  if [[ -n "$BACKUP" ]]; then
    restore_handler
    echo
    green "Handler restored to its correct state."
  fi
}
trap cleanup EXIT INT TERM

if [[ ! -f packages/cli/dist/index.js || ! -f examples/handler-express/dist/index.js ]]; then
  step "Building (no dist/ found)"
  run npm run build || { red "Build failed."; exit 1; }
fi

if ! HANDLER_PORT="$(find_free_port "$DESIRED_PORT")"; then
  red "No free port near ${DESIRED_PORT}. Re-run with DEMO_HANDLER_PORT=<port> ./imessage-demo.sh"
  exit 1
fi
TARGET_URL="http://localhost:${HANDLER_PORT}/webhook"
mkdir -p "$OUT_DIR"
find "${OUT_DIR:?}" -maxdepth 1 -type f \( -name '*.json' -o -name '*.xml' \) -delete 2>/dev/null || true
start_handler || exit 1

# ── 1. Green: four customers, one campaign send ──────────────────────────────

step "1/4  The campaign suite: one opener, four customer archetypes"
dim "examples/messaging/*.yaml — each scenario seeds the same outbound opener"
dim "(sent via the API, never through the webhook) and replies as a different"
dim "customer: YES after 2h, a question, a decline, YES ten days late."
echo
run "${CLI[@]}" --ci \
  --target "$TARGET_URL" --secret "$SECRET" \
  --scenario-dir examples/messaging/campaigns \
  --report-json "$OUT_DIR/campaign.json" \
  --report-junit "$OUT_DIR/campaign.xml"
GREEN_EXIT=$?
echo
if (( GREEN_EXIT == 0 )); then
  green "exit ${GREEN_EXIT} — every archetype handled, including the reply that arrives after the offer ended."
else
  red "Expected a green run (exit was ${GREEN_EXIT})."
  exit 1
fi
pause

# ── 2. Time travel in the step debugger ──────────────────────────────────────

step "2/4  Step one branch and jump the clock ten days"
dim "The debugger pauses before every turn. 'c' sends the next queued turn;"
dim "'warp 10d' moves the simulated clock (payload timestamps and history"
dim "times shift; the HMAC signing header stays real so the handler's replay"
dim "window still accepts the request)."
echo
printf 'c\nwarp 10d\nc\nq\n' | run "${CLI[@]}" --step \
  --target "$TARGET_URL" --secret "$SECRET" \
  --scenario examples/messaging/campaigns/campaign-interested.yaml
echo
dim "The scripted check expected FALL20 (the 2-hour branch). Ten days later"
dim "the same YES is promo_expired — the late-reply archetype in"
dim "examples/messaging/campaign-late-reply.yaml asserts exactly that."
pause

# ── 3. The regression that only shows up a week after launch ─────────────────

step "3/4  A refactor quietly disables the promo window"
BACKUP="$(mktemp)"
cp "$HANDLER_SRC" "$BACKUP"
perl -pi -e 's/const PROMO_WINDOW_MS = 7 \* 24/const PROMO_WINDOW_MS = 700 * 24/' "$HANDLER_SRC"
grep -q "PROMO_WINDOW_MS = 700" "$HANDLER_SRC" || { red "Could not apply the demo break."; exit 1; }
run git --no-pager diff -- "$HANDLER_SRC"
dim "Every live test still passes today: the bug only exists eight days after"
dim "the campaign goes out. Without a simulated clock nobody sees it until"
dim "customers do."
npm --workspace examples/handler-express run build >/dev/null 2>&1 || { red "Rebuild failed."; exit 1; }
stop_handler; start_handler || exit 1
echo
run "${CLI[@]}" --ci \
  --target "$TARGET_URL" --secret "$SECRET" \
  --scenario-dir examples/messaging/campaigns \
  --report-json "$OUT_DIR/red.json" \
  --report-junit "$OUT_DIR/red.xml"
RED_EXIT=$?
echo
if (( RED_EXIT != 0 )) && grep -q "promo_expired" "$OUT_DIR/red.json"; then
  red "exit ${RED_EXIT} — the late-reply branch went red in seconds, not in eight days:"
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
  red "Expected a failing run naming the promo-window break (exit was ${RED_EXIT})."
  exit 1
fi
restore_handler
stop_handler; start_handler || exit 1
pause

# ── 4. Messaging compliance ──────────────────────────────────────────────────

step "4/4  Messaging compliance: STOP / HELP / START and no marketing after opt-out"
run "${CLI[@]}" --ci \
  --target "$TARGET_URL" --secret "$SECRET" \
  --scenario examples/compliance/messaging-stop-keyword.yaml \
  --scenario examples/compliance/messaging-help-keyword.yaml \
  --scenario examples/compliance/messaging-start-resubscribe.yaml \
  --scenario examples/compliance/messaging-post-stop-no-marketing.yaml \
  --report-junit "$OUT_DIR/messaging-compliance.xml"
COMPLIANCE_EXIT=$?
echo
if (( COMPLIANCE_EXIT == 0 )); then
  green "exit ${COMPLIANCE_EXIT} — carrier keywords honored; an opted-out number asking a question five days later gets no offer."
else
  red "Expected a green compliance run (exit was ${COMPLIANCE_EXIT})."
  exit 1
fi
echo
run grep -c "testcase" "$OUT_DIR/messaging-compliance.xml"
echo
green "Done. Campaign branches, time travel, and messaging compliance — all from one webhook contract."
