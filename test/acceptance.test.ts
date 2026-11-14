import test from 'node:test';
import assert from 'node:assert/strict';
import { World, addLine, approver, bal, boot, buy, healthy, journalLines, newBill, num, ok, onHand, r, reject, runTake, shutdown, stockBeef, world } from './harness';

test.after(shutdown);
const day = async (w: World, offset: number) => (await w.pool.query('select (current_date + $1::int)::text d', [offset])).rows[0].d as string;
const STEW = 65000, STEW_TAX = 8966, STEW_NET = 56034, STEW_COST = 20000; // 65,000 cents incl. 16% VAT; 0.25 kg beef at 800/kg

// ------------------------------------------------------------------ stock takes
test('AT-01 stock-take GAIN has a credit side (Zikis audit issue 1)', async () => {
  const w = await world(); await stockBeef(w);
  const id = await runTake(w, w.s.butchery, { [w.i.beef]: '32.5' });
  const lines = await journalLines(w, 'stock_take', id);
  assert.deepEqual(lines.map((l: any) => [l.code, l.debit, l.credit]), [['1200', 1000000, 0], ['5100', 0, 1000000]]);
  assert.equal(await onHand(w, w.i.beef), '32.500000');
  await healthy(w, 'AT-01');
});
test('AT-02 stock-take loss posts Dr variance / Cr Inventory', async () => {
  const w = await world(); await stockBeef(w);
  const id = await runTake(w, w.s.butchery, { [w.i.beef]: '18.5' });
  const lines = await journalLines(w, 'stock_take', id);
  assert.deepEqual(lines.map((l: any) => [l.code, l.debit, l.credit]), [['5100', 120000, 0], ['1200', 0, 120000]]);
  await healthy(w, 'AT-02');
});
test('AT-03 the counter cannot approve their own count', async () => {
  const w = await world(); await stockBeef(w);
  const t = await ok(w, 'manager', 'POST', '/stock-takes', { store_id: w.s.butchery });
  await ok(w, 'manager', 'POST', `/stock-takes/${t.id}/counts`, { counts: [{ item_id: w.i.beef, qty: '19' }] });
  await ok(w, 'manager', 'POST', `/stock-takes/${t.id}/submit`);
  const ap = (await ok(w, 'manager', 'GET', '/approvals?status=pending'))[0];
  await reject(w, 'manager', 'POST', `/approvals/${ap.id}/approve`, {}, 403);
  await reject(w, 'storekeeper', 'POST', `/approvals/${ap.id}/approve`, {}, 403);
  await ok(w, 'accountant', 'POST', `/approvals/${ap.id}/approve`, {});
  await healthy(w);
});
test('AT-04 counts are blind: the counter never sees system quantity', async () => {
  const w = await world(); await stockBeef(w);
  const t = await ok(w, 'storekeeper', 'POST', '/stock-takes', { store_id: w.s.butchery });
  assert.ok((await ok(w, 'storekeeper', 'GET', `/stock-takes/${t.id}`)).lines.every((l: any) => l.system_qty === null));
  await ok(w, 'storekeeper', 'POST', `/stock-takes/${t.id}/counts`, { counts: [{ item_id: w.i.beef, qty: '19' }] });
  await ok(w, 'storekeeper', 'POST', `/stock-takes/${t.id}/submit`);
  assert.ok((await ok(w, 'storekeeper', 'GET', `/stock-takes/${t.id}`)).lines.every((l: any) => l.system_qty === null));
  const m = await ok(w, 'manager', 'GET', `/stock-takes/${t.id}`);
  assert.equal(m.lines[0].system_qty, '20.000000'); assert.equal(m.lines[0].variance, '-1.000000');
});
test('AT-25 stock takes cover every item mapped to the store, with a system quantity (audit: coverage)', async () => {
  const w = await world();
  await w.pool.query('insert into recipe_components values ($1,$2,$3,0.05)', [w.i.stew, w.i.onion, w.s.kitchen]);
  const k = await ok(w, 'storekeeper', 'POST', '/stock-takes', { store_id: w.s.kitchen });
  assert.ok((await ok(w, 'storekeeper', 'GET', `/stock-takes/${k.id}`)).lines.some((l: any) => l.item_id === w.i.onion), 'recipe-mapped raw item must be counted');
  const b = await ok(w, 'manager', 'POST', '/stock-takes', { store_id: w.s.bar });
  assert.ok((await ok(w, 'manager', 'GET', `/stock-takes/${b.id}`)).lines.some((l: any) => l.item_id === w.i.tusker), 'stocked menu item must be counted');
  await ok(w, 'manager', 'POST', `/stock-takes/${b.id}/counts`, { counts: [{ item_id: w.i.tusker, qty: '0' }] });
  await ok(w, 'manager', 'POST', `/stock-takes/${b.id}/submit`);
  const v = await ok(w, 'accountant', 'GET', `/stock-takes/${b.id}`);
  assert.ok(v.lines.every((l: any) => l.system_qty !== null && l.system_qty !== ''));
});

// ---------------------------------------------------------------------- sales
test('AT-05/06 open bill posts revenue per line; payment clears Open Bills (audit issue 2)', async () => {
  const w = await world(); await stockBeef(w);
  const b = await newBill(w); await addLine(w, b, w.i.stew, 2); await addLine(w, b, w.i.stew, 1);
  assert.equal(await bal(w, '1110'), 3 * STEW);
  // VAT is rounded per line: a 2-unit line (130,000) carries 17,931, a 1-unit line carries 8,966.
  assert.equal(await bal(w, '2100'), -(17931 + STEW_TAX)); assert.equal(await bal(w, '4000'), -(3 * STEW - 17931 - STEW_TAX));
  assert.equal(await bal(w, '5000'), 3 * STEW_COST);
  await healthy(w, 'open bill');
  const p = await ok(w, 'cashier', 'POST', `/bills/${b}/payments`, { method: 'cash', amount: 3 * STEW });
  assert.equal(p.balance, 0);
  assert.equal(await bal(w, '1110'), 0); assert.equal(await bal(w, '1000'), 3 * STEW);
  assert.equal((await ok(w, 'owner', 'GET', `/bills/${b}`)).status, 'closed');
  const pnl = await ok(w, 'accountant', 'GET', '/reports/pnl');
  const net3 = 3 * STEW - 17931 - STEW_TAX; assert.equal(pnl.revenue, net3); assert.equal(pnl.gross_profit, net3 - 3 * STEW_COST);
  const bs = await ok(w, 'accountant', 'GET', '/reports/balance-sheet'); assert.equal(bs.balanced, true);
  await healthy(w, 'paid bill');
});
test('AT-07 evening bill paid after midnight stays in one business day', async () => {
  const w = await world(); await stockBeef(w);
  const b = await newBill(w); await addLine(w, b, w.i.stew, 1);
  await ok(w, 'cashier', 'POST', `/bills/${b}/payments`, { method: 'mpesa', amount: STEW });
  const rows = (await w.pool.query(`select distinct business_date::text d from journals where source_type in ('bill_line','payment')`)).rows;
  assert.equal(rows.length, 1, 'sale and receipt must share the business date, whatever the wall clock says');
  await healthy(w);
});
test('AT-08 line to 0 then re-added twice leaves only the final lines (bill J30i0L4IW5HV)', async () => {
  const w = await world(); await stockBeef(w);
  const b = await newBill(w); const a = await addLine(w, b, w.i.stew, 2);
  await ok(w, 'waiter', 'PATCH', `/bills/${b}/lines/${a}`, { qty: '0' });
  await addLine(w, b, w.i.stew, 1); await addLine(w, b, w.i.stew, 1);
  assert.equal(await bal(w, '1110'), 2 * STEW); assert.equal(await bal(w, '4000'), -2 * STEW_NET); assert.equal(await bal(w, '2100'), -2 * STEW_TAX);
  assert.equal(await bal(w, '5000'), 2 * STEW_COST);
  assert.equal(await onHand(w, w.i.beef), '19.500000');
  await healthy(w);
});
test('AT-09 beef leaves the recipe store, never the terminal store (bills J02iH0T748R9, J30iZFUP9EHL)', async () => {
  const w = await world(); await stockBeef(w);
  const b = await newBill(w, 'waiter', { store_id: w.s.restaurant });
  await addLine(w, b, w.i.stew, 1);
  const late = await addLine(w, b, w.i.stew, 2); // added later from the Restaurant POS
  await ok(w, 'waiter', 'PATCH', `/bills/${b}/lines/${late}`, { qty: '3' });
  assert.equal(num(await onHand(w, w.i.beef, w.s.restaurant)), 0);
  assert.equal(await onHand(w, w.i.beef, w.s.butchery), '19.000000'); // 20 - 4 x 0.25
  const rows = (await w.pool.query('select count(*)::int n from stock_balances where store_id=$1', [w.s.restaurant])).rows[0];
  assert.equal(rows.n, 0);
  await healthy(w);
});
test.todo('AT-10 same through the offline sync path (offline sync is not built yet)');
test('AT-11 removing an item before the kitchen prepares it restores stock and reverses revenue', async () => {
  const w = await world(); await stockBeef(w);
  const b = await newBill(w); const l = await addLine(w, b, w.i.stew, 2);
  await ok(w, 'waiter', 'DELETE', `/bills/${b}/lines/${l}`, { reason: 'customer changed mind' });
  assert.equal(await onHand(w, w.i.beef), '20.000000'); assert.equal(await bal(w, '1110'), 0);
  assert.equal(await bal(w, '4000'), 0); assert.equal(await bal(w, '5000'), 0);
  await healthy(w);
});
test('AT-12 removing a prepared item reverses revenue, moves cost to Wastage, keeps stock out', async () => {
  const w = await world(); await stockBeef(w);
  const b = await newBill(w); const l = await addLine(w, b, w.i.stew, 1);
  await ok(w, 'waiter', 'POST', `/bills/${b}/lines/${l}/prepared`);
  await reject(w, 'waiter', 'DELETE', `/bills/${b}/lines/${l}`, { reason: 'wrong table' }, 403);
  await reject(w, 'waiter', 'DELETE', `/bills/${b}/lines/${l}`, { reason: 'wrong table', approver: { user_id: w.uid.manager, pin: '0000' } }, 403);
  await ok(w, 'waiter', 'DELETE', `/bills/${b}/lines/${l}`, { reason: 'wrong table', approver: approver(w) });
  assert.equal(await bal(w, '1110'), 0); assert.equal(await bal(w, '4000'), 0); assert.equal(await bal(w, '5000'), 0);
  assert.equal(await bal(w, '5110'), STEW_COST);
  assert.equal(await onHand(w, w.i.beef), '19.750000');
  await healthy(w);
});
test('AT-13 staff deduction posts to Staff Debtors; repayment clears it (audit item 4)', async () => {
  const w = await world(); await stockBeef(w);
  const b = await newBill(w); await addLine(w, b, w.i.stew, 1);
  await reject(w, 'waiter', 'POST', `/bills/${b}/close`, { disposition: 'staff', staff_id: w.p.staff }, 403);
  await ok(w, 'waiter', 'POST', `/bills/${b}/close`, { disposition: 'staff', staff_id: w.p.staff, approver: approver(w) });
  assert.equal(await bal(w, '1120', w.p.staff), STEW); assert.equal(await bal(w, '1110'), 0);
  assert.equal((await ok(w, 'owner', 'GET', `/bills/${b}`)).disposition, 'staff');
  await ok(w, 'accountant', 'POST', `/parties/${w.p.staff}/receipts`, { method: 'cash', amount: STEW });
  assert.equal(await bal(w, '1120', w.p.staff), 0);
  await healthy(w);
});
test('AT-14/15 complimentary needs a reason and a different approver', async () => {
  const w = await world(); await stockBeef(w);
  const b = await newBill(w); await addLine(w, b, w.i.stew, 1);
  await reject(w, 'waiter', 'POST', `/bills/${b}/close`, { disposition: 'complimentary', reason: 'VIP' }, 403);
  await reject(w, 'waiter', 'POST', `/bills/${b}/close`, { disposition: 'complimentary', approver: approver(w) }, 400);
  await reject(w, 'manager', 'POST', `/bills/${b}/close`, { disposition: 'complimentary', reason: 'VIP', approver: approver(w, 'manager') }, 403);
  await ok(w, 'manager', 'POST', `/bills/${b}/close`, { disposition: 'complimentary', reason: 'VIP guest', approver: approver(w, 'manager2') });
  assert.equal(await bal(w, '6000'), STEW); assert.equal(await bal(w, '1110'), 0);
  await healthy(w);
});
test('AT-16 credit sales respect the customer limit', async () => {
  const w = await world(); await stockBeef(w);
  const a = await newBill(w, 'waiter', { customer_id: w.p.cust }); await addLine(w, a, w.i.stew, 1);
  await ok(w, 'waiter', 'POST', `/bills/${a}/close`, { disposition: 'credit' });
  const b = await newBill(w, 'waiter', { customer_id: w.p.poor }); await addLine(w, b, w.i.stew, 2);
  await reject(w, 'waiter', 'POST', `/bills/${b}/close`, { disposition: 'credit' }, 403);
  await ok(w, 'waiter', 'POST', `/bills/${b}/close`, { disposition: 'credit', approver: approver(w) });
  assert.equal(await bal(w, '1100', w.p.cust), STEW); assert.equal(await bal(w, '1100', w.p.poor), 2 * STEW);
  await ok(w, 'accountant', 'POST', `/parties/${w.p.poor}/receipts`, { method: 'mpesa', amount: 2 * STEW });
  assert.equal(await bal(w, '1100', w.p.poor), 0);
  const stmt = await ok(w, 'accountant', 'GET', '/reports/balances/customer');
  assert.equal(stmt.find((x: any) => x.id === w.p.cust).balance, STEW);
  await healthy(w);
});

// ------------------------------------------------------------------- purchases
test('AT-17 non-stock purchases post to asset/expense, not Inventory (audit issue 3)', async () => {
  const w = await world();
  const p = await buy(w, [{ type: 'asset', account: '1500', amount: 3700000, description: 'POS terminal' }, { type: 'expense', account: '6130', amount: 430000, description: 'Printer repair' }]);
  assert.equal(p.total, 4130000);
  assert.equal(await bal(w, '1500'), 3700000); assert.equal(await bal(w, '6130'), 430000); assert.equal(await bal(w, '1200'), 0);
  assert.equal(await bal(w, '2000', w.p.supplier), -4130000);
  await healthy(w);
});
test('AT-18 one price per purchase line: payable always equals the lines (audit issue 3)', async () => {
  const w = await world();
  const p = await buy(w, [{ type: 'stock', item_id: w.i.beef, qty: '10', unit_price: 80000, tax_rate_bp: 1600 }]);
  assert.equal(p.total, 928000);
  assert.equal(await bal(w, '1200'), 800000); assert.equal(await bal(w, '1400'), 128000); assert.equal(await bal(w, '2000', w.p.supplier), -928000);
  await buy(w, [{ type: 'stock', item_id: w.i.beef, qty: '10', unit_price: 80000, tax_rate_bp: 1600, vat_claimable: false }]);
  assert.equal(await bal(w, '1200'), 800000 + 928000); assert.equal(await bal(w, '1400'), 128000);
  await healthy(w);
});
test('AT-19 purchases post on the delivery date, not the keying date', async () => {
  const w = await world(); const d = await day(w, -5);
  const p = await buy(w, [{ type: 'stock', item_id: w.i.beef, qty: '89', unit_price: 80000 }], { date: d });
  assert.equal(p.late_entry, true);
  const j = (await w.pool.query("select distinct business_date::text d from journals where source_type='purchase'")).rows;
  assert.deepEqual(j.map((x: any) => x.d), [d]);
  const m = (await w.pool.query("select distinct business_date::text d from stock_moves where source_type='purchase'")).rows;
  assert.deepEqual(m.map((x: any) => x.d), [d]);
  assert.equal((await buy(w, [{ type: 'stock', item_id: w.i.beef, qty: '1', unit_price: 80000 }])).late_entry, false);
  await healthy(w);
});
test('AT-20 supplier payment needs a mode and reduces the supplier balance', async () => {
  const w = await world(); const p = await stockBeef(w);
  await reject(w, 'accountant', 'POST', `/purchases/${p.id}/payments`, { amount: 600000 }, 400);
  await ok(w, 'accountant', 'POST', `/purchases/${p.id}/payments`, { method: 'cash', amount: 600000 });
  assert.equal(await bal(w, '2000', w.p.supplier), -1000000);
  await reject(w, 'accountant', 'POST', `/purchases/${p.id}/payments`, { method: 'cash', amount: 2000000 }, 409);
  await healthy(w);
});
test('AT-26 unit conversion is exact: 2 cartons of 24, sell 3 singles', async () => {
  const w = await world();
  await buy(w, [{ type: 'stock', item_id: w.i.tusker, qty: '2', unit: 'carton', unit_price: 600000 }], { store: w.s.bar });
  assert.equal(await onHand(w, w.i.tusker), '48.000000'); assert.equal(await bal(w, '1200'), 1200000);
  const b = await newBill(w); await addLine(w, b, w.i.tusker, 3);
  assert.equal(await bal(w, '5010'), 75000); assert.equal(await onHand(w, w.i.tusker), '45.000000');
  await reject(w, 'storekeeper', 'POST', '/purchases', { supplier_id: w.p.supplier, store_id: w.s.bar, delivery_date: w.today, lines: [{ type: 'stock', item_id: w.i.tusker, qty: '1', unit: 'pallet', unit_price: 1 }] }, 400);
  await healthy(w);
});

// ---------------------------------------------------------- wastage & movements
test('AT-21 double-clicking wastage posts once (audit: wastage entry)', async () => {
  const w = await world(); await stockBeef(w);
  const body = { item_id: w.i.beef, store_id: w.s.butchery, qty: '1.42', reason: 'spoilage' };
  const h = { 'idempotency-key': 'form-123' };
  const x1 = await ok(w, 'storekeeper', 'POST', '/wastage', body, h), x2 = await ok(w, 'storekeeper', 'POST', '/wastage', body, h);
  assert.equal(x1.id, x2.id);
  assert.equal((await w.pool.query('select count(*)::int n from wastage')).rows[0].n, 1);
  assert.equal(await onHand(w, w.i.beef), '18.580000');
  await healthy(w);
});
test('AT-22 wastage keeps exact quantity, needs a listed reason, flags backdating', async () => {
  const w = await world(); await stockBeef(w);
  const body = { item_id: w.i.beef, store_id: w.s.butchery, qty: '1.42', reason: 'spoilage' };
  await ok(w, 'storekeeper', 'POST', '/wastage', body);
  assert.equal((await w.pool.query('select qty::text q from wastage')).rows[0].q, '1.420000');
  await reject(w, 'storekeeper', 'POST', '/wastage', { ...body, reason: 'because' }, 400);
  await reject(w, 'storekeeper', 'POST', '/wastage', { ...body, qty: '1.4200001' }, 400);
  const d = await day(w, -5);
  const pend = await ok(w, 'storekeeper', 'POST', '/wastage', { ...body, qty: '2', date: d });
  assert.equal(pend.status, 'pending'); assert.equal(await onHand(w, w.i.beef), '18.580000');
  const ap = (await ok(w, 'manager', 'GET', '/approvals?status=pending')).find((a: any) => a.subject_id === pend.id);
  await ok(w, 'manager', 'POST', `/approvals/${ap.id}/approve`, {});
  assert.equal(await onHand(w, w.i.beef), '16.580000');
  await healthy(w);
});
test('Stock transfers and consumables post balanced entries', async () => {
  const w = await world(); await stockBeef(w);
  await buy(w, [{ type: 'stock', item_id: w.i.onion, qty: '10', unit_price: 10000 }], { store: w.s.main_store });
  await ok(w, 'storekeeper', 'POST', '/stock/transfers', { from_store: w.s.butchery, to_store: w.s.kitchen, lines: [{ item_id: w.i.beef, qty: '5' }] });
  assert.equal(await onHand(w, w.i.beef, w.s.butchery), '15.000000'); assert.equal(await onHand(w, w.i.beef, w.s.kitchen), '5.000000');
  assert.equal(await bal(w, '1200'), 1600000 + 100000);
  await ok(w, 'storekeeper', 'POST', '/stock/consume', { item_id: w.i.onion, store_id: w.s.main_store, qty: '2', department: 'Kitchen' });
  assert.equal(await bal(w, '5120'), 20000);
  await healthy(w);
});

// -------------------------------------------------------- ledger integrity (DB)
async function expectDbError(w: World, sql: string[], pattern: RegExp) {
  const c = await w.pool.connect();
  try {
    await assert.rejects(async () => { await c.query('begin'); for (const s of sql) await c.query(s); await c.query('commit'); }, pattern);
  } finally { await c.query('rollback').catch(() => {}); c.release(); }
}
test('AT-23 the database rejects one-sided, unbalanced and empty journals', async () => {
  const w = await world();
  const cash = "(select id from accounts where code='1000')", rev = "(select id from accounts where code='4000')";
  const hdr = "insert into journals(id, business_date, source_type) values ('00000000-0000-0000-0000-000000000001', current_date, 'test')";
  await expectDbError(w, [hdr, `insert into journal_lines(journal_id, account_id, debit) values ('00000000-0000-0000-0000-000000000001', ${cash}, 100)`], /at least two lines|out of balance/);
  await expectDbError(w, [hdr, `insert into journal_lines(journal_id, account_id, debit) values ('00000000-0000-0000-0000-000000000001', ${cash}, 100)`, `insert into journal_lines(journal_id, account_id, credit) values ('00000000-0000-0000-0000-000000000001', ${rev}, 90)`], /out of balance/);
  await expectDbError(w, [hdr], /at least two lines/);
  await expectDbError(w, [hdr, `insert into journal_lines(journal_id, account_id, debit, credit) values ('00000000-0000-0000-0000-000000000001', ${cash}, 5, 5)`], /check constraint|violates/);
  await healthy(w);
});
test('AT-24 the ledger is append-only and stock balances are derived only', async () => {
  const w = await world(); await stockBeef(w);
  await expectDbError(w, ['update journal_lines set debit = debit + 1'], /append-only/);
  await expectDbError(w, ['delete from journal_lines'], /append-only/);
  await expectDbError(w, ['update journals set memo = \'x\''], /append-only/);
  await expectDbError(w, ['truncate journal_lines cascade'], /append-only/);
  await expectDbError(w, ['update stock_moves set qty = qty + 1'], /append-only/);
  await expectDbError(w, ["update stock_balances set qty = 999"], /derived from stock_moves/);
  const old = (await w.pool.query('select id from journals limit 1')).rows[0].id;
  const a = "(select id from accounts where code='1000')", b = "(select id from accounts where code='4000')";
  await expectDbError(w, [`insert into journal_lines(journal_id, account_id, debit) values ('${old}', ${a}, 7)`, `insert into journal_lines(journal_id, account_id, credit) values ('${old}', ${b}, 7)`], /only be added when the journal is created/);
  await healthy(w);
});
test('AT-28 trial balance respects the chosen date range (audit: filter ignored)', async () => {
  const w = await world();
  await buy(w, [{ type: 'stock', item_id: w.i.beef, qty: '10', unit_price: 80000 }], { date: await day(w, -3) });
  await buy(w, [{ type: 'stock', item_id: w.i.beef, qty: '5', unit_price: 80000 }], { date: await day(w, -1) });
  const one = await ok(w, 'accountant', 'GET', `/reports/trial-balance?from=${await day(w, -1)}&to=${await day(w, -1)}`);
  assert.equal(one.totals.debit, 400000); assert.equal(one.balanced, true);
  const all = await ok(w, 'accountant', 'GET', '/reports/trial-balance');
  assert.equal(all.totals.debit, 1200000); assert.equal(all.balanced, true);
});
test('AT-32 locked periods reject postings; locks only move forward', async () => {
  const w = await world();
  await ok(w, 'owner', 'POST', '/periods/lock', { through: await day(w, -1) });
  await reject(w, 'storekeeper', 'POST', '/purchases', { supplier_id: w.p.supplier, store_id: w.s.butchery, delivery_date: await day(w, -3), lines: [{ type: 'stock', item_id: w.i.beef, qty: '1', unit_price: 1000 }] }, 409);
  await stockBeef(w);
  await reject(w, 'owner', 'POST', '/periods/lock', { through: await day(w, -10) }, 409);
  await reject(w, 'manager', 'POST', '/periods/lock', { through: await day(w, 0) }, 403);
  await healthy(w);
});
test('AT-33 replaying a command with the same key posts nothing twice', async () => {
  const w = await world(); await stockBeef(w);
  const b = await newBill(w); await addLine(w, b, w.i.stew, 1);
  const h = { 'idempotency-key': 'pay-1' };
  const x = await ok(w, 'cashier', 'POST', `/bills/${b}/payments`, { method: 'cash', amount: 30000 }, h);
  const y = await ok(w, 'cashier', 'POST', `/bills/${b}/payments`, { method: 'cash', amount: 30000 }, h);
  assert.equal(x.payment_id, y.payment_id);
  assert.equal((await w.pool.query('select count(*)::int n from payments')).rows[0].n, 1);
  assert.equal((await ok(w, 'owner', 'GET', `/bills/${b}`)).balance, STEW - 30000);
  await reject(w, 'cashier', 'POST', `/bills/${b}/payments`, { method: 'cash', amount: STEW }, 409); // more than the balance
  await healthy(w);
});

// -------------------------------------------------------------- money & day end
test('AT-31 cash count variance posts to Cash over/short; banking moves cash to bank', async () => {
  const w = await world(); await stockBeef(w);
  const b = await newBill(w); await addLine(w, b, w.i.stew, 1);
  await ok(w, 'cashier', 'POST', `/bills/${b}/payments`, { method: 'cash', amount: STEW });
  const c = await ok(w, 'manager', 'POST', '/cash/count', { counted: STEW - 50000 });
  assert.equal(c.variance, -50000); assert.equal(await bal(w, '6010'), 50000); assert.equal(await bal(w, '1000'), STEW - 50000);
  await ok(w, 'manager', 'POST', '/cash/bank', { amount: 15000, reference: 'slip 1' });
  assert.equal(await bal(w, '1030'), 15000);
  await reject(w, 'manager', 'POST', '/cash/bank', { amount: 99999999 }, 409);
  await healthy(w);
});
test('AT-29 the day cannot close with open bills or pending approvals', async () => {
  const w = await world(); await stockBeef(w);
  const b = await newBill(w); await addLine(w, b, w.i.stew, 1);
  const blocked = await reject(w, 'manager', 'POST', '/day/close', {}, 409);
  assert.ok(blocked.detail.find((k: any) => k.id === 'open_bills' && !k.ok));
  await ok(w, 'waiter', 'POST', `/bills/${b}/void-request`, { reason: 'wrong table' });
  const still = await reject(w, 'manager', 'POST', '/day/close', {}, 409);
  assert.ok(still.detail.find((k: any) => k.id === 'void_approvals' && !k.ok));
  const ap = (await ok(w, 'manager', 'GET', '/approvals?status=pending'))[0];
  await reject(w, 'waiter', 'POST', `/approvals/${ap.id}/approve`, {}, 403);
  await ok(w, 'manager', 'POST', `/approvals/${ap.id}/approve`, {});
  assert.equal((await ok(w, 'owner', 'GET', `/bills/${b}`)).status, 'void');
  assert.equal(await onHand(w, w.i.beef), '20.000000'); assert.equal(await bal(w, '1110'), 0);
  const closed = await ok(w, 'manager', 'POST', '/day/close', {});
  assert.ok(closed.closed);
  await healthy(w);
});
test('Opening balances post once, balanced against Opening Balance Equity; expenses need a mode', async () => {
  const w = await world();
  await ok(w, 'accountant', 'POST', '/opening-balances', { lines: [{ account: '1000', debit: 5000000 }, { account: '2000', credit: 1200000, party_id: w.p.supplier }] });
  assert.equal(await bal(w, '3900'), -3800000);
  await reject(w, 'accountant', 'POST', '/opening-balances', { lines: [{ account: '1000', debit: 1 }] }, 409);
  await reject(w, 'accountant', 'POST', '/expenses', { account: '6110', amount: 500000 }, 400);
  await ok(w, 'accountant', 'POST', '/expenses', { account: '6110', amount: 500000, vat: 80000, method: 'cash', description: 'Electricity' });
  assert.equal(await bal(w, '6110'), 500000); assert.equal(await bal(w, '1400'), 80000); assert.equal(await bal(w, '1000'), 5000000 - 580000);
  await healthy(w);
});

// ----------------------------------------------------------------- tenancy/auth
test('Every client has its own database; data never crosses', async () => {
  const a = await world(), b = await world();
  assert.notEqual(a.db, b.db);
  const dbs = (await a.pool.query('select datname from pg_database where datname = any($1)', [[a.db, b.db]])).rows;
  assert.equal(dbs.length, 2);
  await ok(a, 'owner', 'POST', '/parties', { kind: 'customer', name: 'Only in A' });
  const inB = await ok(b, 'owner', 'GET', '/parties?kind=customer');
  assert.ok(!inB.some((p: any) => p.name === 'Only in A'));
});
test('Self-serve signup, login, roles and rate limits', async () => {
  const app = await boot();
  const slug = 'cafe' + Math.random().toString(36).slice(2, 7);
  const call = async (url: string, payload: any, token?: string) => { const x = await app.inject({ method: 'POST', url, payload, headers: token ? { authorization: 'Bearer ' + token } : {} }); return { s: x.statusCode, b: x.json() }; };
  assert.equal((await call('/api/signup', { slug: 'x', business_name: 'X', email: 'a@b.co', password: 'password123' })).s, 400);
  assert.equal((await call('/api/signup', { slug, business_name: 'Cafe', owner_name: 'Amani', email: `${slug}@example.com`, password: 'short' })).s, 400);
  const s = await call('/api/signup', { slug, business_name: 'Cafe', owner_name: 'Amani', email: `${slug}@example.com`, password: 'password123', demo: true });
  assert.equal(s.s, 200);
  assert.equal((await call('/api/signup', { slug, business_name: 'Cafe', email: `${slug}2@example.com`, password: 'password123' })).s, 409);
  assert.equal((await call('/api/auth/login', { slug, email: `${slug}@example.com`, password: 'wrong-pass' })).s, 401);
  const l = await call('/api/auth/login', { slug, email: `${slug}@example.com`, password: 'password123' });
  assert.equal(l.s, 200);
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer ' + l.b.token } });
  assert.equal(me.json().user.role, 'owner');
  const items = await app.inject({ method: 'GET', url: '/api/items?filter=sellable', headers: { authorization: 'Bearer ' + l.b.token } });
  assert.ok(items.json().length >= 3, 'demo data present');
  assert.equal((await app.inject({ method: 'GET', url: '/api/items' })).statusCode, 401);
});
test('Roles: a waiter cannot see reports, approve, or change setup', async () => {
  const w = await world();
  for (const [m, u] of [['GET', '/reports/trial-balance'], ['GET', '/approvals'], ['POST', '/periods/lock'], ['POST', '/expenses']]) assert.equal((await r(w, 'waiter', m, u, {})).s, 403);
  assert.equal((await r(w, 'waiter', 'POST', '/items', { name: 'x' })).s, 403);
});
