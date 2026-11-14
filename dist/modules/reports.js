"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trialBalance = trialBalance;
exports.profitAndLoss = profitAndLoss;
exports.balanceSheet = balanceSheet;
exports.partyBalances = partyBalances;
exports.journalDetail = journalDetail;
exports.accountLedger = accountLedger;
exports.outletReport = outletReport;
const db_1 = require("../db");
const rng = (q) => ({ from: q.from || '0001-01-01', to: q.to || '9999-12-31' });
async function trialBalance(c, q) {
    const { from, to } = rng(q);
    const rows = await (0, db_1.qa)(c, `select a.code, a.name, a.type, coalesce(sum(l.debit),0)::bigint debit, coalesce(sum(l.credit),0)::bigint credit
    from accounts a left join (select l.* from journal_lines l join journals j on j.id=l.journal_id where j.business_date between $1 and $2) l on l.account_id=a.id
    group by a.id order by a.code`, [from, to]);
    const live = rows.filter((r) => r.debit || r.credit);
    const debit = live.reduce((s, r) => s + r.debit, 0), credit = live.reduce((s, r) => s + r.credit, 0);
    return { from: q.from || null, to: q.to || null, rows: live, totals: { debit, credit, difference: debit - credit }, balanced: debit === credit };
}
async function profitAndLoss(c, q) {
    const t = await trialBalance(c, q);
    const sum = (types, sign) => t.rows.filter((r) => types.includes(r.type)).map((r) => ({ code: r.code, name: r.name, amount: sign * (r.credit - r.debit) }));
    const income = sum(['income', 'contra_income'], 1), cos = sum(['cost_of_sales'], -1), exp = sum(['expense'], -1);
    const tot = (a) => a.reduce((s, r) => s + r.amount, 0);
    const revenue = tot(income), cost = tot(cos), gross = revenue - cost, expenses = tot(exp);
    return { from: q.from || null, to: q.to || null, income, cost_of_sales: cos, expenses: exp, revenue, cost, gross_profit: gross, total_expenses: expenses, net_profit: gross - expenses };
}
async function balanceSheet(c, q) {
    const t = await trialBalance(c, { to: q.to });
    const side = (types, sign) => t.rows.filter((r) => types.includes(r.type)).map((r) => ({ code: r.code, name: r.name, amount: sign * (r.debit - r.credit) }));
    const assets = side(['asset', 'contra_asset'], 1), liabilities = side(['liability'], -1), equity = side(['equity'], -1);
    const pl = await profitAndLoss(c, { to: q.to });
    const tot = (a) => a.reduce((s, r) => s + r.amount, 0);
    const A = tot(assets), L = tot(liabilities), E = tot(equity) + pl.net_profit;
    return { as_at: q.to || null, assets, liabilities, equity, earnings_to_date: pl.net_profit, total_assets: A, total_liabilities: L, total_equity: E, balanced: A === L + E };
}
async function partyBalances(c, kind) {
    const code = kind === 'supplier' ? '2000' : kind === 'staff' ? '1120' : '1100';
    const sign = kind === 'supplier' ? -1 : 1;
    return (0, db_1.qa)(c, `select p.id, p.name, p.credit_limit, (${sign} * coalesce(sum(l.debit-l.credit),0))::bigint balance
    from parties p left join (select l.* from journal_lines l join accounts a on a.id=l.account_id where a.code=$2) l on l.party_id=p.id
    where p.kind=$1 group by p.id order by p.name`, [kind, code]);
}
async function journalDetail(c, id) {
    const j = await (0, db_1.q1)(c, 'select * from journals where id=$1', [id]);
    if (!j)
        throw (0, db_1.notFound)('Journal not found');
    const lines = await (0, db_1.qa)(c, `select a.code, a.name, l.debit, l.credit, l.party_id, l.store_id, l.department from journal_lines l join accounts a on a.id=l.account_id where l.journal_id=$1 order by l.id`, [id]);
    return { ...j, lines };
}
async function accountLedger(c, code, q) {
    const { from, to } = rng(q);
    return (0, db_1.qa)(c, `select j.id journal_id, j.business_date, j.source_type, j.memo, l.debit, l.credit
    from journal_lines l join journals j on j.id=l.journal_id join accounts a on a.id=l.account_id
    where a.code=$1 and j.business_date between $2 and $3 order by j.seq limit 500`, [code, from, to]);
}
// Sales and gross profit by outlet. Only sales postings carry an outlet; shared costs and expenses are reported at business level.
async function outletReport(c, q) {
    const { from, to } = rng(q);
    return (0, db_1.qa)(c, `select o.id outlet_id, o.name,
      coalesce(sum(case when a.type='income' then l.credit - l.debit when a.type='contra_income' then l.credit - l.debit else 0 end),0)::bigint revenue,
      coalesce(sum(case when a.type='cost_of_sales' then l.debit - l.credit else 0 end),0)::bigint cost_of_sales,
      (coalesce(sum(case when a.type in ('income','contra_income') then l.credit - l.debit else 0 end),0) - coalesce(sum(case when a.type='cost_of_sales' then l.debit - l.credit else 0 end),0))::bigint gross_profit
    from outlets o left join (select l.* from journal_lines l join journals j on j.id=l.journal_id where j.business_date between $1 and $2 and l.outlet_id is not null) l on l.outlet_id=o.id
    left join accounts a on a.id=l.account_id group by o.id order by o.name`, [from, to]);
}
