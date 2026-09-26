#!/usr/bin/env bash
# SessionStart hook: put the build state in front of Claude at startup, resume, clear and compaction.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
echo "## Remit build state (from the SessionStart hook)"
if [ -f .agent/NEXT.md ]; then echo; echo "### .agent/NEXT.md"; cat .agent/NEXT.md; fi
if [ -f scripts/progress.mjs ]; then echo; echo "### Progress"; node scripts/progress.mjs 2>/dev/null || true; fi
if [ -f .agent/BLOCKERS.md ]; then echo; echo "### Open blockers"; grep -E '^- \[ \]' .agent/BLOCKERS.md | head -20 || true; fi
echo; echo "### Recent commits"; git log --oneline -5 2>/dev/null || echo "(no commits yet)"
echo; echo "Follow BUILD_PROMPT.md section 3. Never edit BUILD_PROMPT.md, GOAL.txt or loop.sh."
exit 0
