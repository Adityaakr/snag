// Bundles the Action to dist/index.js (ESM, node24) and copies the tree-sitter runtime and grammars next to it.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const require = createRequire(join(here, '..', 'analysis', 'package.json'));
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'grammars'), { recursive: true });
await build({
  entryPoints: [join(here, 'src', 'main.ts')],
  outfile: join(dist, 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  conditions: ['source'],
  legalComments: 'linked',
  // Some dependencies use require() at runtime; give the ESM bundle one.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
});
copyFileSync(require.resolve('web-tree-sitter/web-tree-sitter.wasm'), join(dist, 'web-tree-sitter.wasm'));
for (const g of [
  'tree-sitter-typescript/tree-sitter-typescript.wasm',
  'tree-sitter-typescript/tree-sitter-tsx.wasm',
  'tree-sitter-javascript/tree-sitter-javascript.wasm',
  'tree-sitter-python/tree-sitter-python.wasm',
  'tree-sitter-rust/tree-sitter-rust.wasm',
])
  copyFileSync(require.resolve(g), join(dist, 'grammars', g.split('/')[1]));
writeFileSync(join(dist, 'package.json'), '{ "type": "module" }\n');
console.log('built packages/action/dist');
