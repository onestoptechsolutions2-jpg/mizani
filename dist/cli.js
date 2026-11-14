"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const db_1 = require("./db");
const control_1 = require("./control");
const security_1 = require("./security");
async function backup() {
    const dir = process.env.BACKUP_DIR || './backups';
    fs_1.default.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const t of await (0, db_1.qa)((0, db_1.controlPool)(), "select id, slug, db_name from tenants where status='active'")) {
        const file = path_1.default.join(dir, `${t.slug}-${stamp}.sql.gz`);
        try {
            const dump = (0, child_process_1.execFileSync)('pg_dump', ['-h', process.env.PGHOST || 'localhost', '-p', process.env.PGPORT || '5432', '-U', process.env.PGUSER || 'postgres', '-d', t.db_name, '--no-owner'], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' }, maxBuffer: 1 << 30 });
            fs_1.default.writeFileSync(file, require('zlib').gzipSync(dump));
            await (0, db_1.controlPool)().query('insert into backups(tenant_id, path, bytes) values ($1,$2,$3)', [t.id, file, fs_1.default.statSync(file).size]);
            console.log('backed up', t.slug, file);
        }
        catch (e) {
            console.error('backup failed for', t.slug, e.message);
            process.exitCode = 1;
        }
    }
    const keep = parseInt(process.env.BACKUP_KEEP_DAYS || '14', 10) * 86400_000;
    for (const f of fs_1.default.readdirSync(dir)) {
        const p = path_1.default.join(dir, f);
        if (Date.now() - fs_1.default.statSync(p).mtimeMs > keep)
            fs_1.default.unlinkSync(p);
    }
}
async function main() {
    const [cmd, ...a] = process.argv.slice(2);
    await (0, control_1.initControl)();
    if (cmd === 'migrate-all')
        console.log(JSON.stringify(await (0, control_1.migrateAll)(), null, 2));
    else if (cmd === 'tenants')
        console.table(await (0, control_1.listTenants)());
    else if (cmd === 'backup')
        await backup();
    else if (cmd === 'backup-loop') {
        for (;;) {
            await backup();
            await new Promise((r) => setTimeout(r, 86400_000));
        }
    }
    else if (cmd === 'create-tenant') {
        const [slug, name, email, password] = a;
        if (!password)
            throw new Error('usage: create-tenant <slug> <business name> <email> <password> [--demo]');
        console.log(await (0, control_1.provisionTenant)({ slug, name, ownerName: 'Owner', email, password, demo: a.includes('--demo') }));
    }
    else if (cmd === 'set-password') {
        const [email, pw] = a;
        if (!email || !pw || pw.length < 8)
            throw new Error('usage: set-password <email> <new password (8+ characters)>');
        const r = await (0, db_1.controlPool)().query('update identities set password_hash=$2 where email=$1', [email.toLowerCase(), (0, security_1.hashSecret)(pw)]);
        console.log(r.rowCount ? 'password updated' : 'no such email');
    }
    else if (cmd === 'suspend' || cmd === 'activate') {
        const [slug] = a;
        const r = await (0, db_1.controlPool)().query('update tenants set status=$2 where slug=$1', [slug, cmd === 'suspend' ? 'suspended' : 'active']);
        console.log(r.rowCount ? `${slug} is now ${cmd === 'suspend' ? 'suspended' : 'active'} (takes effect within 30 seconds)` : 'no such business');
    }
    else
        console.log('commands: migrate-all | tenants | backup | backup-loop | create-tenant <slug> <name> <email> <password> [--demo] | set-password <email> <password> | suspend <slug> | activate <slug>');
    if (cmd !== 'backup-loop')
        await (0, db_1.closeAll)();
}
main().catch((e) => { console.error(e); process.exit(1); });
