# Remit GitHub App

The App reviews every pull request that links an issue. It posts one sticky comment and a check run, answers slash commands, and can confirm an issue checklist before any code exists. Spec: BUILD_PROMPT 9, 10.2.

## Permissions and events

| Permission | Access | Why |
|---|---|---|
| Pull requests | read and write | read the diff, post the sticky comment and inline comments |
| Checks | read and write | the check run with annotations |
| Contents | read | file versions for context and `.remit.yml` from the default branch |
| Metadata | read | required by GitHub |
| Issues | read and write | read linked issues; write only for the issue checklist and labels |

**Read-only variant.** Open `/setup?read_only=1` to create the App with Issues set to read. The issue checklist and labels then do not work; everything else does.

**Events:**
- `pull_request`: opened, synchronize, reopened, ready_for_review, edited
- `issues`: edited, labeled, assigned
- `issue_comment`: created, edited
- `check_run`: rerequested
- `installation` and `installation_repositories`: delivered to every App.

## Setup

1. Run the server with `PUBLIC_URL` set to an address GitHub can reach. While the App is not configured, the server prints a one-time setup link, `${PUBLIC_URL}/setup?token=...` (or set `SETUP_TOKEN` yourself). Open it; add `&org=<org>` to create the App under an organization. Setup answers `404` without the token and as soon as credentials exist, so nobody can replace a configured App.
2. The page pre-fills GitHub's App Manifest: the name comes from `BRAND`, the webhook is `${PUBLIC_URL}/webhooks`, and the permissions and events are the ones above. Click **Create the GitHub App**.
3. GitHub redirects to `/setup/callback`, and the server exchanges the one-time code for the App's credentials.
   - With `SECRETS_ENCRYPTION_KEY` set, the credentials are stored encrypted in `${DATA_DIR:-.data}/app-secrets.enc`. The key must be at least 32 characters (generate one with `openssl rand -base64 48`); it is stretched with scrypt and a random salt, and the file uses AES-256-GCM. Stored credentials are never overwritten: to set up again, delete the file deliberately.
   - Without it, the page shows `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET` and `GITHUB_APP_PRIVATE_KEY` once. Put them in the server's environment; they are not stored.
4. Follow the install link and choose repositories.

## Environment

| Variable | Purpose |
|---|---|
| `PUBLIC_URL` | where GitHub sends webhooks (used by `/setup`) |
| `PORT` | listen port (default `3000`) |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | App credentials, unless stored by `/setup` |
| `SECRETS_ENCRYPTION_KEY`, `DATA_DIR` | encrypted credential storage (key of at least 32 characters) |
| `SETUP_TOKEN` | optional fixed setup token (otherwise one is generated and printed at startup) |
| `GITHUB_APP_SLUG` | the App's slug (stored by `/setup`), so Remit only edits comments by `<slug>[bot]` |
| `METRICS_TOKEN` | bearer token for `/metrics`; without it, keep `/metrics` on an internal network |
| `TYPESAFE_API_KEY`, `ANTHROPIC_API_KEY` (or `OPENAI_COMPATIBLE_API_KEY` and `OPENAI_COMPATIBLE_BASE_URL`) | providers; without them verdicts are uncertain and only task lists are read |
| `REMIT_CALIBRATION_DIR` | calibration files (default `eval/calibration`) |

Start it with `pnpm server` (development) or `node packages/server/dist/main.js`.

## Local development

GitHub must reach the webhook, so point `PUBLIC_URL` at a webhook proxy such as smee.io, or at a tunnel:

1. Create a channel at https://smee.io and set `PUBLIC_URL` to the channel URL.
2. Run `npx smee-client --url <channel> --target http://localhost:3000/webhooks`.
3. Open `http://localhost:3000/setup`. The manifest points GitHub at the channel, and smee forwards deliveries with their signatures intact.

## How a review runs

1. **Webhook:**
   - Bodies over 25 MB are refused while streaming (`413`), then the HMAC SHA-256 signature is checked in constant time before the body is parsed; unsigned requests get `401`.
   - Deliveries are deduped by `X-GitHub-Delivery`; a delivery whose handling fails is released so GitHub can redeliver it.
   - A job is queued and the webhook answers `202`.
2. **Debounce:** `synchronize` bursts (and `edited` events that change the title or body; other edits are ignored) for the same PR within `30 s` collapse into one review of the latest head. A newer job cancels a running one, whose check run ends as "Superseded by a newer push".
3. **Config:** `.remit.yml` is read from the default branch only.
   - An invalid file falls back to defaults, and the errors are shown in the check run.
   - A PR that edits `.remit.yml` gets a note that the change applies after merge.
4. **Review:**
   - Create the check run (in progress).
   - Run the pipeline with a per-job installation token narrowed to the PR's repository (never stored). Linked issues outside the PR's account are not read, and the comment says so.
   - Upsert the sticky comment.
   - In rework mode, also upsert the rework request (mentioning `rework.mention` if set; nobody by default).
   - Complete the check run with the mode's conclusion and annotations batched 50 per request.
   - Add inline comments and labels if `surfaces` enables them.
   - Store the result.

**Modes:**
- `comment_only` and `rework` conclude `neutral`.
- `gate` concludes `failure` only when a calibration for the Jev model and question set exists with enough labeled findings and measured P0 precision. Otherwise the gate is refused and the check stays `neutral`, with the reason in the comment.

## Slash commands

Commands are accepted only from people with write or triage permission. For `/remit confirm`, the issue author is also accepted. Bots and the App's own comments are ignored.

| Command | Effect |
|---|---|
| `/remit review` | re-runs the review |
| `/remit agree <finding-id...>` | records `agree` feedback |
| `/remit disagree <finding-id> [reason]` | records `disagree` feedback |
| `/remit explain <finding-id>` | replies with raw answers, thresholds and evidence |
| `/remit confirm` | on an issue, confirms the checklist |
| `/remit help` | lists the commands |

## Issue-time checklist

Set `issue_checklist: on_label` (label `issue_checklist_label`, default `agent-ready`) or `on_assign`.
1. When triggered, Remit extracts the requirements and posts the checklist.
2. `/remit confirm` stores it by issue content hash, and reviews of PRs for that issue use the confirmed list.
3. Editing the issue invalidates the confirmation and re-posts the checklist.

## Uninstall

The `installation.deleted` event deletes everything stored for that installation.

## Tests

- `packages/server/src/app.test.ts` replays the recorded payloads in `fixtures/webhooks/` against FakeGitHub.
- `packages/server/src/e2e.test.ts` runs the real server on a socket, with LiveGitHub authenticating by App JWT and installation token against a local fake GitHub API over HTTP.
