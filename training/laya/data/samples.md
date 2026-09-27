# Training examples, one per question and answer class

Taken from `export/train.jsonl.gz` (the exact examples the trainer would see). States are truncated here for reading.

## `forward.conflict` = `no` (original, seed ts-job-intervals, operator claim_all_done, 659 state tokens)

**Question**
```json
{
 "type": "noul",
 "instructions": "Does any change in `candidates` implement behavior that differs from what `requirement.text` states for the same situation, such as a different value, a different condition or the opposite outcome?",
 "criteria": {
  "true": "At least one change in `candidates` does something different from what `requirement.text` states for the same situation.",
  "false": "No change in `candidates` does something different from `requirement.text`. Behavior that is simply missing counts as false."
 }
}
```
**Target**
```json
{"noul": 0}
```
**State**
```json
{
 "requirement": {
  "text": "Job names are trimmed and lowercased when a job is scheduled",
  "quote": "Job names are trimmed and lowercased when a job is scheduled",
  "examples": []
 },
 "candidates": [
  {
   "id": "U4",
   "file": "src/schedule.ts",
   "symbol": "DurationError",
   "change": "--- a/src/schedule.ts\n+++ b/src/schedule.ts\n@@ -11,3 +11,4 @@\n   timeoutMs: number;\n }\n \n+export class DurationError extends Error {\n@@ -14,2 +19,4 @@\n+}\n+\n export function scheduleJob(job: Job): ScheduledJob {\n   const intervalMs = Number(job.every);\n",
   "after": "export class DurationError extends Error {\n  constructor(readonly input: string) {\n    super(`cannot parse duration \"${input}\"`);\n    this.name = 'DurationError';\n  }\n}"
  },
  {
   "id": "U6",
   "file": "src/schedule.ts",
   "symbol": "scheduleJob",
   "change": "--- a/src/schedule.ts\n+++ b/src/schedule.ts\n@@ -14,4 +21,8 @@\n export function scheduleJob(job: Job): ScheduledJob {\n   const intervalMs = Number(job.every);\n-  return { name: job.name, intervalMs, timeoutMs: jobDefaults().timeoutMs };\n+  if (intervalMs < 1000) {\n+    throw new RangeError(`interval for ${job.name} is shorter than 1 second`);\n+  }\n+  const name = job.name.trim().toLowerCase();\n+  return { name, intervalMs, timeoutMs: jobDefaults().timeoutMs };\n }\n",
   "after": "export function scheduleJob(job: Job): ScheduledJob 
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## `forward.conflict` = `yes` (original, seed ts-job-intervals, operator flip_condition, 1004 state tokens)

**Question**
```json
{
 "type": "noul",
 "instructions": "Does any change in `candidates` implement behavior that differs from what `requirement.text` states for the same situation, such as a different value, a different condition or the opposite outcome?",
 "criteria": {
  "true": "At least one change in `candidates` does something different from what `requirement.text` states for the same situation.",
  "false": "No change in `candidates` does something different from `requirement.text`. Behavior that is simply missing counts as false."
 }
}
```
**Target**
```json
{"noul": 1}
```
**State**
```json
{
 "requirement": {
  "text": "An interval that cannot be parsed throws a `DurationError` that names the bad value",
  "quote": "An interval that cannot be parsed throws a `DurationError` that names the bad value",
  "examples": []
 },
 "candidates": [
  {
   "id": "U11",
   "file": "src/schedule.ts",
   "symbol": "scheduleJob",
   "change": "--- a/src/schedule.ts\n+++ b/src/schedule.ts\n@@ -14,4 +36,8 @@\n export function scheduleJob(job: Job): ScheduledJob {\n-  const intervalMs = Number(job.every);\n-  return { name: job.name, intervalMs, timeoutMs: jobDefaults().timeoutMs };\n+  const intervalMs = parseDuration(job.every);\n+  if (intervalMs < 1000) {\n+    throw new RangeError(`interval for ${job.name} is shorter than 1 second`);\n+  }\n+  const name = job.name.trim().toLowerCase();\n+  return { name, intervalMs, timeoutMs: jobDefaults().timeoutMs };\n }\n",
   "after": "export function scheduleJob(job: Job): ScheduledJob {\n  const intervalMs = parseDuration(job.every);\n  if (intervalMs < 1000) {\n    throw new RangeError(`interval for ${job.name} is shorter than 1 second`);\n  }\n  const name = job.name.trim().toLowerCase();\n  return { name, intervalMs, timeoutMs: jobDefaults().timeoutMs };\n}"
  },
  {
   "id": "U8",
   "file": "src/schedule.ts",
   "symbol": "DurationError",
   "change": "--- a/src/schedule.ts\n+++ b/src/schedule.ts\n@@ -11,3 +11,4 @@\n   timeoutMs: 
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## `forward.coverage` = `0` (twin, seed ts-flag-rules, operator drop_requirement, 647 state tokens)

**Question**
```json
{
 "type": "score",
 "instructions": "How much of the behavior stated in `requirement.text` do the code changes in `candidates` implement? Judge only what the code in `candidates` does.",
 "criteria": [
  "None: no change in `candidates` implements any part of `requirement.text`.",
  "Touched: a change edits related code, but the behavior stated in `requirement.text` is still not implemented.",
  "Most: the main behavior is implemented, but at least one case, value or condition stated in `requirement.text` is not.",
  "Full: every case, value and condition stated in `requirement.text` is implemented."
 ]
}
```
**Target**
```json
{"probabilities": {"0": 1.0}}
```
**State**
```json
{
 "requirement": {
  "text": "A rule with `startsAt` is off before that time and on from it (for example `startsAt: '2026-10-01T00:00:00Z'` is already on at exactly that instant)",
  "quote": "A rule with `startsAt` is off before that time and on from it (for example `startsAt: '2026-10-01T00:00:00Z'` is already on at exactly that instant)",
  "examples": []
 },
 "candidates": [
  {
   "id": "U1",
   "file": "src/flags.ts",
   "symbol": "FlagRule",
   "change": "--- a/src/flags.ts\n+++ b/src/flags.ts\n@@ -7,5 +7,10 @@\n export interface FlagRule {\n   flag: string;\n   enabled: boolean;\n+  countries?: string[];\n+  domains?: string[];\n+  percent?: number;\n+  startsAt?: string;\n+  allowUsers?: string[];\n }\n \n",
   "after": "export interface FlagRule {\n  flag: string;\n  enabled: boolean;\n  countries?: string[];\n  domains?: string[];\n  percent?: number;\n  startsAt?: string;\n  allowUsers?: string[];\n}"
  },
  {
   "id": "U2",
   "file": "src/flags.ts",
   "symbol": "matchesTargets",
   "change": "--- a/src/flags.ts\n+++ b/src/flags.ts\n@@ -12,0 +17,6 @@\n+export function matchesTargets(rule: FlagRule, user: User): boolean {\n+  if (rule.countries && !rule.countries.includes(user.country)) return false;\n+  if (rule.domains && !rule.domains.includes(user.email.slice(user.email.indexOf('@') + 1).toLowerCase())) return false;\n+  return true;\n+}\n+\n",
   "after": "ex
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## `forward.coverage` = `2` (original, seed ts-job-intervals, operator partial_requirement, 1007 state tokens)

**Question**
```json
{
 "type": "score",
 "instructions": "How much of the behavior stated in `requirement.text` do the code changes in `candidates` implement? Judge only what the code in `candidates` does.",
 "criteria": [
  "None: no change in `candidates` implements any part of `requirement.text`.",
  "Touched: a change edits related code, but the behavior stated in `requirement.text` is still not implemented.",
  "Most: the main behavior is implemented, but at least one case, value or condition stated in `requirement.text` is not.",
  "Full: every case, value and condition stated in `requirement.text` is implemented."
 ]
}
```
**Target**
```json
{"probabilities": {"2": 1}}
```
**State**
```json
{
 "requirement": {
  "text": "Job intervals accept a number with a unit suffix: s, m or h (for example `90s`, `5m`, `2h`)",
  "quote": "Job intervals accept a number with a unit suffix: s, m or h (for example `90s`, `5m`, `2h`)",
  "examples": []
 },
 "candidates": [
  {
   "id": "U11",
   "file": "src/schedule.ts",
   "symbol": "scheduleJob",
   "change": "--- a/src/schedule.ts\n+++ b/src/schedule.ts\n@@ -14,4 +34,8 @@\n export function scheduleJob(job: Job): ScheduledJob {\n-  const intervalMs = Number(job.every);\n-  return { name: job.name, intervalMs, timeoutMs: jobDefaults().timeoutMs };\n+  const intervalMs = parseDuration(job.every);\n+  if (intervalMs < 1000) {\n+    throw new RangeError(`interval for ${job.name} is shorter than 1 second`);\n+  }\n+  const name = job.name.trim().toLowerCase();\n+  return { name, intervalMs, timeoutMs: jobDefaults().timeoutMs };\n }\n",
   "after": "export function scheduleJob(job: Job): ScheduledJob {\n  const intervalMs = parseDuration(job.every);\n  if (intervalMs < 1000) {\n    throw new RangeError(`interval for ${job.name} is shorter than 1 second`);\n  }\n  const name = job.name.trim().toLowerCase();\n  return { name, intervalMs, timeoutMs: jobDefaults().timeoutMs };\n}"
  },
  {
   "id": "U10",
   "file": "src/schedule.ts",
   "symbol": "parseDuration",
   "change": "--- a/src/schedule.ts\n+++ b/src/schedule.ts\n@@ -14,1 +21,14 
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## `forward.coverage` = `3` (original, seed ts-job-intervals, operator drop_requirement, 735 state tokens)

**Question**
```json
{
 "type": "score",
 "instructions": "How much of the behavior stated in `requirement.text` do the code changes in `candidates` implement? Judge only what the code in `candidates` does.",
 "criteria": [
  "None: no change in `candidates` implements any part of `requirement.text`.",
  "Touched: a change edits related code, but the behavior stated in `requirement.text` is still not implemented.",
  "Most: the main behavior is implemented, but at least one case, value or condition stated in `requirement.text` is not.",
  "Full: every case, value and condition stated in `requirement.text` is implemented."
 ]
}
```
**Target**
```json
{"probabilities": {"3": 1}}
```
**State**
```json
{
 "requirement": {
  "text": "Intervals shorter than 1 second are rejected with a `RangeError`",
  "quote": "Intervals shorter than 1 second are rejected with a `RangeError`",
  "examples": []
 },
 "candidates": [
  {
   "id": "U8",
   "file": "src/schedule.ts",
   "symbol": "scheduleJob",
   "change": "--- a/src/schedule.ts\n+++ b/src/schedule.ts\n@@ -14,4 +29,8 @@\n export function scheduleJob(job: Job): ScheduledJob {\n-  const intervalMs = Number(job.every);\n-  return { name: job.name, intervalMs, timeoutMs: jobDefaults().timeoutMs };\n+  const intervalMs = parseDuration(job.every);\n+  if (intervalMs < 1000) {\n+    throw new RangeError(`interval for ${job.name} is shorter than 1 second`);\n+  }\n+  const name = job.name.trim().toLowerCase();\n+  return { name, intervalMs, timeoutMs: jobDefaults().timeoutMs };\n }\n",
   "after": "export function scheduleJob(job: Job): ScheduledJob {\n  const intervalMs = parseDuration(job.every);\n  if (intervalMs < 1000) {\n    throw new RangeError(`interval for ${job.name} is shorter than 1 second`);\n  }\n  const name = job.name.trim().toLowerCase();\n  return { name, intervalMs, timeoutMs: jobDefaults().timeoutMs };\n}"
  },
  {
   "id": "U2",
   "file": "src/schedule.ts",
   "symbol": "parseDuration",
   "change": "--- a/src/schedule.ts\n+++ b/src/schedule.ts\n@@ -11,4 +11,19 @@\n   timeoutMs: number;\n }\n \n+export function parse
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## `forward.evidence` = `none` (twin, seed rs-config-parser, operator claim_all_done, 679 state tokens)

**Question**
```json
{
 "type": "choice",
 "instructions": "Which entry in `candidates` most directly implements the behavior stated in `requirement.text`?",
 "criteria": {
  "U1": "`candidates` entry U1 (importer/csv_import.py, (file))",
  "U2": "`candidates` entry U2 (src/parser.rs, get)",
  "U3": "`candidates` entry U3 (src/parser.rs, get_bool)",
  "none": "No entry in `candidates` implements any part of `requirement.text`."
 }
}
```
**Target**
```json
{"probabilities": {"none": 1.0}}
```
**State**
```json
{
 "requirement": {
  "text": "Lines starting with `;` are comments, just like lines starting with `#`",
  "quote": "Lines starting with `;` are comments, just like lines starting with `#`",
  "examples": []
 },
 "candidates": [
  {
   "id": "U1",
   "file": "importer/csv_import.py",
   "symbol": "(file)",
   "change": "--- a/importer/csv_import.py\n+++ b/importer/csv_import.py\n@@ -2,6 +2,8 @@\n \n import csv\n import io\n+import re\n+from datetime import datetime\n \n from importer.config import import_limits\n \n"
  },
  {
   "id": "U2",
   "file": "src/parser.rs",
   "symbol": "get",
   "change": "--- a/src/parser.rs\n+++ b/src/parser.rs\n@@ -25,6 +25,6 @@\n \n impl Config {\n     pub fn get(&self, key: &str) -> Option<&str> {\n-        self.values.get(key).map(|v| v.as_str())\n+        self.values.get(&key.to_ascii_lowercase()).map(|v| v.as_str())\n     }\n \n",
   "after": "    pub fn get(&self, key: &str) -> Option<&str> {\n        self.values.get(&key.to_ascii_lowercase()).map(|v| v.as_str())\n    }"
  },
  {
   "id": "U3",
   "file": "src/parser.rs",
   "symbol": "get_bool",
   "change": "--- a/src/parser.rs\n+++ b/src/parser.rs\n@@ -29,5 +29,17 @@\n     }\n \n+    pub fn get_bool(&self, key: &str) -> Option<bool> {\n+        match self.get(key)? {\n+            \"no\" => Some(false),\n+            \"yes\" => Some(true),\n+            \"true\" => Some(true),\n+        
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## `forward.evidence` = `some` (original, seed ts-job-intervals, operator claim_all_done, 661 state tokens)

**Question**
```json
{
 "type": "choice",
 "instructions": "Which entry in `candidates` most directly implements the behavior stated in `requirement.text`?",
 "criteria": {
  "U6": "`candidates` entry U6 (src/schedule.ts, scheduleJob)",
  "U4": "`candidates` entry U4 (src/schedule.ts, DurationError)",
  "U5": "`candidates` entry U5 (src/schedule.ts, constructor)",
  "none": "No entry in `candidates` implements any part of `requirement.text`."
 }
}
```
**Target**
```json
{"probabilities": {"U6": 1}}
```
**State**
```json
{
 "requirement": {
  "text": "Intervals shorter than 1 second are rejected with a `RangeError`",
  "quote": "Intervals shorter than 1 second are rejected with a `RangeError`",
  "examples": []
 },
 "candidates": [
  {
   "id": "U6",
   "file": "src/schedule.ts",
   "symbol": "scheduleJob",
   "change": "--- a/src/schedule.ts\n+++ b/src/schedule.ts\n@@ -14,4 +21,8 @@\n export function scheduleJob(job: Job): ScheduledJob {\n   const intervalMs = Number(job.every);\n-  return { name: job.name, intervalMs, timeoutMs: jobDefaults().timeoutMs };\n+  if (intervalMs < 1000) {\n+    throw new RangeError(`interval for ${job.name} is shorter than 1 second`);\n+  }\n+  const name = job.name.trim().toLowerCase();\n+  return { name, intervalMs, timeoutMs: jobDefaults().timeoutMs };\n }\n",
   "after": "export function scheduleJob(job: Job): ScheduledJob {\n  const intervalMs = Number(job.every);\n  if (intervalMs < 1000) {\n    throw new RangeError(`interval for ${job.name} is shorter than 1 second`);\n  }\n  const name = job.name.trim().toLowerCase();\n  return { name, intervalMs, timeoutMs: jobDefaults().timeoutMs };\n}"
  },
  {
   "id": "U3",
   "file": "src/schedule.ts",
   "symbol": "DurationError",
   "change": "--- a/src/schedule.ts\n+++ b/src/schedule.ts\n@@ -11,3 +11,4 @@\n   timeoutMs: number;\n }\n \n+export class DurationError extends Error {\n@@ -14,2 +19,4 @@\n+}\n+\n export 
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## `reverse.behavior_change` = `no` (original, seed rs-config-parser, operator inject_refactor, 583 state tokens)

**Question**
```json
{
 "type": "noul",
 "instructions": "Does `change` alter behavior that a caller, user or test could observe, such as return values, errors, side effects, defaults, limits, timing or permissions?",
 "criteria": {
  "true": "Observable behavior after the change differs from before.",
  "false": "Only formatting, names, comments, types or internal structure change, and observable behavior is identical."
 }
}
```
**Target**
```json
{"noul": 0}
```
**State**
```json
{
 "requirements": [
  {
   "id": "R1",
   "text": "Values wrapped in double quotes have the quotes removed (for example `name = \"my app\"` reads as `my app`)"
  },
  {
   "id": "R2",
   "text": "Lines starting with `;` are comments, just like lines starting with `#`"
  },
  {
   "id": "R3",
   "text": "Keys are case-insensitive: `Port`, `PORT` and `port` all read the same value"
  },
  {
   "id": "R4",
   "text": "`Config::get_bool` reads `true`/`false`, `yes`/`no` and `on`/`off`, and returns `None` for anything else"
  }
 ],
 "change": {
  "id": "U3",
  "file": "src/parser.rs",
  "symbol": "split_pair",
  "kind": "source",
  "change": "--- a/src/parser.rs\n+++ b/src/parser.rs\n@@ -34,7 +46,7 @@\n }\n \n fn split_pair(line: &str, number: usize) -> Result<(&str, &str), ParseError> {\n-    let eq = line.find('=').ok_or(ParseError::MissingEquals(number))?;\n-    Ok((line[..eq].trim(), line[eq + 1..].trim()))\n+    let pos = line.find('=').ok_or(ParseError::MissingEquals(number))?;\n+    Ok((line[..pos].trim(), line[pos + 1..].trim()))\n }\n \n"
 },
 "other_changes": [
  {
   "id": "U1",
   "file": "src/parser.rs",
   "symbol": "get"
  },
  {
   "id": "U2",
   "file": "src/parser.rs",
   "symbol": "get_bool"
  },
  {
   "id": "U4",
   "file": "src/parser.rs",
   "symbol": "unquote"
  },
  {
   "id": "U5",
   "file": "src/parser.rs",
   "symbol": "parse_config"
  },
  {
   "id": "
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## `reverse.behavior_change` = `yes` (original, seed rs-config-parser, operator inject_config, 490 state tokens)

**Question**
```json
{
 "type": "noul",
 "instructions": "Does `change` alter behavior that a caller, user or test could observe, such as return values, errors, side effects, defaults, limits, timing or permissions?",
 "criteria": {
  "true": "Observable behavior after the change differs from before.",
  "false": "Only formatting, names, comments, types or internal structure change, and observable behavior is identical."
 }
}
```
**Target**
```json
{"noul": 1}
```
**State**
```json
{
 "requirements": [
  {
   "id": "R1",
   "text": "Values wrapped in double quotes have the quotes removed (for example `name = \"my app\"` reads as `my app`)"
  },
  {
   "id": "R2",
   "text": "Lines starting with `;` are comments, just like lines starting with `#`"
  },
  {
   "id": "R3",
   "text": "Keys are case-insensitive: `Port`, `PORT` and `port` all read the same value"
  },
  {
   "id": "R4",
   "text": "`Config::get_bool` reads `true`/`false`, `yes`/`no` and `on`/`off`, and returns `None` for anything else"
  }
 ],
 "change": {
  "id": "U1",
  "file": "src/limits.rs",
  "symbol": "MAX_LINE_LEN",
  "kind": "source",
  "change": "--- a/src/limits.rs\n+++ b/src/limits.rs\n@@ -1,4 +1,4 @@\n \n \n \n-pub const MAX_LINE_LEN: usize = 1024;\n+pub const MAX_LINE_LEN: usize = 16;\n"
 },
 "other_changes": [
  {
   "id": "U2",
   "file": "src/parser.rs",
   "symbol": "get"
  },
  {
   "id": "U3",
   "file": "src/parser.rs",
   "symbol": "get_bool"
  },
  {
   "id": "U4",
   "file": "src/parser.rs",
   "symbol": "unquote"
  },
  {
   "id": "U5",
   "file": "src/parser.rs",
   "symbol": "parse_config"
  },
  {
   "id": "U6",
   "file": "src/parser.rs",
   "symbol": "strips_double_quotes_from_values"
  },
  {
   "id": "U7",
   "file": "src/parser.rs",
   "symbol": "skips_semicolon_comments"
  },
  {
   "id": "U8",
   "file": "src/parser.rs",
   "symbol": "keys_are_case_insensitiv
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## `reverse.plumbing` = `no` (original, seed rs-config-parser, operator inject_config, 490 state tokens)

**Question**
```json
{
 "type": "noul",
 "instructions": "Is `change` limited to supporting work that other entries in `other_changes` depend on, such as types, imports, exports, wiring, helper functions or renames?",
 "criteria": {
  "true": "It only provides what other changes in this pull request need.",
  "false": "It does more than support other changes, or nothing in `other_changes` needs it."
 }
}
```
**Target**
```json
{"noul": 0}
```
**State**
```json
{
 "requirements": [
  {
   "id": "R1",
   "text": "Values wrapped in double quotes have the quotes removed (for example `name = \"my app\"` reads as `my app`)"
  },
  {
   "id": "R2",
   "text": "Lines starting with `;` are comments, just like lines starting with `#`"
  },
  {
   "id": "R3",
   "text": "Keys are case-insensitive: `Port`, `PORT` and `port` all read the same value"
  },
  {
   "id": "R4",
   "text": "`Config::get_bool` reads `true`/`false`, `yes`/`no` and `on`/`off`, and returns `None` for anything else"
  }
 ],
 "change": {
  "id": "U1",
  "file": "src/limits.rs",
  "symbol": "MAX_LINE_LEN",
  "kind": "source",
  "change": "--- a/src/limits.rs\n+++ b/src/limits.rs\n@@ -1,4 +1,4 @@\n \n \n \n-pub const MAX_LINE_LEN: usize = 1024;\n+pub const MAX_LINE_LEN: usize = 16;\n"
 },
 "other_changes": [
  {
   "id": "U2",
   "file": "src/parser.rs",
   "symbol": "get"
  },
  {
   "id": "U3",
   "file": "src/parser.rs",
   "symbol": "get_bool"
  },
  {
   "id": "U4",
   "file": "src/parser.rs",
   "symbol": "unquote"
  },
  {
   "id": "U5",
   "file": "src/parser.rs",
   "symbol": "parse_config"
  },
  {
   "id": "U6",
   "file": "src/parser.rs",
   "symbol": "strips_double_quotes_from_values"
  },
  {
   "id": "U7",
   "file": "src/parser.rs",
   "symbol": "skips_semicolon_comments"
  },
  {
   "id": "U8",
   "file": "src/parser.rs",
   "symbol": "keys_are_case_insensitiv
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## `reverse.plumbing` = `yes` (original, seed ts-flag-rules, operator drop_requirement, 516 state tokens)

**Question**
```json
{
 "type": "noul",
 "instructions": "Is `change` limited to supporting work that other entries in `other_changes` depend on, such as types, imports, exports, wiring, helper functions or renames?",
 "criteria": {
  "true": "It only provides what other changes in this pull request need.",
  "false": "It does more than support other changes, or nothing in `other_changes` needs it."
 }
}
```
**Target**
```json
{"noul": 1}
```
**State**
```json
{
 "requirements": [
  {
   "id": "R1",
   "text": "Rules can target `countries` (for example `['DE', 'FR']`) and email `domains` (for example `['example.com']`, matched ignoring case); a user must match every list the rule sets"
  },
  {
   "id": "R2",
   "text": "Rules can roll out to a `percent` of users, bucketed by a stable hash of the flag name and user id so the same user always gets the same answer (`percent: 0` is off for everyone, `percent: 100` is on for everyone)"
  },
  {
   "id": "R3",
   "text": "A rule with `startsAt` is off before that time and on from it (for example `startsAt: '2026-10-01T00:00:00Z'` is already on at exactly that instant)"
  },
  {
   "id": "R4",
   "text": "Users listed in `allowUsers` get the flag on whenever the rule is enabled, skipping the targeting, rollout and schedule checks"
  }
 ],
 "change": {
  "id": "U4",
  "file": "src/flags.ts",
  "symbol": "FlagRule",
  "kind": "source",
  "change": "--- a/src/flags.ts\n+++ b/src/flags.ts\n@@ -7,5 +7,10 @@\n export interface FlagRule {\n   flag: string;\n   enabled: boolean;\n+  countries?: string[];\n+  domains?: string[];\n+  percent?: number;\n+  startsAt?: string;\n+  allowUsers?: string[];\n }\n \n"
 },
 "other_changes": [
  {
   "id": "U1",
   "file": "src/flags.test.ts",
   "symbol": "targets countries and email domains"
  },
  {
   "id": "U2",
   "file": "src/flags.test.ts",
   "symbol
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## `reverse.serves` = `none` (original, seed rs-config-parser, operator inject_config, 490 state tokens)

**Question**
```json
{
 "type": "choice",
 "instructions": "Which entry in `requirements` does the code change in `change` directly implement?",
 "criteria": {
  "R1": "`requirements` entry R1: Values wrapped in double quotes have the quotes removed (for example `name = \"my app\"` reads as `my app`)",
  "R2": "`requirements` entry R2: Lines starting with `;` are comments, just like lines starting with `#`",
  "R3": "`requirements` entry R3: Keys are case-insensitive: `Port`, `PORT` and `port` all read the same value",
  "R4": "`requirements` entry R4: `Config::get_bool` reads `true`/`false`, `yes`/`no` and `on`/`off`, and returns `None` for anything else",
  "none": "The change does not directly implement any entry in `requirements`."
 }
}
```
**Target**
```json
{"probabilities": {"none": 1}}
```
**State**
```json
{
 "requirements": [
  {
   "id": "R1",
   "text": "Values wrapped in double quotes have the quotes removed (for example `name = \"my app\"` reads as `my app`)"
  },
  {
   "id": "R2",
   "text": "Lines starting with `;` are comments, just like lines starting with `#`"
  },
  {
   "id": "R3",
   "text": "Keys are case-insensitive: `Port`, `PORT` and `port` all read the same value"
  },
  {
   "id": "R4",
   "text": "`Config::get_bool` reads `true`/`false`, `yes`/`no` and `on`/`off`, and returns `None` for anything else"
  }
 ],
 "change": {
  "id": "U1",
  "file": "src/limits.rs",
  "symbol": "MAX_LINE_LEN",
  "kind": "source",
  "change": "--- a/src/limits.rs\n+++ b/src/limits.rs\n@@ -1,4 +1,4 @@\n \n \n \n-pub const MAX_LINE_LEN: usize = 1024;\n+pub const MAX_LINE_LEN: usize = 16;\n"
 },
 "other_changes": [
  {
   "id": "U2",
   "file": "src/parser.rs",
   "symbol": "get"
  },
  {
   "id": "U3",
   "file": "src/parser.rs",
   "symbol": "get_bool"
  },
  {
   "id": "U4",
   "file": "src/parser.rs",
   "symbol": "unquote"
  },
  {
   "id": "U5",
   "file": "src/parser.rs",
   "symbol": "parse_config"
  },
  {
   "id": "U6",
   "file": "src/parser.rs",
   "symbol": "strips_double_quotes_from_values"
  },
  {
   "id": "U7",
   "file": "src/parser.rs",
   "symbol": "skips_semicolon_comments"
  },
  {
   "id": "U8",
   "file": "src/parser.rs",
   "symbol": "keys_are_case_insensitiv
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## `reverse.serves` = `some` (original, seed ts-job-intervals, operator claim_all_done, 395 state tokens)

**Question**
```json
{
 "type": "choice",
 "instructions": "Which entry in `requirements` does the code change in `change` directly implement?",
 "criteria": {
  "R1": "`requirements` entry R1: Job intervals accept a number with a unit suffix: s, m or h (for example `90s`, `5m`, `2h`)",
  "R2": "`requirements` entry R2: An interval that cannot be parsed throws a `DurationError` that names the bad value",
  "R3": "`requirements` entry R3: Intervals shorter than 1 second are rejected with a `RangeError`",
  "R4": "`requirements` entry R4: Job names are trimmed and lowercased when a job is scheduled",
  "none": "The change does not directly implement any entry in `requirements`."
 }
}
```
**Target**
```json
{"probabilities": {"R4": 1}}
```
**State**
```json
{
 "requirements": [
  {
   "id": "R1",
   "text": "Job intervals accept a number with a unit suffix: s, m or h (for example `90s`, `5m`, `2h`)"
  },
  {
   "id": "R2",
   "text": "An interval that cannot be parsed throws a `DurationError` that names the bad value"
  },
  {
   "id": "R3",
   "text": "Intervals shorter than 1 second are rejected with a `RangeError`"
  },
  {
   "id": "R4",
   "text": "Job names are trimmed and lowercased when a job is scheduled"
  }
 ],
 "change": {
  "id": "U3",
  "file": "src/schedule.test.ts",
  "symbol": "normalizes job names",
  "kind": "test",
  "change": "--- a/src/schedule.test.ts\n+++ b/src/schedule.test.ts\n@@ -8,1 +13,4 @@\n+  it('normalizes job names', () => {\n+    expect(scheduleJob({ name: ' Nightly Sync ', every: '1h' }).name).toBe('nightly sync');\n+  });\n });\n"
 },
 "other_changes": [
  {
   "id": "U1",
   "file": "src/schedule.test.ts",
   "symbol": "(file)"
  },
  {
   "id": "U2",
   "file": "src/schedule.test.ts",
   "symbol": "rejects intervals shorter than one second"
  },
  {
   "id": "U4",
   "file": "src/schedule.ts",
   "symbol": "DurationError"
  },
  {
   "id": "U5",
   "file": "src/schedule.ts",
   "symbol": "constructor"
  },
  {
   "id": "U6",
   "file": "src/schedule.ts",
   "symbol": "scheduleJob"
  }
 ]
}
```

## `tests.asserts_as_stated` = `no` (original, seed ts-job-intervals, operator claim_all_done, 495 state tokens)

**Question**
```json
{
 "type": "noul",
 "instructions": "Does any test in `tests` check the behavior stated in `requirement.text`, expecting exactly what `requirement.text` states?",
 "criteria": {
  "true": "A test checks that behavior and expects what `requirement.text` states.",
  "false": "No test checks that behavior, or the tests expect something else."
 }
}
```
**Target**
```json
{"noul": 0}
```
**State**
```json
{
 "requirement": {
  "text": "An interval that cannot be parsed throws a `DurationError` that names the bad value",
  "quote": "An interval that cannot be parsed throws a `DurationError` that names the bad value",
  "examples": []
 },
 "tests": [
  {
   "id": "U3",
   "file": "src/schedule.test.ts",
   "titles": [
    "scheduleJob",
    "normalizes job names"
   ],
   "change": "--- a/src/schedule.test.ts\n+++ b/src/schedule.test.ts\n@@ -8,1 +13,4 @@\n+  it('normalizes job names', () => {\n+    expect(scheduleJob({ name: ' Nightly Sync ', every: '1h' }).name).toBe('nightly sync');\n+  });\n });\n"
  },
  {
   "id": "U1",
   "file": "src/schedule.test.ts",
   "titles": [],
   "change": "--- a/src/schedule.test.ts\n+++ b/src/schedule.test.ts\n@@ -1,5 +1,5 @@\n import { describe, expect, it } from 'vitest';\n-import { scheduleJob } from './schedule.js';\n+import { DurationError, scheduleJob } from './schedule.js';\n \n describe('scheduleJob', () => {\n   it('keeps the job name', () => {\n"
  },
  {
   "id": "U2",
   "file": "src/schedule.test.ts",
   "titles": [
    "scheduleJob",
    "rejects intervals shorter than one second"
   ],
   "change": "--- a/src/schedule.test.ts\n+++ b/src/schedule.test.ts\n@@ -5,3 +5,8 @@\n   it('keeps the job name', () => {\n     expect(scheduleJob({ name: 'sync', every: '1000' }).name).toBe('sync');\n   });\n+\n+  it('rejects intervals shorter than
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## `tests.asserts_as_stated` = `yes` (original, seed rs-cli-args, operator drop_requirement, 591 state tokens)

**Question**
```json
{
 "type": "noul",
 "instructions": "Does any test in `tests` check the behavior stated in `requirement.text`, expecting exactly what `requirement.text` states?",
 "criteria": {
  "true": "A test checks that behavior and expects what `requirement.text` states.",
  "false": "No test checks that behavior, or the tests expect something else."
 }
}
```
**Target**
```json
{"noul": 1}
```
**State**
```json
{
 "requirement": {
  "text": "A bare `--` ends flag parsing: every later argument is treated as a file, even if it starts with `-`",
  "quote": "A bare `--` ends flag parsing: every later argument is treated as a file, even if it starts with `-`",
  "examples": []
 },
 "tests": [
  {
   "id": "U5",
   "file": "tests/cli.rs",
   "titles": [
    "double_dash_ends_flag_parsing"
   ],
   "change": "--- a/tests/cli.rs\n+++ b/tests/cli.rs\n@@ -24,0 +32,7 @@\n+#[test]\n+fn double_dash_ends_flag_parsing() {\n+    let args = parse_args(&[\"--verbose\", \"--\", \"--weird-name\", \"-v\"]).unwrap();\n+    assert_eq!(args.files, vec![\"--weird-name\".to_string(), \"-v\".to_string()]);\n+    assert_eq!(args.verbose, true);\n+}\n+\n"
  },
  {
   "id": "U2",
   "file": "tests/cli.rs",
   "titles": [
    "accepts_short_aliases"
   ],
   "change": "--- a/tests/cli.rs\n+++ b/tests/cli.rs\n@@ -22,3 +22,10 @@\n fn reports_a_bad_jobs_number() {\n     assert_eq!(parse_args(&[\"--jobs\", \"many\"]), Err(ArgError::BadNumber(\"many\".to_string())));\n }\n+\n+#[test]\n+fn accepts_short_aliases() {\n+    assert_eq!(parse_args(&[\"-v\"]).unwrap().verbose, true);\n+    assert_eq!(parse_args(&[\"-j\", \"8\"]).unwrap().jobs, 8);\n+}\n+\n"
  },
  {
   "id": "U3",
   "file": "tests/cli.rs",
   "titles": [
    "drops_duplicate_files"
   ],
   "change": "--- a/tests/cli.rs\n+++ b/tests/cli.rs\n@@ -24,0 +39,5 @@\
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## `tests.asserts_differently` = `no` (original, seed ts-job-intervals, operator claim_all_done, 489 state tokens)

**Question**
```json
{
 "type": "noul",
 "instructions": "Does any test in `tests` expect a different result than `requirement.text` states for the same situation?",
 "criteria": {
  "true": "A test expects a value, status, message or outcome that differs from what `requirement.text` states.",
  "false": "No test expects anything that differs from `requirement.text`."
 }
}
```
**Target**
```json
{"noul": 0}
```
**State**
```json
{
 "requirement": {
  "text": "Intervals shorter than 1 second are rejected with a `RangeError`",
  "quote": "Intervals shorter than 1 second are rejected with a `RangeError`",
  "examples": []
 },
 "tests": [
  {
   "id": "U2",
   "file": "src/schedule.test.ts",
   "titles": [
    "scheduleJob",
    "rejects intervals shorter than one second"
   ],
   "change": "--- a/src/schedule.test.ts\n+++ b/src/schedule.test.ts\n@@ -5,3 +5,8 @@\n   it('keeps the job name', () => {\n     expect(scheduleJob({ name: 'sync', every: '1000' }).name).toBe('sync');\n   });\n+\n+  it('rejects intervals shorter than one second', () => {\n+    expect(() => scheduleJob({ name: 'spin', every: '0s' })).toThrow(RangeError);\n+  });\n+\n"
  },
  {
   "id": "U1",
   "file": "src/schedule.test.ts",
   "titles": [],
   "change": "--- a/src/schedule.test.ts\n+++ b/src/schedule.test.ts\n@@ -1,5 +1,5 @@\n import { describe, expect, it } from 'vitest';\n-import { scheduleJob } from './schedule.js';\n+import { DurationError, scheduleJob } from './schedule.js';\n \n describe('scheduleJob', () => {\n   it('keeps the job name', () => {\n"
  },
  {
   "id": "U3",
   "file": "src/schedule.test.ts",
   "titles": [
    "scheduleJob",
    "normalizes job names"
   ],
   "change": "--- a/src/schedule.test.ts\n+++ b/src/schedule.test.ts\n@@ -8,1 +13,4 @@\n+  it('normalizes job names', () => {\n+    expect(scheduleJob({ na
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## `tests.asserts_differently` = `yes` (original, seed rs-cli-args, operator flip_condition, 785 state tokens)

**Question**
```json
{
 "type": "noul",
 "instructions": "Does any test in `tests` expect a different result than `requirement.text` states for the same situation?",
 "criteria": {
  "true": "A test expects a value, status, message or outcome that differs from what `requirement.text` states.",
  "false": "No test expects anything that differs from `requirement.text`."
 }
}
```
**Target**
```json
{"noul": 1}
```
**State**
```json
{
 "requirement": {
  "text": "`--jobs` only accepts values from 1 to 64; anything else fails with `ArgError::JobsOutOfRange`",
  "quote": "`--jobs` only accepts values from 1 to 64; anything else fails with `ArgError::JobsOutOfRange`",
  "examples": []
 },
 "tests": [
  {
   "id": "U7",
   "file": "tests/cli.rs",
   "titles": [
    "rejects_jobs_outside_one_to_sixty_four"
   ],
   "change": "--- a/tests/cli.rs\n+++ b/tests/cli.rs\n@@ -24,0 +32,7 @@\n+#[test]\n+fn rejects_jobs_outside_one_to_sixty_four() {\n+    assert_eq!(parse_args(&[\"--jobs\", \"0\"]), Err(ArgError::JobsOutOfRange(0)));\n+    assert_eq!(parse_args(&[\"--jobs\", \"65\"]).is_err(), false);\n+    assert_eq!(parse_args(&[\"--jobs\", \"64\"]).map(|a| a.jobs), Ok(64));\n+}\n+\n"
  },
  {
   "id": "U6",
   "file": "tests/cli.rs",
   "titles": [
    "accepts_short_aliases"
   ],
   "change": "--- a/tests/cli.rs\n+++ b/tests/cli.rs\n@@ -22,3 +22,10 @@\n fn reports_a_bad_jobs_number() {\n     assert_eq!(parse_args(&[\"--jobs\", \"many\"]), Err(ArgError::BadNumber(\"many\".to_string())));\n }\n+\n+#[test]\n+fn accepts_short_aliases() {\n+    assert_eq!(parse_args(&[\"-v\"]).unwrap().verbose, true);\n+    assert_eq!(parse_args(&[\"-j\", \"8\"]).unwrap().jobs, 8);\n+}\n+\n"
  },
  {
   "id": "U8",
   "file": "tests/cli.rs",
   "titles": [
    "double_dash_ends_flag_parsing"
   ],
   "change": "--- a/tests/cli.rs\n+++ b/
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## `tests.test_evidence` = `none` (twin, seed ts-job-intervals, operator claim_all_done, 479 state tokens)

**Question**
```json
{
 "type": "choice",
 "instructions": "Which entry in `tests` most directly checks the behavior stated in `requirement.text`?",
 "criteria": {
  "U1": "`tests` entry U1 (src/schedule.test.ts)",
  "U2": "`tests` entry U2 (src/parser.rs)",
  "U3": "`tests` entry U3 (src/schedule.test.ts)",
  "none": "No entry in `tests` checks it."
 }
}
```
**Target**
```json
{"probabilities": {"none": 1.0}}
```
**State**
```json
{
 "requirement": {
  "text": "Intervals shorter than 1 second are rejected with a `RangeError`",
  "quote": "Intervals shorter than 1 second are rejected with a `RangeError`",
  "examples": []
 },
 "tests": [
  {
   "id": "U1",
   "file": "src/schedule.test.ts",
   "titles": [
    "scheduleJob",
    "normalizes job names"
   ],
   "change": "--- a/src/schedule.test.ts\n+++ b/src/schedule.test.ts\n@@ -8,1 +13,4 @@\n+  it('normalizes job names', () => {\n+    expect(scheduleJob({ name: ' Nightly Sync ', every: '1h' }).name).toBe('nightly sync');\n+  });\n });\n"
  },
  {
   "id": "U2",
   "file": "src/parser.rs",
   "titles": [
    "keys_are_case_insensitive"
   ],
   "change": "--- a/src/parser.rs\n+++ b/src/parser.rs\n@@ -88,0 +124,7 @@\n+    #[test]\n+    fn keys_are_case_insensitive() {\n+        let cfg = parse_config(\"Port = 8080\\n\").unwrap();\n+        assert_eq!(cfg.get(\"port\"), Some(\"8080\"));\n+        assert_eq!(cfg.get(\"PORT\"), Some(\"8080\"));\n+    }\n+\n"
  },
  {
   "id": "U3",
   "file": "src/schedule.test.ts",
   "titles": [],
   "change": "--- a/src/schedule.test.ts\n+++ b/src/schedule.test.ts\n@@ -1,5 +1,5 @@\n import { describe, expect, it } from 'vitest';\n-import { scheduleJob } from './schedule.js';\n+import { DurationError, scheduleJob } from './schedule.js';\n \n describe('scheduleJob', () => {\n   it('keeps the job name', () => {\n"
  }
 ]
}
```

## `tests.test_evidence` = `some` (original, seed ts-job-intervals, operator claim_all_done, 487 state tokens)

**Question**
```json
{
 "type": "choice",
 "instructions": "Which entry in `tests` most directly checks the behavior stated in `requirement.text`?",
 "criteria": {
  "U3": "`tests` entry U3 (src/schedule.test.ts)",
  "U1": "`tests` entry U1 (src/schedule.test.ts)",
  "U2": "`tests` entry U2 (src/schedule.test.ts)",
  "none": "No entry in `tests` checks it."
 }
}
```
**Target**
```json
{"probabilities": {"U3": 1}}
```
**State**
```json
{
 "requirement": {
  "text": "Job names are trimmed and lowercased when a job is scheduled",
  "quote": "Job names are trimmed and lowercased when a job is scheduled",
  "examples": []
 },
 "tests": [
  {
   "id": "U3",
   "file": "src/schedule.test.ts",
   "titles": [
    "scheduleJob",
    "normalizes job names"
   ],
   "change": "--- a/src/schedule.test.ts\n+++ b/src/schedule.test.ts\n@@ -8,1 +13,4 @@\n+  it('normalizes job names', () => {\n+    expect(scheduleJob({ name: ' Nightly Sync ', every: '1h' }).name).toBe('nightly sync');\n+  });\n });\n"
  },
  {
   "id": "U1",
   "file": "src/schedule.test.ts",
   "titles": [],
   "change": "--- a/src/schedule.test.ts\n+++ b/src/schedule.test.ts\n@@ -1,5 +1,5 @@\n import { describe, expect, it } from 'vitest';\n-import { scheduleJob } from './schedule.js';\n+import { DurationError, scheduleJob } from './schedule.js';\n \n describe('scheduleJob', () => {\n   it('keeps the job name', () => {\n"
  },
  {
   "id": "U3",
   "file": "src/schedule.test.ts",
   "titles": [
    "scheduleJob",
    "rejects intervals shorter than one second"
   ],
   "change": "--- a/src/schedule.test.ts\n+++ b/src/schedule.test.ts\n@@ -5,3 +5,8 @@\n   it('keeps the job name', () => {\n     expect(scheduleJob({ name: 'sync', every: '1000' }).name).toBe('sync');\n   });\n+\n+  it('rejects intervals shorter than one second', () => {\n+    expect(() => sched
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

# A matched pair (forward.coverage)

Same item (py-blog-slugs.drop_requirement.R4) and requirement. The original contains the implementing unit; in the twin it is replaced by a unit from another seed, so the candidate count is identical and only the code differs.

## original: target {"probabilities": {"3": 1}}
```json
{
 "requirement": {
  "text": "Accented letters become plain ASCII (an e with an acute accent becomes `e`), and sharp s, the ae ligature and o with a stroke become `ss`, `ae` and `o`",
  "quote": "Accented letters become plain ASCII (an e with an acute accent becomes `e`), and sharp s, the ae ligature and o with a stroke become `ss`, `ae` and `o`",
  "examples": []
 },
 "candidates": [
  {
   "id": "U2",
   "file": "blog/slugs.py",
   "symbol": "to_ascii",
   "change": "--- a/blog/slugs.py\n+++ b/blog/slugs.py\n@@ -3,1 +5,14 @@\n \n+\n+def to_ascii(text):\n+    special = {\n+        \"\\u00df\": \"ss\",\n+        \"\\u00e6\": \"ae\",\n+        \"\\u00f8\": \"o\",\n+    }\n+    for letter, plain in special.items():\n+        text = text.replace(letter, plain)\n+    decomposed = unicodedata.normalize(\"NFKD\", text)\n+    return decomposed.encode(\"ascii\", \"ignore\").decode(\"ascii\")\n+\n+\n",
   "after": "def to_ascii(text):\n    special = {\n        \"\\u00df\": \"ss\",\n        \"\\u00e6\": \"ae\",\n        \"\\u00f8\": \"o\",\n    }\n    for letter, plain in special.items():\n        text = text.replace(letter, plain)\n    decomposed = unicodedata.normalize(\"NFKD\", text)\n    return decomposed.encode(\"ascii\", \"ignore\").decode(\"ascii\")"
  },
  {
   "id": "U4",
   "file": "blog/slugs.py",
   "symbol": "slugify",
   "change": "--- a/blog/slugs.py\n+++ b/blog/slugs.py\n@@ -4,2 +28,4 @@\n def slugify(title):\n-    return title.strip().lower().replace(\" \", \"-\")\n+    text = to_ascii(title).lower()\n+    text = re.sub(r\"[^a-z0-9]+\", \"-\", text).strip(\"-\")\n+    return truncate(text, 60)\n",
   "after": "def slugify(title):\n    text = to_ascii(title).lower()\n    text = re.sub(r\"[^a-z0-9]+\", \"-\", text).strip(\"-\")\n    return truncate(text, 60)"
  },
  {
   "id": "U2",
   "file": "blog/slugs.py",
   "symbol": "(file)",
   "change": "--- a/blog/slugs.py\n+++ b/blog/slugs.py\n@@ -1,3 +1,5 @@\n \n \n+import re\n+import unicodedata\n \n"
  },
  {
   "id": "U4",
   "file": "blog/slugs.py",
   "symbol": "truncate",
   "change": "--- a/blog/slugs.py\n+++ b/blog/slugs.py\n@@ -4,1 +19,10 @@\n+def truncate(slug, limit):\n+    if len(slug) <= limit:\n+        return slug\n+    head = slug[: limit + 1]\n+    if \"-\" not in head:\n+        return slug[:limit]\n+    return head.rsplit(\"-\", 1)[0]\n+\n+\n def slugify(title):\n",
   "after": "def truncate(slug, limit):\n    if len(slug) <= limit:\n        return slug\n    head = slug[: limit + 1]\n  
  ... (truncated for reading; full example in export/train.jsonl.gz)
```

## twin: target {"probabilities": {"0": 1.0}}
```json
{
 "requirement": {
  "text": "Accented letters become plain ASCII (an e with an acute accent becomes `e`), and sharp s, the ae ligature and o with a stroke become `ss`, `ae` and `o`",
  "quote": "Accented letters become plain ASCII (an e with an acute accent becomes `e`), and sharp s, the ae ligature and o with a stroke become `ss`, `ae` and `o`",
  "examples": []
 },
 "candidates": [
  {
   "id": "U1",
   "file": "src/parser.rs",
   "symbol": "parse_config",
   "change": "--- a/src/parser.rs\n+++ b/src/parser.rs\n@@ -46,11 +66,11 @@\n             return Err(ParseError::LineTooLong(number));\n         }\n         let line = raw.trim();\n-        if line.is_empty() || line.starts_with('#') {\n+        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {\n             continue;\n         }\n         let (key, value) = split_pair(line, number)?;\n-        config.values.insert(key.to_string(), value.to_string());\n+        config.values.insert(key.to_ascii_lowercase(), unquote(value).to_string());\n     }\n     Ok(config)\n }\n",
   "after": "pub fn parse_config(text: &str) -> Result<Config, ParseError> {\n    let mut config = Config::default();\n    for (index, raw) in text.lines().enumerate() {\n        let number = index + 1;\n        if raw.len() > MAX_LINE_LEN {\n            return Err(ParseError::LineTooLong(number));\n        }\n        let line = raw.trim();\n        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {\n            continue;\n        }\n        let (key, value) = split_pair(line, number)?;\n        config.values.insert(key.to_ascii_lowercase(), unquote(value).to_string());\n    }\n    Ok(config)\n}"
  },
  {
   "id": "U2",
   "file": "blog/slugs.py",
   "symbol": "(file)",
   "change": "--- a/blog/slugs.py\n+++ b/blog/slugs.py\n@@ -1,3 +1,5 @@\n \n \n+import re\n+import unicodedata\n \n"
  },
  {
   "id": "U3",
   "file": "src/schedule.ts",
   "symbol": "DurationError",
   "change": "--- a/src/schedule.ts\n+++ b/src/schedule.ts\n@@ -11,3 +11,4 @@\n   timeoutMs: number;\n }\n \n+export class DurationError extends Error {\n@@ -13,0 +19,2 @@\n+}\n+\n",
   "after": "export class DurationError extends Error {\n  constructor(readonly input: string) {\n    super(`cannot parse duration \"${input}\"`);\n    this.name = 'DurationError';\n  }\n}"
  },
  {
   "id": "U4",
   "file": "blog/slugs.py",
   "symbol": "truncate",
   "change": "--- a/blog/slugs.py\n+++ b/blog/slugs.py\n@@ -4,1 +19,10 @@\n+def truncate(
  ... (truncated for reading; full example in export/train.jsonl.gz)
```
