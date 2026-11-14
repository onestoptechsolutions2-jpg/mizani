import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

export const MIGRATIONS = path.resolve(__dirname, '../migrations');

// Forward-only, versioned, one transaction per file, advisory-locked so two
// migrators can never race on the same database.
export async function migrate(pool: Pool, kind: 'tenant' | 'control'): Promise<string[]> {
  const dir = path.join(MIGRATIONS, kind);
  const c = await pool.connect();
  const applied: string[] = [];
  try {
    await c.query('select pg_advisory_lock(727274)');
    await c.query('create table if not exists schema_migrations(version text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await c.query('select version from schema_migrations')).rows.map((r) => r.version));
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      await c.query('begin');
      try {
        await c.query("set local lock_timeout = '10s'");
        await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
        await c.query('insert into schema_migrations(version) values ($1)', [f]);
        await c.query('commit');
        applied.push(f);
      } catch (e: any) {
        await c.query('rollback').catch(() => {});
        throw new Error(`migration ${kind}/${f} failed: ${e.message}`);
      }
    }
    return applied;
  } finally {
    await c.query('select pg_advisory_unlock(727274)').catch(() => {});
    c.release();
  }
}
export const latestVersion = (kind: 'tenant' | 'control') =>
  fs.readdirSync(path.join(MIGRATIONS, kind)).filter((x) => x.endsWith('.sql')).sort().pop() || '';
