import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { bad, cents, conflict, forbidden, notFound, q1, qa, qty as vqty } from '../db';
import { BILL_BAL, balanceOf, businessDate, Ctx, JLine, METHOD_ACCT, postJournal, reverseJournal, setting } from '../ledger';
import { addMove, neg, quoteIssue, reverseMoves } from '../stock';
import { can, verifySecret } from '../security';

export async function billBalance(c: PoolClient, id: string): Promise<number> {
  const r = await q1(c, `select ${BILL_BAL('b')}::bigint b from bills b where b.id=$1`, [id]);
  return r ? r.b : 0;
}
async function loadBill(c: PoolClient, id: string, mustBeOpen = true) {
  const b = await q1(c, 'select * from bills where id=$1 for update', [id]);
  if (!b) throw notFound('Bill not found');
  if (mustBeOpen && b.status !== 'open') throw conflict(`Bill ${b.number} is ${b.status} and cannot be changed`);
  return b;
}

export async function verifyApprover(c: PoolClient, a: any, actorId: string): Promise<string> {
  if (!a?.user_id || !a?.pin) throw forbidden('Manager approval required: provide approver user and PIN');
  const u = await q1(c, 'select * from users where id=$1 and active', [a.user_id]);
  if (!u || !can(u.role, 'override') || !verifySecret(String(a.pin), u.pin_hash)) throw forbidden('Approval rejected: invalid manager or PIN');
  if (u.id === actorId) throw forbidden('The approver must be a different person from the person making the request');
  return u.id;
}

export async function openBill(x: Ctx, b: any) {
  const bd = await businessDate(x.c);
  const n = await q1(x.c, "select 'B' || lpad(nextval('bill_seq')::text, 6, '0') n");
  if (b.customer_id) { const p = await q1(x.c, "select 1 from parties where id=$1 and kind='customer'", [b.customer_id]); if (!p) throw bad('Unknown customer'); }
  let outlet = b.outlet_id ?? null;
  if (!outlet && b.store_id) outlet = (await q1(x.c, 'select outlet_id from stores where id=$1', [b.store_id]))?.outlet_id ?? null;
  if (!outlet) outlet = (await q1(x.c, 'select id from outlets order by name limit 1'))?.id ?? null;
  return q1(x.c, 'insert into bills(number, business_date, table_name, customer_id, terminal_store_id, opened_by, outlet_id) values ($1,$2,$3,$4,$5,$6,$7) returning *',
    [n.n, bd, b.table_name ?? null, b.customer_id ?? null, b.store_id ?? null, x.userId, outlet]);
}

export async function addLine(x: Ctx, billId: string, b: any, replaces: string | null = null) {
  const { c } = x;
  const bill = await loadBill(c, billId);
  const item = await q1(c, `select i.*, ra.code rev_code, ca.code cogs_code from items i
    left join accounts ra on ra.id=i.revenue_account_id left join accounts ca on ca.id=i.cogs_account_id
    where i.id=$1 and i.active and i.is_sellable`, [b.item_id]);
  if (!item) throw notFound('Item not found or not sellable');
  const q = vqty(b.qty);
  const discount = b.discount ? cents(b.discount, 'discount', true) : 0;
  if (discount > 0 && !can(x.role as any, 'discount')) throw forbidden('Only a manager can give discounts');
  const bd = await businessDate(c);
  // Wholesale price list for this customer, if any
  let unitPrice = item.sell_price;
  if (bill.customer_id) {
    const pl = await q1(c, 'select pli.price from parties p join price_list_items pli on pli.price_list_id=p.price_list_id and pli.item_id=$2 where p.id=$1', [bill.customer_id, item.id]);
    if (pl) unitPrice = pl.price;
  }
  const gross = (await q1(c, 'select round($1::numeric * $2::bigint)::bigint g', [q, unitPrice])).g;
  // Automatic promotion (best percentage for this item or for everything)
  const promo = await q1(c, `select max(percent_bp)::int p from promotions where active and (item_id is null or item_id=$1) and (starts is null or starts <= $2::date) and (ends is null or ends >= $2::date)`, [item.id, bd]);
  const autoDiscount = promo?.p ? Math.round((gross * promo.p) / 10000) : 0;
  const totalDiscount = discount + autoDiscount;
  if (totalDiscount > gross) throw bad('Discount cannot exceed the line total');
  const payable = gross - totalDiscount;
  // VAT and tourism/catering levy are both carved out of the VAT-inclusive price (Tourism Fund formula: total x levy / (100 + VAT + levy))
  const levyBp = parseInt(await setting(c, 'levy_bp', '0'), 10) || 0;
  const denom = 10000 + item.tax_rate_bp + levyBp;
  const tax = Math.round((payable * item.tax_rate_bp) / denom);
  const levy = Math.round((payable * levyBp) / denom);
  const net = payable - tax - levy;
  const lineId = randomUUID();
  const outlet = bill.outlet_id;

  // Depletion plan: always from the recipe's production store, never from the terminal's store.
  const comps = await qa(c, 'select component_item_id i, store_id s, qty from recipe_components where menu_item_id=$1', [item.id]);
  const plan: { item: string; store: string; qty: string }[] = [];
  if (comps.length) {
    for (const k of comps) plan.push({ item: k.i, store: k.s, qty: (await q1(c, 'select round($1::numeric * $2::numeric, 6)::text n', [q, k.qty])).n });
  } else if (item.is_stocked) {
    if (!item.production_store_id) throw bad(`Item ${item.name} has no production store`);
    plan.push({ item: item.id, store: item.production_store_id, qty: q });
  }
  let cost = 0;
  const inv: JLine[] = [], moves: any[] = [];
  for (const p of plan) {
    const v = await quoteIssue(c, p.item, p.store, p.qty);
    cost += v;
    inv.push({ acct: '1200', cr: v, store: p.store, outlet });
    moves.push({ ...p, v });
  }
  const jid = await postJournal(c, {
    date: bd, source: 'bill_line', sourceId: lineId, by: x.userId, memo: `${bill.number} ${item.name} x${q}`,
    lines: [
      { acct: '1110', dr: payable }, { acct: '4900', dr: totalDiscount, outlet },
      { acct: item.rev_code || '4000', cr: net + totalDiscount, outlet }, { acct: '2100', cr: tax }, { acct: '2110', cr: levy },
      { acct: item.cogs_code || '5000', dr: cost, outlet }, ...inv,
    ],
  });
  for (const m of moves) await addMove(c, { item: m.item, store: m.store, qty: neg(m.qty), value: -m.v, date: bd, source: 'bill_line', sourceId: lineId, journal: jid });
  await c.query(`insert into bill_lines(id, bill_id, item_id, qty, unit_price, discount, gross, payable, tax, net, cogs_value, journal_id, replaces_line_id, levy)
    values ($1,$2,$3,$4::numeric,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [lineId, billId, item.id, q, unitPrice, totalDiscount, gross, payable, tax, net, cost, jid, replaces, levy]);
  return lineId;
}

// Remove a line by reversing exactly its own postings (append-only).
export async function removeLine(x: Ctx, line: any, o: { reason?: string; approved?: boolean; bd?: string; mode?: 'restock' | 'waste'; status?: 'removed' | 'refunded' }) {
  const { c } = x;
  const bd = o.bd ?? (await businessDate(c));
  if (line.status !== 'active') throw conflict('Line already removed');
  const waste = o.mode ? o.mode === 'waste' : !!line.prepared_at;
  if (waste) {
    // E2: the kitchen already prepared it: reverse revenue, move cost to wastage, do not restore stock.
    if (!o.reason) throw bad('A reason is required to remove an item the kitchen has prepared');
    if (!o.approved && !can(x.role as any, 'override')) throw forbidden('Removing a prepared item needs manager approval');
    if (!line.journal_id) { await c.query("update bill_lines set status=$3, removed_at=now(), remove_reason=$2 where id=$1", [line.id, o.reason ?? null, o.status ?? 'removed']); return; }
    const rows = await qa(c, 'select l.*, a.type, a.code from journal_lines l join accounts a on a.id=l.account_id where l.journal_id=$1', [line.journal_id]);
    const cogs = rows.filter((r) => r.type === 'cost_of_sales' && r.debit > 0);
    const total = cogs.reduce((s, r) => s + r.debit, 0);
    const extra: JLine[] = [{ acct: '5110', dr: total }, ...cogs.map((r) => ({ acct: r.account_id, cr: r.debit }))];
    await reverseJournal(c, line.journal_id, {
      date: bd, source: 'bill_line', sourceId: line.id, by: x.userId, memo: `prepared item removed: ${o.reason}`,
      skip: (l) => l.type === 'cost_of_sales' || l.code === '1200', extra,
    });
  } else {
    // E1: not prepared: reverse revenue, tax, cost and stock.
    if (line.journal_id) {
      const jid = await reverseJournal(c, line.journal_id, { date: bd, source: 'bill_line', sourceId: line.id, by: x.userId, memo: `line removed${o.reason ? ': ' + o.reason : ''}` });
      await reverseMoves(c, { date: bd, source: 'bill_line', sourceId: line.id, journal: jid });
    }
  }
  await c.query("update bill_lines set status=$3, removed_at=now(), remove_reason=$2 where id=$1", [line.id, o.reason ?? null, o.status ?? 'removed']);
}

async function loadLine(c: PoolClient, billId: string, lineId: string) {
  const l = await q1(c, 'select * from bill_lines where id=$1 and bill_id=$2 for update', [lineId, billId]);
  if (!l) throw notFound('Line not found');
  return l;
}
async function guardBalance(c: PoolClient, bill: any) {
  if ((await billBalance(c, bill.id)) < 0) throw conflict('Payments already exceed the remaining items on this bill. Refund is not supported yet.');
}

export async function removeBillLine(x: Ctx, billId: string, lineId: string, b: any) {
  const bill = await loadBill(x.c, billId);
  const line = await loadLine(x.c, billId, lineId);
  let approved = false;
  if (line.prepared_at && !can(x.role as any, 'override')) { await verifyApprover(x.c, b.approver, x.userId); approved = true; }
  await removeLine(x, line, { reason: b.reason, approved });
  await guardBalance(x.c, bill);
  return { ok: true };
}
export async function changeQty(x: Ctx, billId: string, lineId: string, newQty: any) {
  const bill = await loadBill(x.c, billId);
  const line = await loadLine(x.c, billId, lineId);
  if (line.status !== 'active') throw conflict('Line already removed');
  if (line.prepared_at) throw conflict('The kitchen has prepared this item. Remove it with a reason, then add the new quantity.');
  const q = vqty(newQty, 'qty', true);
  await removeLine(x, line, { reason: 'quantity changed' });
  let id: string | null = null;
  if (Number(q) > 0) id = await addLine(x, billId, { item_id: line.item_id, qty: q }, line.id);
  await guardBalance(x.c, bill);
  return { line_id: id };
}
export async function markPrepared(c: PoolClient, billId: string, lineId: string) {
  await loadBill(c, billId);
  const l = await loadLine(c, billId, lineId);
  if (l.status !== 'active') throw conflict('Line was removed');
  await c.query('update bill_lines set prepared_at = coalesce(prepared_at, now()) where id=$1', [lineId]);
}

async function closeNow(c: PoolClient, billId: string, disposition: string, by: string) {
  await c.query("update bills set status='closed', disposition=$2, closed_by=$3, closed_at=now() where id=$1", [billId, disposition, by]);
}

const DIRECT = ['cash', 'mpesa', 'card'];
export async function giftCardRemaining(c: PoolClient, code: string): Promise<number | null> {
  const g = await q1(c, 'select amount from gift_cards where code=$1', [code]);
  if (!g) return null;
  const used = await q1(c, "select coalesce(sum(amount),0)::bigint u from payments where method='giftcard' and reference=$1", [code]);
  return g.amount - used.u;
}
// Loyalty: points earned on money actually paid (not on deposits, gift cards or points).
async function accrueLoyalty(x: Ctx, bill: any) {
  const { c } = x;
  if (!bill.customer_id || (await setting(c, 'loyalty_enabled', 'false')) !== 'true') return;
  const paid = (await q1(c, "select coalesce(sum(amount),0)::bigint t from payments where bill_id=$1 and method in ('cash','mpesa','card')", [bill.id])).t;
  const earn = parseInt(await setting(c, 'loyalty_points_per_kes100', '1'), 10) || 0;
  const points = Math.floor(paid / 10000) * earn;
  if (points <= 0) return;
  const value = points * (parseInt(await setting(c, 'loyalty_point_value_cents', '100'), 10) || 0);
  const jid = await postJournal(c, { date: await businessDate(c), source: 'loyalty', sourceId: bill.id, by: x.userId, memo: `loyalty ${points} points ${bill.number}`,
    lines: [{ acct: '6150', dr: value }, { acct: '2220', cr: value, party: bill.customer_id }] });
  await c.query("insert into loyalty_ledger(customer_id, points, kind, bill_id, journal_id) values ($1,$2,'accrual',$3,$4)", [bill.customer_id, points, bill.id, jid]);
}

export async function pay(x: Ctx, billId: string, b: any) {
  const { c } = x;
  const bill = await loadBill(c, billId);
  const method = b.method;
  if (![...DIRECT, 'deposit', 'giftcard', 'points'].includes(method)) throw bad('Payment method must be cash, mpesa, card, deposit, giftcard or points');
  const tip = b.tip ? cents(b.tip, 'tip', true) : 0;
  if (tip && !DIRECT.includes(method)) throw bad('Tips can only be added to cash, M-Pesa or card payments');
  const bal = await billBalance(c, billId);
  const bd = await businessDate(c);
  const id = randomUUID();
  let amount = 0, reference: string | null = b.reference ?? null, lines: JLine[], points = 0;
  if (method === 'points') {
    if (!bill.customer_id) throw bad('Redeeming points needs a customer on the bill');
    points = parseInt(b.points, 10);
    if (!(points > 0)) throw bad('points must be a positive whole number');
    const have = (await q1(c, 'select coalesce(sum(points),0)::int p from loyalty_ledger where customer_id=$1', [bill.customer_id])).p;
    if (points > have) throw conflict(`The customer only has ${have} points`);
    amount = points * (parseInt(await setting(c, 'loyalty_point_value_cents', '100'), 10) || 0);
    lines = [{ acct: '2220', dr: amount, party: bill.customer_id }, { acct: '1110', cr: amount }];
  } else if (method === 'deposit') {
    if (!bill.customer_id) throw bad('Using a deposit needs a customer on the bill');
    amount = cents(b.amount);
    const have = -(await balanceOf(c, '2200', bill.customer_id));
    if (amount > have) throw conflict(`The customer's deposit balance is only ${have}`);
    lines = [{ acct: '2200', dr: amount, party: bill.customer_id }, { acct: '1110', cr: amount }];
  } else if (method === 'giftcard') {
    const rem = await giftCardRemaining(c, String(b.code || ''));
    if (rem === null) throw bad('Unknown gift card');
    amount = cents(b.amount);
    if (amount > rem) throw conflict(`The gift card only has ${rem} left`);
    reference = String(b.code);
    lines = [{ acct: '2210', dr: amount }, { acct: '1110', cr: amount }];
  } else {
    amount = cents(b.amount);
    lines = [{ acct: METHOD_ACCT[method], dr: amount + tip }, { acct: '1110', cr: amount }, { acct: '2300', cr: tip }];
  }
  if (amount > bal) throw conflict(`Payment of ${amount} exceeds the bill balance of ${bal}`);
  const jid = await postJournal(c, { date: bd, source: 'payment', sourceId: id, by: x.userId, memo: `${bill.number} ${method}`, lines });
  await c.query('insert into payments(id, bill_id, method, amount, reference, business_date, journal_id, created_by, tip) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, billId, method, amount, reference, bd, jid, x.userId, tip]);
  if (points) await c.query("insert into loyalty_ledger(customer_id, points, kind, bill_id, journal_id) values ($1,$2,'redemption',$3,$4)", [bill.customer_id, -points, billId, jid]);
  if (bal - amount === 0) { await closeNow(c, billId, 'paid', x.userId); await accrueLoyalty(x, bill); }
  return { payment_id: id, balance: bal - amount, tip };
}

export async function closeBill(x: Ctx, billId: string, b: any) {
  const { c } = x;
  const bill = await loadBill(c, billId);
  const bal = await billBalance(c, billId);
  const kind = b.disposition;
  if (kind === 'paid') {
    if (bal !== 0) throw conflict(`This bill still has ${bal} cents unpaid. Take payment or choose credit, staff, complimentary or write-off.`);
    await closeNow(c, billId, 'paid', x.userId);
    return { closed: true };
  }
  if (!['credit', 'staff', 'complimentary', 'writeoff', 'room'].includes(kind)) throw bad('disposition must be paid, credit, staff, complimentary, writeoff or room');
  if (bal === 0) { await closeNow(c, billId, 'paid', x.userId); return { closed: true }; }
  if (bal < 0) throw conflict('Bill is overpaid');
  const bd = await businessDate(c);
  let acct = '', party: string | null = null, approver: string | null = null, reservation: string | null = null;
  if (kind === 'credit') {
    party = b.customer_id || bill.customer_id;
    const p = party && (await q1(c, "select * from parties where id=$1 and kind='customer'", [party]));
    if (!p) throw bad('Credit needs a customer');
    const owed = await balanceOf(c, '1100', party!);
    if (p.credit_limit === 0 || owed + bal > p.credit_limit) approver = await verifyApprover(c, b.approver, x.userId);
    acct = '1100';
  } else if (kind === 'room') {
    const rv = await q1(c, "select * from reservations where id=$1 and status='checked_in'", [b.reservation_id]);
    if (!rv) throw bad('Charge to room needs a guest who is checked in');
    party = rv.guest_id; acct = '1130'; reservation = rv.id;
  } else if (kind === 'staff') {
    party = b.staff_id;
    const p = party && (await q1(c, "select * from parties where id=$1 and kind='staff'", [party]));
    if (!p) throw bad('Staff deduction needs a staff member');
    approver = await verifyApprover(c, b.approver, x.userId);
    acct = '1120';
  } else {
    if (!b.reason) throw bad('A reason is required');
    approver = await verifyApprover(c, b.approver, x.userId);
    acct = kind === 'complimentary' ? '6000' : '6020';
  }
  const id = randomUUID();
  const jid = await postJournal(c, { date: bd, source: 'disposition', sourceId: id, by: x.userId, memo: `${bill.number} ${kind}${b.reason ? ': ' + b.reason : ''}`,
    lines: [{ acct, dr: bal, party }, { acct: '1110', cr: bal }] });
  await c.query('insert into bill_dispositions(id, bill_id, kind, amount, party_id, approver_id, reason, journal_id, reservation_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, billId, kind, bal, party, approver, b.reason ?? null, jid, reservation]);
  if (kind === 'room') await c.query("insert into folio_charges(reservation_id, kind, description, amount, business_date, journal_id, created_by) values ($1,'pos',$2,$3,$4,$5,$6)", [reservation, `Restaurant bill ${bill.number}`, bal, bd, jid, x.userId]);
  await closeNow(c, billId, kind, x.userId);
  return { closed: true, disposition: kind, amount: bal };
}

export async function requestVoid(x: Ctx, billId: string, reason: string) {
  const bill = await loadBill(x.c, billId);
  if (!reason) throw bad('A reason is required');
  const paid = await q1(x.c, 'select count(*)::int n from payments where bill_id=$1', [billId]);
  if (paid.n) throw conflict('This bill has payments. Void is only for unpaid bills.');
  const dup = await q1(x.c, "select 1 from approvals where kind='bill_void' and subject_id=$1 and status='pending'", [billId]);
  if (dup) throw conflict('A void request is already waiting for approval');
  return q1(x.c, "insert into approvals(kind, subject_id, payload, requested_by) values ('bill_void',$1,$2,$3) returning *", [billId, { reason, number: bill.number }, x.userId]);
}
export async function executeVoid(x: Ctx, billId: string, reason: string) {
  const { c } = x;
  await loadBill(c, billId);
  const lines = await qa(c, "select * from bill_lines where bill_id=$1 and status='active' for update", [billId]);
  for (const l of lines) await removeLine(x, l, { reason: `bill void: ${reason}`, approved: true });
  // A service charge on the bill must be reversed too, or the voided bill keeps a balance.
  const bd = await businessDate(c);
  for (const ch of await qa(c, "select * from bill_charges where bill_id=$1 and status='active' for update", [billId])) {
    await postJournal(c, { date: bd, source: 'service_charge', sourceId: ch.id, by: x.userId, memo: 'service charge reversed: bill void', reverses: ch.journal_id,
      lines: [{ acct: '2300', dr: ch.amount }, { acct: '1110', cr: ch.amount }] });
    await c.query("update bill_charges set status='removed' where id=$1", [ch.id]);
  }
  await c.query("update bills set status='void', disposition='void', closed_by=$2, closed_at=now() where id=$1", [billId, x.userId]);
}

// Customer or staff settles what they owe.
export async function receipt(x: Ctx, partyId: string, b: any) {
  const { c } = x;
  const p = await q1(c, 'select * from parties where id=$1', [partyId]);
  if (!p || !['customer', 'staff'].includes(p.kind)) throw notFound('Customer or staff member not found');
  if (!METHOD_ACCT[b.method]) throw bad('Unknown payment method');
  const amount = cents(b.amount);
  const control = p.kind === 'customer' ? '1100' : '1120';
  const owed = await balanceOf(c, control, partyId);
  if (amount > owed) throw conflict(`${p.name} only owes ${owed}`);
  const bd = await businessDate(c);
  const jid = await postJournal(c, { date: bd, source: 'receipt', sourceId: partyId, by: x.userId, memo: `receipt from ${p.name}`,
    lines: [{ acct: METHOD_ACCT[b.method], dr: amount }, { acct: control, cr: amount, party: partyId }] });
  return { journal_id: jid, balance: owed - amount };
}

export async function getBill(c: PoolClient, id: string) {
  const b = await q1(c, 'select * from bills where id=$1', [id]);
  if (!b) throw notFound('Bill not found');
  const lines = await qa(c, `select bl.*, i.name item_name from bill_lines bl join items i on i.id=bl.item_id where bl.bill_id=$1 order by bl.created_at`, [id]);
  const payments = await qa(c, 'select * from payments where bill_id=$1 order by created_at', [id]);
  const dispositions = await qa(c, 'select * from bill_dispositions where bill_id=$1', [id]);
  const charges = await qa(c, "select * from bill_charges where bill_id=$1 and status='active'", [id]);
  const refunds = await qa(c, 'select * from refunds where bill_id=$1', [id]);
  return { ...b, lines, payments, dispositions, charges, refunds, balance: await billBalance(c, id) };
}
export async function listBills(c: PoolClient, status: string, outlet?: string | null) {
  return qa(c, `select b.id, b.number, b.table_name, b.status, b.disposition, b.business_date, b.opened_at, b.outlet_id,
      ${BILL_BAL('b')}::bigint balance,
      coalesce((select sum(payable) from bill_lines l where l.bill_id=b.id and l.status='active'),0)::bigint total
    from bills b where ($1 = 'all' or b.status = $1) and ($2::uuid is null or b.outlet_id = $2) order by b.opened_at desc limit 200`, [status, outlet ?? null]);
}
