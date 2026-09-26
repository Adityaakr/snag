import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
    include: ['packages/*/src/**/*.slow.test.ts'],
    passWithNoTests: true,
    testTimeout: 120_000,
  },
});
