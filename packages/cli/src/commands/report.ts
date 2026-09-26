/** `remit report <eval-run>` (BUILD_PROMPT 10.1, 11.9): re-renders an eval run's markdown and HTML reports. */
import { resolve } from 'node:path';
import { BRAND } from '@remit/core';
import { rerenderReport } from '@remit/eval';
import { CliError, EXIT } from '../errors.js';
import type { Io } from '../io.js';

export async function reportCommand(argv: string[], io: Io): Promise<number> {
  const dir = argv[0];
  if (!dir || argv.length > 1)
    throw new CliError(
      'remit report needs one eval run directory.',
      `Run \`${BRAND.slug} report eval/reports/<timestamp>\`.`,
    );
  try {
    const { md, html } = rerenderReport(resolve(io.cwd, dir));
    io.out(`Wrote ${md} and ${html}\n`);
  } catch (e) {
    throw new CliError((e as Error).message, 'Pass a directory written by `remit eval`.');
  }
  return EXIT.ok;
}
