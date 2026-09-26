import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, QUESTION_SET_VERSION } from '@remit/core';
import { describe, expect, it } from 'vitest';
import { calibrateOnDev, calibrationPath, loadCalibration, writeCalibration } from './calibrate.js';
import { SEEDS_ROOT, seedItems } from './mutations/generate.js';
import { loadSeed } from './mutations/seed.js';
import { runItems } from './runner.js';
import { objective, tuneThresholds, withThresholds } from './tuning.js';

const items = async () => seedItems(loadSeed(join(SEEDS_ROOT, 'ts-job-intervals')));
const weights = defaultConfig().eval;

describe('threshold tuning', () => {
  it('scores outcomes with the cost weights', async () => {
    const { outcomes } = await runItems(await items(), { mode: 'simulated' });
    const o = objective(outcomes, weights);
    expect(o.cost).toBe(3 * o.falseP0 + 2 * o.missed + o.falseP1);
    expect(objective(outcomes, { cost_false_p0: 0, cost_missed_problem: 0, cost_false_p1: 0 }).cost).toBe(0);
  });

  it('never ends worse than the defaults and keeps defaults on ties', async () => {
    const r = await tuneThresholds(await items(), { mode: 'simulated' }, weights, {
      keys: ['missing', 'behavior'],
      grid: [0.5, 0.95],
    });
    expect(r.after.cost).toBeLessThanOrEqual(r.before.cost);
    expect(r.evaluations).toBe(1 + 2 * 2);
    for (const s of r.steps) expect(r.thresholds[s.key as 'missing']).toBeDefined();
    const flat = await tuneThresholds(
      await items(),
      { mode: 'simulated' },
      { cost_false_p0: 0, cost_missed_problem: 0, cost_false_p1: 0 },
      { keys: ['missing'], grid: [0.5] },
    );
    expect(flat.thresholds).toEqual({});
  });

  it('overrides item thresholds without touching the rest of the config', async () => {
    const [first] = withThresholds(await items(), { missing: 0.9 });
    expect(first?.config.thresholds.missing).toBe(0.9);
    expect(first?.config.thresholds.full).toBe(defaultConfig().thresholds.full);
  });
});

describe('calibrateOnDev', () => {
  it('fits (identity below 50 samples), tunes, measures and round-trips through storage', async () => {
    const r = await calibrateOnDev(
      await items(),
      { mode: 'simulated' },
      weights,
      { id: 'cal-test', jevModel: 'simulated-jev' },
      { keys: ['missing'], grid: [0.6, 0.9] },
    );
    expect(r.calibration.questionSet).toBe(QUESTION_SET_VERSION);
    expect(Object.values(r.fits).every((f) => f.n < 50 === f.identity)).toBe(true);
    expect(r.calibration.p0Precision).toBeGreaterThanOrEqual(0);
    const root = mkdtempSync(join(tmpdir(), 'remit-cal-'));
    const path = writeCalibration(root, r);
    expect(path).toBe(calibrationPath(root, 'simulated-jev'));
    const loaded = loadCalibration(root, 'simulated-jev');
    expect(loaded?.id).toBe('cal-test');
    expect(loaded).not.toHaveProperty('fits');
    expect(loadCalibration(root, 'jev-1.13.0')).toBeUndefined();
  });
});
