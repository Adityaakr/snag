# Next

Milestone: M1 Contracts and diff analysis (offline)
Task: zod contracts for section 5.

Next action:
1. `pnpm --filter @remit/core add zod@4.6.5 --save-exact`.
2. Write packages/core/src/contracts/*.ts: every section 5 type as a zod schema with inferred types (field names binding).
3. Export JSON Schemas to schemas/ via `z.toJSONSchema` (script `pnpm schemas`) and add round-trip tests (parse → serialize → parse, schema file up to date).
4. Then the unified diff parser in packages/analysis with fast-check property tests.
Notes: web-tree-sitter 0.27.0 loads the stock npm grammars (tree-sitter-typescript 0.23.2, -javascript 0.25.0, -python 0.25.0, -rust 0.24.0), checked in scratch.
