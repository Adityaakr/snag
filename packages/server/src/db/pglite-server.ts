/**
 * PGlite behind the Postgres wire protocol on a local port, so clients that need a real connection (pg-boss,
 * node-postgres) run in tests without a Postgres server.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

export async function startPgliteServer(): Promise<{ url: string; stop: () => Promise<void> }> {
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 100 });
  await server.start();
  const address = (
    server as unknown as { server?: { address(): { port: number } | string | null } }
  ).server?.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  if (!port) throw new Error('PGlite socket server did not report a port');
  return {
    url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
    stop: async () => {
      await server.stop();
      await db.close();
    },
  };
}
