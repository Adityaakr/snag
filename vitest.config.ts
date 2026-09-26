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
const src = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));
// Subpath exports first: aliases match by prefix, in order.
const alias = Object.fromEntries([
  ['@remit/core/brand', fileURLToPath(new URL('./packages/core/src/brand.ts', import.meta.url))],
  ...packages.map((name) => [`@remit/${name}`, src(name)]),
]);

export default defineConfig({
  resolve: { alias },
  test: {
    setupFiles: [fileURLToPath(new URL('./scripts/test-setup.ts', import.meta.url))],
    projects: [
      ...packages.map((name) => ({
        resolve: { alias },
        test: {
          name,
          root: `./packages/${name}`,
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/**/*.slow.test.ts', 'src/**/*.live.test.ts'],
          setupFiles: [fileURLToPath(new URL('./scripts/test-setup.ts', import.meta.url))],
        },
      })),
      {
        resolve: { alias },
        test: {
          name: 'scripts',
          root: './scripts',
          include: ['__tests__/**/*.test.{ts,mjs}'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: {
        'packages/core/src/**': { lines: 90 },
        'packages/analysis/src/**': { lines: 90 },
        'packages/pipeline/src/**': { lines: 75 },
        'packages/providers/src/**': { lines: 75 },
        'packages/cli/src/**': { lines: 75 },
        'packages/server/src/**': { lines: 75 },
        'packages/eval/src/**': { lines: 75 },
      },
    },
  },
});
