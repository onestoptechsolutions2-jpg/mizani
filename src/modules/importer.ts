import { PoolClient } from 'pg';
import { bad, q1 } from '../db';
import { Ctx } from '../ledger';
import { openingStock } from './inventory';

// Minimal RFC 4180 parser: quoted fields, escaped quotes, commas and newlines inside quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], f = '', q = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else f += ch;
  }
  row.push(f); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const ALIASES: Record<string, string[]> = {
  name: ['name', 'item', 'item name', 'product', 'product name', 'description', 'customer', 'supplier', 'customer name', 'supplier name', 'full name'],
  price: ['price', 'selling price', 'sale price', 'unit price', 'retail price', 'sell price'],
  cost: ['cost', 'buying price', 'cost price', 'purchase price', 'unit cost', 'avg cost', 'average cost'],
  unit: ['unit', 'uom', 'unit of measure', 'units'],
  category: ['category', 'group', 'department'],
  barcode: ['barcode', 'sku', 'code', 'item code', 'product code'],
  qty: ['qty', 'quantity', 'opening stock', 'stock', 'on hand', 'balance'],
  store: ['store', 'location', 'warehouse', 'department store'],
  vat: ['vat', 'vat rate', 'tax', 'tax rate', 'vat %'],
  sellable: ['sellable', 'sold', 'for sale', 'sell'],
  stocked: ['stocked', 'track stock', 'tracked', 'inventory item'],
  kind: ['kind', 'type', 'party type'],
  phone: ['phone', 'telephone', 'mobile', 'tel', 'phone number', 'contact'],
  credit_limit: ['credit limit', 'limit', 'credit'],
};
function table(csv: string) {
  const rows = parseCsv(csv || '');
  if (rows.length < 2) throw bad('The file needs a header row and at least one data row');
  const head = rows[0].map(norm);
  const col: Record<string, number> = {};
  for (const [k, al] of Object.entries(ALIASES)) { const i = head.findIndex((h) => al.includes(h)); if (i >= 0) col[k] = i; }
  return { col, data: rows.slice(1), head: rows[0] };
}
const yes = (v?: string) => /^(y|yes|true|1|x)$/i.test((v || '').trim());
const money = (v?: string) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const get = (r: string[], col: Record<string, number>, k: string) => (col[k] == null ? undefined : (r[col[k]] ?? '').trim());

type Result = { dry_run: boolean; created: number; skipped: number; errors: { row: number; message: string }[]; columns_recognised: string[]; columns_ignored: string[] };
const wrap = (t: ReturnType<typeof table>, dry: boolean): Result => ({ dry_run: dry, created: 0, skipped: 0, errors: [], columns_recognised: Object.keys(t.col), columns_ignored: t.head.filter((_, i) => !Object.values(t.col).includes(i)) });

export async function importItems(x: Ctx, b: any): Promise<Result> {
  const { c } = x; const t = table(b.csv); const res = wrap(t, b.dry_run !== false);
  if (t.col.name == null) throw bad('No column that looks like an item name (name, item, product…)');
  const stores = new Map((await c.query('select id, lower(name) n from stores')).rows.map((r: any) => [r.n, r.id]));
  const defStore = b.default_store_id || null;
  const accts = new Map((await c.query('select code, id from accounts')).rows.map((r: any) => [r.code, r.id]));
  const seen = new Set<string>();
  for (let i = 0; i < t.data.length; i++) {
    const r = t.data[i], line = i + 2, name = get(r, t.col, 'name');
    if (!name) { res.errors.push({ row: line, message: 'Name is empty' }); continue; }
    const blank = (v?: string) => v === undefined || v === '';
    const price = blank(get(r, t.col, 'price')) ? 0 : money(get(r, t.col, 'price')), cost = blank(get(r, t.col, 'cost')) ? 0 : money(get(r, t.col, 'cost'));
    if (Number.isNaN(price) || price < 0) { res.errors.push({ row: line, message: `Price "${get(r, t.col, 'price')}" is not a number` }); continue; }
    if (Number.isNaN(cost) || cost < 0) { res.errors.push({ row: line, message: `Cost "${get(r, t.col, 'cost')}" is not a number` }); continue; }
    const barcode = get(r, t.col, 'barcode') || null;
    const key = (barcode || name).toLowerCase();
    if (seen.has(key)) { res.skipped++; continue; } seen.add(key);
    if (await q1(c, 'select 1 from items where lower(name)=lower($1) or ($2::text is not null and barcode=$2)', [name, barcode])) { res.skipped++; continue; }
    const sellable = t.col.sellable == null ? price > 0 : yes(get(r, t.col, 'sellable'));
    const stocked = t.col.stocked != null ? yes(get(r, t.col, 'stocked')) : (!!get(r, t.col, 'qty') || !!get(r, t.col, 'cost'));
    const storeName = (get(r, t.col, 'store') || '').toLowerCase();
    const store = (storeName && stores.get(storeName)) || defStore;
    if (stocked && !store) { res.errors.push({ row: line, message: `Tracked item "${name}" needs a store (column "store" or a default store)` }); continue; }
    const vatRaw = get(r, t.col, 'vat'); const vat = vatRaw ? Math.round(parseFloat(vatRaw.replace('%', '')) * 100) : 1600;
    if (!Number.isFinite(vat) || vat < 0) { res.errors.push({ row: line, message: `VAT "${vatRaw}" is not a number` }); continue; }
    if (!res.dry_run) await c.query(`insert into items(name, base_unit, is_sellable, is_stocked, sell_price, tax_rate_bp, revenue_account_id, cogs_account_id, production_store_id, category, barcode, last_cost)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [name, get(r, t.col, 'unit') || 'each', sellable, stocked, price, vat, accts.get('4000'), accts.get('5000'), stocked ? store : null, get(r, t.col, 'category') || null, barcode, cost]);
    res.created++;
  }
  return res;
}
export async function importParties(x: Ctx, b: any): Promise<Result> {
  const { c } = x; const t = table(b.csv); const res = wrap(t, b.dry_run !== false);
  if (t.col.name == null) throw bad('No column that looks like a name');
  for (let i = 0; i < t.data.length; i++) {
    const r = t.data[i], line = i + 2, name = get(r, t.col, 'name');
    const kind = (get(r, t.col, 'kind') || b.default_kind || 'customer').toLowerCase();
    if (!name) { res.errors.push({ row: line, message: 'Name is empty' }); continue; }
    if (!['customer', 'supplier', 'staff'].includes(kind)) { res.errors.push({ row: line, message: `Type "${kind}" must be customer, supplier or staff` }); continue; }
    const limit = !get(r, t.col, 'credit_limit') ? 0 : money(get(r, t.col, 'credit_limit'));
    if (Number.isNaN(limit) || limit < 0) { res.errors.push({ row: line, message: 'Credit limit is not a number' }); continue; }
    if (await q1(c, 'select 1 from parties where lower(name)=lower($1) and kind=$2', [name, kind])) { res.skipped++; continue; }
    if (!res.dry_run) await c.query('insert into parties(kind, name, phone, credit_limit) values ($1,$2,$3,$4)', [kind, name, get(r, t.col, 'phone') || null, limit]);
    res.created++;
  }
  return res;
}
export async function importOpeningStock(x: Ctx, b: any): Promise<Result> {
  const { c } = x; const t = table(b.csv); const res = wrap(t, b.dry_run !== false);
  if ((t.col.name == null && t.col.barcode == null) || t.col.qty == null) throw bad('The file needs an item (name or barcode) column and a quantity column');
  const lines: any[] = [];
  for (let i = 0; i < t.data.length; i++) {
    const r = t.data[i], line = i + 2;
    const it = await q1(c, 'select * from items where is_stocked and (lower(name)=lower($1) or ($2::text is not null and barcode=$2))', [get(r, t.col, 'name') || '', get(r, t.col, 'barcode') || null]);
    if (!it) { res.errors.push({ row: line, message: `No tracked item matches "${get(r, t.col, 'name') || get(r, t.col, 'barcode')}". Import items first.` }); continue; }
    const storeName = (get(r, t.col, 'store') || '').toLowerCase();
    const store = storeName ? (await q1(c, 'select id from stores where lower(name)=$1', [storeName]))?.id : (b.default_store_id || it.production_store_id);
    if (!store) { res.errors.push({ row: line, message: 'Unknown store' }); continue; }
    const qtyS = get(r, t.col, 'qty') || '';
    if (!/^\d+(\.\d{1,6})?$/.test(qtyS.replace(/,/g, ''))) { res.errors.push({ row: line, message: `Quantity "${qtyS}" must be a positive number with at most 6 decimals` }); continue; }
    const cost = get(r, t.col, 'cost') ? money(get(r, t.col, 'cost')) : Math.round(Number(it.last_cost));
    if (Number.isNaN(cost) || cost < 0) { res.errors.push({ row: line, message: 'Unit cost is not a number' }); continue; }
    if (Number(qtyS) === 0) { res.skipped++; continue; }
    lines.push({ item_id: it.id, store_id: store, qty: qtyS.replace(/,/g, ''), unit_cost: cost }); res.created++;
  }
  if (!res.dry_run && lines.length && !res.errors.length) await openingStock(x, { lines, date: b.date });
  else if (!res.dry_run && res.errors.length) { res.created = 0; res.errors.push({ row: 0, message: 'Nothing was imported because some rows have errors. Fix them and try again.' }); }
  return res;
}
