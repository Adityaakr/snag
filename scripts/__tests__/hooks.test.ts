import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const HOOKS = join(import.meta.dirname, '..', 'hooks');
const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'remit-hooks-'));
  temps.push(dir);
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'first commit');
  return dir;
}

function run(hook: string, dir: string, input: string) {
  return spawnSync(join(HOOKS, hook), {
    input,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
}

describe('hook files', () => {
  it.each(['session-start.sh', 'stop-hygiene.sh'])('%s is executable', (hook) => {
    expect(statSync(join(HOOKS, hook)).mode & 0o111).not.toBe(0);
  });
});

describe('session-start.sh', () => {
  it('prints NEXT.md, blockers and recent commits', () => {
    const dir = repo();
    mkdirSync(join(dir, '.agent'));
    writeFileSync(join(dir, '.agent', 'NEXT.md'), 'Do the next thing.\n');
    writeFileSync(
      join(dir, '.agent', 'BLOCKERS.md'),
      '- [ ] B1 M10 keys | unblock: add keys\n- [x] B0 closed\n',
    );
    const r = run(
      'session-start.sh',
      dir,
      JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' }),
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('## Remit build state');
    expect(r.stdout).toContain('Do the next thing.');
    expect(r.stdout).toContain('B1 M10 keys');
    expect(r.stdout).not.toContain('B0 closed');
    expect(r.stdout).toContain('first commit');
  });

  it('works in an empty project', () => {
    const dir = repo();
    const r = run('session-start.sh', dir, '{}');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Follow BUILD_PROMPT.md section 3.');
  });
});

describe('stop-hygiene.sh', () => {
  it('stays quiet on a clean tree', () => {
    const r = run('stop-hygiene.sh', repo(), JSON.stringify({ stop_hook_active: false }));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('asks to commit when the tree is dirty', () => {
    const dir = repo();
    writeFileSync(join(dir, 'x.txt'), 'dirty');
    const r = run('stop-hygiene.sh', dir, JSON.stringify({ stop_hook_active: false }));
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe('Stop');
    expect(out.hookSpecificOutput.additionalContext).toMatch(/Uncommitted changes remain/);
  });

  it('does nothing when the stop hook is already active', () => {
    const dir = repo();
    writeFileSync(join(dir, 'x.txt'), 'dirty');
    const r = run('stop-hygiene.sh', dir, JSON.stringify({ stop_hook_active: true }));
    expect(r.stdout).toBe('');
  });

  it('ignores loop logs', () => {
    const dir = repo();
    // Like the real repo: .agent/ has tracked files, so git lists loop-logs/ on its own line.
    mkdirSync(join(dir, '.agent', 'loop-logs'), { recursive: true });
    writeFileSync(join(dir, '.agent', 'NEXT.md'), 'next');
    execFileSync('git', ['add', '.agent/NEXT.md'], { cwd: dir });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'agent'], {
      cwd: dir,
    });
    writeFileSync(join(dir, '.agent', 'loop-logs', 's.jsonl'), '{}');
    expect(run('stop-hygiene.sh', dir, '{}').stdout).toBe('');
  });

  it('treats malformed input as not active', () => {
    const dir = repo();
    writeFileSync(join(dir, 'x.txt'), 'dirty');
    expect(run('stop-hygiene.sh', dir, 'not json').stdout).toMatch(/Uncommitted/);
  });
});
