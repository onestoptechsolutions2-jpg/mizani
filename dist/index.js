"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("./server");
const control_1 = require("./control");
const db_1 = require("./db");
const owner_1 = require("./modules/owner");
async function main() {
    await (0, control_1.initControl)();
    const results = await (0, control_1.migrateAll)();
    const failed = results.filter((r) => !r.ok);
    if (failed.length)
        console.error('Tenant migrations failed:', failed);
    const app = await (0, server_1.buildApp)({ logger: true });
    const port = parseInt(process.env.PORT || '3000', 10);
    await app.listen({ port, host: '0.0.0.0' });
    // Nightly digest and books alerts: checked every 10 minutes, each business at most once a day.
    const sched = setInterval(async () => {
        try {
            for (const t of await (0, db_1.qa)((0, db_1.controlPool)(), "select slug, db_name from tenants where status='active'"))
                await (0, db_1.tx)((0, db_1.tenantPool)(t.db_name), (c) => (0, owner_1.tick)(c)).catch((e) => app.log.error({ tenant: t.slug, err: e.message }, 'digest tick failed'));
        }
        catch (e) {
            app.log.error(e.message);
        }
    }, 600_000);
    sched.unref();
    const stop = async () => { await app.close(); await (0, db_1.closeAll)(); process.exit(0); };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}
main().catch((e) => { console.error(e); process.exit(1); });
