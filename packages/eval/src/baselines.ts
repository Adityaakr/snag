/**
 * Baselines (BUILD_PROMPT 11.6): `single_pass` (one frontier LLM call per item, Appendix B.2) and the optional
 * `pr_agent` (Qodo PR-Agent ticket compliance). Comparisons, not gates.
 */
import { execFileSync } from 'node:child_process';

/** Whether a baseline can run here, and why not. */
export async function baselineNote(name: string, env: Record<string, string | undefined>): Promise<string> {
  if (name === 'single_pass')
    return env.ANTHROPIC_API_KEY
      ? 'available (run with keys; see docs/eval.md)'
      : 'skipped: ANTHROPIC_API_KEY not set';
  if (name === 'pr_agent') {
    try {
      execFileSync('pr-agent', ['--help'], { stdio: 'ignore' });
      return 'available';
    } catch {
      return 'skipped: pr-agent is not installed (pip install pr-agent)';
    }
  }
  return `unknown baseline ${name}`;
}
