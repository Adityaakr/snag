#!/usr/bin/env bash
# Stop hook: if work is uncommitted, ask Claude to verify, update notes and commit before ending the turn.
input=$(cat)
active=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).stop_hook_active===true))}catch{process.stdout.write("false")}})')
[ "$active" = "true" ] && exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
dirty=$(git status --porcelain 2>/dev/null | grep -v '\.agent/loop-logs/' | head -1)
if [ -n "$dirty" ]; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"Uncommitted changes remain. Before ending: run pnpm verify, update .agent/PROGRESS.md and .agent/NEXT.md, then commit."}}'
fi
exit 0
