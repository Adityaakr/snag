/**
 * PGlite behind the Postgres wire protocol on a local port, so clients that need a real connection (pg-boss,
 * node-postgres) run in tests without a Postgres server. PGlite serves every connection in one session, so
 * advisory locks do not serialize connections here as they do in Postgres.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

export interface PgliteServer {
  url: string;
  stop(): Promise<void>;
  /** Drops every connection and listens again on the same port with the same data (a database restart). */
  restart(downMs?: number): Promise<void>;
}

export async function startPgliteServer(): Promise<PgliteServer> {
  const db = await PGlite.create();
  const listen = async (port: number) => {
    const s = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 100 });
    await s.start();
    return s;
  };
  let server = await listen(0);
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
    restart: async (downMs = 500) => {
      await server.stop();
      await new Promise((r) => setTimeout(r, downMs));
      server = await listen(port);
    },
  };
}
