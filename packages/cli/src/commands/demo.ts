/**
 * `remit demo` (BUILD_PROMPT 10.1): golden scenarios 1 and 2 offline, with scripted answers. Prints the terminal
 * table and a comment preview for each, in under 10 s. No keys and no network.
 */
import { BRAND, renderComment, renderTerminal } from '@remit/core';
import { loadScenario, runScenario } from '@remit/pipeline';
import type { Io } from '../io.js';

export const DEMO_SCENARIOS = [
  {
    name: 'three_reqs_one_missing',
    blurb: 'An issue asks for three things; the PR does two and its description claims all three.',
  },
  {
    name: 'misread_self_consistent',
    blurb: 'The issue asks for 404; the PR returns 400 and its own test asserts 400, so the tests pass.',
  },
];

export async function demoCommand(_argv: string[], io: Io): Promise<number> {
  const started = Date.now();
  io.out(
    `${BRAND.name} demo: two recorded reviews, offline. Answers are scripted, so this shows the plumbing and the output, not model quality.\n\n`,
  );
  for (const [i, s] of DEMO_SCENARIOS.entries()) {
    const { result } = await runScenario(loadScenario(s.name));
    io.out(`== Scenario ${i + 1}: ${s.name}\n${s.blurb}\n\n`);
    io.out(renderTerminal(result, { color: Boolean(process.stdout.isTTY) && !io.env.NO_COLOR }));
    io.out(`\n-- PR comment preview --\n${renderComment(result, { reviewId: `demo_${i + 1}` })}\n`);
  }
  io.out(
    `Done in ${((Date.now() - started) / 1000).toFixed(1)} s. Next: \`${BRAND.slug} init\`, then \`${BRAND.slug} review --issue issue.md --diff main...HEAD\` with keys in .env.\n`,
  );
  return 0;
}
