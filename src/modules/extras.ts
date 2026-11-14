import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { bad, cents, conflict, forbidden, notFound, q1, qa } from '../db';
import { balanceOf, businessDate, Ctx, JLine, METHOD_ACCT, postJournal, setting } from '../ledger';
import { billBalance, removeLine, verifyApprover } from './sales';

// --------------------------------------------------------------- settings ----
export const PAYROLL_DEFAULTS = {
  // Kenya, verified November 2026 against KRA, NSSF and SHA published rates. THESE CHANGE: Treasury has proposed removing
  // personal relief and widening the zero-PAYE band. Review with an accountant before every payroll.
  effective: '2026-02-01',
  paye_bands: [[2400000, 1000], [833300, 2500], [46766700, 3000], [30000000, 3250], [null, 3500]], // [width in cents, rate in bp]
  personal_relief: 240000,
  nssf_rate_bp: 600, nssf_lel: 900000, nssf_uel: 10800000,
  shif_rate_bp: 275, shif_min: 30000,
  housing_ee_bp: 150, housing_er_bp: 150,
};
const KEYS: Record<string, (v: string) => string> = {
  levy_bp: (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 1000) throw bad('levy_bp must be 0 to 1000 (200 = 2%)'); return String(n); },
  loyalty_enabled: (v) => (v === 'true' ? 'true' : 'false'),
  loyalty_points_per_kes100: (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 100) throw bad('points per KES 100 must be 0 to 100'); return String(n); },
  loyalty_point_value_cents: (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 100000) throw bad('point value must be whole cents'); return String(n); },
  service_charge_bp: (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 3000) throw bad('service charge must be 0 to 3000 bp'); return String(n); },
  digest_enabled: (v) => (v === 'true' ? 'true' : 'false'),
  digest_hour: (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 23) throw bad('digest hour must be 0 to 23'); return String(n); },
  webhook_url: (v) => { if (v && !/^https:\/\/[^\s]+$/.test(v)) throw bad('The notification address must start with https://'); return v; },
  business_name: (v) => v.slice(0, 120), business_address: (v) => v.slice(0, 200), business_phone: (v) => v.slice(0, 40),
  kra_pin: (v) => v.slice(0, 20), receipt_footer: (v) => v.slice(0, 200),
  payroll_rates: (v) => { const j = JSON.parse(v); if (!Array.isArray(j.paye_bands) || typeof j.personal_relief !== 'number') throw bad('payroll_rates is missing paye_bands or personal_relief'); return JSON.stringify(j); },
};
export async function getSettings(c: PoolClient) {
  const rows = await qa(c, 'select key, value from settings');
  const m: Record<string, string> = {}; for (const r of rows) if (KEYS[r.key]) m[r.key] = r.value;
  if (!m.payroll_rates) m.payroll_rates = JSON.stringify(PAYROLL_DEFAULTS);
  return m;
}
export async function updateSettings(c: PoolClient, b: Record<string, any>) {
  for (const [k, v] of Object.entries(b || {})) {
    if (!KEYS[k]) throw bad(`Unknown setting ${k}`);
    const val = KEYS[k](typeof v === 'string' ? v : JSON.stringify(v));
    await c.query('insert into settings(key, value) values ($1,$2) on conflict (key) do update set value=excluded.value', [k, val]);
  }
  return getSettings(c);
}

// ---------------------------------------------------- service charge and tips ----
export async function serviceCharge(x: Ctx, billId: string, bpIn?: any) {
  const { c } = x;
  const bill = await q1(c, 'select * from bills where id=$1 for update', [billId]);
  if (!bill) throw notFound('Bill not found');
  if (bill.status !== 'open') throw conflict('Bill is not open');
  const bp = bpIn != null ? Number(bpIn) : parseInt(await setting(c, 'service_charge_bp', '0'), 10);
  if (!Number.isInteger(bp) || bp <= 0 || bp > 3000) throw bad('Set a service charge between 0.01% and 30% (basis points)');
  const bd = await businessDate(c);
  const old = await q1(c, "select * from bill_charges where bill_id=$1 and status='active' for update", [billId]);
  if (old) {
    await postJournal(c, { date: bd, source: 'service_charge', sourceId: old.id, by: x.userId, memo: 'service charge replaced', reverses: old.journal_id,
      lines: [{ acct: '2300', dr: old.amount }, { acct: '1110', cr: old.amount }] });
    await c.query("update bill_charges set status='removed' where id=$1", [old.id]);
  }
  const base = (await q1(c, "select coalesce(sum(payable),0)::bigint t from bill_lines where bill_id=$1 and status='active'", [billId])).t;
  const amount = Math.round((base * bp) / 10000);
  if (amount <= 0) throw bad('Nothing to charge on');
  const id = randomUUID();
  const jid = await postJournal(c, { date: bd, source: 'service_charge', sourceId: id, by: x.userId, memo: `service charge ${bp / 100}% ${bill.number}`,
    lines: [{ acct: '1110', dr: amount }, { acct: '2300', cr: amount }] });
  await c.query('insert into bill_charges(id, bill_id, amount, journal_id, created_by) values ($1,$2,$3,$4,$5)', [id, billId, amount, jid, x.userId]);
  return { amount, balance: await billBalance(c, billId) };
}
export async function tipsPayout(x: Ctx, b: any) {
  const amount = cents(b.amount);
  const held = -(await balanceOf(x.c, '2300'));
  if (amount > held) throw conflict(`Only ${held} is held for staff`);
  const jid = await postJournal(x.c, { date: await businessDate(x.c), source: 'tips_payout', sourceId: randomUUID(), by: x.userId, memo: b.note || 'tips and service charge paid out',
    lines: [{ acct: '2300', dr: amount }, { acct: METHOD_ACCT[b.method || 'cash'] ?? '1000', cr: amount }] });
  return { journal_id: jid, held: held - amount };
}

// ------------------------------------------------------- deposits, gift cards ----
export async function createDeposit(x: Ctx, b: any) {
  const c = x.c;
  const cust = await q1(c, "select * from parties where id=$1 and kind='customer'", [b.customer_id]);
  if (!cust) throw bad('Choose a customer');
  if (!METHOD_ACCT[b.method]) throw bad('A payment method is required');
  const amount = cents(b.amount);
  const jid = await postJournal(c, { date: await businessDate(c), source: 'deposit', sourceId: randomUUID(), by: x.userId, memo: `deposit from ${cust.name}`,
    lines: [{ acct: METHOD_ACCT[b.method], dr: amount }, { acct: '2200', cr: amount, party: cust.id }] });
  return { journal_id: jid, balance: -(await balanceOf(c, '2200', cust.id)) };
}
export async function sellGiftCard(x: Ctx, b: any) {
  const c = x.c;
  const amount = cents(b.amount);
  if (!METHOD_ACCT[b.method]) throw bad('A payment method is required');
  const code = (b.code ? String(b.code) : 'GC' + randomUUID().replace(/-/g, '').slice(0, 10)).toUpperCase();
  if (!/^[A-Z0-9-]{4,24}$/.test(code)) throw bad('Gift card code must be 4 to 24 letters, numbers or hyphens');
  if (await q1(c, 'select 1 from gift_cards where code=$1', [code])) throw conflict('That gift card code already exists');
  const jid = await postJournal(c, { date: await businessDate(c), source: 'gift_card', sourceId: randomUUID(), by: x.userId, memo: `gift card ${code}`,
    lines: [{ acct: METHOD_ACCT[b.method], dr: amount }, { acct: '2210', cr: amount }] });
  await c.query('insert into gift_cards(code, amount, journal_id, sold_by) values ($1,$2,$3,$4)', [code, amount, jid, x.userId]);
  return { code, amount };
}
export async function giftCardInfo(c: PoolClient, code: string) {
  const g = await q1(c, 'select code, amount from gift_cards where code=$1', [code.toUpperCase()]);
  if (!g) throw notFound('Unknown gift card');
  const used = (await q1(c, "select coalesce(sum(amount),0)::bigint u from payments where method='giftcard' and reference=$1", [g.code])).u;
  return { ...g, remaining: g.amount - used };
}
export async function loyaltyBalance(c: PoolClient, customer: string) {
  const r = await q1(c, 'select coalesce(sum(points),0)::int p from loyalty_ledger where customer_id=$1', [customer]);
  const v = parseInt(await setting(c, 'loyalty_point_value_cents', '100'), 10) || 0;
  return { points: r.p, value: r.p * v };
}

// ---------------------------------------------------------------- refunds ----
// Refund one line of a PAID bill. Reverses revenue/tax/levy; stock either returns (restock) or its cost goes to Wastage.
export async function refundLine(x: Ctx, billId: string, b: any) {
  const { c } = x;
  const bill = await q1(c, 'select * from bills where id=$1 for update', [billId]);
  if (!bill) throw notFound('Bill not found');
  if (bill.status !== 'closed' || bill.disposition !== 'paid') throw conflict('Refunds are for bills that were paid. Use void for unpaid bills.');
  const line = await q1(c, 'select * from bill_lines where id=$1 and bill_id=$2 for update', [b.line_id, billId]);
  if (!line || line.status !== 'active') throw conflict('That item is not on the bill or was already removed or refunded');
  if (!b.reason) throw bad('A reason is required');
  const method = b.method;
  if (!['cash', 'mpesa', 'card', 'deposit'].includes(method)) throw bad('Refund method must be cash, mpesa, card or deposit (store credit)');
  if (method === 'deposit' && !bill.customer_id) throw bad('Store credit needs a customer on the bill');
  const approver = await verifyApprover(c, b.approver, x.userId);
  const bd = await businessDate(c);
  await removeLine(x, line, { reason: `refund: ${b.reason}`, approved: true, mode: b.restock ? 'restock' : 'waste', status: 'refunded' });
  const id = randomUUID();
  const out: JLine = method === 'deposit' ? { acct: '2200', cr: line.payable, party: bill.customer_id } : { acct: METHOD_ACCT[method], cr: line.payable };
  const jid = await postJournal(c, { date: bd, source: 'refund', sourceId: id, by: x.userId, memo: `refund ${bill.number}: ${b.reason}`, lines: [{ acct: '1110', dr: line.payable }, out] });
  await c.query('insert into refunds(id, bill_id, line_id, amount, method, restock, reason, approver_id, journal_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [id, billId, line.id, line.payable, method, !!b.restock, b.reason, approver, jid, x.userId]);
  return { refund_id: id, amount: line.payable, balance: await billBalance(c, billId) };
}
