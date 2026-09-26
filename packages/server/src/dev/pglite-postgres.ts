/** A Postgres stand-in for local smoke runs without Docker: PGlite on the Postgres wire protocol. */
import { startPgliteServer } from '../db/pglite-server.js';

const server = await startPgliteServer();
process.stdout.write(`${server.url}\n`);
process.on('SIGTERM', () => void server.stop().then(() => process.exit(0)));
process.on('SIGINT', () => void server.stop().then(() => process.exit(0)));
