import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { closeAll, controlPool, qa } from './db';
import { initControl, listTenants, migrateAll, provisionTenant } from './control';
import { hashSecret } from './security';

async function backup() {
  const dir = process.env.BACKUP_DIR || './backups';
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const t of await qa(controlPool(), "select id, slug, db_name from tenants where status='active'")) {
    const file = path.join(dir, `${t.slug}-${stamp}.sql.gz`);
    try {
      const dump = execFileSync('pg_dump', ['-h', process.env.PGHOST || 'localhost', '-p', process.env.PGPORT || '5432', '-U', process.env.PGUSER || 'postgres', '-d', t.db_name, '--no-owner'], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' }, maxBuffer: 1 << 30 });
      fs.writeFileSync(file, require('zlib').gzipSync(dump));
      await controlPool().query('insert into backups(tenant_id, path, bytes) values ($1,$2,$3)', [t.id, file, fs.statSync(file).size]);
      console.log('backed up', t.slug, file);
    } catch (e: any) { console.error('backup failed for', t.slug, e.message); process.exitCode = 1; }
  }
  const keep = parseInt(process.env.BACKUP_KEEP_DAYS || '14', 10) * 86400_000;
  for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (Date.now() - fs.statSync(p).mtimeMs > keep) fs.unlinkSync(p); }
}

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  await initControl();
  if (cmd === 'migrate-all') console.log(JSON.stringify(await migrateAll(), null, 2));
  else if (cmd === 'tenants') console.table(await listTenants());
  else if (cmd === 'backup') await backup();
  else if (cmd === 'backup-loop') { for (;;) { await backup(); await new Promise((r) => setTimeout(r, 86400_000)); } }
  else if (cmd === 'create-tenant') {
    const [slug, name, email, password] = a;
    if (!password) throw new Error('usage: create-tenant <slug> <business name> <email> <password> [--demo]');
    console.log(await provisionTenant({ slug, name, ownerName: 'Owner', email, password, demo: a.includes('--demo') }));
  } else if (cmd === 'set-password') {
    const [email, pw] = a;
    if (!email || !pw || pw.length < 8) throw new Error('usage: set-password <email> <new password (8+ characters)>');
    const r = await controlPool().query('update identities set password_hash=$2 where email=$1', [email.toLowerCase(), hashSecret(pw)]);
    console.log(r.rowCount ? 'password updated' : 'no such email');
  } else if (cmd === 'suspend' || cmd === 'activate') {
    const [slug] = a;
    const r = await controlPool().query('update tenants set status=$2 where slug=$1', [slug, cmd === 'suspend' ? 'suspended' : 'active']);
    console.log(r.rowCount ? `${slug} is now ${cmd === 'suspend' ? 'suspended' : 'active'} (takes effect within 30 seconds)` : 'no such business');
  } else console.log('commands: migrate-all | tenants | backup | backup-loop | create-tenant <slug> <name> <email> <password> [--demo] | set-password <email> <password> | suspend <slug> | activate <slug>');
  if (cmd !== 'backup-loop') await closeAll();
}
main().catch((e) => { console.error(e); process.exit(1); });
