/** Action entry point, bundled to dist/index.js. Grammars ship next to the bundle. */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAction } from './action.js';

const here = dirname(fileURLToPath(import.meta.url));
process.env.REMIT_GRAMMAR_DIR ??= join(here, 'grammars');
runAction({
  env: process.env,
  out: (t) => process.stdout.write(t),
  calibrationDir: join(here, 'calibration'),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    process.stdout.write(`::error title=Remit::${message.replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}\n`);
    process.exitCode = 1;
  },
);
