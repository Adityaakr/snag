/**
 * `pnpm eval:export-shadow`: writes corpus C items from the database in DATABASE_URL (or the local PGlite in
 * DATA_DIR) to eval/corpora/shadow/{dev,test}. Run `pnpm eval:freeze --append` afterwards for new test files.
 */
import { join } from 'node:path';
import { CORPORA_ROOT } from '@remit/eval';
import { openPglite, openPostgres } from '../../packages/server/src/db/client.js';
import { DbStore } from '../../packages/server/src/db/store.js';
import { shadowRecords, writeShadowCorpus } from '../../packages/server/src/export.js';

const env = process.env;
const database = env.DATABASE_URL
  ? await openPostgres(env.DATABASE_URL)
  : await openPglite(join(env.DATA_DIR ?? '.data', 'pgdata'));
const records = await shadowRecords(new DbStore(database.db));
const counts = writeShadowCorpus(records, CORPORA_ROOT);
process.stdout.write(`${JSON.stringify({ records: records.length, ...counts })}\n`);
await database.close();
