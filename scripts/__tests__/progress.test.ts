import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without type declarations
import { checkTerminal, hasOpenBlocker, main, parseProgress, summarize } from '../progress.mjs';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const ALL_TAGS = Array.from({ length: 11 }, (_, i) => `m${i}-done`);

function fixture(name: string, file = 'PROGRESS.md'): string {
  return readFileSync(join(FIXTURES, name, file), 'utf8');
}

function sink() {
  let text = '';
  return {
    write: (s: string) => {
      text += s;
      return true;
    },
    get text() {
      return text;
    },
  };
}

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Copies a fixture into a temp git repo as .agent/ and applies tags. */
function repoFrom(name: string, tags: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'remit-progress-'));
  temps.push(dir);
  cpSync(join(FIXTURES, name), join(dir, '.agent'), { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  for (const tag of tags) git('tag', tag);
  return dir;
}

describe('parseProgress', () => {
  it('reads milestones, statuses and items', () => {
    const ms = parseProgress(fixture('in-progress'));
    expect(ms.map((m: { number: number }) => m.number)).toEqual([0, 1, 2]);
    expect(ms[1].status).toBe('IN_PROGRESS');
    expect(ms[1].items).toHaveLength(3);
  });

  it.each([
    ['malformed-no-headings', /No milestone sections/],
    ['malformed-unknown-status', /unknown status "FINISHED"/],
    ['malformed-missing-status', /no "Status:" line/],
    ['malformed-duplicate', /appears twice/],
  ])('rejects %s', (name, message) => {
    expect(() => parseProgress(fixture(name))).toThrow(message);
  });
});

describe('summarize', () => {
  it('counts items and finds the current milestone', () => {
    const summary = summarize(parseProgress(fixture('in-progress')));
    expect(summary.milestones[1]).toEqual({ milestone: 'M1', status: 'IN_PROGRESS', checked: 1, total: 3 });
    expect(summary.current).toBe('M1');
  });
});

describe('checkTerminal', () => {
  it('passes when every required milestone is DONE with evidence and tags', () => {
    expect(checkTerminal(parseProgress(fixture('all-done')), { tags: ALL_TAGS, blockersText: '' })).toEqual(
      [],
    );
  });

  it('fails a DONE milestone without its tag', () => {
    const tags = ALL_TAGS.filter((t) => t !== 'm4-done');
    expect(checkTerminal(parseProgress(fixture('all-done')), { tags, blockersText: '' })).toEqual([
      'M4: DONE but git tag m4-done is missing',
    ]);
  });

  it('fails a DONE milestone with an unchecked item', () => {
    const reasons = checkTerminal(parseProgress(fixture('done-unchecked')), {
      tags: ALL_TAGS,
      blockersText: '',
    });
    expect(reasons).toEqual(['M3: DONE but 1 item(s) unchecked']);
  });

  it('fails a checked item without evidence', () => {
    const reasons = checkTerminal(parseProgress(fixture('done-no-evidence')), {
      tags: ALL_TAGS,
      blockersText: '',
    });
    expect(reasons).toEqual(['M2: 1 checked item(s) lack "(evidence:"']);
  });

  it('accepts BLOCKED-HUMAN with an open blocker that has unblock steps', () => {
    const reasons = checkTerminal(parseProgress(fixture('blocked-ok')), {
      tags: ALL_TAGS,
      blockersText: fixture('blocked-ok', 'BLOCKERS.md'),
    });
    expect(reasons).toEqual([]);
  });

  it('rejects BLOCKED-HUMAN when the open blocker has no unblock step', () => {
    const reasons = checkTerminal(parseProgress(fixture('blocked-no-unblock')), {
      tags: ALL_TAGS,
      blockersText: fixture('blocked-no-unblock', 'BLOCKERS.md'),
    });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/^M10: BLOCKED-HUMAN/);
  });

  it('does not let a blocker for M10 satisfy M1', () => {
    const reasons = checkTerminal(parseProgress(fixture('blocked-wrong-milestone')), {
      tags: ALL_TAGS,
      blockersText: fixture('blocked-wrong-milestone', 'BLOCKERS.md'),
    });
    expect(reasons).toEqual([
      'M1: BLOCKED-HUMAN but BLOCKERS.md has no open item mentioning M1 with "unblock:"',
    ]);
  });

  it('reports missing and non-terminal milestones', () => {
    const reasons = checkTerminal(parseProgress(fixture('in-progress')), {
      tags: ['m0-done'],
      blockersText: '',
    });
    expect(reasons).toContain('M1: status is IN_PROGRESS');
    expect(reasons).toContain('M2: status is TODO');
    expect(reasons).toContain('M3: missing from PROGRESS.md');
  });

  it('matches milestone numbers on word boundaries', () => {
    expect(hasOpenBlocker('- [ ] B1 M10 x | unblock: y', 1)).toBe(false);
    expect(hasOpenBlocker('- [ ] B1 M1 x | unblock: y', 1)).toBe(true);
    expect(hasOpenBlocker('- [x] B1 M1 x | unblock: y', 1)).toBe(false);
  });
});

describe('main (CLI)', () => {
  it('prints the summary by default', () => {
    const out = sink();
    const code = main([], { root: repoFrom('in-progress'), out, err: sink() });
    expect(code).toBe(0);
    expect(out.text).toBe('M0 DONE 1/1\nM1 IN_PROGRESS 1/3\nM2 TODO 0/1\ncurrent: M1\n');
  });

  it('prints JSON with --json', () => {
    const out = sink();
    expect(main(['--json'], { root: repoFrom('in-progress'), out, err: sink() })).toBe(0);
    expect(JSON.parse(out.text).current).toBe('M1');
  });

  it('--check succeeds only with real git tags', () => {
    const out = sink();
    expect(main(['--check'], { root: repoFrom('all-done', ALL_TAGS), out, err: sink() })).toBe(0);
    expect(out.text).toBe('ALL REQUIRED MILESTONES TERMINAL\n');

    const out2 = sink();
    expect(main(['--check'], { root: repoFrom('all-done', ['m0-done']), out: out2, err: sink() })).toBe(1);
    expect(out2.text).toContain('M1: DONE but git tag m1-done is missing');
  });

  it('--check reads BLOCKERS.md', () => {
    const out = sink();
    expect(main(['--check'], { root: repoFrom('blocked-ok', ALL_TAGS), out, err: sink() })).toBe(0);
  });

  it('fails cleanly when PROGRESS.md is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'remit-progress-'));
    temps.push(dir);
    const err = sink();
    expect(main([], { root: dir, out: sink(), err })).toBe(1);
    expect(err.text).toMatch(/PROGRESS\.md not found/);
  });

  it('fails cleanly on malformed input without a stack trace', () => {
    const err = sink();
    expect(main(['--check'], { root: repoFrom('malformed-unknown-status'), out: sink(), err })).toBe(1);
    expect(err.text).toMatch(/malformed/);
    expect(err.text).not.toMatch(/\n\s+at /);
  });
});
