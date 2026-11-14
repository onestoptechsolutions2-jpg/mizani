"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listOrders = exports.listPriceLists = exports.listPromotions = void 0;
exports.itemByBarcode = itemByBarcode;
exports.lowStock = lowStock;
exports.createPromotion = createPromotion;
exports.togglePromotion = togglePromotion;
exports.createPriceList = createPriceList;
exports.setListPrice = setListPrice;
exports.assignPriceList = assignPriceList;
exports.statement = statement;
exports.ageing = ageing;
exports.createOrder = createOrder;
exports.deliverOrder = deliverOrder;
exports.cancelOrder = cancelOrder;
const db_1 = require("../db");
const sales_1 = require("./sales");
// ----------------------------------------------------------------- retail ----
async function itemByBarcode(c, code) {
    const i = await (0, db_1.q1)(c, 'select id, name, sell_price, base_unit, barcode from items where barcode=$1 and active and is_sellable', [code]);
    if (!i)
        throw (0, db_1.notFound)('No sellable item has that barcode');
    return i;
}
async function lowStock(c) {
    return (0, db_1.qa)(c, `select i.id, i.name, i.base_unit, i.reorder_level::text, coalesce(sum(b.qty),0)::text on_hand
    from items i left join stock_balances b on b.item_id=i.id where i.is_stocked and i.active and i.reorder_level > 0
    group by i.id having coalesce(sum(b.qty),0) <= i.reorder_level order by i.name`);
}
async function createPromotion(c, b) {
    const bp = Number(b.percent_bp);
    if (!b.name || !Number.isInteger(bp) || bp < 1 || bp > 10000)
        throw (0, db_1.bad)('A name and a percentage (in basis points, 1000 = 10%) are required');
    return (0, db_1.q1)(c, 'insert into promotions(name, item_id, percent_bp, starts, ends) values ($1,$2,$3,$4,$5) returning *', [b.name, b.item_id ?? null, bp, b.starts ?? null, b.ends ?? null]);
}
const listPromotions = (c) => (0, db_1.qa)(c, 'select p.*, i.name item from promotions p left join items i on i.id=p.item_id order by p.created_at desc');
exports.listPromotions = listPromotions;
async function togglePromotion(c, id, active) {
    const r = await c.query('update promotions set active=$2 where id=$1', [id, active]);
    if (!r.rowCount)
        throw (0, db_1.notFound)('Promotion not found');
    return { ok: true };
}
// -------------------------------------------------------------- wholesale ----
async function createPriceList(c, name) {
    if (!name)
        throw (0, db_1.bad)('Name is required');
    return (0, db_1.q1)(c, 'insert into price_lists(name) values ($1) returning *', [name]);
}
const listPriceLists = (c) => (0, db_1.qa)(c, `select l.id, l.name, (select count(*)::int from price_list_items i where i.price_list_id=l.id) items,
  (select count(*)::int from parties p where p.price_list_id=l.id) customers from price_lists l order by l.name`);
exports.listPriceLists = listPriceLists;
async function setListPrice(c, id, b) {
    if (!(await (0, db_1.q1)(c, 'select 1 from price_lists where id=$1', [id])))
        throw (0, db_1.notFound)('Price list not found');
    await c.query('insert into price_list_items(price_list_id, item_id, price) values ($1,$2,$3) on conflict (price_list_id, item_id) do update set price=excluded.price', [id, b.item_id, (0, db_1.cents)(b.price, 'price', true)]);
    return { ok: true };
}
async function assignPriceList(c, customerId, b) {
    const p = await (0, db_1.q1)(c, "select 1 from parties where id=$1 and kind='customer'", [customerId]);
    if (!p)
        throw (0, db_1.notFound)('Customer not found');
    const terms = b.terms_days != null ? Number(b.terms_days) : null;
    if (terms != null && (!Number.isInteger(terms) || terms < 0 || terms > 365))
        throw (0, db_1.bad)('terms_days must be 0 to 365');
    await c.query('update parties set price_list_id=$2, terms_days=coalesce($3, terms_days) where id=$1', [customerId, b.price_list_id || null, terms]);
    return { ok: true };
}
async function statement(c, customerId) {
    const p = await (0, db_1.q1)(c, "select id, name, credit_limit, terms_days from parties where id=$1 and kind='customer'", [customerId]);
    if (!p)
        throw (0, db_1.notFound)('Customer not found');
    const rows = await (0, db_1.qa)(c, `select j.business_date::text date, j.source_type, j.memo, l.debit, l.credit from journal_lines l
    join journals j on j.id=l.journal_id join accounts a on a.id=l.account_id where a.code='1100' and l.party_id=$1 order by j.seq, l.id`, [customerId]);
    let run = 0;
    const lines = rows.map((r) => { run += r.debit - r.credit; return { ...r, balance: run }; });
    return { customer: p, lines, balance: run };
}
// Ageing: receipts are matched to the oldest credit sales first.
async function ageing(c, asOf) {
    const date = asOf || (await (0, db_1.q1)(c, 'select current_date::text d')).d;
    const rows = await (0, db_1.qa)(c, `select l.party_id, p.name, p.terms_days, j.business_date::text date, l.debit, l.credit from journal_lines l
    join journals j on j.id=l.journal_id join accounts a on a.id=l.account_id join parties p on p.id=l.party_id
    where a.code='1100' and j.business_date <= $1::date order by l.party_id, j.business_date, j.seq`, [date]);
    const by = new Map();
    for (const r of rows) {
        const e = by.get(r.party_id) || { name: r.name, terms: r.terms_days, debits: [], credits: 0 };
        if (r.debit)
            e.debits.push({ date: r.date, amt: r.debit });
        e.credits += r.credit;
        by.set(r.party_id, e);
    }
    const out = [];
    const asOfMs = Date.parse(date);
    for (const [id, e] of by) {
        let credit = e.credits;
        const b = { current: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
        for (const d of e.debits) {
            const used = Math.min(credit, d.amt);
            credit -= used;
            const open = d.amt - used;
            if (!open)
                continue;
            const age = Math.floor((asOfMs - Date.parse(d.date)) / 86400000);
            if (age <= 30)
                b.current += open;
            else if (age <= 60)
                b.d31_60 += open;
            else if (age <= 90)
                b.d61_90 += open;
            else
                b.d90_plus += open;
        }
        const total = b.current + b.d31_60 + b.d61_90 + b.d90_plus;
        if (total > 0)
            out.push({ customer_id: id, name: e.name, terms_days: e.terms, ...b, total });
    }
    return { as_at: date, customers: out.sort((a, b) => b.total - a.total), total: out.reduce((s, r) => s + r.total, 0) };
}
// ----------------------------------------------------------------- orders ----
async function createOrder(x, b) {
    const { c } = x;
    if (!(await (0, db_1.q1)(c, "select 1 from parties where id=$1 and kind='customer'", [b.customer_id])))
        throw (0, db_1.bad)('Choose a customer');
    if (!Array.isArray(b.lines) || !b.lines.length)
        throw (0, db_1.bad)('Add at least one line');
    const lines = [];
    for (const l of b.lines) {
        if (!(await (0, db_1.q1)(c, 'select 1 from items where id=$1 and is_sellable', [l.item_id])))
            throw (0, db_1.bad)('Unknown item on the order');
        lines.push({ item_id: l.item_id, qty: (0, db_1.qty)(l.qty) });
    }
    const n = await (0, db_1.q1)(c, "select 'SO' || lpad(nextval('order_seq')::text, 5, '0') n");
    return (0, db_1.q1)(c, 'insert into sales_orders(number, customer_id, lines, created_by) values ($1,$2,$3,$4) returning id, number, status', [n.n, b.customer_id, JSON.stringify(lines), x.userId]);
}
// Delivery = the stock leaves and the invoice (a credit sale at the customer's price list) is raised, in one step.
async function deliverOrder(x, id, b) {
    const { c } = x;
    const o = await (0, db_1.q1)(c, 'select * from sales_orders where id=$1 for update', [id]);
    if (!o)
        throw (0, db_1.notFound)('Order not found');
    if (o.status !== 'open')
        throw (0, db_1.conflict)(`This order is ${o.status}`);
    const bill = await (0, sales_1.openBill)(x, { customer_id: o.customer_id, table_name: o.number });
    for (const l of o.lines)
        await (0, sales_1.addLine)(x, bill.id, { item_id: l.item_id, qty: l.qty });
    const closed = await (0, sales_1.closeBill)(x, bill.id, { disposition: 'credit', customer_id: o.customer_id, approver: b.approver });
    await c.query("update sales_orders set status='delivered', bill_id=$2 where id=$1", [id, bill.id]);
    return { bill_id: bill.id, invoice: bill.number, ...closed };
}
async function cancelOrder(c, id) {
    const r = await c.query("update sales_orders set status='cancelled' where id=$1 and status='open'", [id]);
    if (!r.rowCount)
        throw (0, db_1.conflict)('Only open orders can be cancelled');
    return { ok: true };
}
const listOrders = (c) => (0, db_1.qa)(c, 'select o.id, o.number, o.status, o.bill_id, p.name customer, jsonb_array_length(o.lines)::int lines, o.created_at from sales_orders o join parties p on p.id=o.customer_id order by o.created_at desc limit 200');
exports.listOrders = listOrders;
