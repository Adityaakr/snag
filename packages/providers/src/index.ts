import { BRAND } from '@remit/core';

export * from './cache/store.js';
export * from './common/abort.js';
export * from './common/budget.js';
export * from './common/circuit.js';
export * from './common/errors.js';
export * from './common/limits.js';
export * from './common/retry.js';
export * from './env.js';
export {
  type AppCredentials,
  appJwt,
  appSlug,
  convertManifest,
  installationToken,
  type ManifestConversion,
} from './github/app.js';
export { CachedGitHub } from './github/cached.js';
export { exchangeOAuthCode, type OAuthOptions, type OAuthUser, oauthUser } from './github/oauth.js';
export { githubContents, type PullDiff, pullDiff } from './github/diff.js';
export { type FakeCheckRun, FakeGitHub, type FakeIssue, type FakePull } from './github/fake.js';
export { closingKeywordRefs, linkIssues, plainRefs } from './github/links.js';
export {
  classifyGitHubError,
  LiveGitHub,
  type LiveGitHubOptions,
  MAX_CONTENT_BYTES,
  MAX_PR_FILES,
} from './github/live.js';
export { commentRole, isBotComment } from './github/roles.js';
export { markerOf, type StickyKind, upsertSticky, withMarker } from './github/sticky.js';
export * from './http/http.js';
export * from './http/zip.js';
export * from './github/types.js';
export { toAnswers } from './jev/answers.js';
export { CachedJev } from './jev/cached.js';
export { FakeJev, type JevScript, type RecordedCall, type ScriptedAnswer } from './jev/fake.js';
export { classifyJevError, LiveJev, type LiveJevOptions, processJevLimiter } from './jev/live.js';
export * from './jev/types.js';
export {
  entropyConfidence,
  LLM_JEV_PROMPT_VERSION,
  LLM_JEV_SYSTEM,
  LlmJev,
  type LlmJevOptions,
  normalize,
  toJevAnswers,
} from './jev/llm.js';
export { validateAnswers } from './jev/validate.js';
export {
  AnthropicLlm,
  type AnthropicLlmOptions,
  acceptsTemperature,
  classifyAnthropicError,
  type Effort,
} from './llm/anthropic.js';
export { CachedLlm } from './llm/cached.js';
export { FakeLlm, type LlmScript } from './llm/fake.js';
export { classifyOpenAiError, OpenAiCompatibleLlm, type OpenAiCompatibleOptions } from './llm/openai.js';
export { parseStructured, repairMessages, withRepair } from './llm/repair.js';
export * from './llm/types.js';

/** The package name, used by smoke tests to prove workspace wiring. */
export const PACKAGE = '@remit/providers';

/** Returns a label that proves this package can import @remit/core. */
export function describePackage(): string {
  return `${BRAND.name} ${PACKAGE}`;
}
