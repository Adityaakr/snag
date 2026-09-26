/**
 * Reference counting for `new_symbol_unreferenced` using `git grep` over the head tree (or the working tree in
 * local CLI mode). Test files and the definition line do not count.
 */
import { execFileSync } from 'node:child_process';
import { classifyFile } from '../files/classify.js';
import type { ReferenceIndex } from './api.js';

export class GitGrepReferences implements ReferenceIndex {
  /** @param sha commit to search; omit to search the working tree. */
  constructor(
    readonly cwd: string,
    readonly sha?: string,
  ) {}

  async count(name: string, definedAt: { file: string; line: number }): Promise<number | null> {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
    let out: string;
    try {
      const args = ['grep', '-n', '-w', '-F', '-I', '-e', name];
      if (this.sha) args.push(this.sha);
      out = execFileSync('git', args, {
        cwd: this.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (e) {
      // git grep exits 1 when nothing matches.
      if ((e as { status?: number }).status === 1) return 0;
      return null;
    }
    let count = 0;
    for (const row of out.split('\n')) {
      if (!row) continue;
      const parts = this.sha ? row.split(':').slice(1) : row.split(':');
      const [file, lineNo] = parts as [string, string];
      if (file === definedAt.file && Number(lineNo) === definedAt.line) continue;
      if (classifyFile(file).kind === 'test') continue;
      count++;
    }
    return count;
  }
}
