import { PoolClient } from 'pg';
import { bad, conflict, q1, qa } from './db';

export interface JLine {
  acct: string | number;        // account code ('1110') or id
  dr?: number;
  cr?: number;
  store?: string | null;
  dept?: string | null;
  party?: string | null;
  outlet?: string | null;
}
export interface Ctx { c: PoolClient; userId: string; role: string; }

export async function accountMap(c: PoolClient, codes: (string | number)[]) {
  const strs = [...new Set(codes.filter((x) => typeof x === 'string'))] as string[];
  const ids = [...new Set(codes.filter((x) => typeof x === 'number'))] as number[];
  const rows = await qa(c, 'select id, code, type from accounts where code = any($1) or id = any($2)', [strs, ids]);
  const m = new Map<string | number, { id: number; type: string; code: string }>();
  for (const r of rows) { m.set(r.code, r); m.set(r.id, r); }
  for (const x of codes) if (!m.has(x)) throw bad(`Unknown account ${x}`);
  return m;
}

// The only function that writes journals. Balance is also enforced by a deferred DB trigger.
export async function postJournal(c: PoolClient, o: {
  date: string; source: string; sourceId?: string | null; memo?: string; by?: string | null;
  lines: JLine[]; reverses?: string | null; key?: string | null;
}): Promise<string | null> {
  const lines = o.lines.filter((l) => (l.dr || 0) > 0 || (l.cr || 0) > 0);
  if (!lines.length) return null;
  const dr = lines.reduce((s, l) => s + (l.dr || 0), 0), cr = lines.reduce((s, l) => s + (l.cr || 0), 0);
  if (dr !== cr) throw conflict(`Refusing to post unbalanced journal (debits ${dr}, credits ${cr})`);
  const map = await accountMap(c, lines.map((l) => l.acct));
  const j = await q1(c,
    'insert into journals(business_date, source_type, source_id, memo, created_by, reverses_id, idempotency_key) values ($1,$2,$3,$4,$5,$6,$7) returning id',
    [o.date, o.source, o.sourceId ?? null, o.memo ?? null, o.by ?? null, o.reverses ?? null, o.key ?? null]);
  const vals: any[] = [], ph: string[] = [];
  lines.forEach((l, i) => {
    const b = i * 8;
    ph.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`);
    vals.push(j.id, map.get(l.acct)!.id, l.dr || 0, l.cr || 0, l.store ?? null, l.dept ?? null, l.party ?? null, l.outlet ?? null);
  });
  await c.query(`insert into journal_lines(journal_id, account_id, debit, credit, store_id, department, party_id, outlet_id) values ${ph.join(',')}`, vals);
  return j.id;
}

// Reverse a journal by swapping debits and credits (append-only correction).
export async function reverseJournal(c: PoolClient, origId: string, o: {
  date: string; source: string; sourceId?: string | null; memo?: string; by?: string | null;
  skip?: (l: any) => boolean; extra?: JLine[];
}) {
  const rows = await qa(c, `select l.*, a.code, a.type from journal_lines l join accounts a on a.id=l.account_id where l.journal_id=$1`, [origId]);
  const lines: JLine[] = rows.filter((l) => !(o.skip && o.skip(l))).map((l) => ({
    acct: l.account_id, dr: l.credit, cr: l.debit, store: l.store_id, dept: l.department, party: l.party_id, outlet: l.outlet_id,
  }));
  return postJournal(c, { date: o.date, source: o.source, sourceId: o.sourceId, memo: o.memo ?? 'reversal', by: o.by, reverses: origId, lines: [...lines, ...(o.extra || [])] });
}

export async function balanceOf(c: PoolClient, code: string, partyId?: string): Promise<number> {
  const r = await q1(c, `select coalesce(sum(l.debit-l.credit),0)::bigint b from journal_lines l join accounts a on a.id=l.account_id
    where a.code=$1 and ($2::uuid is null or l.party_id=$2)`, [code, partyId ?? null]);
  return r.b;
}

export const METHOD_ACCT: Record<string, string> = { cash: '1000', mpesa: '1010', card: '1020', bank: '1030' };

export async function businessDate(c: PoolClient): Promise<string> {
  const open = await q1(c, "select business_date from business_days where status='open' order by business_date desc limit 1");
  if (open) return open.business_date;
  const n = await q1(c, 'select greatest(current_date, coalesce((select max(business_date)+1 from business_days), current_date))::text d');
  await c.query("insert into business_days(business_date) values ($1)", [n.d]);
  return n.d;
}

export async function setting(c: PoolClient, key: string, def = ''): Promise<string> {
  const r = await q1(c, 'select value from settings where key=$1', [key]);
  return r ? r.value : def;
}
export const BILL_BAL = (b: string) => `(
    coalesce((select sum(payable) from bill_lines l where l.bill_id=${b}.id and l.status='active'),0)
  + coalesce((select sum(amount) from bill_charges c where c.bill_id=${b}.id and c.status='active'),0)
  - coalesce((select sum(amount) from payments p where p.bill_id=${b}.id),0)
  + coalesce((select sum(amount) from refunds r where r.bill_id=${b}.id),0)
  - coalesce((select sum(amount) from bill_dispositions d where d.bill_id=${b}.id),0))`;
