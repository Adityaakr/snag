/**
 * Repository config (BUILD_PROMPT 9.3, 10.2): `.remit.yml` from the default branch only, validated. An invalid file
 * falls back to defaults and the errors go into the check run.
 */
import { BRAND, parseConfig, type RemitConfig } from '@remit/core';
import type { GitHubWriter } from '@remit/providers';

export const CONFIG_PATH = `.${BRAND.slug}.yml`;

export interface RepoConfig {
  config: RemitConfig;
  errors: string[];
  branch: string;
}

export async function loadRepoConfig(gh: GitHubWriter, owner: string, repo: string): Promise<RepoConfig> {
  const branch = await gh.getDefaultBranch(owner, repo);
  const file = await gh.getContent(owner, repo, CONFIG_PATH, branch);
  if (!file) return { ...parseConfig(''), branch };
  if (!('content' in file))
    return {
      ...parseConfig(''),
      errors: [`${CONFIG_PATH} was skipped (${file.skipped}); using defaults.`],
      branch,
    };
  const r = parseConfig(file.content);
  return { config: r.config, errors: r.errors.map((e) => `${CONFIG_PATH}: ${e}`), branch };
}
