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
export async function openPostgres(connectionString: string): Promise<Database> {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzlePg(pool, { schema });
  await migratePg(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Db, connectionString, close: () => pool.end() };
}
