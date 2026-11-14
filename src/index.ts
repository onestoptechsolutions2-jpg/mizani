import { buildApp } from './server';
import { initControl, migrateAll } from './control';
import { closeAll, controlPool, qa, tenantPool, tx } from './db';
import { tick } from './modules/owner';

async function main() {
  await initControl();
  const results = await migrateAll();
  const failed = results.filter((r) => !r.ok);
  if (failed.length) console.error('Tenant migrations failed:', failed);
  const app = await buildApp({ logger: true });
  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen({ port, host: '0.0.0.0' });
  // Nightly digest and books alerts: checked every 10 minutes, each business at most once a day.
  const sched = setInterval(async () => {
    try {
      for (const t of await qa(controlPool(), "select slug, db_name from tenants where status='active'"))
        await tx(tenantPool(t.db_name), (c) => tick(c)).catch((e) => app.log.error({ tenant: t.slug, err: e.message }, 'digest tick failed'));
    } catch (e: any) { app.log.error(e.message); }
  }, 600_000);
  sched.unref();
  const stop = async () => { await app.close(); await closeAll(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
main().catch((e) => { console.error(e); process.exit(1); });
