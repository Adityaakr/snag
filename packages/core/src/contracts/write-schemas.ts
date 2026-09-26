// Writes schemas/<Contract>.json from the zod contracts. Run with `pnpm schemas`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportJsonSchemas } from './index.js';

export function renderSchemas(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(exportJsonSchemas()).map(([name, schema]) => [
      `${name}.json`,
      `${JSON.stringify(schema, null, 2)}\n`,
    ]),
  );
}

export function writeSchemas(dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  const files = renderSchemas();
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
  return Object.keys(files);
}

if (process.argv[1]?.endsWith('write-schemas.ts')) {
  const written = writeSchemas(join(import.meta.dirname, '..', '..', '..', '..', 'schemas'));
  console.log(`wrote ${written.length} schemas to schemas/`);
}
