# Next

Milestone: M3 Blind requirement extraction
Task: extraction prompt v0 and the IssueSnapshot-only extractor.

Next action:
1. packages/core/src/extract/: prompt builder for Appendix B.1 (`xp-0.1.0`, user message template with <issue> tags, sanitized text), zod output schema for `record_requirements`, pure validation (quote normalization and anchoring, renumbering per section 5, 400-char warning, supersededBy handling).
2. Architecture test: nothing under extract/ imports PR types or modules.
3. Pipeline-level extractor in packages/pipeline (LLM call through providers, one repair call for unanchored quotes, drop with warning).
4. Then task-list fast path + modes, amendments, issue.v0, 12 fixtures, `remit extract`.
M2 is BLOCKED-HUMAN on B2 (keys); when keys exist, run `pnpm remit doctor`, record results in docs/providers.md, check the item, and gate M2 again.
