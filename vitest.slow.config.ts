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
// Subpath exports first: aliases match by prefix, in order.
const alias = Object.fromEntries([
  ['@remit/core/brand', fileURLToPath(new URL('./packages/core/src/brand.ts', import.meta.url))],
  ...packages.map((name) => [
    `@remit/${name}`,
    fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
  ]),
]);

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['packages/*/src/**/*.slow.test.ts'],
    passWithNoTests: true,
    testTimeout: 120_000,
  },
});
