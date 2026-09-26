# Providers

Verified facts about the model providers Remit calls. Checked on `2026-09-26` against the live TypeSafe docs, the TypeSafe JavaScript SDK source at tag `v0.6.0`, the TypeSafe agent skill, and the npm registry. If the docs change, the docs win and this file gets updated.

Legend: **CONFIRMED** means the docs say what the spec says. **DIFFERENT** means the docs say something else. **NOT FOUND** means the docs do not mention it.

## Differences from spec

These go into `DECISIONS.md`.

1. **Token overflow error is not documented.** No page mentions a `max_tokens_exceeded` error code, and the documented HTTP error table has no `400` row. It lists `401`, `422` (body failed validation), `429` and `529`. The SDK still maps `400` to `BadRequestError` and `422` to `UnprocessableEntityError`. Remit should treat both `400` and `422` as possible overflow, detect overflow by inspecting `err.body`, and rely on its own pre-flight token estimate as the main guard. ([API reference](https://docs.typesafe.ai/api.md), [SDK errors source](https://github.com/typesafe-ai/typesafe-sdk-js/blob/v0.6.0/src/errors.ts))
2. **`529` has no own SDK class.** The SDK maps every status `>= 500`, including `529`, to `InternalServerError`. Check `err.status === 529` to tell overload apart. ([SDK errors source](https://github.com/typesafe-ai/typesafe-sdk-js/blob/v0.6.0/src/errors.ts))
3. **The SDK already retries.** Default `RetryPolicy`: `maxRetries` `2`, backoff from `500` ms doubling to `5000` ms, jitter `0.25`, honors `Retry-After` and `retry-after-ms` up to `60000` ms, retries statuses `408`, `429` and `500` to `599`, plus connection errors and timeouts. The spec's own 5-attempt backoff would stack on top of this. Pick one layer: either pass `retry: { maxRetries: 0 }` and keep Remit's loop (so the token bucket sees every attempt), or drop Remit's loop and set `maxRetries: 4`. ([RetryPolicy](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy.md))
4. **Default timeout is `10000` ms per attempt,** with no total budget across retries. ([TypeSafeClientConfig](https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig.md), [RequestOptions](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RequestOptions.md))
5. **More error classes than the spec lists.** Besides the six in the spec, the SDK exports `TypeSafeError` (base), `APIError` (any non-2xx), `PermissionDeniedError` (`403`), `NotFoundError` (`404`), `UnprocessableEntityError` (`422`) and `APIUserAbortError` (abort signal). `APITimeoutError` extends `APIConnectionError`, so check for the timeout class first. ([SDK API reference](https://docs.typesafe.ai/sdk/javascript/api.md))
6. **Score answers also carry `legend`,** and every answer carries a `type` field. Score `probabilities` are keyed by the level index as a string (`"0"`, `"1"`, ...). `score` is an expected value and can fall between levels. ([API reference](https://docs.typesafe.ai/api.md), [ScoreResponse](https://docs.typesafe.ai/sdk/javascript/api/interfaces/ScoreResponse.md))
7. **Per-call options also take `headers`,** and `retry` is a partial `RetryPolicy`. ([RequestOptions](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RequestOptions.md))
8. **`GET /v1/models` lists only aliases** (`jev-latest`, `jev-preview`). Versioned IDs such as `jev-1.13.0` are accepted by the `model` field whether or not they appear in the list. So `remit doctor` cannot verify `jev-1.13.0` by listing models; it has to make a tiny `systemOne` call with `model: "jev-1.13.0"` and check `response.model`. ([Models](https://docs.typesafe.ai/models.md))
9. **Score needs at least `2` levels.** The SDK throws before sending if `criteria` has fewer than two entries. The API accepts up to `10`. ([TypeSafeClient.systemOne](https://docs.typesafe.ai/sdk/javascript/api/classes/TypeSafeClient.md), [API reference](https://docs.typesafe.ai/api.md))
10. **Extra environment variables.** Besides `TYPESAFE_API_KEY`, the SDK reads `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL` (default `jev-latest`) and `TYPESAFE_LOG_LEVEL` (default `warn`). At `debug` the SDK logs request bodies unredacted, which would leak code into logs; Remit should pass `logLevel` explicitly and never use `debug` in CI. Remit should always pass `model` explicitly so `TYPESAFE_DEFAULT_MODEL` cannot override the pin. ([ENV](https://docs.typesafe.ai/sdk/javascript/api/variables/ENV.md), [TypeSafeClientConfig](https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig.md))
11. **`usage.output_tokens` is non-zero** in responses (for example `20`), but output tokens are free. Cost is `input_tokens` times price only. ([API reference](https://docs.typesafe.ai/api.md), [Models](https://docs.typesafe.ai/models.md))
12. **Rate limits are explicitly unstable.** The docs warn they are "adjusting dynamically" and "can change without notice". Values match the spec. ([Models](https://docs.typesafe.ai/models.md))

## TypeSafe facts (spec 7.2)

| Fact | Status | What the docs say |
| --- | --- | --- |
| Package `@typesafe-ai/sdk`, Node 20+ | CONFIRMED | `npm install @typesafe-ai/sdk`, "Node.js 20 or newer". npm `engines.node` is `>=20`. ([JavaScript SDK](https://docs.typesafe.ai/sdk/javascript.md)) |
| `new TypeSafeClient()` reads `TYPESAFE_API_KEY` | CONFIRMED | `new TypeSafeClient(config?)`. `apiKey` "falls back to `TYPESAFE_API_KEY`". Throws if the key is missing. ([TypeSafeClient](https://docs.typesafe.ai/sdk/javascript/api/classes/TypeSafeClient.md), [TypeSafeClientConfig](https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig.md)) |
| `client.systemOne({ state, questions, model })` returns `{ answers, model, usage }` | CONFIRMED | `systemOne<Q>(request, options?): APIPromise<SystemOneResult<Q>>`. Result has `answers`, `model`, `usage`. `model` is optional in the SDK (defaults to `defaultModel`), required in raw HTTP. ([TypeSafeClient](https://docs.typesafe.ai/sdk/javascript/api/classes/TypeSafeClient.md), [SystemOneResult](https://docs.typesafe.ai/sdk/javascript/api/interfaces/SystemOneResult.md)) |
| Per-call options (timeout, retry, signal) in second argument | CONFIRMED, plus `headers` | `RequestOptions = { headers?, retry?: Partial<RetryPolicy>, signal?: AbortSignal, timeout?: number }`. ([RequestOptions](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RequestOptions.md)) |
| `choice(instructions, { key: description \| null })` | CONFIRMED | `choice<T extends ChoiceCriteria>(instructions: EntryType, criteria: T)`. `ChoiceCriteria = { [label: string]: EntryType }`. ([choice](https://docs.typesafe.ai/sdk/javascript/api/functions/choice.md)) |
| `score(instructions, [level descriptions])` | CONFIRMED | `score<T extends ScoreCriteria>(instructions: EntryType, criteria: T)`. `ScoreCriteria = readonly [EntryType, EntryType, ...EntryType[]]`. Array form since SDK `v0.6.0` (breaking change from an integer-keyed object). ([score](https://docs.typesafe.ai/sdk/javascript/api/functions/score.md), [changelog](https://docs.typesafe.ai/sdk/javascript/changelog.md)) |
| `noul(instructions, ...)` with optional true/false criteria | CONFIRMED, shape below | `noul(instructions?: EntryType = null, criteria?: { true?: EntryType; false?: EntryType } \| null)`. Second argument is an object with optional `true` and `false` keys. ([noul](https://docs.typesafe.ai/sdk/javascript/api/functions/noul.md)) |
| Choice answer: `choice`, `probabilities`, `confidence` | CONFIRMED | Plus `type: "choice"`. `choice` is the highest-probability option. ([ChoiceResponse](https://docs.typesafe.ai/sdk/javascript/api/interfaces/ChoiceResponse.md)) |
| Score answer: `score`, per-level `probabilities`, `confidence` | DIFFERENT (superset) | Also `legend` and `type: "score"`. `score` is the expected value. ([ScoreResponse](https://docs.typesafe.ai/sdk/javascript/api/interfaces/ScoreResponse.md)) |
| Noul answer: `noul` `0` to `1`, no confidence | CONFIRMED | `noul` is "probability of a yes answer, from zero to one". Plus `type: "noul"`. ([NoulResponse](https://docs.typesafe.ai/sdk/javascript/api/interfaces/NoulResponse.md), [Primitives](https://docs.typesafe.ai/primitives.md)) |
| Question IDs not sent; option keys and descriptions are | CONFIRMED | "The key is not sent to the underlying model and is not used in inference." ([API reference](https://docs.typesafe.ai/api.md)). "The option names and their descriptions are both sent to the model." ([Choice](https://docs.typesafe.ai/primitives/choice.md)) |
| `POST https://api.typesafe.ai/v1/systemone` | CONFIRMED | Bearer auth, JSON body. SDK uses path `/v1/systemone` on base `https://api.typesafe.ai`. ([API reference](https://docs.typesafe.ai/api.md)) |
| Model `jev-1.13.0` exists | CONFIRMED | Listed as the current model. `jev-latest` and `jev-preview` both point to it today. Response `model` reports the versioned ID. ([Models](https://docs.typesafe.ai/models.md)) |
| `32k` tokens state plus longest question | CONFIRMED | ([Models](https://docs.typesafe.ai/models.md)) |
| `64k` tokens state plus all questions | CONFIRMED | "64k tokens per request". ([Models](https://docs.typesafe.ai/models.md)) |
| `255` options per Choice | CONFIRMED | ([API reference](https://docs.typesafe.ai/api.md)) |
| `10` levels per Score | CONFIRMED | "the API accepts up to 10", minimum `2`. ([API reference](https://docs.typesafe.ai/api.md)) |
| HTTP `400` `max_tokens_exceeded` | NOT FOUND | No page mentions it. Documented errors: `401`, `422`, `429`, `529`. ([API reference](https://docs.typesafe.ai/api.md)) |
| About `1200` requests per minute, `250k` tokens per second | CONFIRMED | "250,000 tokens per second / 1,200 requests per minute", may change without notice. ([Models](https://docs.typesafe.ai/models.md)) |
| `429` rate limited, `529` overloaded | CONFIRMED | ([API reference](https://docs.typesafe.ai/api.md)) |
| `$0.042` per million input tokens, output free | CONFIRMED | "$42 / $0.042" per Btok / Mtok. "Output tokens are free." ([Models](https://docs.typesafe.ai/models.md)) |
| Error classes `RateLimitError`, `BadRequestError`, `AuthenticationError`, `APIConnectionError`, `APITimeoutError`, `InternalServerError` | CONFIRMED, plus more | All six exist. Also `TypeSafeError`, `APIError`, `PermissionDeniedError`, `NotFoundError`, `UnprocessableEntityError`, `APIUserAbortError`. ([SDK API reference](https://docs.typesafe.ai/sdk/javascript/api.md)) |

### Other useful facts

- `APIError` has `status`, `body`, `headers` and `requestId` (from `x-typesafe-request-id`). `RateLimitError` adds `retryAfterMs`. ([APIError](https://docs.typesafe.ai/sdk/javascript/api/classes/APIError.md), [RateLimitError](https://docs.typesafe.ai/sdk/javascript/api/classes/RateLimitError.md))
- `systemOne` returns an `APIPromise` with `withResponse()` (gives `data`, `response`, `requestId`) and `asResponse()`. Logging `requestId` helps support tickets. ([APIPromise](https://docs.typesafe.ai/sdk/javascript/api/classes/APIPromise.md), [WithResponse](https://docs.typesafe.ai/sdk/javascript/api/interfaces/WithResponse.md))
- `state`, `instructions` and every criteria entry accept `EntryType = string | { [key: string]: JsonValue } | JsonValue[] | null`. ([EntryType](https://docs.typesafe.ai/sdk/javascript/api/type-aliases/EntryType.md), [Advanced: structure](https://docs.typesafe.ai/primitives/advanced.md))
- Extra properties on the request object are forwarded to the API, including `null` values. Build the request object explicitly. ([SystemOneRequest](https://docs.typesafe.ai/sdk/javascript/api/interfaces/SystemOneRequest.md))
- `client.models.list()` returns `ModelCard[]` with `name`, `description`, `release_date`. ([Models interface](https://docs.typesafe.ai/sdk/javascript/api/interfaces/Models.md))
- Questions in one request run in parallel and cannot see each other's answers. ([Primitives](https://docs.typesafe.ai/primitives.md), [Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out.md))
- `confidence` is a statistic of the Choice or Score probability distribution; flatter means lower. The exact formula is not published. ([Confidence](https://docs.typesafe.ai/confidence.md))
- Jev input is text only. English is the best-supported language. Jev is not trained on customer requests. ([Models](https://docs.typesafe.ai/models.md))
- The jaggedness page (last reviewed `2026-09-17`) lists nine failure modes: literal reading, math and numbers, date comparison, indirection, large irrelevant state, adversarial content, contradictory instructions and criteria, structural invariants, generation. These match spec 7.5 rules 1 to 8. The page also says not to interpolate exact magnitudes from Score expectations. ([Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md))
- Cookbook patterns relevant to Remit: re-ranking uses one Noul per query and candidate pair and sorts by `noul`, with criteria that fix `true` and `false` ([Re-ranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe.md)); line-by-line search uses one Choice with line IDs as option keys and `null` descriptions, plus a Noul for "does the document contain an answer", since Choice probabilities always sum to `1` ([Line-by-line search](https://docs.typesafe.ai/cookbooks/semantic_find.md)); citation check uses one Choice with `supports`, `contradicts`, `says_nothing` and an auto-accept confidence threshold of `0.8` ([Double-checking citations](https://docs.typesafe.ai/cookbooks/citation_check.md)).
- The TypeSafe agent skill is installed locally at `~/.claude/plugins/marketplaces/typesafe-ai/skills/typesafe-ai/SKILL.md` and is identical to the [GitHub copy](https://raw.githubusercontent.com/typesafe-ai/skills/main/skills/typesafe-ai/SKILL.md). It adds no API facts beyond the docs; it points back to them as the source of truth.

## Versions from npm

Checked with `npm view` on `2026-09-26`.

| Package | Version | Notes |
| --- | --- | --- |
| `@typesafe-ai/sdk` | `0.6.0` | dist-tag `latest` is `0.6.0`; `time.modified` `2026-09-15T18:17:19.633Z`; `engines.node` `>=20`. SDK `VERSION` constant is `"0.6.0"`. |
| `@anthropic-ai/sdk` | `0.128.0` | |
| `openai` | `7.23.0` | |

## TypeScript call shapes

As documented in the SDK reference for `v0.6.0`.

### Client

```ts
import {
  TypeSafeClient, choice, score, noul,
  RateLimitError, BadRequestError, UnprocessableEntityError,
  AuthenticationError, APITimeoutError, APIConnectionError, InternalServerError,
} from "@typesafe-ai/sdk";

// Reads TYPESAFE_API_KEY. All config fields are optional.
const client = new TypeSafeClient({
  defaultModel: "jev-1.13.0",
  timeout: 10_000,            // ms per attempt
  retry: { maxRetries: 0 },   // if Remit owns the retry loop
  logLevel: "warn",
});
```

### Choice

```ts
const res = await client.systemOne(
  {
    model: "jev-1.13.0",
    state: { requirement: { text: "..." }, candidates: [/* ... */] },
    questions: {
      relation: choice("How does `candidate` relate to `requirement.text`?", {
        supports: "The candidate implements what the requirement asks for",
        contradicts: "The candidate does the opposite of what the requirement asks for",
        none: "The candidate does not address the requirement",
      }),
    },
  },
  { timeout: 15_000, signal: controller.signal },
);
res.answers.relation.choice;         // "supports" | "contradicts" | "none"
res.answers.relation.probabilities;  // { supports: number, contradicts: number, none: number }
res.answers.relation.confidence;     // number, 0 to 1
res.model;                           // "jev-1.13.0"
res.usage.input_tokens;              // number
```

### Score

```ts
const res = await client.systemOne({
  model: "jev-1.13.0",
  state: { requirement: { text: "..." }, diff: "..." },
  questions: {
    coverage: score("How completely does `diff` implement `requirement.text`?", [
      "Nothing in `diff` addresses the requirement",
      "Touches the area but implements none of it",
      "Implements part of it",
      "Implements all of it",
    ]),
  },
});
res.answers.coverage.score;          // expected value, can be fractional
res.answers.coverage.probabilities;  // { "0": number, "1": number, "2": number, "3": number }
res.answers.coverage.legend;         // { "0": "...", ... }
res.answers.coverage.confidence;     // number, 0 to 1
```

### Noul

```ts
const res = await client.systemOne({
  model: "jev-1.13.0",
  state: { test: "..." },
  questions: {
    loosens_test: noul("Does `test` remove or weaken an assertion?", {
      true: "An assertion was deleted, made less strict, or skipped",
      false: "Every assertion is as strict as before or stricter",
    }),
    plain: noul("Is `test` a snapshot test?"), // criteria optional
  },
});
res.answers.loosens_test.noul;       // number, 0 to 1; no confidence field
```

### Error handling

```ts
try {
  const { data, requestId } = await client
    .systemOne({ model: "jev-1.13.0", state, questions })
    .withResponse();
} catch (err) {
  if (err instanceof RateLimitError) { /* 429, err.retryAfterMs */ }
  else if (err instanceof InternalServerError && err.status === 529) { /* overloaded */ }
  else if (err instanceof BadRequestError || err instanceof UnprocessableEntityError) {
    /* 400 or 422; inspect err.body for token overflow */
  }
  else if (err instanceof AuthenticationError) { /* 401 */ }
  else if (err instanceof APITimeoutError) { /* check before APIConnectionError */ }
  else if (err instanceof APIConnectionError) { /* network */ }
}
```

## Anthropic

- SDK package: `@anthropic-ai/sdk`, current npm version `0.128.0`.
- Model ID verification: `remit doctor` lists models through the Models API and checks the configured ids; see "Doctor results" below.

## OpenRouter (OpenAI-compatible)

Extraction can run through any OpenAI-compatible endpoint. OpenRouter serves the same Claude models.

- Put `OPENAI_COMPATIBLE_API_KEY` and `OPENAI_COMPATIBLE_BASE_URL=https://openrouter.ai/api/v1` in `.env`.
- Use `config/openrouter.remit.yml` (`--config config/openrouter.remit.yml`), or copy its `extraction` and `llm_prices` blocks into a repository's `.remit.yml`.
- OpenRouter model ids use dots: `anthropic/claude-opus-5.5`. On `2026-09-27` it listed `$4` in and `$20` out per million tokens, the same as Anthropic direct, with `response_format` and structured outputs supported.
- In the App, budgets use the operator's price table. Add the model with `REMIT_LLM_PRICES='{"anthropic/claude-opus-5.5":{"input":4,"output":20}}'`, or the App will not call it.
- OpenRouter covers extraction only. Every verdict still needs Jev (`TYPESAFE_API_KEY`).

## Doctor results

`remit doctor` checks Node, keys, config, TypeSafe connectivity (a one-question `systemOne` call that must be answered by the pinned `jev-1.13.0`, since `/v1/models` lists aliases only), the Anthropic Models API (the configured `extraction.model` and `baseline.model` must be listed), GitHub rate-limit headroom, and prints a fix for every failure.

Run on `2026-09-26` in the build environment, which has no keys yet:

| Check | Result |
| --- | --- |
| Node | `v22.23.2`, ok |
| Config | no `.remit.yml`, defaults |
| `TYPESAFE_API_KEY`, `ANTHROPIC_API_KEY` | not set (blocker B1) |
| `GITHUB_TOKEN` | not set, warning |
| TypeSafe model `jev-1.13.0` | skipped: no key |
| Anthropic model `claude-opus-5-5` | skipped: no key; not yet verified against the Models API |
| GitHub | reachable, `59/60` unauthenticated requests left |

Rerun on `2026-09-27` with an OpenRouter key (`pnpm remit doctor --config config/openrouter.remit.yml`):

| Check | Result |
| --- | --- |
| Config | `config/openrouter.remit.yml` is valid |
| `OPENAI_COMPATIBLE_API_KEY` | set |
| OpenRouter model `anthropic/claude-opus-5.5` | available, priced for budgets |
| `TYPESAFE_API_KEY` | not set: TypeSafe and every verdict still unverified (B1, B2) |
| GitHub | reachable, `58/60` unauthenticated requests left |

When the TypeSafe and Anthropic keys are added, rerun `pnpm remit doctor` and replace the skipped rows with the live results.
