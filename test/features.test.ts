import test from 'node:test';
import assert from 'node:assert/strict';
process.env.PLATFORM_ADMIN_TOKEN = 'platform-secret';
import { World, addLine, approver, bal, boot, buy, healthy, journalLines, newBill, num, ok, onHand, r, reject, shutdown, stockBeef, world } from './harness';
import { clearTenantCache } from '../src/server';
import { computePayslip } from '../src/modules/hr';
import { PAYROLL_DEFAULTS } from '../src/modules/extras';
import { safeWebhook } from '../src/modules/owner';

test.after(shutdown);
const day = async (w: World, offset: number) => (await w.pool.query('select (current_date + $1::int)::text d', [offset])).rows[0].d as string;
const STEW = 65000, STEW_COST = 20000;
async function paidBill(w: World, qty = 1, method = 'cash', extra: any = {}) {
  const b = await newBill(w, 'waiter', extra); const l = await addLine(w, b, w.i.stew, qty);
  await ok(w, 'cashier', 'POST', `/bills/${b}/payments`, { method, amount: STEW * qty });
  return { b, l };
}

// ============================================================ B5 refunds and returns
test('F-01 refund after payment reverses revenue; cost goes to wastage unless restocked', async () => {
  const w = await world(); await stockBeef(w);
  const a = await paidBill(w);
  await reject(w, 'waiter', 'POST', `/bills/${a.b}/refund`, { line_id: a.l, method: 'cash', reason: 'cold', restock: false }, 403);
  const cashBefore = await bal(w, '1000');
  await ok(w, 'waiter', 'POST', `/bills/${a.b}/refund`, { line_id: a.l, method: 'cash', reason: 'food was cold', restock: false, approver: approver(w) });
  assert.equal(await bal(w, '1000'), cashBefore - STEW); assert.equal(await bal(w, '4000'), 0); assert.equal(await bal(w, '2100'), 0);
  assert.equal(await bal(w, '5110'), STEW_COST); assert.equal(await onHand(w, w.i.beef), '19.750000');
  await reject(w, 'waiter', 'POST', `/bills/${a.b}/refund`, { line_id: a.l, method: 'cash', reason: 'again', approver: approver(w) }, 409);
  const c = await paidBill(w);
  await ok(w, 'waiter', 'POST', `/bills/${c.b}/refund`, { line_id: c.l, method: 'mpesa', reason: 'wrong order, untouched', restock: true, approver: approver(w, 'manager2') });
  assert.equal(await onHand(w, w.i.beef), '19.750000'); assert.equal(await bal(w, '5110'), STEW_COST);
  const open = await newBill(w); const ol = await addLine(w, open, w.i.stew, 1);
  await reject(w, 'waiter', 'POST', `/bills/${open}/refund`, { line_id: ol, method: 'cash', reason: 'x', approver: approver(w) }, 409);
  await healthy(w, 'refund');
});
test('F-02 refund to store credit lands in the customer deposit account', async () => {
  const w = await world(); await stockBeef(w);
  const a = await paidBill(w, 1, 'cash', { customer_id: w.p.cust });
  await ok(w, 'waiter', 'POST', `/bills/${a.b}/refund`, { line_id: a.l, method: 'deposit', reason: 'goodwill credit', restock: false, approver: approver(w) });
  assert.equal(await bal(w, '2200', w.p.cust), -STEW);
  await healthy(w);
});
test('F-03 purchase return: credits Inventory and VAT input at original cost, reduces what is owed', async () => {
  const w = await world();
  const p = await buy(w, [{ type: 'stock', item_id: w.i.beef, qty: '10', unit_price: 80000, tax_rate_bp: 1600 }]);
  const lineId = (await w.pool.query('select id from purchase_lines limit 1')).rows[0].id;
  const out = await ok(w, 'storekeeper', 'POST', `/purchases/${p.id}/returns`, { reason: 'bad quality', lines: [{ purchase_line_id: lineId, qty: '4' }] });
  assert.equal(out.credit, 371200);
  assert.equal(await bal(w, '1200'), 480000); assert.equal(await bal(w, '1400'), 76800);
  assert.equal(await bal(w, '2000', w.p.supplier), -(928000 - 371200)); assert.equal(await onHand(w, w.i.beef), '6.000000');
  await reject(w, 'storekeeper', 'POST', `/purchases/${p.id}/returns`, { reason: 'more', lines: [{ purchase_line_id: lineId, qty: '7' }] }, 409);
  const list = await ok(w, 'storekeeper', 'GET', '/purchases'); assert.equal(list[0].outstanding, 928000 - 371200);
  await healthy(w);
});

// ===================================================== B6 tips, charges, deposits, cards
test('F-04 tips are held for staff, not booked as revenue, and paid out', async () => {
  const w = await world(); await stockBeef(w);
  const b = await newBill(w); await addLine(w, b, w.i.stew, 1);
  await ok(w, 'cashier', 'POST', `/bills/${b}/payments`, { method: 'cash', amount: STEW, tip: 5000 });
  assert.equal(await bal(w, '1000'), STEW + 5000); assert.equal(await bal(w, '2300'), -5000); assert.equal(await bal(w, '4000'), -(STEW - STEW_TAXNET()));
  await reject(w, 'accountant', 'POST', '/tips/payout', { amount: 9000 }, 409);
  await ok(w, 'accountant', 'POST', '/tips/payout', { amount: 5000, method: 'cash' });
  assert.equal(await bal(w, '2300'), 0);
  await healthy(w);
});
function STEW_TAXNET() { return 8966; }
test('F-05 service charge is held as a liability; re-applying replaces it', async () => {
  const w = await world(); await stockBeef(w);
  const b = await newBill(w); await addLine(w, b, w.i.stew, 1);
  assert.equal((await ok(w, 'waiter', 'POST', `/bills/${b}/service-charge`, { percent_bp: 1000 })).amount, 6500);
  const again = await ok(w, 'waiter', 'POST', `/bills/${b}/service-charge`, { percent_bp: 1000 });
  assert.equal(again.balance, STEW + 6500); assert.equal(await bal(w, '2300'), -6500);
  await ok(w, 'cashier', 'POST', `/bills/${b}/payments`, { method: 'card', amount: STEW + 6500 });
  assert.equal((await ok(w, 'owner', 'GET', `/bills/${b}`)).status, 'closed');
  await healthy(w);
});
test('F-05b voiding a bill that has a service charge reverses the charge too (found by the soak test)', async () => {
  const w = await world(); await stockBeef(w);
  const b = await newBill(w); await addLine(w, b, w.i.stew, 1);
  await ok(w, 'waiter', 'POST', `/bills/${b}/service-charge`, { percent_bp: 1000 });
  await ok(w, 'waiter', 'POST', `/bills/${b}/void-request`, { reason: 'walked out' });
  const ap = (await ok(w, 'manager', 'GET', '/approvals?status=pending'))[0];
  await ok(w, 'manager', 'POST', `/approvals/${ap.id}/approve`, {});
  assert.equal(await bal(w, '2300'), 0); assert.equal(await bal(w, '1110'), 0); assert.equal((await ok(w, 'owner', 'GET', `/bills/${b}`)).balance, 0);
  await healthy(w);
});
test('F-06 deposits and gift cards are liabilities that settle bills', async () => {
  const w = await world(); await stockBeef(w);
  await ok(w, 'cashier', 'POST', '/deposits', { customer_id: w.p.cust, amount: 100000, method: 'cash' });
  const b = await newBill(w, 'waiter', { customer_id: w.p.cust }); await addLine(w, b, w.i.stew, 1);
  await ok(w, 'cashier', 'POST', `/bills/${b}/payments`, { method: 'deposit', amount: STEW });
  assert.equal(await bal(w, '2200', w.p.cust), -35000);
  const gc = await ok(w, 'cashier', 'POST', '/gift-cards', { amount: 50000, method: 'mpesa' });
  const b2 = await newBill(w); await addLine(w, b2, w.i.stew, 1);
  await ok(w, 'cashier', 'POST', `/bills/${b2}/payments`, { method: 'giftcard', code: gc.code, amount: 30000 });
  await reject(w, 'cashier', 'POST', `/bills/${b2}/payments`, { method: 'giftcard', code: gc.code, amount: 30000 }, 409);
  assert.equal((await ok(w, 'cashier', 'GET', `/gift-cards/${gc.code}`)).remaining, 20000);
  await reject(w, 'cashier', 'POST', `/bills/${b2}/payments`, { method: 'giftcard', code: 'NOPE0000', amount: 100 }, 400);
  assert.equal(await bal(w, '2210'), -20000);
  await healthy(w);
});
test('F-07 loyalty points accrue on paid money and redeem as payment', async () => {
  const w = await world(); await stockBeef(w);
  await ok(w, 'owner', 'POST', '/settings', { loyalty_enabled: 'true' });
  const a = await newBill(w, 'waiter', { customer_id: w.p.cust }); await addLine(w, a, w.i.stew, 2);
  await ok(w, 'cashier', 'POST', `/bills/${a}/payments`, { method: 'cash', amount: 2 * STEW });
  assert.equal((await ok(w, 'cashier', 'GET', `/customers/${w.p.cust}/loyalty`)).points, 13);
  assert.equal(await bal(w, '6150'), 1300); assert.equal(await bal(w, '2220', w.p.cust), -1300);
  const b = await newBill(w, 'waiter', { customer_id: w.p.cust }); await addLine(w, b, w.i.stew, 1);
  await reject(w, 'cashier', 'POST', `/bills/${b}/payments`, { method: 'points', points: 99 }, 409);
  await ok(w, 'cashier', 'POST', `/bills/${b}/payments`, { method: 'points', points: 10 });
  assert.equal((await ok(w, 'cashier', 'GET', `/customers/${w.p.cust}/loyalty`)).points, 3);
  assert.equal(await bal(w, '2220', w.p.cust), -300);
  await healthy(w);
});

// ===================================================================== B7 levy
test('F-08 tourism/catering levy is carved out of the VAT-inclusive price and reverses with the line', async () => {
  const w = await world(); await stockBeef(w);
  await reject(w, 'manager', 'POST', '/settings', { levy_bp: 200 }, 403);
  await reject(w, 'owner', 'POST', '/settings', { levy_bp: 5000 }, 400);
  await ok(w, 'owner', 'POST', '/settings', { levy_bp: 200 });
  const b = await newBill(w); const l = await addLine(w, b, w.i.stew, 1);
  assert.equal(await bal(w, '2100'), -8814); assert.equal(await bal(w, '2110'), -1102); assert.equal(await bal(w, '4000'), -55084);
  await ok(w, 'waiter', 'DELETE', `/bills/${b}/lines/${l}`, { reason: 'changed mind' });
  assert.equal(await bal(w, '2110'), 0); assert.equal(await bal(w, '2100'), 0);
  await healthy(w);
});

// ===================================================== B8 production, meals, depreciation
test('F-09 prep production converts raw items into a prepared item at cost, net zero on Inventory', async () => {
  const w = await world(); await stockBeef(w);
  await buy(w, [{ type: 'stock', item_id: w.i.onion, qty: '5', unit_price: 10000 }], { store: w.s.kitchen });
  const sauce = (await w.pool.query("insert into items(name, base_unit, is_stocked, production_store_id) values ('Stew base','litre',true,$1) returning id", [w.s.kitchen])).rows[0].id;
  const invBefore = await bal(w, '1200');
  const out = await ok(w, 'storekeeper', 'POST', '/stock/production', { output_item_id: sauce, store_id: w.s.kitchen, qty: '10', inputs: [{ item_id: w.i.beef, store_id: w.s.butchery, qty: '2' }, { item_id: w.i.onion, store_id: w.s.kitchen, qty: '1' }] });
  assert.equal(out.total_cost, 170000); assert.equal(await bal(w, '1200'), invBefore);
  assert.equal(await onHand(w, sauce), '10.000000'); assert.equal(await onHand(w, w.i.beef), '18.000000');
  assert.equal(num((await w.pool.query('select last_cost::text c from items where id=$1', [sauce])).rows[0].c), 17000);
  await healthy(w);
});
test('F-10 staff meals are charged to Staff meals, not lost', async () => {
  const w = await world(); await stockBeef(w);
  await ok(w, 'storekeeper', 'POST', '/stock/staff-meal', { item_id: w.i.beef, store_id: w.s.butchery, qty: '1.5' });
  assert.equal(await bal(w, '5130'), 120000); assert.equal(await onHand(w, w.i.beef), '18.500000');
  await healthy(w);
});
test('F-11 depreciation: straight line, once per period, catches up, matches the register', async () => {
  const w = await world();
  await ok(w, 'accountant', 'POST', '/assets', { name: 'POS terminal', cost: 3700000, life_months: 36, acquired: '2026-09-15' });
  assert.equal((await ok(w, 'accountant', 'POST', '/assets/depreciate', { period: '2026-09' })).total, 102778);
  assert.equal((await ok(w, 'accountant', 'POST', '/assets/depreciate', { period: '2026-10' })).total, 102778);
  await reject(w, 'accountant', 'POST', '/assets/depreciate', { period: '2026-10' }, 409);
  assert.equal((await ok(w, 'accountant', 'POST', '/assets/depreciate', { period: '2026-12' })).total, 411111 - 205556);
  assert.equal(await bal(w, '6040'), 411111); assert.equal(await bal(w, '1590'), -411111);
  assert.equal((await ok(w, 'accountant', 'GET', '/assets'))[0].book_value, 3700000 - 411111);
  await healthy(w);
});

// ================================================================== B4 printing
test('F-12 receipts and kitchen tickets: text, ESC/POS bytes, no duplicate orders on reprint', async () => {
  const w = await world(); await stockBeef(w);
  await ok(w, 'owner', 'POST', '/settings', { business_name: 'Zikis Lounge', business_phone: '0700 000 000', kra_pin: 'P000000000A' });
  const b = await newBill(w, 'waiter', { table_name: 'T4' }); await addLine(w, b, w.i.stew, 2);
  const k1 = await ok(w, 'waiter', 'GET', `/bills/${b}/kot`); assert.equal(k1.lines, 1); assert.match(k1.text, /2 x Beef stew/);
  await ok(w, 'waiter', 'POST', `/bills/${b}/kot`);
  assert.equal((await ok(w, 'waiter', 'GET', `/bills/${b}/kot`)).lines, 0);
  await addLine(w, b, w.i.stew, 1);
  const k2 = await ok(w, 'waiter', 'POST', `/bills/${b}/kot?format=escpos`); assert.equal(k2.lines, 1); assert.match(k2.text, /1 x Beef stew/); assert.doesNotMatch(k2.text, /2 x Beef stew/);
  await ok(w, 'cashier', 'POST', `/bills/${b}/payments`, { method: 'cash', amount: 3 * STEW });
  const t = (await ok(w, 'cashier', 'GET', `/bills/${b}/receipt?format=text`)).text;
  assert.match(t, /Zikis Lounge/); assert.match(t, /TOTAL\s+1,950\.00/); assert.match(t, /incl\. VAT\s+268\.97/); assert.match(t, /BALANCE\s+0\.00/);
  assert.ok(t.split('\n').every((l: string) => l.length <= 42), 'fits an 80 mm printer');
  const bytes = Buffer.from((await ok(w, 'cashier', 'GET', `/bills/${b}/receipt?format=escpos`)).base64, 'base64');
  assert.deepEqual([...bytes.subarray(0, 2)], [0x1b, 0x40]); assert.deepEqual([...bytes.subarray(-4)], [0x1d, 0x56, 0x42, 0x00]);
  await reject(w, 'waiter', 'GET', `/bills/${b}/kot`, undefined as any, 409);
});

// ============================================================================ B9 hotel
test('F-13 hotel: booking, deposit, check-in, night audit, folio charges, checkout, housekeeping', async () => {
  const w = await world();
  const rt = await ok(w, 'owner', 'POST', '/hotel/room-types', { name: 'Standard', rate: 1000000 });
  const r101 = await ok(w, 'owner', 'POST', '/hotel/rooms', { number: '101', room_type_id: rt.id });
  await ok(w, 'owner', 'POST', '/hotel/rooms', { number: '102', room_type_id: rt.id });
  const from = await day(w, 0), to = await day(w, 3);
  assert.equal((await ok(w, 'cashier', 'GET', `/hotel/availability?from=${from}&to=${to}`))[0].available, 2);
  const rv = await ok(w, 'cashier', 'POST', '/hotel/reservations', { guest_id: w.p.cust, room_type_id: rt.id, room_id: r101.id, check_in: from, check_out: to });
  assert.equal((await ok(w, 'cashier', 'GET', `/hotel/availability?from=${from}&to=${to}`))[0].available, 1);
  await reject(w, 'cashier', 'POST', '/hotel/reservations', { guest_id: w.p.poor, room_type_id: rt.id, room_id: r101.id, check_in: from, check_out: to }, 409);
  const dep = await ok(w, 'cashier', 'POST', `/hotel/reservations/${rv.id}/payments`, { method: 'cash', amount: 500000 });
  assert.equal(dep.deposit, true); assert.equal(await bal(w, '2200', w.p.cust), -500000);
  await ok(w, 'cashier', 'POST', `/hotel/reservations/${rv.id}/check-in`, {});
  assert.equal((await ok(w, 'cashier', 'GET', '/hotel/rooms')).find((x: any) => x.number === '101').status, 'occupied');
  const audit = await ok(w, 'manager', 'POST', '/hotel/night-audit'); assert.equal(audit.posted, 1);
  assert.equal((await ok(w, 'manager', 'POST', '/hotel/night-audit')).posted, 0);
  assert.equal(await bal(w, '1130', w.p.cust), 1000000); assert.equal(await bal(w, '4100'), -862069); assert.equal(await bal(w, '2100'), -137931);
  await ok(w, 'cashier', 'POST', `/hotel/reservations/${rv.id}/charges`, { description: 'Laundry', amount: 200000 });
  await ok(w, 'cashier', 'POST', `/hotel/reservations/${rv.id}/payments`, { method: 'deposit', amount: 500000 });
  await reject(w, 'cashier', 'POST', `/hotel/reservations/${rv.id}/check-out`, {}, 409);
  await ok(w, 'cashier', 'POST', `/hotel/reservations/${rv.id}/payments`, { method: 'mpesa', amount: 700000 });
  await healthy(w, 'folio');
  await ok(w, 'cashier', 'POST', `/hotel/reservations/${rv.id}/check-out`, {});
  assert.equal(await bal(w, '1130'), 0);
  const room = (await ok(w, 'cashier', 'GET', '/hotel/rooms')).find((x: any) => x.number === '101'); assert.equal(room.status, 'dirty');
  await ok(w, 'waiter', 'PATCH', `/hotel/rooms/${room.id}/status`, { status: 'clean' });
  const occ = await ok(w, 'manager', 'GET', `/hotel/occupancy?date=${from}`); assert.equal(occ.rooms_occupied, 1); assert.equal(occ.room_revenue, 1000000);
  await healthy(w);
});
test('F-13b hotel: restaurant bill charged to room, and unpaid folio moved to the guest account with approval', async () => {
  const w = await world(); await stockBeef(w);
  const rt = await ok(w, 'owner', 'POST', '/hotel/room-types', { name: 'Deluxe', rate: 500000 });
  const rm = await ok(w, 'owner', 'POST', '/hotel/rooms', { number: '201', room_type_id: rt.id });
  const rv = await ok(w, 'cashier', 'POST', '/hotel/reservations', { guest_id: w.p.cust, room_type_id: rt.id, check_in: await day(w, 0), check_out: await day(w, 1) });
  await ok(w, 'cashier', 'POST', `/hotel/reservations/${rv.id}/check-in`, { room_id: rm.id });
  const b = await newBill(w); await addLine(w, b, w.i.stew, 1);
  await reject(w, 'waiter', 'POST', `/bills/${b}/close`, { disposition: 'room', reservation_id: '00000000-0000-0000-0000-000000000000' }, 400);
  await ok(w, 'waiter', 'POST', `/bills/${b}/close`, { disposition: 'room', reservation_id: rv.id });
  assert.equal(await bal(w, '1130', w.p.cust), STEW);
  const f = await ok(w, 'cashier', 'GET', `/hotel/reservations/${rv.id}`); assert.equal(f.balance, STEW); assert.equal(f.charges[0].kind, 'pos');
  await healthy(w, 'room charge');
  await reject(w, 'cashier', 'POST', `/hotel/reservations/${rv.id}/check-out`, { transfer_to_debtors: true }, 403);
  await ok(w, 'cashier', 'POST', `/hotel/reservations/${rv.id}/check-out`, { transfer_to_debtors: true, approver: approver(w) });
  assert.equal(await bal(w, '1100', w.p.cust), STEW); assert.equal(await bal(w, '1130'), 0);
  await healthy(w);
});

// ============================================================== B9 HR and payroll
test('F-14a payroll maths matches hand-worked Kenyan figures (rates verified Nov 2026)', async () => {
  const p = computePayslip(5000000, PAYROLL_DEFAULTS);
  assert.deepEqual([p.nssf_ee, p.shif, p.housing_ee, p.taxable, p.paye], [300000, 137500, 75000, 4487500, 584585]);
  const lo = computePayslip(1000000, PAYROLL_DEFAULTS); assert.deepEqual([lo.nssf_ee, lo.shif, lo.housing_ee, lo.paye], [60000, 30000, 15000, 0]); // SHIF minimum, relief wipes out PAYE
  const hi = computePayslip(10000000, PAYROLL_DEFAULTS); assert.deepEqual([hi.nssf_ee, hi.shif, hi.taxable, hi.paye], [600000, 275000, 8975000, 1930835]);
  const top = computePayslip(20000000, PAYROLL_DEFAULTS); assert.equal(top.nssf_ee, 648000); // capped at the 108,000 upper limit
});
test('F-14b payroll run posts balanced entries, pays net, remits to authorities, recovers staff debts', async () => {
  const w = await world(); await stockBeef(w);
  const staffParty = w.p.staff;
  const e1 = await ok(w, 'accountant', 'POST', '/hr/employees', { name: 'Wanjiku', basic_salary: 4000000, allowances: 1000000, party_id: staffParty, start_date: '2026-01-01' });
  await ok(w, 'accountant', 'POST', '/hr/employees', { name: 'Kamau', basic_salary: 1000000, start_date: '2026-01-01' });
  const pv = await ok(w, 'manager', 'POST', '/payroll/preview', { gross: 5000000 }); assert.equal(pv.net, 3902915); assert.equal(pv.employer_cost, 5375000);
  await reject(w, 'manager', 'POST', '/payroll/runs', { period: '2026-10' }, 403);
  // staff bill deduction creates a debt that payroll can recover
  const b = await newBill(w); await addLine(w, b, w.i.stew, 1);
  await ok(w, 'waiter', 'POST', `/bills/${b}/close`, { disposition: 'staff', staff_id: staffParty, approver: approver(w) });
  const run = await ok(w, 'accountant', 'POST', '/payroll/runs', { period: '2026-10', recover_staff_debt: true });
  assert.equal(run.gross, 6000000); assert.equal(run.paye, 584585); assert.equal(run.nssf, 2 * (300000 + 60000)); assert.equal(run.housing_levy, 2 * (75000 + 15000));
  assert.equal(await bal(w, '1120', staffParty), 0); // recovered in full (65,000 owed, below half of take-home)
  assert.equal(await bal(w, '6120'), 6000000); assert.equal(await bal(w, '6121'), 300000 + 60000 + 75000 + 15000);
  await reject(w, 'accountant', 'POST', '/payroll/runs', { period: '2026-10' }, 409);
  const slips = await ok(w, 'accountant', 'GET', `/payroll/runs/${run.id}/payslips`); assert.equal(slips.length, 2);
  await healthy(w, 'payroll run');
  await ok(w, 'accountant', 'POST', `/payroll/runs/${run.id}/pay`, { method: 'bank' });
  await reject(w, 'accountant', 'POST', `/payroll/runs/${run.id}/pay`, { method: 'bank' }, 409);
  assert.equal(await bal(w, '2440'), 0);
  const li = await ok(w, 'accountant', 'GET', '/payroll/liabilities'); assert.equal(li.PAYE, 584585);
  await ok(w, 'accountant', 'POST', '/payroll/remit', { liability: 'PAYE', amount: 584585, method: 'bank', reference: 'iTax' });
  await reject(w, 'accountant', 'POST', '/payroll/remit', { liability: 'PAYE', amount: 1, method: 'bank' }, 409);
  assert.equal((await ok(w, 'accountant', 'GET', '/payroll/liabilities')).PAYE, 0);
  await healthy(w, 'payroll paid');
});
test('F-15 leave accrues 1.75 days a month; requests need approval by someone else', async () => {
  const w = await world();
  const start = await day(w, -427); // about 14 months
  const e = await ok(w, 'manager', 'POST', '/hr/employees', { name: 'Achieng', basic_salary: 3000000, start_date: start });
  const bal0 = await ok(w, 'manager', 'GET', `/hr/employees/${e.id}/leave-balance`); assert.ok(bal0.balance >= 22 && bal0.balance <= 25, JSON.stringify(bal0));
  await reject(w, 'manager', 'POST', '/hr/leave', { employee_id: e.id, start_date: from0(), end_date: from0(), days: 40 }, 409);
  const l = await ok(w, 'manager', 'POST', '/hr/leave', { employee_id: e.id, start_date: await day(w, 5), end_date: await day(w, 9), days: 5 });
  const ap = (await ok(w, 'accountant', 'GET', '/approvals?status=pending')).find((a: any) => a.subject_id === l.id);
  await reject(w, 'manager', 'POST', `/approvals/${ap.id}/approve`, {}, 403);
  await ok(w, 'accountant', 'POST', `/approvals/${ap.id}/approve`, {});
  assert.equal((await ok(w, 'manager', 'GET', `/hr/employees/${e.id}/leave-balance`)).used, 5);
  await reject(w, 'waiter', 'GET', '/hr/employees', undefined as any, 403);
});
function from0() { return new Date().toISOString().slice(0, 10); }

// ================================================================= retail, wholesale
test('F-16 retail: barcode lookup, reorder alerts, automatic promotions visible in discounts', async () => {
  const w = await world(); await stockBeef(w);
  await w.pool.query("update items set barcode='6161100012345' where id=$1", [w.i.stew]);
  assert.equal((await ok(w, 'cashier', 'GET', '/items/barcode/6161100012345')).name, 'Beef stew');
  await reject(w, 'cashier', 'GET', '/items/barcode/000', undefined as any, 404);
  await w.pool.query('update items set reorder_level=25 where id=$1', [w.i.beef]);
  assert.equal((await ok(w, 'storekeeper', 'GET', '/reports/low-stock'))[0].name, 'Beef (raw)');
  const pr = await ok(w, 'manager', 'POST', '/promotions', { name: 'Happy stew', item_id: w.i.stew, percent_bp: 1000, starts: await day(w, -1), ends: await day(w, 1) });
  const b = await newBill(w); await addLine(w, b, w.i.stew, 1); // a waiter cannot discount, but the promotion applies by itself
  assert.equal((await ok(w, 'owner', 'GET', `/bills/${b}`)).balance, 58500); assert.equal(await bal(w, '4900'), 6500);
  await ok(w, 'manager', 'POST', `/promotions/${pr.id}/active`, { active: false });
  const b2 = await newBill(w); await addLine(w, b2, w.i.stew, 1);
  assert.equal((await ok(w, 'owner', 'GET', `/bills/${b2}`)).balance, 65000);
  await healthy(w);
});
test('F-17 wholesale: price lists, statements, FIFO ageing, orders delivered as credit invoices', async () => {
  const w = await world(); await stockBeef(w);
  const pl = await ok(w, 'manager', 'POST', '/price-lists', { name: 'Trade' });
  await ok(w, 'manager', 'POST', `/price-lists/${pl.id}/items`, { item_id: w.i.stew, price: 50000 });
  await ok(w, 'manager', 'POST', `/customers/${w.p.cust}/price-list`, { price_list_id: pl.id, terms_days: 14 });
  const b = await newBill(w, 'waiter', { customer_id: w.p.cust }); await addLine(w, b, w.i.stew, 1);
  assert.equal((await ok(w, 'owner', 'GET', `/bills/${b}`)).balance, 50000);
  await ok(w, 'waiter', 'POST', `/bills/${b}/close`, { disposition: 'credit' });
  // an old invoice, via opening balance dated 60 days ago, then a part payment that must settle the OLDEST first
  await ok(w, 'accountant', 'POST', '/opening-balances', { date: await day(w, -60), lines: [{ account: '1100', debit: 100000, party_id: w.p.cust }] });
  await ok(w, 'accountant', 'POST', `/parties/${w.p.cust}/receipts`, { method: 'cash', amount: 30000 });
  const ag = await ok(w, 'accountant', 'GET', '/reports/ageing');
  const row = ag.customers.find((c: any) => c.customer_id === w.p.cust);
  assert.equal(row.d31_60, 70000); assert.equal(row.current, 50000); assert.equal(row.total, 120000); assert.equal(ag.total, 120000);
  const st = await ok(w, 'accountant', 'GET', `/customers/${w.p.cust}/statement`); assert.equal(st.balance, 120000); assert.equal(st.lines.at(-1).balance, 120000);
  const o = await ok(w, 'waiter', 'POST', '/orders', { customer_id: w.p.cust, lines: [{ item_id: w.i.stew, qty: '3' }] });
  const d = await ok(w, 'waiter', 'POST', `/orders/${o.id}/deliver`, { approver: approver(w) });
  assert.equal(d.disposition, 'credit'); assert.equal(await onHand(w, w.i.beef), '19.000000'); // 1 stew on the first bill + 3 delivered = 1 kg
  await reject(w, 'waiter', 'POST', `/orders/${o.id}/deliver`, {}, 409);
  const o2 = await ok(w, 'waiter', 'POST', '/orders', { customer_id: w.p.poor, lines: [{ item_id: w.i.stew, qty: '2' }] });
  await reject(w, 'waiter', 'POST', `/orders/${o2.id}/deliver`, {}, 403);
  await healthy(w);
});

// ========================================================== B10 import, health check
test('F-18 CSV import: dry run first, tolerant of other systems’ column names, idempotent, all-or-nothing for stock', async () => {
  const w = await world();
  const csv = '\uFEFFProduct Name,Selling Price,Buying Price,UOM,Category,Barcode,Store\r\n"Pilau, beef",450.00,,plate,Food,,\r\nTusker Lager,300,220,bottle,Beer,6161,Bar\r\nBad Row,abc,,,,,\r\n,100,,,,,\r\n';
  const dry = await ok(w, 'manager', 'POST', '/import/items', { csv });
  assert.equal(dry.dry_run, true); assert.equal(dry.created, 2); assert.equal(dry.errors.length, 2); assert.deepEqual(dry.errors.map((e: any) => e.row), [4, 5]);
  assert.equal((await w.pool.query("select count(*)::int n from items where name in ('Pilau, beef','Tusker Lager')")).rows[0].n, 0);
  const real = await ok(w, 'manager', 'POST', '/import/items', { csv, dry_run: false });
  assert.equal(real.created, 2);
  assert.equal(num((await w.pool.query("select sell_price::text p from items where name='Pilau, beef'")).rows[0].p), 45000);
  assert.equal((await ok(w, 'manager', 'POST', '/import/items', { csv, dry_run: false })).created, 0); // re-import is safe
  const parties = await ok(w, 'manager', 'POST', '/import/parties', { csv: 'Name,Phone,Type,Credit Limit\nAcme Ltd,0711,customer,50000\nBidco,0722,supplier,\n', dry_run: false });
  assert.equal(parties.created, 2);
  const bad = await ok(w, 'accountant', 'POST', '/import/opening-stock', { csv: 'Item,Quantity,Cost\nTusker Lager,24,220\nMystery Item,5,10\n', dry_run: false });
  assert.equal(bad.created, 0); assert.equal(await bal(w, '1200'), 0); // one bad row stops the whole stock import
  const good = await ok(w, 'accountant', 'POST', '/import/opening-stock', { csv: 'Item,Quantity,Cost\nTusker Lager,24,220\n', dry_run: false });
  assert.equal(good.created, 1); assert.equal(await bal(w, '1200'), 24 * 22000); await healthy(w);
  await reject(w, 'waiter', 'POST', '/import/items', { csv }, 403);
});
test('F-19 Books Health Check works without an account and finds the Zikis problems', async () => {
  const app = await boot();
  const call = async (payload: any) => { const x = await app.inject({ method: 'POST', url: '/api/health-check', payload }); return { s: x.statusCode, b: x.json() }; };
  const tb = 'Account,Debit,Credit\nCash,"14,000,000.00",0\nInventory,669729.53,0\nSales,0,"14,555,729.06"\n';
  const stock = 'Item,Store,Qty,Value\nBeef,Restaurant,-111,-8880000\nGoat,Restaurant,-61,-6100000\nTomatoes,Kitchen,12,0\nRice,Main,50,500000\n';
  const bills = 'Bill,Status,Total,Paid,Date,Discount\nB1,Open,1000,0,2026-01-01,0\nB2,Closed,2000,1500,2026-01-02,0\nB3,Void,500,0,2026-01-02,0\nB4,Void,500,0,2026-01-02,0\nB5,Closed,4000,4000,2026-01-03,600\n';
  const x = await call({ trial_balance: tb, stock, bills });
  assert.equal(x.s, 200);
  const ids = x.b.findings.map((f: any) => f.id);
  for (const id of ['tb_unbalanced', 'neg_stock', 'zero_cost', 'open_bills', 'closed_unpaid', 'many_voids', 'discounts']) assert.ok(ids.includes(id), id + ' in ' + ids);
  assert.match(x.b.findings.find((f: any) => f.id === 'tb_unbalanced').title, /114,000/);
  assert.ok(x.b.score < 50); assert.equal(x.b.grade, 'At risk'); assert.match(x.b.privacy, /not stored/);
  const clean = await call({ trial_balance: 'Account,Debit,Credit\nCash,100,0\nSales,0,100\n' });
  assert.equal(clean.b.score, 100); assert.equal(clean.b.grade, 'Healthy');
  assert.equal((await call({})).s, 400); assert.equal((await call({ trial_balance: 'x,y\n1,2\n' })).s, 400);
});

// ==================================================== B11 owner view, alerts, planning
test('F-20 owner summary, digest, and webhook safety (no calls into private networks)', async () => {
  const w = await world(); await stockBeef(w);
  const a = await paidBill(w, 2); await ok(w, 'waiter', 'POST', `/bills/${a.b}/refund`, { line_id: a.l, method: 'cash', reason: 'x', approver: approver(w) });
  const s = await ok(w, 'owner', 'GET', '/owner/summary');
  assert.equal(s.books.ok, true); assert.ok(s.net_sales >= 0); assert.equal(s.open_bills, 0); assert.ok(Array.isArray(s.top_items));
  const d = await ok(w, 'owner', 'GET', '/owner/digest'); assert.match(d.text, /Books balanced/); assert.match(d.text, /Sales KES/);
  assert.equal((await ok(w, 'owner', 'POST', '/owner/digest/send')).status, 'skipped');
  await reject(w, 'owner', 'POST', '/settings', { webhook_url: 'http://example.com/hook' }, 400);
  for (const bad of ['https://127.0.0.1/hook', 'https://10.1.2.3/x', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/x', 'https://192.168.0.5/x', 'ftp://example.com']) await assert.rejects(() => safeWebhook(bad), /private network|https|valid/);
  await ok(w, 'owner', 'POST', '/settings', { webhook_url: 'https://127.0.0.1/hook' }); // accepted as text, refused at send time
  const sent = await ok(w, 'owner', 'POST', '/owner/digest/send'); assert.equal(sent.status, 'failed'); assert.match(sent.detail, /private network/);
  assert.equal((await ok(w, 'owner', 'GET', '/notifications')).length, 2);
});
test('F-21 forecast uses same-weekday history; reorder suggestions use real usage and reorder levels', async () => {
  const w = await world(); await stockBeef(w);
  const dow = (await w.pool.query('select extract(dow from current_date - 7)::int d')).rows[0].d;
  for (const back of [7, 14, 21]) {
    const bill = (await w.pool.query("insert into bills(number, business_date, status, disposition, opened_by) values ($1, current_date - $2::int, 'closed','paid',$3) returning id", ['H' + back + Math.random(), back, w.uid.owner])).rows[0].id;
    await w.pool.query("insert into bill_lines(id, bill_id, item_id, qty, unit_price, gross, payable, tax, net) values (gen_random_uuid(),$1,$2,4,65000,260000,260000,0,260000)", [bill, w.i.stew]);
  }
  const f = await ok(w, 'owner', 'GET', '/forecast?days=7&weeks=4');
  const stew = f.items.find((i: any) => i.name === 'Beef stew');
  assert.equal(stew.total, 3); // 3 Mondays-equivalent of 4 units over 4 weeks = 3 per week
  assert.equal(stew.next_days.filter((x: any) => x.qty > 0).length, 1);
  await w.pool.query('update items set reorder_level=15 where id=$1', [w.i.beef]);
  const b = await newBill(w); await addLine(w, b, w.i.stew, 40);
  const ro = await ok(w, 'storekeeper', 'GET', '/forecast/reorder');
  const beef = ro.items.find((i: any) => i.name === 'Beef (raw)');
  assert.equal(beef.on_hand, 10); assert.ok(beef.suggested_order >= 20 - 0.01 && beef.days_of_cover > 0);
});

// ================================================================== B12 billing
test('F-21b billing: trial, plan, invoice, overdue read-only, payment restores trading', async () => {
  const app = await boot(); const w = await world(); await stockBeef(w);
  const slug = (await (await import('../src/db')).controlPool().query('select slug from tenants where id=$1', [w.tenantId])).rows[0].slug;
  const plat = async (m: string, u: string, body?: any, token = 'platform-secret') => { const x = await app.inject({ method: m as any, url: '/api/platform' + u, headers: { 'x-platform-token': token }, payload: body }); return { s: x.statusCode, b: x.json() }; };
  const cp = (await import('../src/db')).controlPool();
  assert.equal((await plat('GET', '/plans', undefined, 'wrong')).s, 403);
  assert.equal((await ok(w, 'owner', 'GET', '/outlets')).length >= 1, true);
  // trial expires -> read-only, never locked out
  await cp.query("update subscriptions set trial_ends = current_date - 1 where tenant_id=$1", [w.tenantId]); clearTenantCache();
  const blocked = await r(w, 'waiter', 'POST', '/bills', {}); assert.equal(blocked.s, 402); assert.match(blocked.b.error, /trial has ended/);
  assert.equal((await r(w, 'owner', 'GET', '/reports/trial-balance')).s, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/billing', headers: { authorization: 'Bearer ' + w.tok.owner } })).json().access.status, 'trial_expired');
  // choose a plan, invoice, collect
  assert.equal((await plat('POST', '/subscribe', { slug, plan: 'restaurant', outlets: 2 })).s, 200);
  const inv = await plat('POST', '/invoices/generate'); assert.equal(inv.b.find((i: any) => i.tenant === w.tenantId).amount, 700000);
  assert.equal((await r(w, 'waiter', 'POST', '/bills', {})).s, 200);
  await cp.query("update billing_invoices set due_date = current_date - 10 where tenant_id=$1", [w.tenantId]); clearTenantCache();
  assert.equal((await r(w, 'waiter', 'POST', '/bills', {})).s, 402);
  const id = (await plat('GET', '/invoices?status=issued')).b.find((i: any) => i.slug === slug).id;
  assert.equal((await plat('POST', `/invoices/${id}/pay`, { amount: 700000, method: 'mpesa', reference: 'QWE123' })).s, 200);
  assert.equal((await r(w, 'waiter', 'POST', '/bills', {})).s, 200);
  assert.equal((await plat('POST', '/invoices/generate')).b.filter((i: any) => i.tenant === w.tenantId).length, 0); // not yet due again
  await cp.query('update subscriptions set trial_ends = null where tenant_id=$1', [w.tenantId]);
});

// =============================================================== B13 multi-outlet, PWA
test('F-22 multi-outlet: bills, stock and sales are separated by outlet', async () => {
  const w = await world(); await stockBeef(w);
  const main = (await ok(w, 'owner', 'GET', '/outlets'))[0];
  const wl = await ok(w, 'owner', 'POST', '/outlets', { name: 'Westlands' });
  await reject(w, 'manager', 'POST', '/outlets', { name: 'X' }, 403);
  const a = await newBill(w, 'waiter', { outlet_id: main.id }); await addLine(w, a, w.i.stew, 1);
  const b = await newBill(w, 'waiter', { outlet_id: wl.id }); await addLine(w, b, w.i.stew, 3);
  assert.equal((await ok(w, 'waiter', 'GET', `/bills?status=open&outlet=${wl.id}`)).length, 1);
  const rep = await ok(w, 'accountant', 'GET', '/reports/outlets');
  const net = (n: number) => n * STEW - Math.round(n * STEW * 1600 / 11600);
  assert.equal(rep.find((x: any) => x.name === 'Westlands').revenue, 3 * STEW - 26897); // VAT rounded once on the 3-unit line
  assert.equal(rep.find((x: any) => x.name === 'Westlands').cost_of_sales, 3 * STEW_COST);
  assert.equal(rep.find((x: any) => x.name === 'Main outlet').revenue, net(1));
  await ok(w, 'manager', 'PATCH', `/stores/${w.s.bar}`, { outlet_id: wl.id });
  assert.equal((await ok(w, 'owner', 'GET', `/stock?outlet=${wl.id}`)).length, 0);
  assert.equal((await ok(w, 'owner', 'GET', `/owner/summary?outlet=${wl.id}`)).closed_bills, 0);
  await healthy(w);
});
test('F-23 the app can be installed as a phone app (manifest, service worker, icon)', async () => {
  const app = await boot();
  const m = await app.inject({ method: 'GET', url: '/manifest.webmanifest' }); assert.equal(m.statusCode, 200); assert.equal(m.json().display, 'standalone');
  const sw = await app.inject({ method: 'GET', url: '/sw.js' }); assert.equal(sw.statusCode, 200); assert.match(sw.body, /\/api\//);
  assert.equal((await app.inject({ method: 'GET', url: '/icon.svg' })).statusCode, 200);
});
