import assert from 'node:assert/strict';
process.env.CONTROL_DB = process.env.TEST_CONTROL_DB || 'mizani_test_control';
process.env.JWT_SECRET = 'test-secret';
process.env.TENANT_POOL_CACHE = '500';
import { buildApp } from '../src/server';
import { initControl, provisionTenant } from '../src/control';
import { closeAll, tenantPool } from '../src/db';
import { hashSecret } from '../src/security';

let app: any;
export async function boot() { if (!app) { await initControl(); app = await buildApp(); } return app; }
export async function shutdown() { await closeAll(); }

export interface World {
  pool: any; ids: Record<string, string>; tok: Record<string, string>; uid: Record<string, string>; today: string;
  s: Record<string, string>; i: Record<string, string>; p: Record<string, string>; tenantId: string; db: string;
}
const PINS: Record<string, string> = { manager: '2222', manager2: '3333', owner: '1111' };

export async function world(): Promise<World> {
  await boot();
  const slug = 't' + Math.random().toString(36).slice(2, 9);
  const t = await provisionTenant({ slug, name: 'Test ' + slug, ownerName: 'Olivia Owner', email: `${slug}@example.com`, password: 'password123', pin: '1111' });
  const pool = tenantPool(t.dbName);
  const w: World = { pool, ids: {}, tok: {}, uid: {}, today: '', s: {}, i: {}, p: {}, tenantId: t.tenantId, db: t.dbName };
  w.today = (await pool.query('select current_date::text d')).rows[0].d;
  w.uid.owner = t.userId;
  const mk = async (key: string, role: string, pin?: string) => {
    const r = await pool.query('insert into users(name, role, pin_hash) values ($1,$2,$3) returning id', [key, role, pin ? hashSecret(pin) : null]);
    w.uid[key] = r.rows[0].id;
  };
  await mk('manager', 'manager', '2222'); await mk('manager2', 'manager', '3333'); await mk('waiter', 'waiter');
  await mk('cashier', 'cashier'); await mk('storekeeper', 'storekeeper'); await mk('accountant', 'accountant');
  for (const k of Object.keys(w.uid)) {
    const role = (await pool.query('select role from users where id=$1', [w.uid[k]])).rows[0].role;
    w.tok[k] = app.tokenFor({ tenantId: t.tenantId, dbName: t.dbName }, { id: w.uid[k], role });
  }
  for (const r of (await pool.query('select id, name from stores')).rows) w.s[r.name.toLowerCase().replace(/ /g, '_')] = r.id;
  const acct = async (code: string) => (await pool.query('select id from accounts where code=$1', [code])).rows[0].id;
  const item = async (key: string, name: string, o: any) => {
    const r = await pool.query(`insert into items(name, base_unit, is_sellable, is_stocked, sell_price, tax_rate_bp, revenue_account_id, cogs_account_id, production_store_id, last_cost)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`, [name, o.unit || 'each', !!o.sell, !!o.stock, o.price || 0, o.tax ?? 1600, o.rev ? await acct(o.rev) : null, o.cogs ? await acct(o.cogs) : null, o.store || null, o.cost || 0]);
    w.i[key] = r.rows[0].id;
  };
  await item('beef', 'Beef (raw)', { unit: 'kg', stock: true, store: w.s.butchery, cost: 80000 });
  await item('onion', 'Onions', { unit: 'kg', stock: true, store: w.s.main_store, cost: 10000 });
  await item('stew', 'Beef stew', { sell: true, price: 65000, rev: '4000', cogs: '5000' });
  await item('tusker', 'Tusker 500ml', { sell: true, stock: true, price: 30000, rev: '4010', cogs: '5010', store: w.s.bar, cost: 25000 });
  await item('laptop', 'Office laptop', {});
  await pool.query('insert into recipe_components values ($1,$2,$3,0.25)', [w.i.stew, w.i.beef, w.s.butchery]);
  await pool.query("insert into item_units values ($1,'carton',24)", [w.i.tusker]);
  const party = async (key: string, kind: string, name: string, limit = 0) => { w.p[key] = (await pool.query('insert into parties(kind, name, credit_limit) values ($1,$2,$3) returning id', [kind, name, limit])).rows[0].id; };
  await party('supplier', 'supplier', 'Kinoo Distributors'); await party('cust', 'customer', 'Regular Customer', 500000);
  await party('poor', 'customer', 'Small Limit Customer', 100000); await party('staff', 'staff', 'Wanjiku (waiter)');
  return w;
}

export async function r(w: World, who: string, method: string, url: string, body?: any, headers: any = {}) {
  const res = await app.inject({ method, url: '/api' + url, headers: { authorization: 'Bearer ' + w.tok[who], ...headers }, payload: body });
  let b: any; try { b = res.json(); } catch { b = res.body; }
  return { s: res.statusCode as number, b };
}
export async function ok(w: World, who: string, method: string, url: string, body?: any, headers: any = {}) {
  const x = await r(w, who, method, url, body, headers);
  assert.equal(x.s, 200, `${method} ${url} -> ${x.s} ${JSON.stringify(x.b)}`);
  return x.b;
}
export async function reject(w: World, who: string, method: string, url: string, body: any, status = 409) {
  const x = await r(w, who, method, url, body);
  assert.ok(x.s >= 400 && x.s < 500, `${method} ${url} should be rejected but got ${x.s}`);
  if (status) assert.equal(x.s, status, `${method} ${url} -> ${x.s} ${JSON.stringify(x.b)}`);
  return x.b;
}
export async function healthy(w: World, label = '') {
  const rec = await ok(w, 'owner', 'GET', '/reconcile');
  const failed = rec.checks.filter((c: any) => !c.ok);
  assert.equal(failed.length, 0, `${label} invariants failed: ${JSON.stringify(failed)}`);
  assert.equal(rec.totals.debit, rec.totals.credit, `${label} trial balance out by ${rec.totals.debit - rec.totals.credit}`);
  const tb = await ok(w, 'owner', 'GET', '/reports/trial-balance');
  assert.equal(tb.balanced, true);
}
export async function bal(w: World, code: string, party?: string): Promise<number> {
  const x = await w.pool.query(`select coalesce(sum(l.debit-l.credit),0)::bigint b from journal_lines l join accounts a on a.id=l.account_id where a.code=$1 and ($2::uuid is null or l.party_id=$2)`, [code, party ?? null]);
  return x.rows[0].b;
}
export async function onHand(w: World, item: string, store?: string): Promise<string> {
  const x = await w.pool.query('select coalesce(sum(qty),0)::text q from stock_balances where item_id=$1 and ($2::uuid is null or store_id=$2)', [item, store ?? null]);
  return x.rows[0].q;
}
export const num = (s: string) => Number(s);
export const approver = (w: World, who = 'manager') => ({ user_id: w.uid[who], pin: PINS[who] });

// Stock beef via a real purchase: 20 kg at KES 800/kg.
export async function buy(w: World, lines: any[], opts: any = {}) {
  return ok(w, opts.who || 'storekeeper', 'POST', '/purchases', { supplier_id: w.p.supplier, store_id: opts.store || w.s.butchery, delivery_date: opts.date || w.today, lines });
}
export async function stockBeef(w: World, qty = '20') { return buy(w, [{ type: 'stock', item_id: w.i.beef, qty, unit_price: 80000 }]); }

export async function newBill(w: World, who = 'waiter', body: any = {}) { return (await ok(w, who, 'POST', '/bills', body)).id as string; }
export async function addLine(w: World, bill: string, item: string, qty: string | number, who = 'waiter') { return (await ok(w, who, 'POST', `/bills/${bill}/lines`, { item_id: item, qty: String(qty) })).line_id as string; }

export async function runTake(w: World, store: string, counts: Record<string, string>, counter = 'storekeeper', approverWho = 'manager') {
  const t = await ok(w, counter, 'POST', '/stock-takes', { store_id: store });
  const view = await ok(w, counter, 'GET', `/stock-takes/${t.id}`);
  const stock = await ok(w, 'owner', 'GET', '/stock');
  const book = (id: string) => { const q = stock.find((s: any) => s.item_id === id && s.store_id === store)?.qty ?? '0'; return q.startsWith('-') ? '0' : q; }; // a physical count is never negative
  const lines = view.lines.map((l: any) => ({ item_id: l.item_id, qty: counts[l.item_id] ?? book(l.item_id) }));
  await ok(w, counter, 'POST', `/stock-takes/${t.id}/counts`, { counts: lines });
  await ok(w, counter, 'POST', `/stock-takes/${t.id}/submit`);
  const ap = (await ok(w, approverWho, 'GET', '/approvals?status=pending')).find((a: any) => a.subject_id === t.id);
  await ok(w, approverWho, 'POST', `/approvals/${ap.id}/approve`, {});
  return t.id as string;
}
export async function journalLines(w: World, sourceType: string, sourceId?: string) {
  return (await w.pool.query(`select a.code, l.debit, l.credit from journals j join journal_lines l on l.journal_id=j.id join accounts a on a.id=l.account_id
    where j.source_type=$1 and ($2::uuid is null or j.source_id=$2) order by j.seq, l.id`, [sourceType, sourceId ?? null])).rows;
}
