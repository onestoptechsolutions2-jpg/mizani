import { PoolClient } from 'pg';
import { q1 } from './db';

// Serialise per item+store so costing is consistent under concurrency.
async function lock(c: PoolClient, item: string, store: string) {
  await c.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [item + store]);
}

// Value of issuing `qty` units (moving weighted average; last cost when stock is short).
// All arithmetic is done by Postgres numeric: no floating point anywhere.
export async function quoteIssue(c: PoolClient, item: string, store: string, qty: string): Promise<number> {
  await lock(c, item, store);
  const r = await q1(c, `
    with b as (select coalesce(sum(qty),0) q, coalesce(sum(value),0) v from stock_balances where item_id=$1 and store_id=$2),
         i as (select last_cost lc from items where id=$1)
    select (case
      when b.q > 0 and $3::numeric <= b.q then (case when $3::numeric = b.q then b.v else round($3::numeric * b.v / b.q) end)
      when b.q > 0 then b.v + round(($3::numeric - b.q) * i.lc)
      else round($3::numeric * i.lc) end)::bigint as val
    from b, i`, [item, store, qty]);
  return r.val;
}
// Value of adding found stock (stock-take gain): average cost if stock exists, else last cost.
export async function quoteGain(c: PoolClient, item: string, store: string, qty: string): Promise<number> {
  await lock(c, item, store);
  const r = await q1(c, `
    with b as (select coalesce(sum(qty),0) q, coalesce(sum(value),0) v from stock_balances where item_id=$1 and store_id=$2),
         i as (select last_cost lc from items where id=$1)
    select (case when b.q > 0 and b.v > 0 then round($3::numeric * b.v / b.q) else round($3::numeric * i.lc) end)::bigint as val
    from b, i`, [item, store, qty]);
  return r.val;
}
export async function onHand(c: PoolClient, item: string, store: string): Promise<{ qty: string; value: number }> {
  const r = await q1(c, 'select coalesce(sum(qty),0)::text q, coalesce(sum(value),0)::bigint v from stock_balances where item_id=$1 and store_id=$2', [item, store]);
  return { qty: r.q, value: r.v };
}

export async function addMove(c: PoolClient, m: {
  item: string; store: string; qty: string; value: number; date: string;
  source: string; sourceId?: string | null; journal?: string | null; note?: string;
}) {
  await lock(c, m.item, m.store);
  await c.query(`insert into stock_moves(item_id, store_id, qty, value, business_date, source_type, source_id, journal_id, note)
    values ($1,$2,$3::numeric,$4,$5,$6,$7,$8,$9)`,
    [m.item, m.store, m.qty, m.value, m.date, m.source, m.sourceId ?? null, m.journal ?? null, m.note ?? null]);
}
export const neg = (qtyStr: string) => (qtyStr.startsWith('-') ? qtyStr.slice(1) : '-' + qtyStr);

// Undo the original stock moves of a source document (used when a bill line is removed before preparation).
export async function reverseMoves(c: PoolClient, o: { date: string; source: string; sourceId: string; journal: string | null }) {
  const rows = (await c.query("select * from stock_moves where source_type=$1 and source_id=$2 and coalesce(note,'') <> 'reversal'", [o.source, o.sourceId])).rows;
  for (const m of rows) await addMove(c, { item: m.item_id, store: m.store_id, qty: neg(m.qty), value: -m.value, date: o.date, source: o.source, sourceId: o.sourceId, journal: o.journal, note: 'reversal' });
}
export async function updateLastCost(c: PoolClient, item: string, qty: string, value: number) {
  await c.query('update items set last_cost = round($3::numeric / $2::numeric, 6) where id=$1 and $2::numeric > 0', [item, qty, value]);
}
