import { cpSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SEEDS_ROOT } from '@remit/eval';
import { describe, expect, it } from 'vitest';
import { CliError } from '../errors.js';
import { memoryIo } from '../testing.js';
import { mutateCommand } from './mutate.js';

describe('remit mutate', () => {
  it('writes the clean seed and every operator item to the seed split', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'remit-mutate-'));
    cpSync(join(SEEDS_ROOT, 'ts-job-intervals'), join(dir, 'seeds', 'ts-job-intervals'), { recursive: true });
    const io = memoryIo(dir);
    expect(await mutateCommand(['--seed', 'seeds/ts-job-intervals', '--out', 'corpora'], io.sink)).toBe(0);
    expect(io.out).toMatch(/^ts-job-intervals: \d+ items to (dev|test) \(clean 1, drop_requirement 4, /);
    const split = /to (dev|test)/.exec(io.out)?.[1] as string;
    const files = readdirSync(join(dir, 'corpora', 'mutations', split));
    expect(files).toContain('ts-job-intervals.clean.json');
    expect(files.some((f) => f.startsWith('ts-job-intervals.claim_all_done.'))).toBe(true);
    // Rerunning replaces the seed's items instead of adding to them.
    const again = memoryIo(dir);
    await mutateCommand(['--all', '--seeds', 'seeds', '--out', 'corpora'], again.sink);
    expect(readdirSync(join(dir, 'corpora', 'mutations', split))).toEqual(files);
  });

  it('explains missing arguments and bad seeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'remit-mutate-'));
    await expect(mutateCommand([], memoryIo(dir).sink)).rejects.toBeInstanceOf(CliError);
    await expect(mutateCommand(['--all', '--seeds', 'nowhere'], memoryIo(dir).sink)).rejects.toThrow(
      /No seeds/,
    );
    await expect(mutateCommand(['--seed', 'nowhere'], memoryIo(dir).sink)).rejects.toThrow(/Seed .* failed/);
  });
});
