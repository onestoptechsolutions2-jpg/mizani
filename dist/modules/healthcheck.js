"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyse = analyse;
const db_1 = require("../db");
const importer_1 = require("./importer");
// "Books Health Check": a free look at exports from ANY system. Nothing is stored; the data is analysed in memory and discarded.
const norm = (h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const HC = {
    account: ['account', 'account name', 'name', 'ledger', 'account code'], debit: ['debit', 'debits', 'dr'], credit: ['credit', 'credits', 'cr'],
    item: ['item', 'item name', 'product', 'product name', 'description', 'name'], qty: ['qty', 'quantity', 'on hand', 'stock', 'balance', 'closing stock'],
    value: ['value', 'stock value', 'total value', 'amount', 'cost value'], unitcost: ['cost', 'unit cost', 'avg cost', 'buying price', 'cost price'],
    status: ['status', 'state'], total: ['total', 'bill total', 'amount', 'sale total', 'grand total'], paid: ['paid', 'amount paid', 'payment', 'received'],
    date: ['date', 'bill date', 'sale date', 'created', 'created at'], discount: ['discount', 'discounts'], bill: ['bill', 'bill no', 'bill number', 'receipt', 'receipt no', 'invoice', 'order', 'order no', 'number', 'ref'],
};
function tab(csv, need, label) {
    if (!csv || !csv.trim())
        return null;
    const rows = (0, importer_1.parseCsv)(csv);
    if (rows.length < 2)
        throw (0, db_1.bad)(`${label}: the file needs a header row and data rows`);
    const head = rows[0].map(norm);
    const col = {};
    for (const [k, al] of Object.entries(HC)) {
        const i = head.findIndex((h) => al.includes(h));
        if (i >= 0)
            col[k] = i;
    }
    for (const n of need)
        if (col[n] == null)
            throw (0, db_1.bad)(`${label}: could not find a "${n}" column. Columns seen: ${rows[0].join(', ')}`);
    return { col, rows: rows.slice(1) };
}
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
const kes = (n) => 'KES ' + n.toLocaleString('en-KE', { maximumFractionDigits: 0 });
function analyse(b) {
    const findings = [];
    let score = 100, checked = 0;
    const add = (f, penalty) => { findings.push(f); score -= penalty; };
    const tb = tab(b.trial_balance, ['debit', 'credit'], 'Trial balance');
    if (tb) {
        checked++;
        let d = 0, c = 0;
        for (const r of tb.rows) {
            d += num(r[tb.col.debit]);
            c += num(r[tb.col.credit]);
        }
        const diff = Math.round((d - c) * 100) / 100;
        if (Math.abs(diff) >= 0.01)
            add({ id: 'tb_unbalanced', severity: 'high', title: `The trial balance is out by ${kes(Math.abs(diff))}`, detail: `Debits ${kes(d)} against credits ${kes(c)}. A correct double-entry ledger can never do this: some transactions have posted only one side.`, prevents: 'Mizani refuses to save any entry where debits and credits differ.' }, 35);
        else
            findings.push({ id: 'tb_ok', severity: 'info', title: 'The trial balance balances', detail: `Debits and credits both ${kes(d)}.` });
    }
    const st = tab(b.stock, ['item', 'qty'], 'Stock');
    if (st) {
        checked++;
        let neg = 0, negVal = 0, zeroCost = 0, total = 0;
        const names = [];
        for (const r of st.rows) {
            const q = num(r[st.col.qty]);
            const v = st.col.value != null ? num(r[st.col.value]) : st.col.unitcost != null ? q * num(r[st.col.unitcost]) : NaN;
            if (Number.isFinite(v))
                total += v;
            if (q < 0) {
                neg++;
                if (Number.isFinite(v))
                    negVal += v;
                if (names.length < 5)
                    names.push(r[st.col.item]);
            }
            if (q > 0 && Number.isFinite(v) && v === 0)
                zeroCost++;
        }
        if (neg)
            add({ id: 'neg_stock', severity: 'high', title: `${neg} item${neg > 1 ? 's' : ''} show negative stock`, detail: `For example: ${names.join(', ')}. Negative stock means stock left a store that never held it, usually because a sale deducted from the wrong store or a delivery was not recorded.`, prevents: 'In Mizani stock always leaves the store named in the recipe, and negative stock shows in red and is counted at the next stock take.' }, Math.min(25, 5 + neg));
        if (zeroCost)
            add({ id: 'zero_cost', severity: 'medium', title: `${zeroCost} item${zeroCost > 1 ? 's' : ''} in stock have no cost`, detail: 'Stock with no value understates inventory and makes cost of sales and profit wrong.', prevents: 'Mizani values every receipt at its purchase price and uses moving average cost.' }, Math.min(10, 2 + zeroCost));
        findings.push({ id: 'stock_total', severity: 'info', title: `Stock value: ${kes(total)}`, detail: `${st.rows.length} stock lines read.` });
    }
    const bl = tab(b.bills, ['status', 'total'], 'Bills');
    if (bl) {
        checked++;
        let open = 0, openVal = 0, voids = 0, unpaid = 0, unpaidVal = 0, sales = 0, disc = 0, n = 0;
        const now = Date.now();
        let stale = 0;
        for (const r of bl.rows) {
            const status = norm(r[bl.col.status]);
            const total = num(r[bl.col.total]);
            const paid = bl.col.paid != null ? num(r[bl.col.paid]) : null;
            n++;
            if (/void|cancel/.test(status)) {
                voids++;
                continue;
            }
            sales += total;
            if (bl.col.discount != null)
                disc += num(r[bl.col.discount]);
            if (/open|pending|unpaid|credit/.test(status)) {
                open++;
                openVal += total;
                const dt = bl.col.date != null ? Date.parse(r[bl.col.date]) : NaN;
                if (Number.isFinite(dt) && now - dt > 7 * 86400000)
                    stale++;
            }
            else if (paid != null && paid + 0.5 < total) {
                unpaid++;
                unpaidVal += total - paid;
            }
        }
        if (open)
            add({ id: 'open_bills', severity: stale ? 'high' : 'medium', title: `${open} bills are still open (${kes(openVal)})`, detail: stale ? `${stale} of them are more than a week old. Open bills hide unpaid sales, wrong reports and unexplained cash.` : 'Open bills hide unpaid sales and make daily reports unreliable.', prevents: 'Mizani will not close a trading day while any bill is open.' }, stale ? 15 : 8);
        if (unpaid)
            add({ id: 'closed_unpaid', severity: 'high', title: `${unpaid} closed bills were not paid in full (${kes(unpaidVal)} short)`, detail: 'Bills closed without full payment or a recorded reason (credit, staff, complimentary, write-off) are where cash disappears.', prevents: 'Every bill must close with a disposition, and anything other than payment needs a manager approval.' }, 15);
        if (n && voids / n > 0.03)
            add({ id: 'many_voids', severity: 'medium', title: `${voids} of ${n} bills were voided (${Math.round((voids / n) * 100)}%)`, detail: 'More than about 3% voids deserves a look at who is voiding and when.', prevents: 'In Mizani a void is a request that a different person approves.' }, 8);
        if (sales > 0 && disc / sales > 0.05)
            add({ id: 'discounts', severity: 'medium', title: `Discounts are ${(disc / sales * 100).toFixed(1)}% of sales`, detail: 'Discounts above about 5% of sales usually mean unapproved discounting.', prevents: 'Only managers can discount, and automatic promotions are visible and dated.' }, 6);
        findings.push({ id: 'sales_total', severity: 'info', title: `Sales read: ${kes(sales)} across ${n - voids} bills`, detail: '' });
    }
    if (!checked)
        throw (0, db_1.bad)('Upload at least one file: a trial balance, a stock report or a bills list (CSV).');
    score = Math.max(0, Math.min(100, score));
    const high = findings.filter((f) => f.severity === 'high').length;
    return { score, grade: score >= 90 ? 'Healthy' : score >= 70 ? 'Needs attention' : 'At risk', files_checked: checked, findings, summary: high ? `${high} serious problem${high > 1 ? 's' : ''} found. These are the kinds of leaks Mizani is built to make impossible.` : findings.some((f) => f.severity === 'medium') ? 'No serious problems, but a few things deserve attention.' : 'Nothing worrying found in what you uploaded.', privacy: 'Your files were analysed in memory and were not stored.' };
}
