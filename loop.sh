#!/usr/bin/env bash
# loop.sh: keeps Claude Code building Remit across fresh sessions until the
# build is done, you ask it to stop, or it stops making progress.
#
# Usage (from the repo root, next to BUILD_PROMPT.md and GOAL.txt):
#   ./loop.sh                                # up to 30 sessions
#   ./loop.sh 60                             # up to 60 sessions
#   PERMISSION_MODE=acceptEdits ./loop.sh    # if auto mode is not available to you
#
# Each session runs Claude Code headless with /goal and the condition in GOAL.txt.
# All state lives in git and .agent/, so every session starts with a fresh
# context and continues from .agent/NEXT.md.
#
# Watch the running session:  tail -f "$(ls -t .agent/loop-logs/*.jsonl | head -1)"
# Stop after this session:    touch .agent/STOP
# Stop right now:             Ctrl+C
#
# Tunables (environment variables):
#   PAUSE_SECONDS    pause between healthy sessions             (default 20)
#   BACKOFF_SECONDS  wait after a failed session, e.g. limits    (default 900)
#   STALL_LIMIT      healthy sessions in a row with no commits   (default 3)
#   FAIL_LIMIT       failed sessions in a row before giving up   (default 8)

set -uo pipefail

MAX_SESSIONS="${1:-30}"
PERMISSION_MODE="${PERMISSION_MODE:-auto}"
PAUSE_SECONDS="${PAUSE_SECONDS:-20}"
BACKOFF_SECONDS="${BACKOFF_SECONDS:-900}"
STALL_LIMIT="${STALL_LIMIT:-3}"
FAIL_LIMIT="${FAIL_LIMIT:-8}"
LOG_DIR=".agent/loop-logs"
GOAL_FILE="GOAL.txt"

die() { echo "loop.sh: $*" >&2; exit 2; }

case "$MAX_SESSIONS" in (''|*[!0-9]*) die "The first argument must be a number of sessions." ;; esac
command -v claude >/dev/null 2>&1 || die "Claude Code (claude) is not installed or not on PATH."
command -v node >/dev/null 2>&1 || die "Node.js is not installed. Install Node 22 LTS."
command -v git >/dev/null 2>&1 || die "git is not installed."
[ -f BUILD_PROMPT.md ] || die "Run this from the repo root, next to BUILD_PROMPT.md."
[ -f "$GOAL_FILE" ] || die "Missing $GOAL_FILE."
goal_chars=$(wc -c < "$GOAL_FILE" | tr -d ' ')
[ "$goal_chars" -le 4000 ] || die "$GOAL_FILE has $goal_chars characters; /goal accepts at most 4000."

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || git init -q
mkdir -p "$LOG_DIR"

build_done() { [ -f scripts/progress.mjs ] && node scripts/progress.mjs --check >/dev/null 2>&1; }
head_sha() { git rev-parse -q --verify HEAD 2>/dev/null || echo none; }
commits_between() {
  if [ "$1" = none ]; then git rev-list --count HEAD 2>/dev/null || echo 0
  else git rev-list --count "$1..$2" 2>/dev/null || echo 0; fi
}

stalls=0
fails=0
for ((i = 1; i <= MAX_SESSIONS; i++)); do
  if [ -f .agent/STOP ]; then echo "Found .agent/STOP. Stopping."; exit 0; fi
  if build_done; then break; fi

  stamp=$(date +%Y%m%d-%H%M%S)
  log="$LOG_DIR/session-$i-$stamp.jsonl"
  before=$(head_sha)
  echo "=== session $i of $MAX_SESSIONS, started $stamp, log: $log"

  claude -p "/goal $(cat "$GOAL_FILE")" \
    --permission-mode "$PERMISSION_MODE" \
    --permission-prompts none \
    --output-format stream-json --verbose \
    >"$log" 2>"$log.stderr"
  status=$?

  if command -v jq >/dev/null 2>&1; then
    cost=$(jq -r 'select(.type == "result") | .total_cost_usd // empty' "$log" 2>/dev/null | tail -1)
    [ -n "$cost" ] && echo "    session cost (client-side estimate): \$$cost"
  fi

  after=$(head_sha)
  if [ "$before" != "$after" ]; then
    stalls=0
    fails=0
    echo "    exit $status, new commits: $(commits_between "$before" "$after")"
  elif [ "$status" -ne 0 ]; then
    fails=$((fails + 1))
    echo "    exit $status, no new commits (failed sessions in a row: $fails)"
  else
    stalls=$((stalls + 1))
    echo "    exit $status, no new commits (healthy sessions without progress in a row: $stalls)"
  fi

  if [ "$stalls" -ge "$STALL_LIMIT" ]; then
    echo "No progress in $stalls sessions. Stopping so you can check .agent/NEXT.md, .agent/BLOCKERS.md and $LOG_DIR."
    exit 1
  fi
  if [ "$fails" -ge "$FAIL_LIMIT" ]; then
    echo "$fails failed sessions in a row. Check the newest $LOG_DIR/*.stderr file, then run ./loop.sh again."
    exit 1
  fi

  if [ "$status" -ne 0 ]; then
    echo "    non-zero exit (often a usage or rate limit); waiting ${BACKOFF_SECONDS}s"
    sleep "$BACKOFF_SECONDS"
  else
    sleep "$PAUSE_SECONDS"
  fi
done

if build_done; then
  echo "Build loop finished: every required milestone is terminal."
  echo "Start with docs/HANDOFF.md, then .agent/BLOCKERS.md for anything that needs you."
  exit 0
fi
echo "Reached $MAX_SESSIONS sessions before finishing. The next action is in .agent/NEXT.md. Run ./loop.sh again to continue."
exit 1
