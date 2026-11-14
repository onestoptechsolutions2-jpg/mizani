"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPurchase = createPurchase;
exports.payPurchase = payPurchase;
exports.listPurchases = listPurchases;
exports.returnPurchase = returnPurchase;
const crypto_1 = require("crypto");
const db_1 = require("../db");
const ledger_1 = require("../ledger");
const stock_1 = require("../stock");
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
// One price per line. The payable is derived from the lines, so the payable and the
// inventory debit can never disagree. Non-stock lines post to an expense or asset account.
async function createPurchase(x, b) {
    const { c } = x;
    if (!isDate(b.delivery_date))
        throw (0, db_1.bad)('delivery_date (YYYY-MM-DD) is required: it is the date the goods arrived');
    const sup = await (0, db_1.q1)(c, "select * from parties where id=$1 and kind='supplier'", [b.supplier_id]);
    if (!sup)
        throw (0, db_1.bad)('Unknown supplier');
    const store = await (0, db_1.q1)(c, 'select * from stores where id=$1', [b.store_id]);
    if (!store)
        throw (0, db_1.bad)('Unknown store');
    if (!Array.isArray(b.lines) || !b.lines.length)
        throw (0, db_1.bad)('A purchase needs at least one line');
    const id = (0, crypto_1.randomUUID)();
    const jl = [];
    const stockIn = [];
    const rows = [];
    let total = 0;
    for (const l of b.lines) {
        const type = l.type || 'stock';
        const rate = l.tax_rate_bp == null ? 0 : Number(l.tax_rate_bp);
        if (!Number.isInteger(rate) || rate < 0)
            throw (0, db_1.bad)('tax_rate_bp must be a whole number of basis points');
        const claimable = l.vat_claimable !== false;
        let net, q, unitPrice, unit = null, factor = '1', acct = null, item = null, desc = l.description ?? null;
        if (type === 'stock') {
            item = await (0, db_1.q1)(c, 'select * from items where id=$1 and is_stocked', [l.item_id]);
            if (!item)
                throw (0, db_1.bad)('Stock line needs a stocked item');
            q = (0, db_1.qty)(l.qty);
            unitPrice = (0, db_1.cents)(l.unit_price, 'unit_price', true);
            unit = l.unit || item.base_unit;
            if (unit !== item.base_unit) {
                const u = await (0, db_1.q1)(c, 'select factor::text f from item_units where item_id=$1 and unit=$2', [item.id, unit]);
                if (!u)
                    throw (0, db_1.bad)(`Item ${item.name} has no unit "${unit}"`);
                factor = u.f;
            }
            net = (await (0, db_1.q1)(c, 'select round($1::numeric * $2::bigint)::bigint n', [q, unitPrice])).n;
        }
        else {
            const a = await (0, db_1.q1)(c, 'select * from accounts where code=$1', [l.account]);
            if (!a)
                throw (0, db_1.bad)('Expense and asset lines need a valid account code');
            if (type === 'expense' && !['expense', 'cost_of_sales'].includes(a.type))
                throw (0, db_1.bad)('Account must be an expense account');
            if (type === 'asset' && a.type !== 'asset')
                throw (0, db_1.bad)('Account must be an asset account');
            if (type !== 'expense' && type !== 'asset')
                throw (0, db_1.bad)('Line type must be stock, expense or asset');
            net = (0, db_1.cents)(l.amount, 'amount');
            unitPrice = net;
            q = '1';
            acct = a.code;
        }
        const tax = Math.round((net * rate) / 10000);
        const debitMain = net + (claimable ? 0 : tax);
        total += net + tax;
        if (type === 'stock') {
            const qBase = (await (0, db_1.q1)(c, 'select round($1::numeric * $2::numeric, 6)::text n', [q, factor])).n;
            jl.push({ acct: '1200', dr: debitMain, store: store.id });
            stockIn.push({ item: item.id, qty: qBase, value: debitMain });
        }
        else
            jl.push({ acct: acct, dr: debitMain });
        if (claimable)
            jl.push({ acct: '1400', dr: tax });
        rows.push({ type, item: item?.id ?? null, acct, desc, q, unit, factor, unitPrice, rate, net, tax, claimable });
    }
    jl.push({ acct: '2000', cr: total, party: sup.id });
    const jid = await (0, ledger_1.postJournal)(c, { date: b.delivery_date, source: 'purchase', sourceId: id, by: x.userId, memo: `purchase from ${sup.name}`, lines: jl });
    const late = (await (0, db_1.q1)(c, 'select (current_date - $1::date) > 2 late', [b.delivery_date])).late;
    const num = await (0, db_1.q1)(c, "select 'P' || lpad(nextval('purchase_seq')::text, 6, '0') n");
    await c.query(`insert into purchases(id, number, supplier_id, store_id, delivery_date, late_entry, reference, total, journal_id, created_by)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, num.n, sup.id, store.id, b.delivery_date, late, b.reference ?? null, total, jid, x.userId]);
    for (const r of rows) {
        await c.query(`insert into purchase_lines(purchase_id, line_type, item_id, account_id, description, qty, unit, factor, unit_price, tax_rate_bp, line_net, line_tax, vat_claimable)
      values ($1,$2,$3,(select id from accounts where code=$4),$5,$6::numeric,$7,$8::numeric,$9,$10,$11,$12,$13)`, [id, r.type, r.item, r.acct, r.desc, r.q, r.unit, r.factor, r.unitPrice, r.rate, r.net, r.tax, r.claimable]);
    }
    for (const s of stockIn) {
        await (0, stock_1.addMove)(c, { item: s.item, store: store.id, qty: s.qty, value: s.value, date: b.delivery_date, source: 'purchase', sourceId: id, journal: jid });
        await (0, stock_1.updateLastCost)(c, s.item, s.qty, s.value);
    }
    return { id, number: num.n, total, late_entry: late };
}
async function payPurchase(x, id, b) {
    const { c } = x;
    const p = await (0, db_1.q1)(c, 'select * from purchases where id=$1 for update', [id]);
    if (!p)
        throw (0, db_1.notFound)('Purchase not found');
    if (!ledger_1.METHOD_ACCT[b.method])
        throw (0, db_1.bad)('A payment method is required (cash, mpesa, card or bank)');
    const amount = (0, db_1.cents)(b.amount);
    if (amount > p.total - p.paid - p.returned)
        throw (0, db_1.conflict)(`Only ${p.total - p.paid - p.returned} is still owed on ${p.number}`);
    const bd = (await (0, db_1.q1)(c, 'select business_date from business_days where status=\'open\' order by business_date desc limit 1'))?.business_date
        ?? (await (0, db_1.q1)(c, 'select current_date::text d')).d;
    const sid = (0, crypto_1.randomUUID)();
    const jid = await (0, ledger_1.postJournal)(c, { date: bd, source: 'supplier_payment', sourceId: sid, by: x.userId, memo: `pay ${p.number}`,
        lines: [{ acct: '2000', dr: amount, party: p.supplier_id }, { acct: ledger_1.METHOD_ACCT[b.method], cr: amount }] });
    await c.query('insert into supplier_payments(id, purchase_id, method, amount, reference, journal_id, created_by) values ($1,$2,$3,$4,$5,$6,$7)', [sid, id, b.method, amount, b.reference ?? null, jid, x.userId]);
    await c.query('update purchases set paid = paid + $2 where id=$1', [id, amount]);
    return { paid: p.paid + amount, outstanding: p.total - p.paid - p.returned - amount };
}
async function listPurchases(c) {
    return (0, db_1.qa)(c, `select p.id, p.number, s.name supplier, p.delivery_date, p.entry_date, p.late_entry, p.total, p.paid, p.returned, (p.total - p.paid - p.returned)::bigint outstanding
    from purchases p join parties s on s.id=p.supplier_id order by p.created_at desc limit 200`);
}
// Return stock to a supplier: Dr supplier (they owe us / we owe less), Cr Inventory and VAT input at the ORIGINAL cost.
async function returnPurchase(x, id, b) {
    const { c } = x;
    const p = await (0, db_1.q1)(c, 'select * from purchases where id=$1 for update', [id]);
    if (!p)
        throw (0, db_1.notFound)('Purchase not found');
    if (!b.reason)
        throw (0, db_1.bad)('A reason is required');
    if (!Array.isArray(b.lines) || !b.lines.length)
        throw (0, db_1.bad)('Choose what to return');
    const jl = [], mv = [], rows = [];
    let total = 0;
    for (const l of b.lines) {
        const pl = await (0, db_1.q1)(c, "select * from purchase_lines where id=$1 and purchase_id=$2 and line_type='stock'", [l.purchase_line_id, id]);
        if (!pl)
            throw (0, db_1.bad)('Only stock lines of this purchase can be returned');
        const q = (0, db_1.qty)(l.qty);
        const done = (await (0, db_1.q1)(c, 'select coalesce(sum(qty),0)::text d from purchase_return_lines where purchase_line_id=$1', [pl.id])).d;
        const ok = (await (0, db_1.q1)(c, 'select ($1::numeric + $2::numeric) <= $3::numeric ok', [done, q, pl.qty])).ok;
        if (!ok)
            throw (0, db_1.conflict)(`Only ${(await (0, db_1.q1)(c, 'select ($1::numeric - $2::numeric)::text r', [pl.qty, done])).r} can still be returned`);
        const inv = (await (0, db_1.q1)(c, 'select round(($1::numeric + case when $4 then 0 else $2::numeric end) * $3::numeric / $5::numeric)::bigint v', [pl.line_net, pl.line_tax, q, pl.vat_claimable, pl.qty])).v;
        const tax = pl.vat_claimable ? (await (0, db_1.q1)(c, 'select round($1::numeric * $2::numeric / $3::numeric)::bigint t', [pl.line_tax, q, pl.qty])).t : 0;
        const base = (await (0, db_1.q1)(c, 'select round($1::numeric * $2::numeric, 6)::text q', [q, pl.factor])).q;
        total += inv + tax;
        jl.push({ acct: '1200', cr: inv, store: p.store_id }, { acct: '1400', cr: tax });
        mv.push({ item: pl.item_id, qty: base, value: inv });
        rows.push({ pl: pl.id, q, inv, tax });
    }
    jl.push({ acct: '2000', dr: total, party: p.supplier_id });
    const rid = (0, crypto_1.randomUUID)();
    const bd = await (0, ledger_1.businessDate)(c);
    const jid = await (0, ledger_1.postJournal)(c, { date: bd, source: 'purchase_return', sourceId: rid, by: x.userId, memo: `return to supplier: ${b.reason}`, lines: jl });
    await c.query('insert into purchase_returns(id, purchase_id, amount, reason, journal_id, created_by) values ($1,$2,$3,$4,$5,$6)', [rid, id, total, b.reason, jid, x.userId]);
    for (const r of rows)
        await c.query('insert into purchase_return_lines(return_id, purchase_line_id, qty, value, tax) values ($1,$2,$3::numeric,$4,$5)', [rid, r.pl, r.q, r.inv, r.tax]);
    for (const m of mv)
        await (0, stock_1.addMove)(c, { item: m.item, store: p.store_id, qty: (0, stock_1.neg)(m.qty), value: -m.value, date: bd, source: 'purchase_return', sourceId: rid, journal: jid });
    await c.query('update purchases set returned = returned + $2 where id=$1', [id, total]);
    return { return_id: rid, credit: total };
}
