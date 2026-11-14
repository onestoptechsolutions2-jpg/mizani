import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { bad, cents, conflict, notFound, q1, qa, qty as vqty } from '../db';
import { businessDate, Ctx, JLine, postJournal } from '../ledger';
import { addMove, neg, quoteIssue, updateLastCost } from '../stock';

// Prep and batch production: raw items out at average cost, prepared item in at the total. Net zero on Inventory.
export async function produce(x: Ctx, b: any) {
  const { c } = x;
  const out = await q1(c, 'select * from items where id=$1 and is_stocked', [b.output_item_id]);
  if (!out) throw bad('The prepared item must be a stocked item');
  if (!(await q1(c, 'select 1 from stores where id=$1', [b.store_id]))) throw bad('Unknown store');
  const q = vqty(b.qty);
  if (!Array.isArray(b.inputs) || !b.inputs.length) throw bad('List what was used');
  const bd = await businessDate(c);
  const id = randomUUID();
  let total = 0;
  const jl: JLine[] = [], moves: any[] = [];
  for (const i of b.inputs) {
    const iq = vqty(i.qty);
    const v = await quoteIssue(c, i.item_id, i.store_id, iq);
    total += v;
    jl.push({ acct: '1200', cr: v, store: i.store_id });
    moves.push({ item: i.item_id, store: i.store_id, qty: neg(iq), value: -v });
  }
  jl.push({ acct: '1200', dr: total, store: b.store_id });
  const jid = await postJournal(c, { date: bd, source: 'production', sourceId: id, by: x.userId, memo: `production of ${out.name}`, lines: jl });
  await c.query('insert into productions(id, output_item_id, store_id, qty, total_cost, journal_id, created_by) values ($1,$2,$3,$4::numeric,$5,$6,$7)', [id, out.id, b.store_id, q, total, jid, x.userId]);
  for (const m of moves) await addMove(c, { ...m, item: m.item, date: bd, source: 'production', sourceId: id, journal: jid });
  await addMove(c, { item: out.id, store: b.store_id, qty: q, value: total, date: bd, source: 'production', sourceId: id, journal: jid });
  await updateLastCost(c, out.id, q, total);
  return { id, total_cost: total, unit_cost: (await q1(c, 'select round($1::numeric / $2::numeric, 4)::text u', [total, q])).u };
}

export async function staffMeal(x: Ctx, b: any) {
  const { c } = x;
  const q = vqty(b.qty);
  const bd = await businessDate(c);
  const v = await quoteIssue(c, b.item_id, b.store_id, q);
  const id = randomUUID();
  const jid = await postJournal(c, { date: bd, source: 'staff_meal', sourceId: id, by: x.userId, memo: b.note || 'staff meal',
    lines: [{ acct: '5130', dr: v }, { acct: '1200', cr: v, store: b.store_id }] });
  await addMove(c, { item: b.item_id, store: b.store_id, qty: neg(q), value: -v, date: bd, source: 'staff_meal', sourceId: id, journal: jid });
  return { id, value: v };
}

// ------------------------------------------------------------- fixed assets ----
export async function createAsset(x: Ctx, b: any) {
  const cost = cents(b.cost, 'cost'), salvage = b.salvage ? cents(b.salvage, 'salvage', true) : 0;
  const life = Number(b.life_months);
  if (!Number.isInteger(life) || life < 1 || life > 600) throw bad('life_months must be 1 to 600');
  if (!b.name || !/^\d{4}-\d{2}-\d{2}$/.test(b.acquired || '')) throw bad('name and acquired (YYYY-MM-DD) are required');
  if (salvage >= cost) throw bad('Salvage value must be less than cost');
  return q1(x.c, 'insert into fixed_assets(name, cost, salvage, life_months, acquired) values ($1,$2,$3,$4,$5) returning *', [b.name, cost, salvage, life, b.acquired]);
}
export const listAssets = (c: PoolClient) => qa(c, "select *, (cost - accumulated)::bigint book_value from fixed_assets order by acquired, name");

// Straight line, monthly, from the month of acquisition. Catches up automatically if a month was skipped.
export async function depreciate(x: Ctx, period: string) {
  const { c } = x;
  if (!/^\d{4}-\d{2}$/.test(period || '')) throw bad('period must be YYYY-MM');
  if (await q1(c, 'select 1 from depreciation_runs where period=$1', [period])) throw conflict(`Depreciation for ${period} has already been run`);
  const end = (await q1(c, "select (date_trunc('month', ($1 || '-01')::date) + interval '1 month - 1 day')::date::text d", [period])).d;
  const assets = await qa(c, "select *, ((extract(year from $1::date)*12 + extract(month from $1::date)) - (extract(year from acquired)*12 + extract(month from acquired)) + 1)::int months from fixed_assets where status='active' and acquired <= $1::date for update", [end]);
  let total = 0;
  const upd: [string, number][] = [];
  for (const a of assets) {
    const n = Math.min(a.months, a.life_months);
    const target = Math.round(((a.cost - a.salvage) * n) / a.life_months);
    const dep = target - a.accumulated;
    if (dep > 0) { total += dep; upd.push([a.id, dep]); }
  }
  const jid = total > 0 ? await postJournal(c, { date: end, source: 'depreciation', sourceId: null, by: x.userId, memo: `depreciation ${period}`,
    lines: [{ acct: '6040', dr: total }, { acct: '1590', cr: total }] }) : null;
  for (const [id, dep] of upd) await c.query('update fixed_assets set accumulated = accumulated + $2 where id=$1', [id, dep]);
  await c.query('insert into depreciation_runs(period, journal_id, total, created_by) values ($1,$2,$3,$4)', [period, jid, total, x.userId]);
  return { period, total, assets: upd.length };
}
