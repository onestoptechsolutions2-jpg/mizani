import test from 'node:test';
import assert from 'node:assert/strict';
import { World, approver, buy, healthy, num, ok, onHand, r, runTake, shutdown, world } from './harness';

test.after(shutdown);
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// AT-36: everything at once. Sales with levy, promotions, tips, deposits, gift cards, loyalty, service charges, refunds,
// purchases and returns, production, hotel stays, payroll, depreciation, stock takes. All 15 invariants must hold throughout.
test('AT-36 soak: random mix of every feature keeps all 15 invariants', async () => {
  const w = await world();
  const R = rng(Number(process.env.SOAK_SEED || 20261112));
  const pick = <T,>(a: T[]): T => a[Math.floor(R() * a.length)];
  const N = Number(process.env.SOAK_OPS || 500);
  await ok(w, 'owner', 'POST', '/settings', { levy_bp: 200, loyalty_enabled: 'true' });
  await ok(w, 'manager', 'POST', '/promotions', { name: 'Beer deal', item_id: w.i.tusker, percent_bp: 500 });
  await buy(w, [{ type: 'stock', item_id: w.i.beef, qty: '300', unit_price: 80000, tax_rate_bp: 1600 }]);
  await buy(w, [{ type: 'stock', item_id: w.i.tusker, qty: '12', unit: 'carton', unit_price: 600000 }], { store: w.s.bar });
  await buy(w, [{ type: 'stock', item_id: w.i.onion, qty: '40', unit_price: 10000 }], { store: w.s.kitchen });
  const base = (await w.pool.query("insert into items(name, base_unit, is_stocked, production_store_id) values ('Stew base','litre',true,$1) returning id", [w.s.kitchen])).rows[0].id;
  const rt = await ok(w, 'owner', 'POST', '/hotel/room-types', { name: 'Std', rate: 800000 });
  const rooms: any[] = []; for (const n of ['1', '2', '3']) rooms.push(await ok(w, 'owner', 'POST', '/hotel/rooms', { number: n, room_type_id: rt.id }));
  for (const [n, b, a] of [['A', 3000000, 500000], ['B', 1500000, 0], ['C', 8000000, 1000000]] as any) await ok(w, 'accountant', 'POST', '/hr/employees', { name: 'Emp ' + n, basic_salary: b, allowances: a, start_date: '2026-01-01', link_staff_account: true });
  await ok(w, 'accountant', 'POST', '/assets', { name: 'Fridge', cost: 9000000, salvage: 500000, life_months: 60, acquired: '2026-03-10' });
  const stats: Record<string, number> = {}; const bump = (k: string) => (stats[k] = (stats[k] || 0) + 1);
  const call = async (who: string, m: string, u: string, b?: any) => { const x = await r(w, who, m, u, b); assert.ok(x.s < 500, `${m} ${u} -> ${x.s} ${JSON.stringify(x.b)}`); bump(x.s === 200 ? 'ok' : 'rejected'); return x; };
  const bills: string[] = [], giftCodes: string[] = [];
  let payrollMonth = 0, deprMonth = 0;
  const openBills = async () => { const x = await call('waiter', 'GET', '/bills?status=open'); return x.b as any[]; };
  const anyOpen = async () => { const l = await openBills(); return l.length ? pick(l) : null; };

  for (let n = 1; n <= N; n++) {
    const d = R() * 100;
    if (d < 14) { const x = await call('waiter', 'POST', '/bills', R() < 0.5 ? { customer_id: pick([w.p.cust, w.p.poor]) } : {}); if (x.s === 200) { bills.push(x.b.id); for (let k = 0; k < 1 + Math.floor(R() * 3); k++) await call('waiter', 'POST', `/bills/${x.b.id}/lines`, { item_id: pick([w.i.stew, w.i.stew, w.i.tusker]), qty: String(1 + Math.floor(R() * 3)) }); } }
    else if (d < 30) { const b = await anyOpen(); if (b && b.balance > 0) { const amt = R() < 0.6 ? b.balance : Math.max(1, Math.floor(b.balance * R())); await call('cashier', 'POST', `/bills/${b.id}/payments`, { method: pick(['cash', 'mpesa', 'card']), amount: amt, tip: R() < 0.4 ? Math.floor(R() * 8000) : 0 }); } }
    else if (d < 35) { await call('cashier', 'POST', '/deposits', { customer_id: pick([w.p.cust, w.p.poor]), amount: 10000 + Math.floor(R() * 100000), method: pick(['cash', 'mpesa']) }); const b = await anyOpen(); if (b && b.balance > 0) { const full = await call('waiter', 'GET', `/bills/${b.id}`); if (full.b.customer_id) await call('cashier', 'POST', `/bills/${b.id}/payments`, { method: 'deposit', amount: Math.min(b.balance, 5000 + Math.floor(R() * 40000)) }); } }
    else if (d < 39) { if (R() < 0.5 || !giftCodes.length) { const g = await call('cashier', 'POST', '/gift-cards', { amount: 20000 + Math.floor(R() * 80000), method: 'cash' }); if (g.s === 200) giftCodes.push(g.b.code); } else { const b = await anyOpen(); if (b && b.balance > 0) await call('cashier', 'POST', `/bills/${b.id}/payments`, { method: 'giftcard', code: pick(giftCodes), amount: Math.min(b.balance, 10000 + Math.floor(R() * 30000)) }); } }
    else if (d < 43) { const b = await anyOpen(); if (b && b.customer_id) await call('cashier', 'POST', `/bills/${b.id}/payments`, { method: 'points', points: 1 + Math.floor(R() * 5) }); }
    else if (d < 50) { const closed = (await call('owner', 'GET', '/bills?status=closed')).b as any[]; const b = closed.length ? pick(closed) : null; if (b) { const full = (await call('owner', 'GET', `/bills/${b.id}`)).b; const l = full.lines.filter((x: any) => x.status === 'active'); if (l.length && full.disposition === 'paid') await call('waiter', 'POST', `/bills/${b.id}/refund`, { line_id: pick(l).id, method: pick(['cash', 'mpesa', 'card', ...(full.customer_id ? ['deposit'] : [])]), reason: 'soak', restock: R() < 0.5, approver: approver(w, pick(['manager', 'manager2'])) }); } }
    else if (d < 54) { const b = await anyOpen(); if (b) await call('waiter', 'POST', `/bills/${b.id}/service-charge`, { percent_bp: pick([500, 1000]) }); }
    else if (d < 59) { const p = await call('storekeeper', 'POST', '/purchases', { supplier_id: w.p.supplier, store_id: w.s.butchery, delivery_date: w.today, lines: [{ type: 'stock', item_id: w.i.beef, qty: (5 + Math.floor(R() * 100) / 10).toFixed(1), unit_price: 70000 + Math.floor(R() * 20000), tax_rate_bp: pick([0, 1600]), vat_claimable: R() < 0.5 }] }); if (p.s === 200 && R() < 0.6) { const line = (await w.pool.query('select id, qty::text q from purchase_lines where purchase_id=$1', [p.b.id])).rows[0]; await call('storekeeper', 'POST', `/purchases/${p.b.id}/returns`, { reason: 'soak', lines: [{ purchase_line_id: line.id, qty: (num(line.q) * R() * 0.9).toFixed(2) }] }); } }
    else if (d < 64) { if (R() < 0.6) await call('storekeeper', 'POST', '/stock/production', { output_item_id: base, store_id: w.s.kitchen, qty: (1 + R() * 9).toFixed(2), inputs: [{ item_id: w.i.beef, store_id: w.s.butchery, qty: (R() * 2 + 0.1).toFixed(2) }, { item_id: w.i.onion, store_id: w.s.kitchen, qty: (R() + 0.1).toFixed(2) }] }); else await call('storekeeper', 'POST', '/stock/staff-meal', { item_id: w.i.beef, store_id: w.s.butchery, qty: (R() + 0.05).toFixed(2) }); }
    else if (d < 72) { // a hotel stay start to finish
      const g = pick([w.p.cust, w.p.poor]); const room = pick(rooms); const day0 = w.today;
      const rv = await call('cashier', 'POST', '/hotel/reservations', { guest_id: g, room_type_id: rt.id, room_id: room.id, check_in: day0, check_out: (await w.pool.query("select (current_date + 2)::text d")).rows[0].d });
      if (rv.s === 200) {
        if (R() < 0.4) await call('cashier', 'POST', `/hotel/reservations/${rv.b.id}/payments`, { method: 'cash', amount: 100000 + Math.floor(R() * 600000) });
        const ci = await call('cashier', 'POST', `/hotel/reservations/${rv.b.id}/check-in`, {});
        if (ci.s === 200) {
          await call('manager', 'POST', '/hotel/night-audit');
          if (R() < 0.6) await call('cashier', 'POST', `/hotel/reservations/${rv.b.id}/charges`, { description: 'Minibar', amount: 20000 + Math.floor(R() * 100000) });
          const f = (await call('cashier', 'GET', `/hotel/reservations/${rv.b.id}`)).b;
          if (R() < 0.5 && f.balance > 0) await call('cashier', 'POST', `/hotel/reservations/${rv.b.id}/payments`, { method: pick(['cash', 'mpesa', 'card']), amount: Math.min(f.balance, 100000 + Math.floor(R() * 900000)) });
          await call('cashier', 'POST', `/hotel/reservations/${rv.b.id}/check-out`, { transfer_to_debtors: true, approver: approver(w) });
          await call('waiter', 'PATCH', `/hotel/rooms/${room.id}/status`, { status: 'clean' });
        }
      }
    }
    else if (d < 76) { if (payrollMonth < 12 && R() < 0.5) { const period = `2026-${String(++payrollMonth).padStart(2, '0')}`; const run = await call('accountant', 'POST', '/payroll/runs', { period, recover_staff_debt: R() < 0.7 }); if (run.s === 200) { await call('accountant', 'POST', `/payroll/runs/${run.b.id}/pay`, { method: 'bank' }); await call('accountant', 'POST', '/payroll/remit', { liability: pick(['PAYE', 'NSSF', 'SHIF', 'AHL']), amount: 1000 + Math.floor(R() * 100000), method: 'bank' }); } } }
    else if (d < 79) { if (deprMonth < 12) await call('accountant', 'POST', '/assets/depreciate', { period: `2026-${String(++deprMonth).padStart(2, '0')}` }); }
    else if (d < 84) { await call('storekeeper', 'POST', '/wastage', { item_id: pick([w.i.beef, w.i.tusker]), store_id: pick([w.s.butchery, w.s.bar]), qty: (R() * 2 + 0.01).toFixed(2), reason: 'spoilage' }); }
    else if (d < 87) { const store = pick([w.s.butchery, w.s.bar]); const item = store === w.s.bar ? w.i.tusker : w.i.beef; const cur = num(await onHand(w, item, store)); await runTake(w, store, { [item]: Math.max(0, cur + (R() - 0.5) * 6).toFixed(2) }); }
    else if (d < 93) { const b = await anyOpen(); if (b && b.balance > 0) { const k = pick(['credit', 'staff', 'complimentary', 'writeoff']); await call('waiter', 'POST', `/bills/${b.id}/close`, { disposition: k, customer_id: w.p.cust, staff_id: w.p.staff, reason: 'soak', approver: approver(w, pick(['manager', 'manager2'])) }); } }
    else if (d < 96) { const b = await anyOpen(); if (b) { await call('waiter', 'POST', `/bills/${b.id}/void-request`, { reason: 'soak' }); const ap = (await call('manager', 'GET', '/approvals?status=pending')).b.find((a: any) => a.subject_id === b.id); if (ap) await call('manager', 'POST', `/approvals/${ap.id}/approve`, {}); } }
    else { await call('accountant', 'POST', '/expenses', { account: pick(['6100', '6110']), amount: 1000 + Math.floor(R() * 200000), method: pick(['cash', 'bank']) }); await call('accountant', 'POST', '/cash/count', { counted: Math.floor(R() * 800000) }); }
    if (n % 20 === 0) await healthy(w, `after ${n} events`);
  }
  await healthy(w, 'final');
  const ev = (await w.pool.query('select (select count(*) from journals)::int j, (select count(*) from stock_moves)::int m, (select count(*) from reservations)::int h, (select count(*) from payroll_runs)::int p, (select count(*) from refunds)::int f')).rows[0];
  console.log(`soak2 ok: ${N} events -> ${ev.j} journals, ${ev.m} stock moves, ${ev.h} stays, ${ev.p} payroll runs, ${ev.f} refunds; ${JSON.stringify(stats)}`);
});
