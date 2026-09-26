/**
 * `remit mutate --seed <path>` or `remit mutate --all` (BUILD_PROMPT 10.1, G.1): generates corpus B items (the clean
 * seed plus every mutation operator) and writes them to the seed's split under eval/corpora/mutations/.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BRAND } from '@remit/core';
import { CORPORA_ROOT, SEEDS_ROOT, seedDirs, writeSeedItems } from '@remit/eval';
import { CliError, EXIT } from '../errors.js';
import type { Io } from '../io.js';

export async function mutateCommand(argv: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      seed: { type: 'string' },
      all: { type: 'boolean', default: false },
      out: { type: 'string' },
      seeds: { type: 'string' },
    },
  });
  if (!values.seed && !values.all)
    throw new CliError(
      'remit mutate needs --seed <path> or --all.',
      `Run \`${BRAND.slug} mutate --seed eval/corpora/mutations/seeds/<id>\`.`,
    );
  const out = values.out ? resolve(io.cwd, values.out) : CORPORA_ROOT;
  const dirs = values.seed
    ? [resolve(io.cwd, values.seed)]
    : seedDirs(values.seeds ? resolve(io.cwd, values.seeds) : SEEDS_ROOT);
  if (!dirs.length)
    throw new CliError('No seeds found.', 'Seeds live in eval/corpora/mutations/seeds/<id>/.');
  for (const dir of dirs) {
    let r: Awaited<ReturnType<typeof writeSeedItems>>;
    try {
      r = await writeSeedItems(dir, out);
    } catch (e) {
      throw new CliError(
        `Seed ${dir} failed: ${(e as Error).message.split('\n')[0]}`,
        'Fix the seed annotation.',
      );
    }
    const ops = Object.entries(r.operators)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    io.out(`${r.seed}: ${r.items} items to ${r.split} (${ops})\n`);
  }
  return EXIT.ok;
}
