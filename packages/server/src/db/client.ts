/**
 * Database connections: PGlite (tests, local runs) or Postgres through node-postgres (production), both behind the
 * same Drizzle interface, with the drizzle-kit migrations in packages/server/drizzle applied at startup.
 */
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzleLite } from 'drizzle-orm/pglite';
import { migrate as migrateLite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const MIGRATIONS = join(import.meta.dirname, '..', '..', 'drizzle');
/** A fixed advisory lock id for migrations. */
export const MIGRATION_LOCK = 7_212_024;

export interface Database {
  db: Db;
  /** For pg-boss and other clients that need a connection string (Postgres only). */
  connectionString?: string;
  close(): Promise<void>;
}

/** An in-process PGlite database (memory when `dataDir` is omitted), migrated. */
export async function openPglite(dataDir?: string): Promise<Database & { client: PGlite }> {
  const client = dataDir ? await PGlite.create(dataDir) : await PGlite.create();
  const db = drizzleLite(client, { schema });
  await migrateLite(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Db, client, close: () => client.close() };
}

/** Postgres through node-postgres, migrated. Only parameterized queries go through Drizzle (9.11). */
export async function openPostgres(
  connectionString: string,
  opts: { onError?: (error: Error) => void } = {},
): Promise<Database> {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // An idle connection dropped by the server (a database restart, a failover) emits 'error' on the pool; without a
  // listener that crashes the process. The pool replaces the connection on the next query.
  pool.on('error', (e) => opts.onError?.(e));
  const db = drizzlePg(pool, { schema });
  // Web and worker processes start together: an advisory lock makes exactly one of them run the migrations.
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await migratePg(drizzlePg(client, { schema }), { migrationsFolder: MIGRATIONS });
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
  return { db: db as unknown as Db, connectionString, close: () => pool.end() };
}
