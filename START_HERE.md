# Start here

This kit gets Claude Code to build **Remit** (working name). Remit is a reviewer that checks whether an agent-written PR actually does what its issue asked. Claude Code works through the build milestone by milestone and keeps going across sessions until it's done.

## What's in the kit

| File | What it is |
|---|---|
| `BUILD_PROMPT.md` | The full spec and operating manual that Claude Code follows |
| `GOAL.txt` | The completion condition for Claude Code's `/goal` |
| `loop.sh` | Restarts Claude Code in fresh sessions until the goal is met |
| `START_HERE.md` | This file |

Don't edit these files once the build starts. A guard checks their hashes, so any change makes the build's own checks fail.

## Before you start (about 10 minutes)

1. **Update Claude Code:** `claude update`. The loop needs `/goal` and auto mode.
2. **Set up the folder:** create an empty folder, put the four files in it, then run `git init` and `chmod +x loop.sh`.
3. **Install the TypeSafe skill,** so Claude Code knows the Jev API:

   ```bash
   claude plugin marketplace add typesafe-ai/skills
   claude plugin install typesafe@typesafe-ai
   ```

4. **Add your keys (recommended):** put them in a `.env` file in the folder. Claude Code is told never to read `.env`; the app loads it at runtime.

   ```bash
   TYPESAFE_API_KEY=...
   ANTHROPIC_API_KEY=...
   GITHUB_TOKEN=...   # a read-only fine-grained token is enough
   ```

   Without keys, the build still completes using fakes and recorded data. Only the live evaluation milestone (M10) waits for you.

## Run it

**Watch it** (recommended for the first milestone):
1. Run `claude` in the folder.
2. Type `/goal`, add a space, paste the contents of `GOAL.txt`, and press Enter.

**Leave it running:** run `./loop.sh 40`, ideally inside tmux.
- Each session writes a log to `.agent/loop-logs/`.
- `.agent/PROGRESS.md` shows where the build is.
- `.agent/NEXT.md` shows what it's doing next.

**Stop it:**
- Ctrl+C stops immediately.
- `touch .agent/STOP` stops after the current session.

If auto mode isn't available on your account, run `PERMISSION_MODE=acceptEdits ./loop.sh` instead.

## Things only you can do

The agent records these in `.agent/BLOCKERS.md` and keeps working on everything else.

- **API keys,** if you skipped them.
- **Register the GitHub App.** After M7, run `pnpm dev:server` and open `/setup` for the one-click manifest flow. For local testing, point `PUBLIC_URL` at a webhook proxy such as smee.io.
- **A sandbox repository** for live end-to-end tests.
- **Deployment** credentials and a domain.
- **A license and the final name.** The name `Remit` lives in one constant, `packages/core/src/brand.ts`.

When the loop finishes, start with `docs/HANDOFF.md`.
