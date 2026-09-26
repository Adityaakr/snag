/**
 * `pnpm eval:mine-seeds`: mines real seed candidates (BUILD_PROMPT G.2) into eval/corpora/mutations/real/. Needs
 * GITHUB_TOKEN; every response is cached under eval/cassettes/github so reruns are free.
 */
import { join } from 'node:path';
import { EVAL_ROOT, mineSeeds } from '@remit/eval';
import { CachedGitHub, FileStore, LiveGitHub } from '@remit/providers';

const token = process.env.GITHUB_TOKEN;
if (!token) {
  process.stderr.write('GITHUB_TOKEN is not set; real seeds are skipped (see .agent/BLOCKERS.md B6).\n');
  process.exit(0);
}
const gh = new CachedGitHub(
  new LiveGitHub({ token }),
  new FileStore(join(EVAL_ROOT, 'cassettes')),
  'replay_or_live',
);
const result = await mineSeeds(gh);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
