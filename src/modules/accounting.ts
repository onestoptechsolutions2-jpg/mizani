import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { bad, cents, conflict, forbidden, q1, qa } from '../db';
import { balanceOf, businessDate, Ctx, JLine, METHOD_ACCT, postJournal } from '../ledger';
import { reconcile } from './reconcile';

export async function createExpense(x: Ctx, b: any) {
  const { c } = x;
  const a = await q1(c, 'select * from accounts where code=$1', [b.account]);
  if (!a || !['expense', 'cost_of_sales'].includes(a.type)) throw bad('Choose an expense account');
  const amount = cents(b.amount), vat = b.vat ? cents(b.vat, 'vat', true) : 0;
  const method = b.method;
  if (method !== 'credit' && !METHOD_ACCT[method]) throw bad('A payment mode is required (cash, mpesa, card, bank or credit)');
  let supplier: string | null = null;
  if (method === 'credit') {
    supplier = b.supplier_id;
    if (!supplier || !(await q1(c, "select 1 from parties where id=$1 and kind='supplier'", [supplier]))) throw bad('Credit expenses need a supplier');
  }
  const bd = b.date || (await businessDate(c));
  const id = randomUUID();
  const credit: JLine = method === 'credit' ? { acct: '2000', cr: amount + vat, party: supplier } : { acct: METHOD_ACCT[method], cr: amount + vat };
  const jid = await postJournal(c, { date: bd, source: 'expense', sourceId: id, by: x.userId, memo: b.description || a.name,
    lines: [{ acct: a.code, dr: amount }, { acct: '1400', dr: vat }, credit] });
  await c.query('insert into expenses(id, account_id, amount, vat, method, supplier_id, description, business_date, journal_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [id, a.id, amount, vat, method, supplier, b.description ?? null, bd, jid, x.userId]);
  return { id };
}

// Counted cash versus what the books say should be in the till/safe.
export async function cashCount(x: Ctx, b: any) {
  const { c } = x;
  const counted = cents(b.counted, 'counted', true);
  const expected = await balanceOf(c, '1000');
  const variance = counted - expected;
  const bd = await businessDate(c);
  const id = randomUUID();
  const jid = variance === 0 ? null : await postJournal(c, { date: bd, source: 'cash_up', sourceId: id, by: x.userId, memo: 'cash count variance',
    lines: variance < 0 ? [{ acct: '6010', dr: -variance }, { acct: '1000', cr: -variance }] : [{ acct: '1000', dr: variance }, { acct: '6010', cr: variance }] });
  await c.query('insert into cash_ups(id, business_date, expected, counted, variance, journal_id, created_by) values ($1,$2,$3,$4,$5,$6,$7)', [id, bd, expected, counted, variance, jid, x.userId]);
  return { expected, counted, variance };
}
export async function bankCash(x: Ctx, b: any) {
  const amount = cents(b.amount);
  const cash = await balanceOf(x.c, '1000');
  if (amount > cash) throw conflict(`Only ${cash} cash is on hand according to the books`);
  const jid = await postJournal(x.c, { date: await businessDate(x.c), source: 'banking', sourceId: randomUUID(), by: x.userId, memo: `cash banked ${b.reference || ''}`,
    lines: [{ acct: '1030', dr: amount }, { acct: '1000', cr: amount }] });
  return { journal_id: jid };
}

// Opening balances: a balanced journal against Opening Balance Equity, allowed once.
export async function openingBalances(x: Ctx, b: any) {
  const { c } = x;
  const s = await q1(c, "select value from settings where key='opening_posted'");
  if (s.value === 'true') throw conflict('Opening balances have already been posted');
  if (!Array.isArray(b.lines) || !b.lines.length) throw bad('Add at least one line');
  const lines: JLine[] = [];
  let net = 0;
  for (const l of b.lines) {
    const d = l.debit ? cents(l.debit, 'debit') : 0, k = l.credit ? cents(l.credit, 'credit') : 0;
    if ((d > 0) === (k > 0)) throw bad('Each line needs either a debit or a credit');
    lines.push({ acct: l.account, dr: d, cr: k, party: l.party_id ?? null });
    net += d - k;
  }
  if (net > 0) lines.push({ acct: '3900', cr: net }); else if (net < 0) lines.push({ acct: '3900', dr: -net });
  const jid = await postJournal(c, { date: b.date || (await businessDate(c)), source: 'opening_balance', sourceId: randomUUID(), by: x.userId, memo: 'opening balances', lines });
  await c.query("update settings set value='true' where key='opening_posted'");
  return { journal_id: jid };
}
export async function lockPeriod(c: PoolClient, through: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) throw bad('through must be YYYY-MM-DD');
  const cur = await q1(c, "select value from settings where key='locked_through'");
  if (through < cur.value) throw conflict('A period lock can only move forward');
  await c.query("update settings set value=$1 where key='locked_through'", [through]);
  return { locked_through: through };
}

// ---------------------------------------------------------------- trading day ---
export async function dayStatus(c: PoolClient) {
  const d = await q1(c, "select business_date from business_days where status='open' order by business_date desc limit 1");
  const checks = await closeChecklist(c);
  return { business_date: d?.business_date ?? null, ready_to_close: checks.every((k) => k.ok), checklist: checks };
}
async function closeChecklist(c: PoolClient) {
  const openBills = (await q1(c, "select count(*)::int n from bills where status='open'")).n;
  const pendVoid = (await q1(c, "select count(*)::int n from approvals where status='pending' and kind='bill_void'")).n;
  const pendTake = (await q1(c, "select count(*)::int n from approvals where status='pending' and kind='stock_take'")).n;
  const pendWaste = (await q1(c, "select count(*)::int n from approvals where status='pending' and kind='wastage'")).n;
  const unpaid = (await q1(c, "select count(*)::int n from purchases where total > paid and entry_date < current_date - 30")).n;
  const rec = await reconcile(c);
  return [
    { id: 'open_bills', label: 'No open bills', ok: openBills === 0, detail: `${openBills} open` },
    { id: 'void_approvals', label: 'No void approvals waiting', ok: pendVoid === 0, detail: `${pendVoid} waiting` },
    { id: 'stock_take_approvals', label: 'No stock takes waiting for approval', ok: pendTake === 0, detail: `${pendTake} waiting` },
    { id: 'wastage_approvals', label: 'No wastage entries waiting for approval', ok: pendWaste === 0, detail: `${pendWaste} waiting` },
    { id: 'old_payables', label: 'No supplier invoices unpaid for more than 30 days', ok: unpaid === 0, detail: `${unpaid} overdue (informational)`, soft: true },
    { id: 'books_balanced', label: 'Books reconcile (trial balance, stock, debtors, creditors)', ok: rec.ok, detail: rec.ok ? 'all checks pass' : rec.checks.filter((k) => !k.ok).map((k) => k.id).join(', ') },
  ].map((k: any) => (k.soft ? { ...k, ok: true } : k));
}
export async function closeDay(x: Ctx) {
  const checks = await closeChecklist(x.c);
  const failed = checks.filter((k) => !k.ok);
  if (failed.length) throw conflict('The day cannot close yet', checks);
  const d = await q1(x.c, "select business_date from business_days where status='open' order by business_date desc limit 1 for update");
  if (!d) throw conflict('No trading day is open');
  await x.c.query("update business_days set status='closed', closed_at=now(), closed_by=$2 where business_date=$1", [d.business_date, x.userId]);
  return { closed: d.business_date };
}
export async function openDay(x: Ctx) { return { business_date: await businessDate(x.c) }; }
