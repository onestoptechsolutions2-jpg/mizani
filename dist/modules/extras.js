"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAYROLL_DEFAULTS = void 0;
exports.getSettings = getSettings;
exports.updateSettings = updateSettings;
exports.serviceCharge = serviceCharge;
exports.tipsPayout = tipsPayout;
exports.createDeposit = createDeposit;
exports.sellGiftCard = sellGiftCard;
exports.giftCardInfo = giftCardInfo;
exports.loyaltyBalance = loyaltyBalance;
exports.refundLine = refundLine;
const crypto_1 = require("crypto");
const db_1 = require("../db");
const ledger_1 = require("../ledger");
const sales_1 = require("./sales");
// --------------------------------------------------------------- settings ----
exports.PAYROLL_DEFAULTS = {
    // Kenya, verified November 2026 against KRA, NSSF and SHA published rates. THESE CHANGE: Treasury has proposed removing
    // personal relief and widening the zero-PAYE band. Review with an accountant before every payroll.
    effective: '2026-02-01',
    paye_bands: [[2400000, 1000], [833300, 2500], [46766700, 3000], [30000000, 3250], [null, 3500]], // [width in cents, rate in bp]
    personal_relief: 240000,
    nssf_rate_bp: 600, nssf_lel: 900000, nssf_uel: 10800000,
    shif_rate_bp: 275, shif_min: 30000,
    housing_ee_bp: 150, housing_er_bp: 150,
};
const KEYS = {
    levy_bp: (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 1000)
        throw (0, db_1.bad)('levy_bp must be 0 to 1000 (200 = 2%)'); return String(n); },
    loyalty_enabled: (v) => (v === 'true' ? 'true' : 'false'),
    loyalty_points_per_kes100: (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 100)
        throw (0, db_1.bad)('points per KES 100 must be 0 to 100'); return String(n); },
    loyalty_point_value_cents: (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 100000)
        throw (0, db_1.bad)('point value must be whole cents'); return String(n); },
    service_charge_bp: (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 3000)
        throw (0, db_1.bad)('service charge must be 0 to 3000 bp'); return String(n); },
    digest_enabled: (v) => (v === 'true' ? 'true' : 'false'),
    digest_hour: (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 23)
        throw (0, db_1.bad)('digest hour must be 0 to 23'); return String(n); },
    webhook_url: (v) => { if (v && !/^https:\/\/[^\s]+$/.test(v))
        throw (0, db_1.bad)('The notification address must start with https://'); return v; },
    business_name: (v) => v.slice(0, 120), business_address: (v) => v.slice(0, 200), business_phone: (v) => v.slice(0, 40),
    kra_pin: (v) => v.slice(0, 20), receipt_footer: (v) => v.slice(0, 200),
    payroll_rates: (v) => { const j = JSON.parse(v); if (!Array.isArray(j.paye_bands) || typeof j.personal_relief !== 'number')
        throw (0, db_1.bad)('payroll_rates is missing paye_bands or personal_relief'); return JSON.stringify(j); },
};
async function getSettings(c) {
    const rows = await (0, db_1.qa)(c, 'select key, value from settings');
    const m = {};
    for (const r of rows)
        if (KEYS[r.key])
            m[r.key] = r.value;
    if (!m.payroll_rates)
        m.payroll_rates = JSON.stringify(exports.PAYROLL_DEFAULTS);
    return m;
}
async function updateSettings(c, b) {
    for (const [k, v] of Object.entries(b || {})) {
        if (!KEYS[k])
            throw (0, db_1.bad)(`Unknown setting ${k}`);
        const val = KEYS[k](typeof v === 'string' ? v : JSON.stringify(v));
        await c.query('insert into settings(key, value) values ($1,$2) on conflict (key) do update set value=excluded.value', [k, val]);
    }
    return getSettings(c);
}
// ---------------------------------------------------- service charge and tips ----
async function serviceCharge(x, billId, bpIn) {
    const { c } = x;
    const bill = await (0, db_1.q1)(c, 'select * from bills where id=$1 for update', [billId]);
    if (!bill)
        throw (0, db_1.notFound)('Bill not found');
    if (bill.status !== 'open')
        throw (0, db_1.conflict)('Bill is not open');
    const bp = bpIn != null ? Number(bpIn) : parseInt(await (0, ledger_1.setting)(c, 'service_charge_bp', '0'), 10);
    if (!Number.isInteger(bp) || bp <= 0 || bp > 3000)
        throw (0, db_1.bad)('Set a service charge between 0.01% and 30% (basis points)');
    const bd = await (0, ledger_1.businessDate)(c);
    const old = await (0, db_1.q1)(c, "select * from bill_charges where bill_id=$1 and status='active' for update", [billId]);
    if (old) {
        await (0, ledger_1.postJournal)(c, { date: bd, source: 'service_charge', sourceId: old.id, by: x.userId, memo: 'service charge replaced', reverses: old.journal_id,
            lines: [{ acct: '2300', dr: old.amount }, { acct: '1110', cr: old.amount }] });
        await c.query("update bill_charges set status='removed' where id=$1", [old.id]);
    }
    const base = (await (0, db_1.q1)(c, "select coalesce(sum(payable),0)::bigint t from bill_lines where bill_id=$1 and status='active'", [billId])).t;
    const amount = Math.round((base * bp) / 10000);
    if (amount <= 0)
        throw (0, db_1.bad)('Nothing to charge on');
    const id = (0, crypto_1.randomUUID)();
    const jid = await (0, ledger_1.postJournal)(c, { date: bd, source: 'service_charge', sourceId: id, by: x.userId, memo: `service charge ${bp / 100}% ${bill.number}`,
        lines: [{ acct: '1110', dr: amount }, { acct: '2300', cr: amount }] });
    await c.query('insert into bill_charges(id, bill_id, amount, journal_id, created_by) values ($1,$2,$3,$4,$5)', [id, billId, amount, jid, x.userId]);
    return { amount, balance: await (0, sales_1.billBalance)(c, billId) };
}
async function tipsPayout(x, b) {
    const amount = (0, db_1.cents)(b.amount);
    const held = -(await (0, ledger_1.balanceOf)(x.c, '2300'));
    if (amount > held)
        throw (0, db_1.conflict)(`Only ${held} is held for staff`);
    const jid = await (0, ledger_1.postJournal)(x.c, { date: await (0, ledger_1.businessDate)(x.c), source: 'tips_payout', sourceId: (0, crypto_1.randomUUID)(), by: x.userId, memo: b.note || 'tips and service charge paid out',
        lines: [{ acct: '2300', dr: amount }, { acct: ledger_1.METHOD_ACCT[b.method || 'cash'] ?? '1000', cr: amount }] });
    return { journal_id: jid, held: held - amount };
}
// ------------------------------------------------------- deposits, gift cards ----
async function createDeposit(x, b) {
    const c = x.c;
    const cust = await (0, db_1.q1)(c, "select * from parties where id=$1 and kind='customer'", [b.customer_id]);
    if (!cust)
        throw (0, db_1.bad)('Choose a customer');
    if (!ledger_1.METHOD_ACCT[b.method])
        throw (0, db_1.bad)('A payment method is required');
    const amount = (0, db_1.cents)(b.amount);
    const jid = await (0, ledger_1.postJournal)(c, { date: await (0, ledger_1.businessDate)(c), source: 'deposit', sourceId: (0, crypto_1.randomUUID)(), by: x.userId, memo: `deposit from ${cust.name}`,
        lines: [{ acct: ledger_1.METHOD_ACCT[b.method], dr: amount }, { acct: '2200', cr: amount, party: cust.id }] });
    return { journal_id: jid, balance: -(await (0, ledger_1.balanceOf)(c, '2200', cust.id)) };
}
async function sellGiftCard(x, b) {
    const c = x.c;
    const amount = (0, db_1.cents)(b.amount);
    if (!ledger_1.METHOD_ACCT[b.method])
        throw (0, db_1.bad)('A payment method is required');
    const code = (b.code ? String(b.code) : 'GC' + (0, crypto_1.randomUUID)().replace(/-/g, '').slice(0, 10)).toUpperCase();
    if (!/^[A-Z0-9-]{4,24}$/.test(code))
        throw (0, db_1.bad)('Gift card code must be 4 to 24 letters, numbers or hyphens');
    if (await (0, db_1.q1)(c, 'select 1 from gift_cards where code=$1', [code]))
        throw (0, db_1.conflict)('That gift card code already exists');
    const jid = await (0, ledger_1.postJournal)(c, { date: await (0, ledger_1.businessDate)(c), source: 'gift_card', sourceId: (0, crypto_1.randomUUID)(), by: x.userId, memo: `gift card ${code}`,
        lines: [{ acct: ledger_1.METHOD_ACCT[b.method], dr: amount }, { acct: '2210', cr: amount }] });
    await c.query('insert into gift_cards(code, amount, journal_id, sold_by) values ($1,$2,$3,$4)', [code, amount, jid, x.userId]);
    return { code, amount };
}
async function giftCardInfo(c, code) {
    const g = await (0, db_1.q1)(c, 'select code, amount from gift_cards where code=$1', [code.toUpperCase()]);
    if (!g)
        throw (0, db_1.notFound)('Unknown gift card');
    const used = (await (0, db_1.q1)(c, "select coalesce(sum(amount),0)::bigint u from payments where method='giftcard' and reference=$1", [g.code])).u;
    return { ...g, remaining: g.amount - used };
}
async function loyaltyBalance(c, customer) {
    const r = await (0, db_1.q1)(c, 'select coalesce(sum(points),0)::int p from loyalty_ledger where customer_id=$1', [customer]);
    const v = parseInt(await (0, ledger_1.setting)(c, 'loyalty_point_value_cents', '100'), 10) || 0;
    return { points: r.p, value: r.p * v };
}
// ---------------------------------------------------------------- refunds ----
// Refund one line of a PAID bill. Reverses revenue/tax/levy; stock either returns (restock) or its cost goes to Wastage.
async function refundLine(x, billId, b) {
    const { c } = x;
    const bill = await (0, db_1.q1)(c, 'select * from bills where id=$1 for update', [billId]);
    if (!bill)
        throw (0, db_1.notFound)('Bill not found');
    if (bill.status !== 'closed' || bill.disposition !== 'paid')
        throw (0, db_1.conflict)('Refunds are for bills that were paid. Use void for unpaid bills.');
    const line = await (0, db_1.q1)(c, 'select * from bill_lines where id=$1 and bill_id=$2 for update', [b.line_id, billId]);
    if (!line || line.status !== 'active')
        throw (0, db_1.conflict)('That item is not on the bill or was already removed or refunded');
    if (!b.reason)
        throw (0, db_1.bad)('A reason is required');
    const method = b.method;
    if (!['cash', 'mpesa', 'card', 'deposit'].includes(method))
        throw (0, db_1.bad)('Refund method must be cash, mpesa, card or deposit (store credit)');
    if (method === 'deposit' && !bill.customer_id)
        throw (0, db_1.bad)('Store credit needs a customer on the bill');
    const approver = await (0, sales_1.verifyApprover)(c, b.approver, x.userId);
    const bd = await (0, ledger_1.businessDate)(c);
    await (0, sales_1.removeLine)(x, line, { reason: `refund: ${b.reason}`, approved: true, mode: b.restock ? 'restock' : 'waste', status: 'refunded' });
    const id = (0, crypto_1.randomUUID)();
    const out = method === 'deposit' ? { acct: '2200', cr: line.payable, party: bill.customer_id } : { acct: ledger_1.METHOD_ACCT[method], cr: line.payable };
    const jid = await (0, ledger_1.postJournal)(c, { date: bd, source: 'refund', sourceId: id, by: x.userId, memo: `refund ${bill.number}: ${b.reason}`, lines: [{ acct: '1110', dr: line.payable }, out] });
    await c.query('insert into refunds(id, bill_id, line_id, amount, method, restock, reason, approver_id, journal_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, billId, line.id, line.payable, method, !!b.restock, b.reason, approver, jid, x.userId]);
    return { refund_id: id, amount: line.payable, balance: await (0, sales_1.billBalance)(c, billId) };
}
