"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.latestVersion = exports.MIGRATIONS = void 0;
exports.migrate = migrate;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
exports.MIGRATIONS = path_1.default.resolve(__dirname, '../migrations');
// Forward-only, versioned, one transaction per file, advisory-locked so two
// migrators can never race on the same database.
async function migrate(pool, kind) {
    const dir = path_1.default.join(exports.MIGRATIONS, kind);
    const c = await pool.connect();
    const applied = [];
    try {
        await c.query('select pg_advisory_lock(727274)');
        await c.query('create table if not exists schema_migrations(version text primary key, applied_at timestamptz not null default now())');
        const done = new Set((await c.query('select version from schema_migrations')).rows.map((r) => r.version));
        for (const f of fs_1.default.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
            if (done.has(f))
                continue;
            await c.query('begin');
            try {
                await c.query("set local lock_timeout = '10s'");
                await c.query(fs_1.default.readFileSync(path_1.default.join(dir, f), 'utf8'));
                await c.query('insert into schema_migrations(version) values ($1)', [f]);
                await c.query('commit');
                applied.push(f);
            }
            catch (e) {
                await c.query('rollback').catch(() => { });
                throw new Error(`migration ${kind}/${f} failed: ${e.message}`);
            }
        }
        return applied;
    }
    finally {
        await c.query('select pg_advisory_unlock(727274)').catch(() => { });
        c.release();
    }
}
const latestVersion = (kind) => fs_1.default.readdirSync(path_1.default.join(exports.MIGRATIONS, kind)).filter((x) => x.endsWith('.sql')).sort().pop() || '';
exports.latestVersion = latestVersion;
