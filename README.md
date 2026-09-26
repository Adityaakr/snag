# Remit

Remit checks whether a pull request does what its linked issue asked, and nothing it didn't.

It reads the issue without looking at the PR and lists each requirement with an exact quote. Then it checks the diff in both directions: where each requirement is implemented, and which requirement each change serves. Every verdict is typed (done, partial, missing, contradicted and a few more), carries a confidence and points at exact lines. Changes no requirement explains are flagged, not condemned. Remit starts in comment-only mode and refuses to block merges until it has calibration evidence.

## Status

Under construction. See `.agent/PROGRESS.md` for milestone status. The CLI, the review pipeline and the renderers work; the GitHub App, the dashboard and live evaluation come later.

## Quickstart

You need Node 22 (see `.nvmrc`) and pnpm 11 (`corepack enable` gives you the version pinned in `package.json`).

### 1. See it work, offline (about 5 minutes)

```bash
git clone <this repo> remit && cd remit
pnpm install
pnpm demo
```

`pnpm demo` replays two recorded reviews with scripted answers, so it needs no keys and no network:

- an issue with three requirements where the PR does two and claims all three (Remit flags the missing one as `P0` and notes the false claim)
- an issue that asks for a 404 where the PR returns 400 and its own test asserts 400 (Remit flags the contradiction even though the tests pass)

### 2. Review a real change

Put your keys in a `.env` file in the repo root (see `.env.example`). Remit loads it at runtime.

```bash
TYPESAFE_API_KEY=...     # Jev: the typed questions behind every verdict
ANTHROPIC_API_KEY=...    # requirement extraction (or set extraction.mode: tasklist_only)
GITHUB_TOKEN=...         # reading GitHub PRs; a read-only fine-grained token is enough
```

Then check your setup and write a config:

```bash
pnpm remit doctor        # keys, connectivity, model ids, rate limits; prints a fix for each failure
pnpm remit init          # writes a commented .remit.yml with the defaults
```

Review a GitHub PR, or a local branch against an issue file:

```bash
pnpm remit review https://github.com/owner/repo/pull/123
pnpm remit review --issue issue.md --diff main...HEAD --pr-body pr.md
```

An issue file is markdown: the first `# ` line is the title, and each `## Comment by @login (maintainer)` section is a comment.

Useful flags: `--json`, `--markdown` (the PR comment), `--sarif`, `--out <dir>` (all of them), `--dry-run` (estimate calls and cost without calling anything), `--explain F-R3` (the answers and thresholds behind one finding), `--budget-usd 0.25`, `--offline`, `--verbose`.

Exit codes: `0` ok, `1` gate failure (gate mode only), `2` usage or config error, `3` provider or network error, `4` budget exceeded (partial result written).

### Other commands

- `pnpm remit extract <issue-url|file>` lists the requirements and open questions Remit reads from an issue.
- `pnpm remit units --diff <file|range>` shows how a diff splits into change units and which code facts fire.

## How it works

1. Blind extraction: an LLM reads only the issue and lists atomic, quoted requirements. Quotes are checked in code.
2. The diff becomes change units (one function, test or config block each) with comment-stripped views, and deterministic code facts such as a loosened assertion or a new `@ts-ignore`.
3. TypeSafe's Jev answers narrow typed questions: how much of each requirement the candidate changes implement, whether tests expect what the issue says, which requirement each change serves.
4. Plain code turns the answers into verdicts, findings and routes. The PR description is read last, only to spot claims that do not match.

See `BUILD_PROMPT.md` for the full design, and `docs/` for providers, configuration and more.

## Development

```bash
pnpm verify     # format, lint, typecheck, tests with coverage, guards (under 3 minutes)
pnpm test       # unit and golden tests only
pnpm test:live  # live provider smoke tests; skipped without keys
```

License and final name are still to be chosen.
