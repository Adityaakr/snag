import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSeed, SEEDS_ROOT, seedItems } from '@remit/eval';
import { describe, expect, it } from 'vitest';
import { CliError } from '../errors.js';
import { memoryIo } from '../testing.js';
import { evalCommand } from './eval.js';

const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'remit-eval-'));
  mkdirSync(join(dir, '.agent'));
  writeFileSync(join(dir, '.agent', 'EXPERIMENTS.md'), '# Experiments\n');
  return dir;
};

describe('remit eval', () => {
  it('runs golden scripted at 100%, writes a report and logs a summary line', async () => {
    const dir = tmp();
    const io = memoryIo(dir);
    expect(await evalCommand(['golden'], io.sink)).toBe(0);
    expect(io.out).toContain('Golden accuracy 100% (18/18).');
    const reports = readdirSync(join(dir, 'eval', 'reports'));
    expect(reports).toHaveLength(1);
    expect(existsSync(join(dir, 'eval', 'reports', reports[0] as string, 'report.html'))).toBe(true);
    expect(readFileSync(join(dir, '.agent', 'EXPERIMENTS.md'), 'utf8')).toContain('golden');
  });

  it('runs mutations on the simulated stand-in without keys and marks it', async () => {
    const dir = tmp();
    const items = await seedItems(loadSeed(join(SEEDS_ROOT, 'ts-job-intervals')));
    const io = memoryIo(dir);
    const code = await evalCommand(
      ['mutations', '--split', 'dev', '--limit', '3', '--no-log'],
      io.sink,
      () => items,
    );
    expect(code).toBe(0);
    expect(io.out).toMatch(/simulated/);
    const [report] = readdirSync(join(dir, 'eval', 'reports'));
    const md = readFileSync(join(dir, 'eval', 'reports', report as string, 'report.md'), 'utf8');
    expect(md).toMatch(/not a real measurement/i);
    expect(readFileSync(join(dir, '.agent', 'EXPERIMENTS.md'), 'utf8')).toBe('# Experiments\n');
  });

  it('refuses bad arguments with a fix hint', async () => {
    const dir = tmp();
    const run = (argv: string[], env: Record<string, string> = {}) =>
      evalCommand(argv, memoryIo(dir, env).sink, () => []);
    await expect(run([])).rejects.toBeInstanceOf(CliError);
    await expect(run(['nope'])).rejects.toThrow(/needs a corpus/);
    await expect(run(['mutations', '--split', 'x'])).rejects.toThrow(/not dev or test/);
    await expect(run(['mutations', '--split', 'test'])).rejects.toThrow(/only with --gate/);
    await expect(run(['mutations', '--limit', '0'])).rejects.toThrow(/positive integer/);
    await expect(run(['mutations', '--mode', 'magic'])).rejects.toThrow(/not scripted/);
    await expect(run(['mutations'])).rejects.toMatchObject({
      fix: expect.stringMatching(/remit mutate --all/),
    });
    await expect(run(['swebench'])).rejects.toMatchObject({ fix: expect.stringMatching(/eval:fetch-a/) });
    await expect(run(['shadow'])).rejects.toMatchObject({ fix: expect.stringMatching(/stored feedback/) });
    const items = await seedItems(loadSeed(join(SEEDS_ROOT, 'ts-job-intervals')));
    await expect(
      evalCommand(['mutations', '--mode', 'live'], memoryIo(dir).sink, () => items),
    ).rejects.toThrow(/TYPESAFE_API_KEY/);
  });
});

describe('remit report', () => {
  it('re-renders a saved run and explains bad input', async () => {
    const { reportCommand } = await import('./report.js');
    const dir = tmp();
    const items = await seedItems(loadSeed(join(SEEDS_ROOT, 'ts-job-intervals')));
    await evalCommand(['mutations', '--limit', '2', '--no-log'], memoryIo(dir).sink, () => items);
    const [run] = readdirSync(join(dir, 'eval', 'reports'));
    const io = memoryIo(dir);
    expect(await reportCommand([`eval/reports/${run}`], io.sink)).toBe(0);
    expect(io.out).toMatch(/report\.md and .*report\.html/);
    await expect(reportCommand([], memoryIo(dir).sink)).rejects.toThrow(/one eval run directory/);
    await expect(reportCommand(['nowhere'], memoryIo(dir).sink)).rejects.toThrow(/metrics\.json/);
  });
});
