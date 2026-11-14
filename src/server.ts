import fs from 'fs';
import path from 'path';
import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import jwt from '@fastify/jwt';
import { bad, conflict, controlPool, forbidden, HttpError, notFound, q1, qa, tenantPool, tx } from './db';
import { Ctx, businessDate } from './ledger';
import { can, hashSecret, Role } from './security';
import { generateInvoices, listInvoices, listPlans, listTenants, login, migrateAll, payInvoice, provisionTenant, subscribe, subscriptionAccess, tenantBilling } from './control';
import { migrate } from './migrate';
import * as sales from './modules/sales';
import * as purchases from './modules/purchases';
import * as inv from './modules/inventory';
import * as acc from './modules/accounting';
import * as rep from './modules/reports';
import { decide, listApprovals } from './modules/approvals';
import { reconcile } from './modules/reconcile';
import * as ex from './modules/extras';
import * as prod from './modules/production';
import * as prn from './modules/printing';
import * as hotel from './modules/hotel';
import * as hr from './modules/hr';
import * as trade from './modules/trade';
import * as imp from './modules/importer';
import { analyse } from './modules/healthcheck';
import * as own from './modules/owner';

interface Req { c: Ctx['c']; x: Ctx; userId: string; role: Role; body: any; params: any; query: any; user: any; tenantId: string; req: FastifyRequest; }

const hits = new Map<string, number[]>();
function limit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.');
  arr.push(now); hits.set(key, arr);
}

const tenantCache = new Map<string, { at: number; status: string; writable: boolean; message: string | null }>();
export const clearTenantCache = () => tenantCache.clear();
async function tenantStatus(tid: string) {
  const e = tenantCache.get(tid);
  if (e && Date.now() - e.at < 30000) return e;
  const t = await q1(controlPool(), 'select status from tenants where id=$1', [tid]);
  const status = t?.status || 'deleted';
  const acc = status === 'active' ? await subscriptionAccess(tid) : { writable: false, message: null };
  const v = { at: Date.now(), status, writable: acc.writable, message: acc.message };
  tenantCache.set(tid, v);
  return v;
}

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5_000_000 });
  const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
  if (secret === 'dev-secret-change-me' && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production');
  await app.register(jwt, { secret, sign: { expiresIn: '12h' } });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, detail: err.detail });
    if (err.code && /^(23|P0001)/.test(err.code)) return reply.code(409).send({ error: err.message.replace(/^ERROR:\s*/, '') });
    if (err.code && /^22/.test(err.code)) return reply.code(400).send({ error: 'Invalid value: ' + err.message });
    if (err.validation || err.statusCode === 400) return reply.code(400).send({ error: err.message });
    if (err.statusCode === 401 || err.code?.startsWith?.('FST_JWT')) return reply.code(401).send({ error: 'Please sign in again' });
    req.log.error(err);
    if (process.env.DEBUG_ERRORS) console.error('500:', err);
    return reply.code(500).send({ error: 'Something went wrong on our side. Try again, and tell support if it continues.' });
  });

  const root = path.resolve(__dirname, '../public');
  app.get('/', async (_r, reply) => reply.type('text/html').send(fs.readFileSync(path.join(root, 'index.html'))));
  for (const [url, file, type] of [['/manifest.webmanifest', 'manifest.webmanifest', 'application/manifest+json'], ['/sw.js', 'sw.js', 'text/javascript'], ['/icon.svg', 'icon.svg', 'image/svg+xml']])
    app.get(url, async (_r, reply) => reply.type(type).header('cache-control', 'no-cache').send(fs.readFileSync(path.join(root, file))));
  app.get('/healthz', async () => { await controlPool().query('select 1'); return { ok: true }; });

  // Route helper: auth -> permission -> tenant transaction -> idempotency -> handler.
  function route(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, perm: string, fn: (r: Req) => Promise<any>) {
    app.route({ method, url: '/api' + url, handler: async (req: any, reply) => {
      await req.jwtVerify();
      const u = req.user as { tid: string; uid: string; role: Role; db: string };
      if (!can(u.role, perm)) throw forbidden('Your role cannot do this');
      const ts = await tenantStatus(u.tid);
      if (ts.status !== 'active') throw forbidden('This business is not active');
      if (method !== 'GET' && !ts.writable) throw new HttpError(402, ts.message || 'A subscription payment is needed to make changes. Reading is still allowed.');
      const key = method !== 'GET' && req.headers['idempotency-key'] ? `${u.uid}:${req.headers['idempotency-key']}` : null;
      const out = await tx(tenantPool(u.db), async (c) => {
        if (key) {
          const ins = await c.query('insert into commands(key, route) values ($1,$2) on conflict do nothing returning key', [key, method + url]);
          if (!ins.rowCount) { const prev = await q1(c, 'select response from commands where key=$1', [key]); return prev.response; }
        }
        const user = await q1(c, 'select id, name, role from users where id=$1 and active', [u.uid]);
        if (!user) throw forbidden('This user is disabled');
        const x: Ctx = { c, userId: u.uid, role: user.role };
        const res = await fn({ c, x, userId: u.uid, role: user.role, body: req.body || {}, params: req.params, query: req.query || {}, user, tenantId: u.tid, req });
        if (key) await c.query('update commands set response=$2, status=200 where key=$1', [key, JSON.stringify(res ?? null)]);
        return res;
      });
      return reply.send(out ?? { ok: true });
    } });
  }
  const tokenFor = (t: { tenantId: string; dbName: string }, user: { id: string; role: string }) =>
    app.jwt.sign({ tid: t.tenantId, uid: user.id, role: user.role, db: t.dbName });

  // ------------------------------------------------------------ public ---
  app.post('/api/signup', async (req: any, reply) => {
    if (process.env.ALLOW_SIGNUP === 'false') throw forbidden('Signup is closed');
    limit('signup:' + req.ip, 10, 3600_000);
    const b = req.body || {};
    const t = await provisionTenant({ slug: b.slug, name: b.business_name, ownerName: b.owner_name, email: b.email, password: b.password, pin: b.pin, demo: !!b.demo });
    const user = await q1(tenantPool(t.dbName), 'select id, role, name from users where id=$1', [t.userId]);
    return reply.send({ token: tokenFor(t, user), business: b.business_name, slug: t.slug, user });
  });
  app.post('/api/auth/login', async (req: any, reply) => {
    const b = req.body || {};
    limit(`login:${req.ip}:${b.email}`, 10, 300_000);
    const r = await login(b.email, b.password, b.slug);
    return reply.send({ token: tokenFor(r, r.user), business: r.tenantName, user: { id: r.user.id, name: r.user.name, role: r.user.role } });
  });

  app.post('/api/health-check', async (req: any, reply) => {
    limit('hc:' + req.ip, 20, 3600_000);
    return reply.send(analyse(req.body || {}));
  });

  // ---------------------------------------------------------- platform ---
  const platform = (req: any) => {
    if (!process.env.PLATFORM_ADMIN_TOKEN) throw notFound('Not found');
    if (req.headers['x-platform-token'] !== process.env.PLATFORM_ADMIN_TOKEN) throw forbidden('Invalid platform token');
  };
  app.get('/api/platform/tenants', async (req) => { platform(req); return listTenants(); });
  app.post('/api/platform/migrate', async (req) => { platform(req); return migrateAll(); });
  app.get('/api/platform/plans', async (req) => { platform(req); return listPlans(); });
  app.post('/api/platform/subscribe', async (req: any) => { platform(req); const r = await subscribe(req.body?.slug, req.body?.plan, req.body?.outlets ?? 1); clearTenantCache(); return r; });
  app.post('/api/platform/invoices/generate', async (req) => { platform(req); return generateInvoices(); });
  app.get('/api/platform/invoices', async (req: any) => { platform(req); return listInvoices(req.query?.status); });
  app.post('/api/platform/invoices/:id/pay', async (req: any) => { platform(req); const r = await payInvoice(req.params.id, req.body || {}); clearTenantCache(); return r; });

  // ---------------------------------------------------------- identity ---
  route('GET', '/me', 'read', async (r) => ({ user: r.user, business_date: await businessDate(r.c), tenant: r.tenantId }));
  route('GET', '/approvers', 'read', async (r) => qa(r.c, "select id, name from users where active and role in ('owner','manager') and pin_hash is not null order by name"));
  route('GET', '/users', 'setup', async (r) => qa(r.c, 'select id, name, role, active, (pin_hash is not null) has_pin from users order by name'));
  route('POST', '/users', 'setup', async (r) => {
    const b = r.body;
    if (!['owner', 'manager', 'accountant', 'storekeeper', 'cashier', 'waiter'].includes(b.role)) throw bad('Unknown role');
    if (b.role === 'owner' && r.role !== 'owner') throw forbidden('Only an owner can add an owner');
    if (!b.name) throw bad('Name is required');
    if (b.pin && !/^\d{4,8}$/.test(String(b.pin))) throw bad('PIN must be 4 to 8 digits');
    const u = await q1(r.c, 'insert into users(name, role, pin_hash) values ($1,$2,$3) returning id', [b.name, b.role, b.pin ? hashSecret(String(b.pin)) : null]);
    if (b.email) {
      if (!b.password || String(b.password).length < 8) throw bad('Password must be at least 8 characters');
      const cp = await controlPool().connect();
      try {
        await cp.query('begin');
        let idn = await q1(cp, 'select id from identities where email=$1', [String(b.email).toLowerCase()]);
        if (!idn) idn = await q1(cp, 'insert into identities(email, password_hash) values ($1,$2) returning id', [String(b.email).toLowerCase(), hashSecret(String(b.password))]);
        await cp.query('insert into memberships(identity_id, tenant_id, tenant_user_id) values ($1,$2,$3)', [idn.id, r.tenantId, u.id]);
        await cp.query('commit');
      } catch (e) { await cp.query('rollback'); throw e; } finally { cp.release(); }
    }
    return { id: u.id };
  });

  // ----------------------------------------------------------- catalog ---
  route('GET', '/accounts', 'read', async (r) => qa(r.c, 'select code, name, type from accounts where active order by code'));
  route('GET', '/stores', 'read', async (r) => qa(r.c, 'select id, name, kind from stores order by name'));
  route('POST', '/stores', 'setup', async (r) => q1(r.c, 'insert into stores(outlet_id, name, kind) values ((select id from outlets limit 1), $1, $2) returning id, name', [r.body.name, r.body.kind || 'store']));
  route('GET', '/items', 'read', async (r) => qa(r.c, `select i.id, i.name, i.base_unit, i.is_sellable, i.is_stocked, i.sell_price, i.tax_rate_bp, i.category, i.production_store_id, i.last_cost::text,
      coalesce((select json_agg(json_build_object('unit', u.unit, 'factor', u.factor::text)) from item_units u where u.item_id=i.id), '[]') units,
      coalesce((select json_agg(json_build_object('item_id', k.component_item_id, 'store_id', k.store_id, 'qty', k.qty::text)) from recipe_components k where k.menu_item_id=i.id), '[]') recipe
    from items i where i.active and ($1::text is null or ($1='sellable' and i.is_sellable) or ($1='stocked' and i.is_stocked)) order by i.name`, [r.query.filter ?? null]));
  route('POST', '/items', 'setup', async (r) => {
    const b = r.body;
    if (!b.name) throw bad('Name is required');
    const price = b.price ? Number(b.price) : 0;
    if (!Number.isInteger(price) || price < 0) throw bad('Price must be whole cents');
    const acct = async (code: string | undefined, def: string) => (await q1(r.c, 'select id from accounts where code=$1', [code || def]))?.id ?? null;
    if (b.sellable && b.stocked && !b.store_id) throw bad('Stocked items need a production store');
    return q1(r.c, `insert into items(name, base_unit, is_sellable, is_stocked, sell_price, tax_rate_bp, revenue_account_id, cogs_account_id, production_store_id, category)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, name`, [b.name, b.unit || 'each', !!b.sellable, !!b.stocked, price, b.tax_rate_bp ?? 1600,
      await acct(b.revenue_account, '4000'), await acct(b.cogs_account, '5000'), b.store_id ?? null, b.category ?? null]);
  });
  route('POST', '/items/:id/recipe', 'setup', async (r) => {
    await r.c.query('delete from recipe_components where menu_item_id=$1', [r.params.id]);
    for (const k of r.body.components || []) await r.c.query('insert into recipe_components values ($1,$2,$3,$4::numeric)', [r.params.id, k.item_id, k.store_id, k.qty]);
    return { ok: true };
  });
  route('POST', '/items/:id/units', 'setup', async (r) => { await r.c.query('insert into item_units values ($1,$2,$3::numeric) on conflict (item_id, unit) do update set factor=excluded.factor', [r.params.id, r.body.unit, r.body.factor]); return { ok: true }; });
  route('GET', '/parties', 'read', async (r) => qa(r.c, 'select id, kind, name, phone, credit_limit from parties where ($1::text is null or kind=$1) order by name', [r.query.kind ?? null]));
  route('POST', '/parties', 'setup', async (r) => {
    if (!['customer', 'supplier', 'staff'].includes(r.body.kind) || !r.body.name) throw bad('Kind and name are required');
    return q1(r.c, 'insert into parties(kind, name, phone, credit_limit) values ($1,$2,$3,$4) returning id, name', [r.body.kind, r.body.name, r.body.phone ?? null, r.body.credit_limit ?? 0]);
  });

  // --------------------------------------------------------------- day ---
  route('GET', '/day', 'read', async (r) => acc.dayStatus(r.c));
  route('POST', '/day/open', 'money', async (r) => acc.openDay(r.x));
  route('POST', '/day/close', 'money', async (r) => acc.closeDay(r.x));

  // -------------------------------------------------------------- sales ---
  route('POST', '/bills', 'sell', async (r) => sales.openBill(r.x, r.body));
  route('GET', '/bills', 'sell', async (r) => sales.listBills(r.c, String(r.query.status || 'open'), (r.query.outlet as string) || null));
  route('GET', '/bills/:id', 'sell', async (r) => sales.getBill(r.c, r.params.id));
  route('POST', '/bills/:id/lines', 'sell', async (r) => ({ line_id: await sales.addLine(r.x, r.params.id, r.body) }));
  route('PATCH', '/bills/:id/lines/:lineId', 'sell', async (r) => sales.changeQty(r.x, r.params.id, r.params.lineId, r.body.qty));
  route('DELETE', '/bills/:id/lines/:lineId', 'sell', async (r) => sales.removeBillLine(r.x, r.params.id, r.params.lineId, r.body));
  route('POST', '/bills/:id/lines/:lineId/prepared', 'sell', async (r) => { await sales.markPrepared(r.c, r.params.id, r.params.lineId); return { ok: true }; });
  route('POST', '/bills/:id/payments', 'sell', async (r) => sales.pay(r.x, r.params.id, r.body));
  route('POST', '/bills/:id/close', 'sell', async (r) => sales.closeBill(r.x, r.params.id, r.body));
  route('POST', '/bills/:id/void-request', 'sell', async (r) => sales.requestVoid(r.x, r.params.id, r.body.reason));
  route('POST', '/parties/:id/receipts', 'money', async (r) => sales.receipt(r.x, r.params.id, r.body));

  // ---------------------------------------------------------- purchases ---
  route('POST', '/purchases', 'purchase', async (r) => purchases.createPurchase(r.x, r.body));
  route('GET', '/purchases', 'purchase', async (r) => purchases.listPurchases(r.c));
  route('POST', '/purchases/:id/payments', 'money', async (r) => purchases.payPurchase(r.x, r.params.id, r.body));

  // -------------------------------------------------------------- stock ---
  route('GET', '/stock', 'stock', async (r) => inv.stockReport(r.c, (r.query.outlet as string) || null));
  route('POST', '/stock/transfers', 'stock', async (r) => inv.transfer(r.x, r.body));
  route('POST', '/stock/consume', 'stock', async (r) => inv.consume(r.x, r.body));
  route('POST', '/stock/opening', 'money', async (r) => inv.openingStock(r.x, r.body));
  route('POST', '/wastage', 'stock', async (r) => inv.createWastage(r.x, r.body));
  route('GET', '/wastage/reasons', 'read', async (r) => qa(r.c, 'select code, label from wastage_reasons order by label'));
  route('POST', '/stock-takes', 'count', async (r) => inv.startTake(r.x, r.body.store_id));
  route('GET', '/stock-takes', 'stock', async (r) => qa(r.c, `select t.id, t.number, t.status, s.name store, t.created_at from stock_takes t join stores s on s.id=t.store_id order by t.created_at desc limit 50`));
  route('GET', '/stock-takes/:id', 'stock', async (r) => inv.getTake(r.c, r.params.id, { userId: r.userId, role: r.role }));
  route('POST', '/stock-takes/:id/counts', 'count', async (r) => inv.saveCounts(r.x, r.params.id, r.body.counts));
  route('POST', '/stock-takes/:id/submit', 'count', async (r) => inv.submitTake(r.x, r.params.id));

  // ---------------------------------------------------------- approvals ---
  route('GET', '/approvals', 'approve', async (r) => listApprovals(r.c, String(r.query.status || 'pending')));
  route('POST', '/approvals/:id/approve', 'approve', async (r) => decide(r.x, r.params.id, true, r.body.reason));
  route('POST', '/approvals/:id/reject', 'approve', async (r) => decide(r.x, r.params.id, false, r.body.reason));

  // --------------------------------------------------------- accounting ---
  route('POST', '/expenses', 'money', async (r) => acc.createExpense(r.x, r.body));
  route('POST', '/cash/count', 'money', async (r) => acc.cashCount(r.x, r.body));
  route('POST', '/cash/bank', 'money', async (r) => acc.bankCash(r.x, r.body));
  route('POST', '/opening-balances', 'money', async (r) => acc.openingBalances(r.x, r.body));
  route('POST', '/periods/lock', 'admin', async (r) => acc.lockPeriod(r.c, r.body.through));

  // ------------------------------------------------------------ reports ---
  route('GET', '/reports/trial-balance', 'report', async (r) => rep.trialBalance(r.c, r.query));
  route('GET', '/reports/pnl', 'report', async (r) => rep.profitAndLoss(r.c, r.query));
  route('GET', '/reports/balance-sheet', 'report', async (r) => rep.balanceSheet(r.c, r.query));
  route('GET', '/reports/balances/:kind', 'report', async (r) => rep.partyBalances(r.c, r.params.kind));
  route('GET', '/journals/:id', 'report', async (r) => rep.journalDetail(r.c, r.params.id));
  route('GET', '/accounts/:code/ledger', 'report', async (r) => rep.accountLedger(r.c, r.params.code, r.query));
  route('GET', '/reconcile', 'read', async (r) => reconcile(r.c));


  // ------------------------------------------------- printing and bill extras ---
  route('GET', '/bills/:id/receipt', 'sell', async (r) => {
    const d = await prn.receiptData(r.c, r.params.id); const text = prn.receiptText(d);
    if (r.query.format === 'text') return { text };
    if (r.query.format === 'escpos') return { base64: prn.escpos(text, { drawer: r.query.drawer === '1' }).toString('base64') };
    return { ...d, text };
  });
  route('GET', '/bills/:id/kot', 'sell', async (r) => prn.kot(r.c, r.params.id, false));
  route('POST', '/bills/:id/kot', 'sell', async (r) => { const k = await prn.kot(r.c, r.params.id, true); return r.query.format === 'escpos' ? { ...k, base64: prn.escpos(k.text).toString('base64') } : k; });
  route('POST', '/bills/:id/refund', 'sell', async (r) => ex.refundLine(r.x, r.params.id, r.body));
  route('POST', '/bills/:id/service-charge', 'sell', async (r) => ex.serviceCharge(r.x, r.params.id, r.body.percent_bp));
  route('POST', '/tips/payout', 'money', async (r) => ex.tipsPayout(r.x, r.body));
  route('POST', '/deposits', 'sell', async (r) => ex.createDeposit(r.x, r.body));
  route('POST', '/gift-cards', 'sell', async (r) => ex.sellGiftCard(r.x, r.body));
  route('GET', '/gift-cards/:code', 'sell', async (r) => ex.giftCardInfo(r.c, r.params.code));
  route('GET', '/customers/:id/loyalty', 'sell', async (r) => ex.loyaltyBalance(r.c, r.params.id));
  route('GET', '/settings', 'setup', async (r) => ex.getSettings(r.c));
  route('POST', '/settings', 'admin', async (r) => ex.updateSettings(r.c, r.body));
  route('POST', '/purchases/:id/returns', 'purchase', async (r) => purchases.returnPurchase(r.x, r.params.id, r.body));

  // ------------------------------------------------------ production, assets ---
  route('POST', '/stock/production', 'stock', async (r) => prod.produce(r.x, r.body));
  route('POST', '/stock/staff-meal', 'stock', async (r) => prod.staffMeal(r.x, r.body));
  route('GET', '/assets', 'money', async (r) => prod.listAssets(r.c));
  route('POST', '/assets', 'money', async (r) => prod.createAsset(r.x, r.body));
  route('POST', '/assets/depreciate', 'money', async (r) => prod.depreciate(r.x, r.body.period));

  // ------------------------------------------------------------------ hotel ---
  route('GET', '/hotel/room-types', 'hotel', async (r) => hotel.listRoomTypes(r.c));
  route('POST', '/hotel/room-types', 'setup', async (r) => hotel.createRoomType(r.x, r.body));
  route('GET', '/hotel/rooms', 'hotel', async (r) => hotel.listRooms(r.c));
  route('POST', '/hotel/rooms', 'setup', async (r) => hotel.createRoom(r.x, r.body));
  route('PATCH', '/hotel/rooms/:id/status', 'housekeeping', async (r) => hotel.setRoomStatus(r.c, r.params.id, r.body.status));
  route('GET', '/hotel/availability', 'hotel', async (r) => hotel.availability(r.c, String(r.query.from), String(r.query.to)));
  route('GET', '/hotel/reservations', 'hotel', async (r) => hotel.listReservations(r.c, (r.query.status as string) || undefined));
  route('POST', '/hotel/reservations', 'hotel', async (r) => hotel.createReservation(r.x, r.body));
  route('GET', '/hotel/reservations/:id', 'hotel', async (r) => hotel.folio(r.c, r.params.id));
  route('POST', '/hotel/reservations/:id/cancel', 'hotel', async (r) => hotel.cancelReservation(r.x, r.params.id));
  route('POST', '/hotel/reservations/:id/check-in', 'hotel', async (r) => hotel.checkIn(r.x, r.params.id, r.body));
  route('POST', '/hotel/reservations/:id/charges', 'hotel', async (r) => hotel.postExtraCharge(r.x, r.params.id, r.body));
  route('POST', '/hotel/reservations/:id/payments', 'hotel', async (r) => hotel.folioPayment(r.x, r.params.id, r.body));
  route('POST', '/hotel/reservations/:id/check-out', 'hotel', async (r) => hotel.checkOut(r.x, r.params.id, r.body));
  route('POST', '/hotel/night-audit', 'money', async (r) => hotel.nightAudit(r.x));
  route('GET', '/hotel/occupancy', 'hotel', async (r) => hotel.occupancy(r.c, String(r.query.date || new Date().toISOString().slice(0, 10))));

  // -------------------------------------------------------------- HR, payroll ---
  route('GET', '/hr/employees', 'hr', async (r) => hr.listEmployees(r.c));
  route('POST', '/hr/employees', 'hr', async (r) => hr.createEmployee(r.x, r.body));
  route('PATCH', '/hr/employees/:id', 'hr', async (r) => hr.updateEmployee(r.c, r.params.id, r.body));
  route('GET', '/hr/employees/:id/leave-balance', 'hr', async (r) => hr.leaveBalance(r.c, r.params.id));
  route('GET', '/hr/leave', 'hr', async (r) => hr.listLeave(r.c));
  route('POST', '/hr/leave', 'hr', async (r) => hr.requestLeave(r.x, r.body));
  route('POST', '/payroll/preview', 'hr', async (r) => hr.preview(r.c, r.body.gross));
  route('GET', '/payroll/runs', 'payroll', async (r) => hr.listRuns(r.c));
  route('POST', '/payroll/runs', 'payroll', async (r) => hr.runPayroll(r.x, r.body));
  route('GET', '/payroll/runs/:id/payslips', 'payroll', async (r) => hr.payslips(r.c, r.params.id));
  route('POST', '/payroll/runs/:id/pay', 'payroll', async (r) => hr.payRun(r.x, r.params.id, r.body));
  route('POST', '/payroll/remit', 'payroll', async (r) => hr.remit(r.x, r.body));
  route('GET', '/payroll/liabilities', 'payroll', async (r) => hr.liabilities(r.c));

  // ------------------------------------------------------- retail, wholesale ---
  route('GET', '/items/barcode/:code', 'sell', async (r) => trade.itemByBarcode(r.c, r.params.code));
  route('GET', '/reports/low-stock', 'stock', async (r) => trade.lowStock(r.c));
  route('GET', '/promotions', 'sell', async (r) => trade.listPromotions(r.c));
  route('POST', '/promotions', 'setup', async (r) => trade.createPromotion(r.c, r.body));
  route('POST', '/promotions/:id/active', 'setup', async (r) => trade.togglePromotion(r.c, r.params.id, !!r.body.active));
  route('GET', '/price-lists', 'sell', async (r) => trade.listPriceLists(r.c));
  route('POST', '/price-lists', 'setup', async (r) => trade.createPriceList(r.c, r.body.name));
  route('POST', '/price-lists/:id/items', 'setup', async (r) => trade.setListPrice(r.c, r.params.id, r.body));
  route('POST', '/customers/:id/price-list', 'setup', async (r) => trade.assignPriceList(r.c, r.params.id, r.body));
  route('GET', '/customers/:id/statement', 'money', async (r) => trade.statement(r.c, r.params.id));
  route('GET', '/reports/ageing', 'report', async (r) => trade.ageing(r.c, (r.query.as_at as string) || undefined));
  route('GET', '/orders', 'sell', async (r) => trade.listOrders(r.c));
  route('POST', '/orders', 'sell', async (r) => trade.createOrder(r.x, r.body));
  route('POST', '/orders/:id/deliver', 'sell', async (r) => trade.deliverOrder(r.x, r.params.id, r.body));
  route('POST', '/orders/:id/cancel', 'sell', async (r) => trade.cancelOrder(r.c, r.params.id));

  // --------------------------------------------------------------- importing ---
  route('POST', '/import/items', 'setup', async (r) => imp.importItems(r.x, r.body));
  route('POST', '/import/parties', 'setup', async (r) => imp.importParties(r.x, r.body));
  route('POST', '/import/opening-stock', 'money', async (r) => imp.importOpeningStock(r.x, r.body));

  // ----------------------------------------------- owner view, alerts, planning ---
  route('GET', '/owner/summary', 'report', async (r) => own.ownerSummary(r.c, (r.query.outlet as string) || null));
  route('GET', '/owner/digest', 'report', async (r) => ({ text: (await own.digestText(r.c)).text }));
  route('POST', '/owner/digest/send', 'admin', async (r) => own.sendDigest(r.c));
  route('GET', '/notifications', 'report', async (r) => own.listNotifications(r.c));
  route('GET', '/forecast', 'report', async (r) => own.forecastDemand(r.c, Number(r.query.days || 7), Number(r.query.weeks || 8)));
  route('GET', '/forecast/reorder', 'stock', async (r) => own.reorderSuggestions(r.c, Number(r.query.lead || 3), Number(r.query.cover || 7)));

  // ------------------------------------------------------ outlets and billing ---
  route('GET', '/outlets', 'read', async (r) => qa(r.c, 'select id, name, (select count(*)::int from stores s where s.outlet_id=o.id) stores from outlets o order by name'));
  route('POST', '/outlets', 'admin', async (r) => { if (!r.body.name) throw bad('Name is required'); return q1(r.c, 'insert into outlets(name) values ($1) returning id, name', [r.body.name]); });
  route('PATCH', '/stores/:id', 'setup', async (r) => { await r.c.query('update stores set outlet_id=coalesce($2,outlet_id), name=coalesce($3,name) where id=$1', [r.params.id, r.body.outlet_id ?? null, r.body.name ?? null]); return { ok: true }; });
  route('GET', '/reports/outlets', 'report', async (r) => rep.outletReport(r.c, r.query));
  app.get('/api/billing', async (req: any) => { await req.jwtVerify(); return tenantBilling(req.user.tid); });

  (app as any).tokenFor = tokenFor;
  return app;
}
