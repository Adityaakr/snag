import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const settings = JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8'));
const spec = readFileSync(join(ROOT, 'BUILD_PROMPT.md'), 'utf8');

describe('.claude/settings.json (Appendix A.1)', () => {
  it('matches the spec byte for byte', () => {
    const block = /### A\.1 `\.claude\/settings\.json`[\s\S]*?```json\n([\s\S]*?)\n```/.exec(spec)?.[1];
    expect(block).toBeDefined();
    expect(readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8')).toBe(`${block}\n`);
  });

  it('points every hook at an executable script', () => {
    const commands: string[] = Object.values(
      settings.hooks as Record<string, { hooks: { command: string }[] }[]>,
    )
      .flat()
      .flatMap((entry) => entry.hooks.map((h) => h.command));
    expect(commands).toHaveLength(2);
    for (const command of commands) {
      const path = join(ROOT, command.replace(`\${CLAUDE_PROJECT_DIR}/`, ''));
      expect(statSync(path).mode & 0o111).not.toBe(0);
    }
  });

  it('denies reading .env and editing the kit files, and asks before push', () => {
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining([
        'Read(./.env)',
        'Edit(./BUILD_PROMPT.md)',
        'Edit(./GOAL.txt)',
        'Edit(./loop.sh)',
      ]),
    );
    expect(settings.permissions.ask).toEqual(['Bash(git push *)']);
  });
});
