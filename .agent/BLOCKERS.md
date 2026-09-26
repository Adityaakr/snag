# Blockers

One per line: `- [ ] B<n> M<k> <what> | tried: ... | unblock: <exact human action or condition> | workaround: ...`

- [ ] B1 M2 No provider keys in the environment (TYPESAFE_API_KEY, ANTHROPIC_API_KEY, GITHUB_TOKEN) | tried: checked env at session start | unblock: add the keys to `.env` in the repo root (see `.env.example`), then rerun `pnpm test:live` | workaround: fakes and record-and-replay cassettes
