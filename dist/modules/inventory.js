"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transfer = transfer;
exports.consume = consume;
exports.openingStock = openingStock;
exports.createWastage = createWastage;
exports.approveWastage = approveWastage;
exports.rejectWastage = rejectWastage;
exports.startTake = startTake;
exports.getTake = getTake;
exports.saveCounts = saveCounts;
exports.submitTake = submitTake;
exports.approveTake = approveTake;
exports.rejectTake = rejectTake;
exports.stockReport = stockReport;
const crypto_1 = require("crypto");
const db_1 = require("../db");
const ledger_1 = require("../ledger");
const stock_1 = require("../stock");
// ---------------------------------------------------------------- transfers ---
async function transfer(x, b) {
    const { c } = x;
    if (b.from_store === b.to_store)
        throw (0, db_1.bad)('Choose two different stores');
    for (const s of [b.from_store, b.to_store])
        if (!(await (0, db_1.q1)(c, 'select 1 from stores where id=$1', [s])))
            throw (0, db_1.bad)('Unknown store');
    if (!Array.isArray(b.lines) || !b.lines.length)
        throw (0, db_1.bad)('Add at least one item');
    const bd = await (0, ledger_1.businessDate)(c);
    const id = (0, crypto_1.randomUUID)();
    const jl = [], mv = [];
    for (const l of b.lines) {
        const q = (0, db_1.qty)(l.qty);
        const v = await (0, stock_1.quoteIssue)(c, l.item_id, b.from_store, q);
        jl.push({ acct: '1200', dr: v, store: b.to_store }, { acct: '1200', cr: v, store: b.from_store });
        mv.push({ item: l.item_id, q, v });
    }
    const jid = await (0, ledger_1.postJournal)(c, { date: bd, source: 'transfer', sourceId: id, by: x.userId, memo: 'stock transfer', lines: jl });
    for (const m of mv) {
        await (0, stock_1.addMove)(c, { item: m.item, store: b.from_store, qty: (0, stock_1.neg)(m.q), value: -m.v, date: bd, source: 'transfer', sourceId: id, journal: jid });
        await (0, stock_1.addMove)(c, { item: m.item, store: b.to_store, qty: m.q, value: m.v, date: bd, source: 'transfer', sourceId: id, journal: jid });
    }
    return { id };
}
// Departmental consumables (straws, tissue, cleaning materials...)
async function consume(x, b) {
    const { c } = x;
    const q = (0, db_1.qty)(b.qty);
    const bd = await (0, ledger_1.businessDate)(c);
    const v = await (0, stock_1.quoteIssue)(c, b.item_id, b.store_id, q);
    const id = (0, crypto_1.randomUUID)();
    const jid = await (0, ledger_1.postJournal)(c, { date: bd, source: 'consumption', sourceId: id, by: x.userId, memo: `consumables ${b.department || ''}`,
        lines: [{ acct: '5120', dr: v, dept: b.department ?? null }, { acct: '1200', cr: v, store: b.store_id }] });
    await (0, stock_1.addMove)(c, { item: b.item_id, store: b.store_id, qty: (0, stock_1.neg)(q), value: -v, date: bd, source: 'consumption', sourceId: id, journal: jid });
    return { id, value: v };
}
async function openingStock(x, b) {
    const { c } = x;
    if (!Array.isArray(b.lines) || !b.lines.length)
        throw (0, db_1.bad)('Add at least one line');
    const bd = b.date || (await (0, ledger_1.businessDate)(c));
    const id = (0, crypto_1.randomUUID)();
    const jl = [], mv = [];
    let total = 0;
    for (const l of b.lines) {
        const q = (0, db_1.qty)(l.qty);
        const v = (await (0, db_1.q1)(c, 'select round($1::numeric * $2::bigint)::bigint v', [q, (0, db_1.cents)(l.unit_cost, 'unit_cost', true)])).v;
        total += v;
        jl.push({ acct: '1200', dr: v, store: l.store_id });
        mv.push({ ...l, q, v });
    }
    jl.push({ acct: '3900', cr: total });
    const jid = await (0, ledger_1.postJournal)(c, { date: bd, source: 'opening_stock', sourceId: id, by: x.userId, memo: 'opening stock', lines: jl });
    for (const m of mv) {
        await (0, stock_1.addMove)(c, { item: m.item_id, store: m.store_id, qty: m.q, value: m.v, date: bd, source: 'opening_stock', sourceId: id, journal: jid });
        await (0, stock_1.updateLastCost)(c, m.item_id, m.q, m.v);
    }
    return { id, total };
}
// ---------------------------------------------------------------- wastage ---
async function postWastage(c, w, by) {
    const v = await (0, stock_1.quoteIssue)(c, w.item_id, w.store_id, w.qty);
    const jid = await (0, ledger_1.postJournal)(c, { date: w.business_date, source: 'wastage', sourceId: w.id, by, memo: `wastage: ${w.reason}`,
        lines: [{ acct: '5110', dr: v }, { acct: '1200', cr: v, store: w.store_id }] });
    await (0, stock_1.addMove)(c, { item: w.item_id, store: w.store_id, qty: (0, stock_1.neg)(w.qty), value: -v, date: w.business_date, source: 'wastage', sourceId: w.id, journal: jid });
    await c.query("update wastage set status='posted', journal_id=$2 where id=$1", [w.id, jid]);
}
async function createWastage(x, b) {
    const { c } = x;
    const q = (0, db_1.qty)(b.qty);
    const reason = await (0, db_1.q1)(c, 'select 1 from wastage_reasons where code=$1', [b.reason]);
    if (!reason)
        throw (0, db_1.bad)('Choose a reason from the list');
    const bd = await (0, ledger_1.businessDate)(c);
    const date = b.date || bd;
    const backdated = (await (0, db_1.q1)(c, 'select ($1::date - $2::date) > 2 b', [bd, date])).b;
    const id = (0, crypto_1.randomUUID)();
    await c.query(`insert into wastage(id, item_id, store_id, qty, reason, note, business_date, backdated, status, created_by)
    values ($1,$2,$3,$4::numeric,$5,$6,$7,$8,$9,$10)`, [id, b.item_id, b.store_id, q, b.reason, b.note ?? null, date, backdated, backdated ? 'pending' : 'posted', x.userId]);
    const w = await (0, db_1.q1)(c, 'select * from wastage where id=$1', [id]);
    if (backdated) {
        await c.query("insert into approvals(kind, subject_id, payload, requested_by) values ('wastage',$1,$2,$3)", [id, { reason: 'dated more than 2 days back' }, x.userId]);
        return { id, status: 'pending', message: 'Dated more than 2 days back: waiting for approval' };
    }
    await postWastage(c, w, x.userId);
    return { id, status: 'posted' };
}
async function approveWastage(x, id) {
    const w = await (0, db_1.q1)(x.c, 'select * from wastage where id=$1 for update', [id]);
    if (!w || w.status !== 'pending')
        throw (0, db_1.conflict)('Nothing to approve');
    await postWastage(x.c, w, x.userId);
}
async function rejectWastage(c, id) { await c.query("update wastage set status='rejected' where id=$1", [id]); }
// -------------------------------------------------------------- stock takes ---
async function startTake(x, storeId) {
    const { c } = x;
    if (!(await (0, db_1.q1)(c, 'select 1 from stores where id=$1', [storeId])))
        throw (0, db_1.bad)('Unknown store');
    if (await (0, db_1.q1)(c, "select 1 from stock_takes where store_id=$1 and status in ('counting','pending_approval')", [storeId]))
        throw (0, db_1.conflict)('This store already has a stock take in progress');
    const id = (0, crypto_1.randomUUID)();
    const n = await (0, db_1.q1)(c, "select 'ST' || lpad(nextval('stock_take_seq')::text, 5, '0') n");
    await c.query('insert into stock_takes(id, number, store_id, counted_by) values ($1,$2,$3,$4)', [id, n.n, storeId, x.userId]);
    // Every stocked item mapped to the store: assigned here, holding stock here, or used in a recipe from here.
    await c.query(`insert into stock_take_lines(take_id, item_id)
    select $1, i.id from items i where i.is_stocked and i.active and (
      i.production_store_id = $2
      or exists (select 1 from stock_balances b where b.item_id=i.id and b.store_id=$2 and b.qty <> 0)
      or exists (select 1 from recipe_components r where r.component_item_id=i.id and r.store_id=$2))`, [id, storeId]);
    return { id, number: n.n };
}
async function getTake(c, id, viewer) {
    const t = await (0, db_1.q1)(c, 'select t.*, s.name store_name from stock_takes t join stores s on s.id=t.store_id where t.id=$1', [id]);
    if (!t)
        throw (0, db_1.notFound)('Stock take not found');
    const showSystem = ['pending_approval', 'approved'].includes(t.status) && viewer.userId !== t.counted_by && ['owner', 'manager', 'accountant'].includes(viewer.role);
    const lines = await (0, db_1.qa)(c, `select l.item_id, i.name, i.base_unit, l.counted_qty::text counted_qty,
      ${showSystem ? 'l.system_qty::text system_qty, (l.counted_qty - l.system_qty)::text variance' : 'null::text system_qty, null::text variance'}
    from stock_take_lines l join items i on i.id=l.item_id where l.take_id=$1 order by i.name`, [id]);
    return { ...t, lines };
}
async function saveCounts(x, id, counts) {
    const t = await (0, db_1.q1)(x.c, 'select * from stock_takes where id=$1 for update', [id]);
    if (!t)
        throw (0, db_1.notFound)('Stock take not found');
    if (t.status !== 'counting')
        throw (0, db_1.conflict)('This count has been submitted');
    if (t.counted_by !== x.userId)
        throw (0, db_1.forbidden)('Only the person who started this count can enter quantities');
    for (const k of counts || []) {
        const r = await x.c.query('update stock_take_lines set counted_qty=$3::numeric where take_id=$1 and item_id=$2', [id, k.item_id, (0, db_1.qty)(k.qty, 'qty', true)]);
        if (!r.rowCount)
            throw (0, db_1.bad)('That item is not part of this count');
    }
    return { ok: true };
}
async function submitTake(x, id) {
    const { c } = x;
    const t = await (0, db_1.q1)(c, 'select * from stock_takes where id=$1 for update', [id]);
    if (!t)
        throw (0, db_1.notFound)('Stock take not found');
    if (t.status !== 'counting')
        throw (0, db_1.conflict)('Already submitted');
    if (t.counted_by !== x.userId)
        throw (0, db_1.forbidden)('Only the counter can submit');
    const missing = await (0, db_1.qa)(c, 'select i.name from stock_take_lines l join items i on i.id=l.item_id where l.take_id=$1 and l.counted_qty is null', [id]);
    if (missing.length)
        throw (0, db_1.conflict)(`${missing.length} items are not counted yet`, missing.map((m) => m.name));
    // Freeze system quantity at the moment of submission.
    await c.query(`update stock_take_lines l set system_qty = coalesce((select b.qty from stock_balances b where b.item_id=l.item_id and b.store_id=$2),0) where l.take_id=$1`, [id, t.store_id]);
    await c.query("update stock_takes set status='pending_approval', submitted_at=now() where id=$1", [id]);
    await c.query("insert into approvals(kind, subject_id, payload, requested_by) values ('stock_take',$1,$2,$3)", [id, { number: t.number }, x.userId]);
    return { status: 'pending_approval' };
}
// Variances post to Stock Count Variance (5100): gains debit Inventory, losses credit it.
async function approveTake(x, id) {
    const { c } = x;
    const t = await (0, db_1.q1)(c, 'select * from stock_takes where id=$1 for update', [id]);
    if (!t || t.status !== 'pending_approval')
        throw (0, db_1.conflict)('Nothing to approve');
    if (t.counted_by === x.userId)
        throw (0, db_1.forbidden)('The person who counted cannot approve the count');
    const lines = await (0, db_1.qa)(c, 'select item_id, (counted_qty - system_qty)::text v from stock_take_lines where take_id=$1 and counted_qty <> system_qty', [id]);
    const bd = await (0, ledger_1.businessDate)(c);
    const jl = [], mv = [];
    for (const l of lines) {
        if (l.v.startsWith('-')) {
            const q = l.v.slice(1);
            const v = await (0, stock_1.quoteIssue)(c, l.item_id, t.store_id, q);
            jl.push({ acct: '5100', dr: v }, { acct: '1200', cr: v, store: t.store_id });
            mv.push({ item: l.item_id, q: (0, stock_1.neg)(q), v: -v });
        }
        else {
            const v = await (0, stock_1.quoteGain)(c, l.item_id, t.store_id, l.v);
            jl.push({ acct: '1200', dr: v, store: t.store_id }, { acct: '5100', cr: v });
            mv.push({ item: l.item_id, q: l.v, v });
        }
    }
    const jid = await (0, ledger_1.postJournal)(c, { date: bd, source: 'stock_take', sourceId: id, by: x.userId, memo: `stock take ${t.number}`, lines: jl });
    for (const m of mv)
        await (0, stock_1.addMove)(c, { item: m.item, store: t.store_id, qty: m.q, value: m.v, date: bd, source: 'stock_take', sourceId: id, journal: jid, note: 'stock take variance' });
    await c.query("update stock_takes set status='approved', approved_by=$2, approved_at=now(), journal_id=$3 where id=$1", [id, x.userId, jid]);
}
async function rejectTake(c, id, by) {
    await c.query("update stock_takes set status='rejected', approved_by=$2, approved_at=now() where id=$1", [id, by]);
}
async function stockReport(c, outlet) {
    return (0, db_1.qa)(c, `select i.id item_id, i.name, i.base_unit, s.id store_id, s.name store, b.qty::text qty, b.value::bigint value
    from stock_balances b join items i on i.id=b.item_id join stores s on s.id=b.store_id where (b.qty <> 0 or b.value <> 0) and ($1::uuid is null or s.outlet_id=$1) order by s.name, i.name`, [outlet ?? null]);
}
