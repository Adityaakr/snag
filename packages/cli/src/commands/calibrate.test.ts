import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QUESTION_SET_VERSION } from '@remit/core';
import { loadSeed, SEEDS_ROOT, seedItems } from '@remit/eval';
import { describe, expect, it } from 'vitest';
import { memoryIo } from '../testing.js';
import { calibrateCommand } from './calibrate.js';

describe('remit calibrate', () => {
  it('calibrates on dev in simulated mode without keys and writes the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'remit-calibrate-'));
    const items = await seedItems(loadSeed(join(SEEDS_ROOT, 'ts-job-intervals')));
    const io = memoryIo(dir);
    const code = await calibrateCommand(['--out', 'cal', '--limit', '4'], io.sink, (c) =>
      c === 'mutations' ? items : [],
    );
    expect(code).toBe(0);
    expect(io.out).toMatch(/^Simulated \(not a real measurement\)\. Calibrated on 4 dev items/);
    expect(existsSync(join(dir, 'cal', 'simulated-jev', `${QUESTION_SET_VERSION}.json`))).toBe(true);
  }, 60_000);

  it('refuses bad options and live mode without keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'remit-calibrate-'));
    const run = (argv: string[]) => calibrateCommand(argv, memoryIo(dir).sink, () => []);
    await expect(run(['--mode', 'scripted'])).rejects.toThrow(/not simulated or live/);
    await expect(run(['--passes', '0'])).rejects.toThrow(/positive integer/);
    await expect(run([])).rejects.toThrow(/No dev items/);
    const items = await seedItems(loadSeed(join(SEEDS_ROOT, 'ts-job-intervals')));
    await expect(calibrateCommand(['--mode', 'live'], memoryIo(dir).sink, () => items)).rejects.toThrow(
      /TYPESAFE_API_KEY/,
    );
  });
});
