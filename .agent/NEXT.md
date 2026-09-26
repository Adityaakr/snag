# Next

Milestone: M5 CLI end to end, renderers, demo
Task: renderers.

Next action:
1. packages/core/src/render/: sanitize (6.10: escape markdown, neutralize @mentions with a zero-width joiner, strip HTML and images, URLs as inline code, strip bidi/invisible, truncate quotes to 200), then sticky comment (E.1, hidden marker), check-run title/summary/annotations model (50 per batch), rework comment (E.2 with JSON block), issue checklist (E.3), terminal table (icons and words, never color alone), JSON, SARIF 2.1.0 (unit and fact findings). Snapshot tests with the golden results.
2. `remit review` (local and GitHub modes, all 10.1 flags, exit codes 0 to 4), `remit init`, `remit demo` (scenarios 1 and 2 offline, under 10 s).
3. README quickstart verified in a clean clone; first dogfood run logged in EXPERIMENTS.md (3.5).
