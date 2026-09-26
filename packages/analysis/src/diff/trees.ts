/** Unified diff between two in-memory trees (path to text), in `git diff` format with 3 lines of context. */
import { createTwoFilesPatch } from 'diff';

export type FileTree = Record<string, string>;

export function diffTrees(base: FileTree, head: FileTree): string {
  const paths = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
  let out = '';
  for (const p of paths) {
    const b = base[p];
    const h = head[p];
    if (b === h) continue;
    const header =
      b === undefined
        ? `diff --git a/${p} b/${p}\nnew file mode 100644\n`
        : h === undefined
          ? `diff --git a/${p} b/${p}\ndeleted file mode 100644\n`
          : `diff --git a/${p} b/${p}\n`;
    const patch = createTwoFilesPatch(
      b === undefined ? '/dev/null' : `a/${p}`,
      h === undefined ? '/dev/null' : `b/${p}`,
      b ?? '',
      h ?? '',
      '',
      '',
      { context: 3 },
    );
    out += header + patch.split('\n').slice(1).join('\n').replace(/\t$/gm, '');
  }
  return out;
}
