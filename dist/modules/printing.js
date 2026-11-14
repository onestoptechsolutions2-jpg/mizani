"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.receiptData = receiptData;
exports.receiptText = receiptText;
exports.escpos = escpos;
exports.kot = kot;
const db_1 = require("../db");
const ledger_1 = require("../ledger");
const sales_1 = require("./sales");
const kes = (c) => (c / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const W = 42; // characters on an 80 mm thermal printer
const center = (s) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
const row = (l, r) => (l.length + r.length >= W ? l.slice(0, W - r.length - 1) + ' ' + r : l + ' '.repeat(W - l.length - r.length) + r);
const rule = (ch = '-') => ch.repeat(W);
async function receiptData(c, billId) {
    const b = await (0, db_1.q1)(c, 'select b.*, p.name customer_name from bills b left join parties p on p.id=b.customer_id where b.id=$1', [billId]);
    if (!b)
        throw (0, db_1.notFound)('Bill not found');
    const lines = await (0, db_1.qa)(c, "select l.qty::text, l.unit_price, l.discount, l.payable, l.tax, l.levy, i.name from bill_lines l join items i on i.id=l.item_id where l.bill_id=$1 and l.status='active' order by l.created_at", [billId]);
    const charges = await (0, db_1.qa)(c, "select kind, amount from bill_charges where bill_id=$1 and status='active'", [billId]);
    const payments = await (0, db_1.qa)(c, 'select method, amount, tip from payments where bill_id=$1 order by created_at', [billId]);
    const seller = await (0, db_1.q1)(c, 'select name from users where id=$1', [b.closed_by || b.opened_by]);
    return {
        business: { name: await (0, ledger_1.setting)(c, 'business_name', 'Receipt'), address: await (0, ledger_1.setting)(c, 'business_address', ''), phone: await (0, ledger_1.setting)(c, 'business_phone', ''), kra_pin: await (0, ledger_1.setting)(c, 'kra_pin', ''), footer: await (0, ledger_1.setting)(c, 'receipt_footer', 'Thank you. Come again.') },
        number: b.number, date: b.business_date, table: b.table_name, customer: b.customer_name, served_by: seller?.name, status: b.status,
        lines, charges, payments,
        totals: { items: lines.reduce((s, l) => s + l.payable, 0), charges: charges.reduce((s, l) => s + l.amount, 0), vat: lines.reduce((s, l) => s + l.tax, 0), levy: lines.reduce((s, l) => s + l.levy, 0), discount: lines.reduce((s, l) => s + l.discount, 0), paid: payments.reduce((s, p) => s + p.amount, 0), tips: payments.reduce((s, p) => s + p.tip, 0) },
        balance: await (0, sales_1.billBalance)(c, billId),
    };
}
function receiptText(d) {
    const o = [];
    o.push(center(d.business.name));
    if (d.business.address)
        o.push(center(d.business.address));
    if (d.business.phone)
        o.push(center('Tel ' + d.business.phone));
    if (d.business.kra_pin)
        o.push(center('PIN ' + d.business.kra_pin));
    o.push(rule('='), row('Bill ' + d.number, d.date));
    if (d.table)
        o.push('Table: ' + d.table);
    if (d.customer)
        o.push('Customer: ' + d.customer);
    if (d.served_by)
        o.push('Served by: ' + d.served_by);
    o.push(rule());
    for (const l of d.lines) {
        o.push(l.name.slice(0, W));
        o.push(row(`  ${Number(l.qty)} x ${kes(l.unit_price)}`, kes(l.payable + l.discount)));
        if (l.discount)
            o.push(row('  Discount', '-' + kes(l.discount)));
    }
    for (const ch of d.charges)
        o.push(row('Service charge', kes(ch.amount)));
    o.push(rule(), row('TOTAL', kes(d.totals.items + d.totals.charges)));
    if (d.totals.vat)
        o.push(row('  incl. VAT', kes(d.totals.vat)));
    if (d.totals.levy)
        o.push(row('  incl. tourism levy', kes(d.totals.levy)));
    for (const p of d.payments)
        o.push(row('Paid ' + p.method, kes(p.amount)));
    if (d.totals.tips)
        o.push(row('Tip', kes(d.totals.tips)));
    o.push(row('BALANCE', kes(d.balance)), rule('='), center(d.business.footer), center('Powered by Mizani'));
    return o.join('\n') + '\n';
}
// ESC/POS: initialise, text, feed, partial cut. Send these bytes to the printer (TCP 9100 or USB).
function escpos(text, opts = {}) {
    const ascii = Buffer.from(text.replace(/[^\x09\x0a\x20-\x7e]/g, '?'), 'latin1');
    return Buffer.concat([Buffer.from([0x1b, 0x40]), ascii, Buffer.from('\n\n\n'), opts.drawer ? Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]) : Buffer.alloc(0), opts.cut === false ? Buffer.alloc(0) : Buffer.from([0x1d, 0x56, 0x42, 0x00])]);
}
// Kitchen order ticket: only the lines not yet sent. Marking them sent means a reprint never duplicates an order.
async function kot(c, billId, mark) {
    const b = await (0, db_1.q1)(c, 'select * from bills where id=$1', [billId]);
    if (!b)
        throw (0, db_1.notFound)('Bill not found');
    if (b.status !== 'open')
        throw (0, db_1.conflict)('Only open bills have kitchen tickets');
    const lines = await (0, db_1.qa)(c, "select l.id, l.qty::text, i.name from bill_lines l join items i on i.id=l.item_id where l.bill_id=$1 and l.status='active' and l.kot_sent_at is null order by l.created_at", [billId]);
    const o = [center('*** KITCHEN ORDER ***'), rule('='), row('Bill ' + b.number, new Date().toISOString().slice(11, 16)), 'Table: ' + (b.table_name || '-'), rule()];
    for (const l of lines)
        o.push(`${Number(l.qty)} x ${l.name}`.slice(0, W));
    o.push(rule());
    if (mark && lines.length)
        await c.query('update bill_lines set kot_sent_at=now() where id = any($1)', [lines.map((l) => l.id)]);
    return { bill: b.number, lines: lines.length, text: o.join('\n') + '\n' };
}
