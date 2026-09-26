# Remit GitHub Action

`packages/action` is a JavaScript action (`action.yml` plus the bundled `dist/index.js`, runtime `node24`).
- It reads the PR from the event payload and reviews it through the GitHub API only. It never checks out or runs PR code.
- It upserts the sticky comment, writes the job summary, and emits annotations as workflow commands.
- It exits according to the mode: `gate` fails the job only on a calibrated gate failure. The calibration comes from `calibration-path` or from the files bundled in `dist/calibration` (real Jev models only). Without one, gate mode is refused and the job does not fail.

## Inputs

| Input | Default | Purpose |
|---|---|---|
| `typesafe-api-key` | | Jev judgment model; without it verdicts are uncertain |
| `anthropic-api-key` | | requirement extraction; without it only issue task lists are read |
| `openai-compatible-api-key`, `openai-compatible-base-url` | | alternative extraction provider |
| `github-token` | `${{ github.token }}` | API access (pull requests write, contents read) |
| `mode` | from config | `comment_only`, `rework` or `gate` |
| `config-path` | `.remit.yml` | config file, read from the default branch |
| `calibration-path` | | calibration JSON on the default branch (from `remit calibrate`); otherwise the calibration shipped with the action is used when it matches the Jev model and question set |
| `budget-usd` | from config | maximum provider spend per review |

## Example: `pull_request`

```yaml
name: Remit
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review, edited]
permissions:
  contents: read
  pull-requests: write
  issues: read
jobs:
  remit:
    runs-on: ubuntu-latest
    steps:
      - uses: <owner>/remit/packages/action@<full-commit-sha> # pin by SHA
        with:
          typesafe-api-key: ${{ secrets.TYPESAFE_API_KEY }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

There is no `actions/checkout` step: the action does not need the code on disk.

**Fork PRs.** GitHub does not pass secrets to workflows triggered by `pull_request` from forks. The action detects a fork PR without keys and skips it with a notice.

## Alternative for fork PRs: `pull_request_target`

`pull_request_target` runs in the context of the base repository, with secrets. Usually that is dangerous, because a workflow that checks out and runs the fork's code hands it your secrets. It is safe here only because this action never checks out or runs PR code: it reads the diff and file contents through the API as data. Do not add a checkout step to this workflow.

```yaml
name: Remit (forks)
on:
  pull_request_target:
    types: [opened, synchronize, reopened, ready_for_review, edited]
permissions:
  contents: read
  pull-requests: write
  issues: read
jobs:
  remit:
    runs-on: ubuntu-latest
    steps:
      - uses: <owner>/remit/packages/action@<full-commit-sha>
        with:
          typesafe-api-key: ${{ secrets.TYPESAFE_API_KEY }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Permissions

Grant only what is listed:
- `contents: read` for file versions and the config;
- `pull-requests: write` for the sticky comment;
- `issues: read` for linked issues.

Annotations and the job summary need no extra permission.

## Pinning

Pin the action to a full commit SHA, not a branch or tag, so a later change to the action cannot run in your workflow without review. Update the SHA deliberately (Renovate can do it).

## Building

`pnpm --filter @remit/action build` bundles `dist/index.js` with esbuild and copies the tree-sitter runtime and grammars into `dist/`. The bundle is committed. `packages/action/src/bundle.slow.test.ts` (run by `pnpm test:slow`) rebuilds it and runs it against a local fake GitHub API.
