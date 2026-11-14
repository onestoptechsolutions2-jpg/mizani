"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listNotifications = void 0;
exports.ownerSummary = ownerSummary;
exports.digestText = digestText;
exports.safeWebhook = safeWebhook;
exports.deliver = deliver;
exports.sendDigest = sendDigest;
exports.tick = tick;
exports.forecastDemand = forecastDemand;
exports.reorderSuggestions = reorderSuggestions;
const promises_1 = __importDefault(require("dns/promises"));
const net_1 = __importDefault(require("net"));
const db_1 = require("../db");
const ledger_1 = require("../ledger");
const reconcile_1 = require("./reconcile");
const kes = (c) => 'KES ' + (c / 100).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
async function ownerSummary(c, outlet) {
    const bd = await (0, ledger_1.businessDate)(c);
    const o = outlet ?? null;
    const sales = await (0, db_1.q1)(c, `select coalesce(sum(case when a.type in ('income') then l.credit - l.debit when a.type='contra_income' then -(l.debit - l.credit) else 0 end),0)::bigint net,
      coalesce(sum(case when a.type='cost_of_sales' and a.code in ('5000','5010') then l.debit - l.credit else 0 end),0)::bigint cogs
    from journal_lines l join journals j on j.id=l.journal_id join accounts a on a.id=l.account_id
    where j.business_date=$1 and ($2::uuid is null or l.outlet_id=$2)`, [bd, o]);
    const bills = await (0, db_1.q1)(c, "select count(*)::int n from bills where business_date=$1 and status='closed' and ($2::uuid is null or outlet_id=$2)", [bd, o]);
    const pays = await (0, db_1.qa)(c, "select method, coalesce(sum(amount),0)::bigint amount from payments where business_date=$1 group by method order by method", [bd]);
    const open = await (0, db_1.q1)(c, `select count(*)::int n, coalesce(sum((select coalesce(sum(payable),0) from bill_lines l where l.bill_id=b.id and l.status='active')),0)::bigint v from bills b where status='open' and ($1::uuid is null or outlet_id=$1)`, [o]);
    const risk = await (0, db_1.q1)(c, `select
      coalesce((select sum(amount) from bill_dispositions d join bills b on b.id=d.bill_id where d.kind='complimentary' and b.business_date=$1),0)::bigint comps,
      coalesce((select sum(amount) from bill_dispositions d join bills b on b.id=d.bill_id where d.kind='writeoff' and b.business_date=$1),0)::bigint writeoffs,
      coalesce((select sum(l.debit-l.credit) from journal_lines l join journals j on j.id=l.journal_id join accounts a on a.id=l.account_id where a.code='5110' and j.business_date=$1),0)::bigint wastage,
      coalesce((select sum(l.debit-l.credit) from journal_lines l join journals j on j.id=l.journal_id join accounts a on a.id=l.account_id where a.code='5100' and j.business_date=$1),0)::bigint stock_variance,
      (select count(*) from bill_lines l join bills b on b.id=l.bill_id where l.status='removed' and l.removed_at::date = current_date)::int removed_lines`, [bd]);
    const top = await (0, db_1.qa)(c, `select i.name, sum(l.qty)::text qty, sum(l.payable)::bigint amount from bill_lines l join bills b on b.id=l.bill_id join items i on i.id=l.item_id
    where b.business_date=$1 and l.status='active' and ($2::uuid is null or b.outlet_id=$2) group by i.name order by sum(l.payable) desc limit 5`, [bd, o]);
    const pending = (await (0, db_1.q1)(c, "select count(*)::int n from approvals where status='pending'")).n;
    const rec = await (0, reconcile_1.reconcile)(c);
    const low = (await (0, db_1.q1)(c, `select count(*)::int n from (select i.id from items i left join stock_balances b on b.item_id=i.id where i.is_stocked and i.active and i.reorder_level > 0 group by i.id having coalesce(sum(b.qty),0) <= max(i.reorder_level)) x`)).n;
    return {
        business_date: bd, net_sales: sales.net, gross_profit: sales.net - sales.cogs, closed_bills: bills.n, average_bill: bills.n ? Math.round(sales.net / bills.n) : 0,
        takings: pays, open_bills: open.n, open_bills_value: open.v,
        cash_in_till_per_books: await (0, ledger_1.balanceOf)(c, '1000'), mpesa_clearing: await (0, ledger_1.balanceOf)(c, '1010'), customers_owe: await (0, ledger_1.balanceOf)(c, '1100'), we_owe_suppliers: -(await (0, ledger_1.balanceOf)(c, '2000')),
        watch: { complimentary: risk.comps, write_offs: risk.writeoffs, wastage_today: risk.wastage, stock_variance_today: risk.stock_variance, items_removed_today: risk.removed_lines },
        pending_approvals: pending, low_stock_items: low, top_items: top,
        books: { ok: rec.ok, failing: rec.checks.filter((k) => !k.ok).map((k) => ({ id: k.id, name: k.name, detail: k.detail })) },
    };
}
async function digestText(c) {
    const s = await ownerSummary(c);
    const name = await (0, ledger_1.setting)(c, 'business_name', 'Your business');
    const L = [`${name}: ${s.business_date}`, `Sales ${kes(s.net_sales)} from ${s.closed_bills} bills (avg ${kes(s.average_bill)}). Gross profit ${kes(s.gross_profit)}.`];
    if (s.takings.length)
        L.push('Takings: ' + s.takings.map((p) => `${p.method} ${kes(p.amount)}`).join(', ') + '.');
    L.push(`Open bills: ${s.open_bills} (${kes(s.open_bills_value)}). Cash per books ${kes(s.cash_in_till_per_books)}.`);
    const w = s.watch, flags = [];
    if (w.complimentary)
        flags.push(`complimentary ${kes(w.complimentary)}`);
    if (w.write_offs)
        flags.push(`write-offs ${kes(w.write_offs)}`);
    if (w.wastage_today)
        flags.push(`wastage ${kes(w.wastage_today)}`);
    if (w.stock_variance_today)
        flags.push(`stock variance ${kes(w.stock_variance_today)}`);
    if (w.items_removed_today)
        flags.push(`${w.items_removed_today} items removed from bills`);
    L.push(flags.length ? 'Watch: ' + flags.join(', ') + '.' : 'Nothing unusual on discounts, wastage or write-offs.');
    if (s.pending_approvals)
        L.push(`${s.pending_approvals} approval(s) waiting for a manager.`);
    if (s.low_stock_items)
        L.push(`${s.low_stock_items} item(s) at or below reorder level.`);
    L.push(s.books.ok ? 'Books balanced. All checks pass.' : `BOOKS NEED ATTENTION: ${s.books.failing.map((f) => f.name).join('; ')}.`);
    return { text: L.join('\n'), summary: s };
}
// ------------------------------------------------------- outbound webhooks ----
const privateIp = (ip) => {
    if (net_1.default.isIPv6(ip))
        return /^(::1|fc|fd|fe80|::ffff:(127|10|192\.168|169\.254|172\.(1[6-9]|2\d|3[01])))/i.test(ip) || ip === '::';
    const [a, b2] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b2 === 254) || (a === 172 && b2 >= 16 && b2 <= 31) || (a === 192 && b2 === 168) || a >= 224;
};
// The webhook address is typed in by a business, so the server must never be tricked into calling its own network.
async function safeWebhook(url) {
    let u;
    try {
        u = new URL(url);
    }
    catch {
        throw (0, db_1.bad)('That is not a valid web address');
    }
    if (u.protocol !== 'https:')
        throw (0, db_1.bad)('The notification address must use https');
    if (u.username || u.password)
        throw (0, db_1.bad)('Remove the username and password from the address');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const addrs = net_1.default.isIP(host) ? [{ address: host }] : await promises_1.default.lookup(host, { all: true }).catch(() => { throw (0, db_1.bad)('That address could not be found'); });
    if (!addrs.length || addrs.some((a) => privateIp(a.address)))
        throw (0, db_1.bad)('That address points to a private network and is not allowed');
    return u;
}
async function deliver(url, text, extra = {}) {
    const u = await safeWebhook(url);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    try {
        const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, ...extra }), signal: ctl.signal, redirect: 'error' });
        if (!r.ok)
            throw new Error(`The receiver answered ${r.status}`);
    }
    finally {
        clearTimeout(t);
    }
}
async function sendDigest(c, kind = 'digest') {
    const { text } = await digestText(c);
    const url = await (0, ledger_1.setting)(c, 'webhook_url', '');
    const n = await (0, db_1.q1)(c, "insert into notifications(kind, message, status) values ($1,$2,'queued') returning id", [kind, text]);
    if (!url) {
        await c.query("update notifications set status='skipped', detail='No notification address is set' where id=$1", [n.id]);
        return { id: n.id, status: 'skipped', text };
    }
    try {
        await deliver(url, text, { kind });
        await c.query("update notifications set status='sent' where id=$1", [n.id]);
        return { id: n.id, status: 'sent', text };
    }
    catch (e) {
        await c.query("update notifications set status='failed', detail=$2 where id=$1", [n.id, String(e.message).slice(0, 300)]);
        return { id: n.id, status: 'failed', detail: e.message, text };
    }
}
const listNotifications = (c) => (0, db_1.qa)(c, 'select id, kind, status, detail, left(message, 400) message, created_at from notifications order by id desc limit 50');
exports.listNotifications = listNotifications;
// Called by the scheduler for each business. Sends the nightly digest once a day at the chosen hour (Nairobi time), and an alert if the books fail.
async function tick(c) {
    const hour = (await (0, db_1.q1)(c, "select extract(hour from (now() at time zone 'Africa/Nairobi'))::int h")).h;
    const sent = [];
    if ((await (0, ledger_1.setting)(c, 'digest_enabled', 'false')) === 'true' && hour === parseInt(await (0, ledger_1.setting)(c, 'digest_hour', '21'), 10)
        && !(await (0, db_1.q1)(c, "select 1 from notifications where kind='digest' and (created_at at time zone 'Africa/Nairobi')::date = (now() at time zone 'Africa/Nairobi')::date"))) {
        await sendDigest(c, 'digest');
        sent.push('digest');
    }
    if ((await (0, ledger_1.setting)(c, 'digest_enabled', 'false')) === 'true' && !(await (0, db_1.q1)(c, "select 1 from notifications where kind='alert' and created_at > now() - interval '24 hours'"))) {
        const rec = await (0, reconcile_1.reconcile)(c);
        if (!rec.ok) {
            await sendDigest(c, 'alert');
            sent.push('alert');
        }
    }
    return sent;
}
// ---------------------------------------------------------------- forecast ----
// Demand: the average of the same weekday over recent weeks, per item. A baseline to plan with, not a prediction engine.
async function forecastDemand(c, days = 7, weeks = 8) {
    days = Math.min(Math.max(days, 1), 28);
    weeks = Math.min(Math.max(weeks, 2), 26);
    const rows = await (0, db_1.qa)(c, `select i.id, i.name, extract(dow from b.business_date)::int dow, sum(l.qty)::float8 q
    from bill_lines l join bills b on b.id=l.bill_id join items i on i.id=l.item_id
    where l.status='active' and b.business_date >= current_date - ($1 * 7) and b.business_date < current_date group by i.id, i.name, dow`, [weeks]);
    const out = new Map();
    for (const r of rows) {
        const e = out.get(r.id) || { item_id: r.id, name: r.name, perDow: Array(7).fill(0) };
        e.perDow[r.dow] = r.q / weeks;
        out.set(r.id, e);
    }
    const start = (await (0, db_1.q1)(c, 'select current_date::text d, extract(dow from current_date)::int dow'));
    const items = [];
    for (const e of out.values()) {
        const daily = Array.from({ length: days }, (_, k) => ({ offset: k + 1, qty: Math.round(e.perDow[(start.dow + k + 1) % 7] * 100) / 100 }));
        items.push({ item_id: e.item_id, name: e.name, next_days: daily, total: Math.round(daily.reduce((s, d) => s + d.qty, 0) * 100) / 100 });
    }
    return { basis: `Average of the same weekday over the last ${weeks} weeks`, days, items: items.sort((a, b) => b.total - a.total) };
}
async function reorderSuggestions(c, lead = 3, cover = 7) {
    const rows = await (0, db_1.qa)(c, `select i.id, i.name, i.base_unit, i.reorder_level::float8 reorder,
      coalesce((select sum(qty)::float8 from stock_balances b where b.item_id=i.id),0) on_hand,
      coalesce((select -sum(m.qty)::float8 from stock_moves m where m.item_id=i.id and m.business_date >= current_date - 28 and m.source_type in ('bill_line','wastage','consumption','staff_meal','production') and m.qty < 0 or false),0) used28
    from items i where i.is_stocked and i.active`);
    const net = await (0, db_1.qa)(c, `select m.item_id, -sum(m.qty)::float8 used from stock_moves m where m.business_date >= current_date - 28 and m.source_type in ('bill_line','wastage','consumption','staff_meal') group by m.item_id`);
    const usedBy = new Map(net.map((r) => [r.item_id, r.used]));
    const out = [];
    for (const r of rows) {
        const used = Math.max(0, usedBy.get(r.id) || 0);
        const rate = used / 28;
        if (rate <= 0 && !(r.reorder > 0 && r.on_hand <= r.reorder))
            continue;
        const need = rate * (lead + cover) - r.on_hand;
        const suggested = Math.max(need, r.reorder > 0 && r.on_hand <= r.reorder ? r.reorder * 2 - r.on_hand : 0);
        if (suggested > 0)
            out.push({ item_id: r.id, name: r.name, unit: r.base_unit, on_hand: Math.round(r.on_hand * 100) / 100, daily_use: Math.round(rate * 100) / 100, days_of_cover: rate ? Math.round((r.on_hand / rate) * 10) / 10 : null, suggested_order: Math.ceil(suggested * 100) / 100 });
    }
    return { basis: `Usage over the last 28 days; covers ${cover} days after a ${lead}-day delivery lead time`, items: out.sort((a, b) => (a.days_of_cover ?? 1e9) - (b.days_of_cover ?? 1e9)) };
}
