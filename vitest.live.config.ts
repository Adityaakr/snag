import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The app loads keys from .env at runtime; existing environment variables win.
if (existsSync('.env')) process.loadEnvFile('.env');
for (const key of ['TYPESAFE_API_KEY', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN']) {
  if (!process.env[key]) process.stdout.write(`skipped: ${key} not set\n`);
}

const packages = [
  'core',
  'analysis',
  'providers',
  'pipeline',
  'cli',
  'server',
  'dashboard',
  'action',
  'eval',
];
const alias = Object.fromEntries(
  packages.map((name) => [
    `@remit/${name}`,
    fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
  ]),
);

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['packages/*/src/**/*.live.test.ts'],
    passWithNoTests: true,
    testTimeout: 120_000,
  },
});
