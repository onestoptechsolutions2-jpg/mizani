import { Pool, PoolClient, types } from 'pg';

// int8 -> number (cents fit safely), numeric -> string (exact), date -> 'YYYY-MM-DD' string
types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1700, (v) => v);
types.setTypeParser(1082, (v) => v);

const base = () => ({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
});
export const CONTROL_DB = () => process.env.CONTROL_DB || 'mizani_control';

let _admin: Pool | null = null;
let _control: Pool | null = null;
const tenantPools = new Map<string, { pool: Pool; last: number }>();

export const adminPool = () => (_admin ??= new Pool({ ...base(), database: 'postgres', max: 2 }));
export const controlPool = () => (_control ??= new Pool({ ...base(), database: CONTROL_DB(), max: 8 }));

export async function ensureDatabase(name: string) {
  const r = await adminPool().query('select 1 from pg_database where datname=$1', [name]);
  if (!r.rowCount) await adminPool().query(`create database "${name.replace(/"/g, '')}"`);
}
export async function dropDatabase(name: string) {
  await adminPool().query(`drop database if exists "${name.replace(/"/g, '')}" with (force)`);
}

// Per-tenant pools: small, lazily created, least-recently-used eviction.
export function tenantPool(dbName: string): Pool {
  let e = tenantPools.get(dbName);
  if (!e) {
    const max = parseInt(process.env.TENANT_POOL_MAX || '4', 10);
    e = { pool: new Pool({ ...base(), database: dbName, max, idleTimeoutMillis: 30000 }), last: Date.now() };
    tenantPools.set(dbName, e);
    const limit = parseInt(process.env.TENANT_POOL_CACHE || '50', 10);
    if (tenantPools.size > limit) {
      const oldest = [...tenantPools.entries()].filter(([k]) => k !== dbName).sort((a, b) => a[1].last - b[1].last)[0];
      if (oldest) { oldest[1].pool.end().catch(() => {}); tenantPools.delete(oldest[0]); }
    }
  }
  e.last = Date.now();
  return e.pool;
}
export async function closeTenantPool(dbName: string) {
  const e = tenantPools.get(dbName);
  if (e) { tenantPools.delete(dbName); await e.pool.end().catch(() => {}); }
}
export async function closeAll() {
  for (const [, e] of tenantPools) await e.pool.end().catch(() => {});
  tenantPools.clear();
  await _control?.end().catch(() => {}); _control = null;
  await _admin?.end().catch(() => {}); _admin = null;
}

export async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("set local statement_timeout = '30s'");
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public detail?: any) { super(message); }
}
export const bad = (m: string, d?: any) => new HttpError(400, m, d);
export const conflict = (m: string, d?: any) => new HttpError(409, m, d);
export const forbidden = (m: string) => new HttpError(403, m);
export const notFound = (m: string) => new HttpError(404, m);

export async function q1<T = any>(c: { query: Function }, sql: string, params: any[] = []): Promise<T | null> {
  const r = await c.query(sql, params);
  return r.rows[0] ?? null;
}
export async function qa<T = any>(c: { query: Function }, sql: string, params: any[] = []): Promise<T[]> {
  return (await c.query(sql, params)).rows;
}

// Quantity validation: exact decimals up to 6 places, never silently rounded.
export function qty(v: any, field = 'qty', allowZero = false): string {
  const s = String(v ?? '').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw bad(`${field} must be a positive number with at most 6 decimals`);
  if (!allowZero && Number(s) === 0) throw bad(`${field} must be greater than zero`);
  return s;
}
export function cents(v: any, field = 'amount', allowZero = false): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || (!allowZero && n === 0)) throw bad(`${field} must be a whole number of cents${allowZero ? '' : ' greater than zero'}`);
  return n;
}
