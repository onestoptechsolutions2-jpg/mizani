import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { bad, cents, conflict, forbidden, notFound, q1, qa, qty as vqty } from '../db';
import { businessDate, Ctx, JLine, postJournal } from '../ledger';
import { addMove, neg, quoteGain, quoteIssue, updateLastCost } from '../stock';

// ---------------------------------------------------------------- transfers ---
export async function transfer(x: Ctx, b: any) {
  const { c } = x;
  if (b.from_store === b.to_store) throw bad('Choose two different stores');
  for (const s of [b.from_store, b.to_store]) if (!(await q1(c, 'select 1 from stores where id=$1', [s]))) throw bad('Unknown store');
  if (!Array.isArray(b.lines) || !b.lines.length) throw bad('Add at least one item');
  const bd = await businessDate(c);
  const id = randomUUID();
  const jl: JLine[] = [], mv: any[] = [];
  for (const l of b.lines) {
    const q = vqty(l.qty);
    const v = await quoteIssue(c, l.item_id, b.from_store, q);
    jl.push({ acct: '1200', dr: v, store: b.to_store }, { acct: '1200', cr: v, store: b.from_store });
    mv.push({ item: l.item_id, q, v });
  }
  const jid = await postJournal(c, { date: bd, source: 'transfer', sourceId: id, by: x.userId, memo: 'stock transfer', lines: jl });
  for (const m of mv) {
    await addMove(c, { item: m.item, store: b.from_store, qty: neg(m.q), value: -m.v, date: bd, source: 'transfer', sourceId: id, journal: jid });
    await addMove(c, { item: m.item, store: b.to_store, qty: m.q, value: m.v, date: bd, source: 'transfer', sourceId: id, journal: jid });
  }
  return { id };
}

// Departmental consumables (straws, tissue, cleaning materials...)
export async function consume(x: Ctx, b: any) {
  const { c } = x;
  const q = vqty(b.qty);
  const bd = await businessDate(c);
  const v = await quoteIssue(c, b.item_id, b.store_id, q);
  const id = randomUUID();
  const jid = await postJournal(c, { date: bd, source: 'consumption', sourceId: id, by: x.userId, memo: `consumables ${b.department || ''}`,
    lines: [{ acct: '5120', dr: v, dept: b.department ?? null }, { acct: '1200', cr: v, store: b.store_id }] });
  await addMove(c, { item: b.item_id, store: b.store_id, qty: neg(q), value: -v, date: bd, source: 'consumption', sourceId: id, journal: jid });
  return { id, value: v };
}

export async function openingStock(x: Ctx, b: any) {
  const { c } = x;
  if (!Array.isArray(b.lines) || !b.lines.length) throw bad('Add at least one line');
  const bd = b.date || (await businessDate(c));
  const id = randomUUID();
  const jl: JLine[] = [], mv: any[] = [];
  let total = 0;
  for (const l of b.lines) {
    const q = vqty(l.qty);
    const v = (await q1(c, 'select round($1::numeric * $2::bigint)::bigint v', [q, cents(l.unit_cost, 'unit_cost', true)])).v;
    total += v; jl.push({ acct: '1200', dr: v, store: l.store_id }); mv.push({ ...l, q, v });
  }
  jl.push({ acct: '3900', cr: total });
  const jid = await postJournal(c, { date: bd, source: 'opening_stock', sourceId: id, by: x.userId, memo: 'opening stock', lines: jl });
  for (const m of mv) { await addMove(c, { item: m.item_id, store: m.store_id, qty: m.q, value: m.v, date: bd, source: 'opening_stock', sourceId: id, journal: jid }); await updateLastCost(c, m.item_id, m.q, m.v); }
  return { id, total };
}

// ---------------------------------------------------------------- wastage ---
async function postWastage(c: PoolClient, w: any, by: string) {
  const v = await quoteIssue(c, w.item_id, w.store_id, w.qty);
  const jid = await postJournal(c, { date: w.business_date, source: 'wastage', sourceId: w.id, by, memo: `wastage: ${w.reason}`,
    lines: [{ acct: '5110', dr: v }, { acct: '1200', cr: v, store: w.store_id }] });
  await addMove(c, { item: w.item_id, store: w.store_id, qty: neg(w.qty), value: -v, date: w.business_date, source: 'wastage', sourceId: w.id, journal: jid });
  await c.query("update wastage set status='posted', journal_id=$2 where id=$1", [w.id, jid]);
}
export async function createWastage(x: Ctx, b: any) {
  const { c } = x;
  const q = vqty(b.qty);
  const reason = await q1(c, 'select 1 from wastage_reasons where code=$1', [b.reason]);
  if (!reason) throw bad('Choose a reason from the list');
  const bd = await businessDate(c);
  const date = b.date || bd;
  const backdated = (await q1(c, 'select ($1::date - $2::date) > 2 b', [bd, date])).b;
  const id = randomUUID();
  await c.query(`insert into wastage(id, item_id, store_id, qty, reason, note, business_date, backdated, status, created_by)
    values ($1,$2,$3,$4::numeric,$5,$6,$7,$8,$9,$10)`, [id, b.item_id, b.store_id, q, b.reason, b.note ?? null, date, backdated, backdated ? 'pending' : 'posted', x.userId]);
  const w = await q1(c, 'select * from wastage where id=$1', [id]);
  if (backdated) {
    await c.query("insert into approvals(kind, subject_id, payload, requested_by) values ('wastage',$1,$2,$3)", [id, { reason: 'dated more than 2 days back' }, x.userId]);
    return { id, status: 'pending', message: 'Dated more than 2 days back: waiting for approval' };
  }
  await postWastage(c, w, x.userId);
  return { id, status: 'posted' };
}
export async function approveWastage(x: Ctx, id: string) {
  const w = await q1(x.c, 'select * from wastage where id=$1 for update', [id]);
  if (!w || w.status !== 'pending') throw conflict('Nothing to approve');
  await postWastage(x.c, w, x.userId);
}
export async function rejectWastage(c: PoolClient, id: string) { await c.query("update wastage set status='rejected' where id=$1", [id]); }

// -------------------------------------------------------------- stock takes ---
export async function startTake(x: Ctx, storeId: string) {
  const { c } = x;
  if (!(await q1(c, 'select 1 from stores where id=$1', [storeId]))) throw bad('Unknown store');
  if (await q1(c, "select 1 from stock_takes where store_id=$1 and status in ('counting','pending_approval')", [storeId])) throw conflict('This store already has a stock take in progress');
  const id = randomUUID();
  const n = await q1(c, "select 'ST' || lpad(nextval('stock_take_seq')::text, 5, '0') n");
  await c.query('insert into stock_takes(id, number, store_id, counted_by) values ($1,$2,$3,$4)', [id, n.n, storeId, x.userId]);
  // Every stocked item mapped to the store: assigned here, holding stock here, or used in a recipe from here.
  await c.query(`insert into stock_take_lines(take_id, item_id)
    select $1, i.id from items i where i.is_stocked and i.active and (
      i.production_store_id = $2
      or exists (select 1 from stock_balances b where b.item_id=i.id and b.store_id=$2 and b.qty <> 0)
      or exists (select 1 from recipe_components r where r.component_item_id=i.id and r.store_id=$2))`, [id, storeId]);
  return { id, number: n.n };
}
export async function getTake(c: PoolClient, id: string, viewer: { userId: string; role: string }) {
  const t = await q1(c, 'select t.*, s.name store_name from stock_takes t join stores s on s.id=t.store_id where t.id=$1', [id]);
  if (!t) throw notFound('Stock take not found');
  const showSystem = ['pending_approval', 'approved'].includes(t.status) && viewer.userId !== t.counted_by && ['owner', 'manager', 'accountant'].includes(viewer.role);
  const lines = await qa(c, `select l.item_id, i.name, i.base_unit, l.counted_qty::text counted_qty,
      ${showSystem ? 'l.system_qty::text system_qty, (l.counted_qty - l.system_qty)::text variance' : 'null::text system_qty, null::text variance'}
    from stock_take_lines l join items i on i.id=l.item_id where l.take_id=$1 order by i.name`, [id]);
  return { ...t, lines };
}
export async function saveCounts(x: Ctx, id: string, counts: any[]) {
  const t = await q1(x.c, 'select * from stock_takes where id=$1 for update', [id]);
  if (!t) throw notFound('Stock take not found');
  if (t.status !== 'counting') throw conflict('This count has been submitted');
  if (t.counted_by !== x.userId) throw forbidden('Only the person who started this count can enter quantities');
  for (const k of counts || []) {
    const r = await x.c.query('update stock_take_lines set counted_qty=$3::numeric where take_id=$1 and item_id=$2', [id, k.item_id, vqty(k.qty, 'qty', true)]);
    if (!r.rowCount) throw bad('That item is not part of this count');
  }
  return { ok: true };
}
export async function submitTake(x: Ctx, id: string) {
  const { c } = x;
  const t = await q1(c, 'select * from stock_takes where id=$1 for update', [id]);
  if (!t) throw notFound('Stock take not found');
  if (t.status !== 'counting') throw conflict('Already submitted');
  if (t.counted_by !== x.userId) throw forbidden('Only the counter can submit');
  const missing = await qa(c, 'select i.name from stock_take_lines l join items i on i.id=l.item_id where l.take_id=$1 and l.counted_qty is null', [id]);
  if (missing.length) throw conflict(`${missing.length} items are not counted yet`, missing.map((m) => m.name));
  // Freeze system quantity at the moment of submission.
  await c.query(`update stock_take_lines l set system_qty = coalesce((select b.qty from stock_balances b where b.item_id=l.item_id and b.store_id=$2),0) where l.take_id=$1`, [id, t.store_id]);
  await c.query("update stock_takes set status='pending_approval', submitted_at=now() where id=$1", [id]);
  await c.query("insert into approvals(kind, subject_id, payload, requested_by) values ('stock_take',$1,$2,$3)", [id, { number: t.number }, x.userId]);
  return { status: 'pending_approval' };
}
// Variances post to Stock Count Variance (5100): gains debit Inventory, losses credit it.
export async function approveTake(x: Ctx, id: string) {
  const { c } = x;
  const t = await q1(c, 'select * from stock_takes where id=$1 for update', [id]);
  if (!t || t.status !== 'pending_approval') throw conflict('Nothing to approve');
  if (t.counted_by === x.userId) throw forbidden('The person who counted cannot approve the count');
  const lines = await qa(c, 'select item_id, (counted_qty - system_qty)::text v from stock_take_lines where take_id=$1 and counted_qty <> system_qty', [id]);
  const bd = await businessDate(c);
  const jl: JLine[] = [], mv: any[] = [];
  for (const l of lines) {
    if (l.v.startsWith('-')) {
      const q = l.v.slice(1);
      const v = await quoteIssue(c, l.item_id, t.store_id, q);
      jl.push({ acct: '5100', dr: v }, { acct: '1200', cr: v, store: t.store_id });
      mv.push({ item: l.item_id, q: neg(q), v: -v });
    } else {
      const v = await quoteGain(c, l.item_id, t.store_id, l.v);
      jl.push({ acct: '1200', dr: v, store: t.store_id }, { acct: '5100', cr: v });
      mv.push({ item: l.item_id, q: l.v, v });
    }
  }
  const jid = await postJournal(c, { date: bd, source: 'stock_take', sourceId: id, by: x.userId, memo: `stock take ${t.number}`, lines: jl });
  for (const m of mv) await addMove(c, { item: m.item, store: t.store_id, qty: m.q, value: m.v, date: bd, source: 'stock_take', sourceId: id, journal: jid, note: 'stock take variance' });
  await c.query("update stock_takes set status='approved', approved_by=$2, approved_at=now(), journal_id=$3 where id=$1", [id, x.userId, jid]);
}
export async function rejectTake(c: PoolClient, id: string, by: string) {
  await c.query("update stock_takes set status='rejected', approved_by=$2, approved_at=now() where id=$1", [id, by]);
}

export async function stockReport(c: PoolClient, outlet?: string | null) {
  return qa(c, `select i.id item_id, i.name, i.base_unit, s.id store_id, s.name store, b.qty::text qty, b.value::bigint value
    from stock_balances b join items i on i.id=b.item_id join stores s on s.id=b.store_id where (b.qty <> 0 or b.value <> 0) and ($1::uuid is null or s.outlet_id=$1) order by s.name, i.name`, [outlet ?? null]);
}
