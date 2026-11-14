"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFound = exports.forbidden = exports.conflict = exports.bad = exports.HttpError = exports.controlPool = exports.adminPool = exports.CONTROL_DB = void 0;
exports.ensureDatabase = ensureDatabase;
exports.dropDatabase = dropDatabase;
exports.tenantPool = tenantPool;
exports.closeTenantPool = closeTenantPool;
exports.closeAll = closeAll;
exports.tx = tx;
exports.q1 = q1;
exports.qa = qa;
exports.qty = qty;
exports.cents = cents;
const pg_1 = require("pg");
// int8 -> number (cents fit safely), numeric -> string (exact), date -> 'YYYY-MM-DD' string
pg_1.types.setTypeParser(20, (v) => parseInt(v, 10));
pg_1.types.setTypeParser(1700, (v) => v);
pg_1.types.setTypeParser(1082, (v) => v);
const base = () => ({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
});
const CONTROL_DB = () => process.env.CONTROL_DB || 'mizani_control';
exports.CONTROL_DB = CONTROL_DB;
let _admin = null;
let _control = null;
const tenantPools = new Map();
const adminPool = () => (_admin ??= new pg_1.Pool({ ...base(), database: 'postgres', max: 2 }));
exports.adminPool = adminPool;
const controlPool = () => (_control ??= new pg_1.Pool({ ...base(), database: (0, exports.CONTROL_DB)(), max: 8 }));
exports.controlPool = controlPool;
async function ensureDatabase(name) {
    const r = await (0, exports.adminPool)().query('select 1 from pg_database where datname=$1', [name]);
    if (!r.rowCount)
        await (0, exports.adminPool)().query(`create database "${name.replace(/"/g, '')}"`);
}
async function dropDatabase(name) {
    await (0, exports.adminPool)().query(`drop database if exists "${name.replace(/"/g, '')}" with (force)`);
}
// Per-tenant pools: small, lazily created, least-recently-used eviction.
function tenantPool(dbName) {
    let e = tenantPools.get(dbName);
    if (!e) {
        const max = parseInt(process.env.TENANT_POOL_MAX || '4', 10);
        e = { pool: new pg_1.Pool({ ...base(), database: dbName, max, idleTimeoutMillis: 30000 }), last: Date.now() };
        tenantPools.set(dbName, e);
        const limit = parseInt(process.env.TENANT_POOL_CACHE || '50', 10);
        if (tenantPools.size > limit) {
            const oldest = [...tenantPools.entries()].filter(([k]) => k !== dbName).sort((a, b) => a[1].last - b[1].last)[0];
            if (oldest) {
                oldest[1].pool.end().catch(() => { });
                tenantPools.delete(oldest[0]);
            }
        }
    }
    e.last = Date.now();
    return e.pool;
}
async function closeTenantPool(dbName) {
    const e = tenantPools.get(dbName);
    if (e) {
        tenantPools.delete(dbName);
        await e.pool.end().catch(() => { });
    }
}
async function closeAll() {
    for (const [, e] of tenantPools)
        await e.pool.end().catch(() => { });
    tenantPools.clear();
    await _control?.end().catch(() => { });
    _control = null;
    await _admin?.end().catch(() => { });
    _admin = null;
}
async function tx(pool, fn) {
    const c = await pool.connect();
    try {
        await c.query('begin');
        await c.query("set local statement_timeout = '30s'");
        const r = await fn(c);
        await c.query('commit');
        return r;
    }
    catch (e) {
        await c.query('rollback').catch(() => { });
        throw e;
    }
    finally {
        c.release();
    }
}
class HttpError extends Error {
    status;
    detail;
    constructor(status, message, detail) {
        super(message);
        this.status = status;
        this.detail = detail;
    }
}
exports.HttpError = HttpError;
const bad = (m, d) => new HttpError(400, m, d);
exports.bad = bad;
const conflict = (m, d) => new HttpError(409, m, d);
exports.conflict = conflict;
const forbidden = (m) => new HttpError(403, m);
exports.forbidden = forbidden;
const notFound = (m) => new HttpError(404, m);
exports.notFound = notFound;
async function q1(c, sql, params = []) {
    const r = await c.query(sql, params);
    return r.rows[0] ?? null;
}
async function qa(c, sql, params = []) {
    return (await c.query(sql, params)).rows;
}
// Quantity validation: exact decimals up to 6 places, never silently rounded.
function qty(v, field = 'qty', allowZero = false) {
    const s = String(v ?? '').trim();
    if (!/^\d+(\.\d{1,6})?$/.test(s))
        throw (0, exports.bad)(`${field} must be a positive number with at most 6 decimals`);
    if (!allowZero && Number(s) === 0)
        throw (0, exports.bad)(`${field} must be greater than zero`);
    return s;
}
function cents(v, field = 'amount', allowZero = false) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || (!allowZero && n === 0))
        throw (0, exports.bad)(`${field} must be a whole number of cents${allowZero ? '' : ' greater than zero'}`);
    return n;
}
