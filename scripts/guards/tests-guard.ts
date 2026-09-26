/**
 * guard:tests (BUILD_PROMPT 3.6): run Remit's own code-fact detectors on test files changed since the last
 * `m*-done` tag and fail on any high-severity test-weakening fact, unless .agent/DECISIONS.md names that exact
 * `file:line` with a reason. Checks the working tree (so it runs before a commit), including untracked files.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildUnits, detectFacts, parseDiff } from '@remit/analysis';
import { createTwoFilesPatch } from 'diff';

export const WEAKENING = new Set([
  'assertion_removed',
  'assertion_weakened',
  'test_skipped',
  'test_focused',
  'test_deleted',
]);

const git = (root: string, args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** The most recent `m<N>-done` tag reachable from HEAD, or null. */
export function lastMilestoneTag(root: string): string | null {
  try {
    return git(root, ['describe', '--tags', '--abbrev=0', '--match', 'm*-done', 'HEAD']).trim() || null;
  } catch {
    return null;
  }
}

export async function checkTests(root: string): Promise<{ problems: string[]; note?: string }> {
  const tag = lastMilestoneTag(root);
  if (!tag) return { problems: [], note: 'no m*-done tag yet; nothing to compare' };
  let text = git(root, [
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--find-renames',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    tag,
  ]);
  for (const path of git(root, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)) {
    const content = readFileSync(join(root, path), 'utf8');
    if (content.includes('\0')) continue;
    text += `diff --git a/${path} b/${path}\nnew file mode 100644\n${createTwoFilesPatch('/dev/null', `b/${path}`, '', content).split('\n').slice(1).join('\n').replace(/\t$/gm, '')}`;
  }
  const contents = {
    async get(side: 'base' | 'head', path: string) {
      if (side === 'head')
        return existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null;
      try {
        return git(root, ['show', `${tag}:${path}`]);
      } catch {
        return null;
      }
    },
  };
  const { units } = await buildUnits(parseDiff(text), { contents });
  const testUnits = units.filter((u) => u.kind === 'test');
  const { units: withFacts } = await detectFacts(testUnits, { contents });
  const decisionsPath = join(root, '.agent', 'DECISIONS.md');
  const decisions = existsSync(decisionsPath) ? readFileSync(decisionsPath, 'utf8') : '';
  const problems: string[] = [];
  for (const u of withFacts) {
    for (const f of u.facts) {
      if (f.severity !== 'high' || !WEAKENING.has(f.kind)) continue;
      const where = `${u.file}:${f.line ?? 0}`;
      if (decisions.includes(where)) continue;
      problems.push(
        `${where} ${f.kind}: ${f.detail} (since ${tag}; allow only with a DECISIONS.md entry naming ${where} and a reason)`,
      );
    }
  }
  return { problems };
}

if (process.argv[1]?.endsWith('tests-guard.ts')) {
  const { problems, note } = await checkTests(process.cwd());
  if (note) console.log(note);
  for (const p of problems) console.log(p);
  process.exitCode = problems.length ? 1 : 0;
}
