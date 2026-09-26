import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { BRAND, parseConfig, type RemitConfig } from '@remit/core';
import { CliError } from './errors.js';

/** Loads `.remit.yml` from the working directory, or `--config <path>`. Invalid config is a usage error. */
export function loadConfig(cwd: string, path?: string): RemitConfig {
  const file = path ? (isAbsolute(path) ? path : join(cwd, path)) : join(cwd, `.${BRAND.slug}.yml`);
  if (!existsSync(file)) {
    if (path)
      throw new CliError(
        `Config file ${path} does not exist.`,
        `Check the path, or drop --config to use .${BRAND.slug}.yml.`,
      );
    return parseConfig('').config;
  }
  const { config, errors } = parseConfig(readFileSync(file, 'utf8'));
  if (errors.length)
    throw new CliError(
      `The config is invalid:\n  ${errors.join('\n  ')}`,
      `Fix ${file}, or run \`${BRAND.slug} init\` for a commented template.`,
    );
  return config;
}
