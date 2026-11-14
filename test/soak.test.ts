import test from 'node:test';
import assert from 'node:assert/strict';
import { World, approver, buy, healthy, num, ok, onHand, r, runTake, shutdown, world } from './harness';

test.after(shutdown);

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// AT-34: random mixed events across every module; all invariants must hold throughout.
test('AT-34 soak: 600 random events, invariants hold every 25 events', async () => {
  const w = await world();
  const R = rng(Number(process.env.SOAK_SEED || 20261110));
  const pick = <T,>(a: T[]): T => a[Math.floor(R() * a.length)];
  const N = Number(process.env.SOAK_OPS || 600);
  await buy(w, [{ type: 'stock', item_id: w.i.beef, qty: '300', unit_price: 80000 }]);
  await buy(w, [{ type: 'stock', item_id: w.i.tusker, qty: '12', unit: 'carton', unit_price: 600000 }], { store: w.s.bar });
  const stats: Record<string, number> = {}; const bump = (k: string) => (stats[k] = (stats[k] || 0) + 1);
  const call = async (who: string, m: string, u: string, b?: any) => { const x = await r(w, who, m, u, b); assert.ok(x.s < 500, `${m} ${u} -> ${x.s} ${JSON.stringify(x.b)}`); bump(x.s === 200 ? 'ok' : 'rejected'); return x; };
  const bills: string[] = [];
  const openBill = async () => { const x = await call('waiter', 'POST', '/bills', {}); bills.push(x.b.id); return x.b.id as string; };
  const getBill = async (id: string) => (await call('owner', 'GET', `/bills/${id}`)).b;
  const live = async () => { for (let k = 0; k < 6 && bills.length; k++) { const id = pick(bills); const b = await getBill(id); if (b.status === 'open') return b; } return null; };

  for (let n = 1; n <= N; n++) {
    const d = R() * 100;
    if (d < 20) { const id = bills.length < 3 || R() < 0.4 ? await openBill() : pick(bills); for (let k = 0; k < 1 + Math.floor(R() * 3); k++) await call('waiter', 'POST', `/bills/${id}/lines`, { item_id: pick([w.i.stew, w.i.stew, w.i.tusker]), qty: String(1 + Math.floor(R() * 3)) }); }
    else if (d < 32) { const b = await live(); const l = b && pick(b.lines.filter((x: any) => x.status === 'active' && !x.prepared_at)); if (l) await call('waiter', 'PATCH', `/bills/${b.id}/lines/${l.id}`, { qty: String(Math.floor(R() * 5)) }); }
    else if (d < 40) { const b = await live(); const l = b && pick(b.lines.filter((x: any) => x.status === 'active')); if (l) await call('waiter', 'DELETE', `/bills/${b.id}/lines/${l.id}`, { reason: 'changed mind', approver: l.prepared_at ? approver(w) : undefined }); }
    else if (d < 46) { const b = await live(); const l = b && pick(b.lines.filter((x: any) => x.status === 'active')); if (l) await call('waiter', 'POST', `/bills/${b.id}/lines/${l.id}/prepared`); }
    else if (d < 60) { const b = await live(); if (b && b.balance > 0) { const amt = R() < 0.5 ? b.balance : Math.max(1, Math.floor(b.balance * R())); await call('cashier', 'POST', `/bills/${b.id}/payments`, { method: pick(['cash', 'mpesa', 'card']), amount: amt }); } }
    else if (d < 70) { const b = await live(); if (b && b.balance > 0) { const k = pick(['credit', 'staff', 'complimentary', 'writeoff']); await call('waiter', 'POST', `/bills/${b.id}/close`, { disposition: k, customer_id: w.p.poor, staff_id: w.p.staff, reason: 'soak', approver: approver(w, pick(['manager', 'manager2'])) }); } }
    else if (d < 75) { await call('storekeeper', 'POST', '/purchases', { supplier_id: w.p.supplier, store_id: w.s.butchery, delivery_date: w.today, lines: [
      { type: 'stock', item_id: w.i.beef, qty: (5 + Math.floor(R() * 150) / 10).toFixed(1), unit_price: 70000 + Math.floor(R() * 20000), tax_rate_bp: pick([0, 1600]), vat_claimable: R() < 0.5 },
      ...(R() < 0.4 ? [{ type: 'expense', account: '6130', amount: 1000 + Math.floor(R() * 90000) }] : [])] }); }
    else if (d < 80) { await call('storekeeper', 'POST', '/wastage', { item_id: pick([w.i.beef, w.i.tusker]), store_id: pick([w.s.butchery, w.s.bar]), qty: (R() * 2 + 0.01).toFixed(2), reason: pick(['spoilage', 'breakage', 'over_prep']) }); }
    else if (d < 84) { await call('storekeeper', 'POST', '/stock/transfers', { from_store: w.s.butchery, to_store: w.s.kitchen, lines: [{ item_id: w.i.beef, qty: (R() * 3 + 0.1).toFixed(2) }] }); }
    else if (d < 87) { await call('storekeeper', 'POST', '/stock/consume', { item_id: w.i.beef, store_id: w.s.butchery, qty: (R() * 0.5 + 0.01).toFixed(2), department: 'Kitchen' }); }
    else if (d < 91) { const store = pick([w.s.butchery, w.s.bar]); const item = store === w.s.bar ? w.i.tusker : w.i.beef; const cur = num(await onHand(w, item, store)); const counted = Math.max(0, cur + (R() - 0.5) * 6).toFixed(2); await runTake(w, store, { [item]: counted }); bump('stock_takes'); }
    else if (d < 95) { const b = await live(); if (b) { await call('waiter', 'POST', `/bills/${b.id}/void-request`, { reason: 'soak void' }); const ap = (await call('manager', 'GET', '/approvals?status=pending')).b.find((a: any) => a.subject_id === b.id); if (ap) await call('manager', 'POST', `/approvals/${ap.id}/approve`, {}); } }
    else if (d < 98) { await call('accountant', 'POST', '/expenses', { account: pick(['6100', '6110', '6190']), amount: 1000 + Math.floor(R() * 200000), vat: R() < 0.5 ? 1600 : 0, method: pick(['cash', 'mpesa', 'bank']) }); }
    else { await call('accountant', 'POST', '/cash/count', { counted: Math.max(0, Math.floor(R() * 500000)) }); }
    if (n % 25 === 0) await healthy(w, `after ${n} events`);
  }
  await healthy(w, 'final');
  const tb = await ok(w, 'accountant', 'GET', '/reports/trial-balance');
  assert.equal(tb.totals.difference, 0);
  const ev = (await w.pool.query('select (select count(*) from journals)::int j, (select count(*) from stock_moves)::int m')).rows[0];
  console.log(`soak ok: ${N} events -> ${ev.j} journals, ${ev.m} stock moves, stats ${JSON.stringify(stats)}`);
});

// AT-35: many tills ringing the same stock at the same moment must not corrupt costing or balance.
test('AT-35 concurrency: 40 simultaneous sales, payments and wastage entries keep every invariant', async () => {
  const w = await world();
  await buy(w, [{ type: 'stock', item_id: w.i.beef, qty: '100', unit_price: 80000 }]);
  const bills = await Promise.all(Array.from({ length: 20 }, () => r(w, 'waiter', 'POST', '/bills', {}).then((x) => x.b.id)));
  const adds = await Promise.all(bills.map((id) => r(w, 'waiter', 'POST', `/bills/${id}/lines`, { item_id: w.i.stew, qty: '2' })));
  assert.ok(adds.every((x) => x.s === 200), JSON.stringify(adds.find((x) => x.s !== 200)));
  const mixed = await Promise.all([
    ...bills.map((id) => r(w, 'cashier', 'POST', `/bills/${id}/payments`, { method: 'cash', amount: 130000 })),
    ...Array.from({ length: 20 }, (_, i) => r(w, 'storekeeper', 'POST', '/wastage', { item_id: w.i.beef, store_id: w.s.butchery, qty: '0.1', reason: 'spoilage' }, { 'idempotency-key': 'w' + i })),
  ]);
  assert.ok(mixed.every((x) => x.s === 200), JSON.stringify(mixed.find((x) => x.s !== 200)));
  assert.equal(num(await onHand(w, w.i.beef)), 100 - 20 * 0.5 - 20 * 0.1);
  await healthy(w, 'after concurrent load');
});
