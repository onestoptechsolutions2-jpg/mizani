import { PoolClient } from 'pg';
import { conflict, notFound, q1, qa } from '../db';
import { setting } from '../ledger';
import { billBalance } from './sales';

const kes = (c: number) => (c / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const W = 42; // characters on an 80 mm thermal printer
const center = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
const row = (l: string, r: string) => (l.length + r.length >= W ? l.slice(0, W - r.length - 1) + ' ' + r : l + ' '.repeat(W - l.length - r.length) + r);
const rule = (ch = '-') => ch.repeat(W);

export async function receiptData(c: PoolClient, billId: string) {
  const b = await q1(c, 'select b.*, p.name customer_name from bills b left join parties p on p.id=b.customer_id where b.id=$1', [billId]);
  if (!b) throw notFound('Bill not found');
  const lines = await qa(c, "select l.qty::text, l.unit_price, l.discount, l.payable, l.tax, l.levy, i.name from bill_lines l join items i on i.id=l.item_id where l.bill_id=$1 and l.status='active' order by l.created_at", [billId]);
  const charges = await qa(c, "select kind, amount from bill_charges where bill_id=$1 and status='active'", [billId]);
  const payments = await qa(c, 'select method, amount, tip from payments where bill_id=$1 order by created_at', [billId]);
  const seller = await q1(c, 'select name from users where id=$1', [b.closed_by || b.opened_by]);
  return {
    business: { name: await setting(c, 'business_name', 'Receipt'), address: await setting(c, 'business_address', ''), phone: await setting(c, 'business_phone', ''), kra_pin: await setting(c, 'kra_pin', ''), footer: await setting(c, 'receipt_footer', 'Thank you. Come again.') },
    number: b.number, date: b.business_date, table: b.table_name, customer: b.customer_name, served_by: seller?.name, status: b.status,
    lines, charges, payments,
    totals: { items: lines.reduce((s: number, l: any) => s + l.payable, 0), charges: charges.reduce((s: number, l: any) => s + l.amount, 0), vat: lines.reduce((s: number, l: any) => s + l.tax, 0), levy: lines.reduce((s: number, l: any) => s + l.levy, 0), discount: lines.reduce((s: number, l: any) => s + l.discount, 0), paid: payments.reduce((s: number, p: any) => s + p.amount, 0), tips: payments.reduce((s: number, p: any) => s + p.tip, 0) },
    balance: await billBalance(c, billId),
  };
}
export function receiptText(d: any): string {
  const o: string[] = [];
  o.push(center(d.business.name)); if (d.business.address) o.push(center(d.business.address)); if (d.business.phone) o.push(center('Tel ' + d.business.phone)); if (d.business.kra_pin) o.push(center('PIN ' + d.business.kra_pin));
  o.push(rule('='), row('Bill ' + d.number, d.date)); if (d.table) o.push('Table: ' + d.table); if (d.customer) o.push('Customer: ' + d.customer); if (d.served_by) o.push('Served by: ' + d.served_by);
  o.push(rule());
  for (const l of d.lines) { o.push(l.name.slice(0, W)); o.push(row(`  ${Number(l.qty)} x ${kes(l.unit_price)}`, kes(l.payable + l.discount))); if (l.discount) o.push(row('  Discount', '-' + kes(l.discount))); }
  for (const ch of d.charges) o.push(row('Service charge', kes(ch.amount)));
  o.push(rule(), row('TOTAL', kes(d.totals.items + d.totals.charges)));
  if (d.totals.vat) o.push(row('  incl. VAT', kes(d.totals.vat))); if (d.totals.levy) o.push(row('  incl. tourism levy', kes(d.totals.levy)));
  for (const p of d.payments) o.push(row('Paid ' + p.method, kes(p.amount)));
  if (d.totals.tips) o.push(row('Tip', kes(d.totals.tips)));
  o.push(row('BALANCE', kes(d.balance)), rule('='), center(d.business.footer), center('Powered by Mizani'));
  return o.join('\n') + '\n';
}
// ESC/POS: initialise, text, feed, partial cut. Send these bytes to the printer (TCP 9100 or USB).
export function escpos(text: string, opts: { cut?: boolean; drawer?: boolean } = {}): Buffer {
  const ascii = Buffer.from(text.replace(/[^\x09\x0a\x20-\x7e]/g, '?'), 'latin1');
  return Buffer.concat([Buffer.from([0x1b, 0x40]), ascii, Buffer.from('\n\n\n'), opts.drawer ? Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]) : Buffer.alloc(0), opts.cut === false ? Buffer.alloc(0) : Buffer.from([0x1d, 0x56, 0x42, 0x00])]);
}

// Kitchen order ticket: only the lines not yet sent. Marking them sent means a reprint never duplicates an order.
export async function kot(c: PoolClient, billId: string, mark: boolean) {
  const b = await q1(c, 'select * from bills where id=$1', [billId]);
  if (!b) throw notFound('Bill not found');
  if (b.status !== 'open') throw conflict('Only open bills have kitchen tickets');
  const lines = await qa(c, "select l.id, l.qty::text, i.name from bill_lines l join items i on i.id=l.item_id where l.bill_id=$1 and l.status='active' and l.kot_sent_at is null order by l.created_at", [billId]);
  const o = [center('*** KITCHEN ORDER ***'), rule('='), row('Bill ' + b.number, new Date().toISOString().slice(11, 16)), 'Table: ' + (b.table_name || '-'), rule()];
  for (const l of lines) o.push(`${Number(l.qty)} x ${l.name}`.slice(0, W));
  o.push(rule());
  if (mark && lines.length) await c.query('update bill_lines set kot_sent_at=now() where id = any($1)', [lines.map((l: any) => l.id)]);
  return { bill: b.number, lines: lines.length, text: o.join('\n') + '\n' };
}
