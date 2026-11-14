"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.payslips = exports.listRuns = exports.listLeave = exports.listEmployees = void 0;
exports.createEmployee = createEmployee;
exports.updateEmployee = updateEmployee;
exports.leaveBalance = leaveBalance;
exports.requestLeave = requestLeave;
exports.decideLeave = decideLeave;
exports.computePayslip = computePayslip;
exports.preview = preview;
exports.runPayroll = runPayroll;
exports.payRun = payRun;
exports.remit = remit;
exports.liabilities = liabilities;
const crypto_1 = require("crypto");
const db_1 = require("../db");
const ledger_1 = require("../ledger");
const extras_1 = require("./extras");
// ---------------------------------------------------------------- employees ----
async function createEmployee(x, b) {
    if (!b.name)
        throw (0, db_1.bad)('Name is required');
    const basic = (0, db_1.cents)(b.basic_salary, 'basic_salary', true), allow = b.allowances ? (0, db_1.cents)(b.allowances, 'allowances', true) : 0;
    let party = b.party_id ?? null;
    if (b.link_staff_account)
        party = (await (0, db_1.q1)(x.c, "insert into parties(kind, name, phone) values ('staff',$1,$2) returning id", [b.name, b.phone ?? null])).id;
    return (0, db_1.q1)(x.c, 'insert into employees(name, id_number, kra_pin, nssf_no, sha_no, basic_salary, allowances, start_date, party_id) values ($1,$2,$3,$4,$5,$6,$7,coalesce($8::date, current_date),$9) returning *', [b.name, b.id_number ?? null, b.kra_pin ?? null, b.nssf_no ?? null, b.sha_no ?? null, basic, allow, b.start_date ?? null, party]);
}
const listEmployees = (c) => (0, db_1.qa)(c, 'select * from employees order by name');
exports.listEmployees = listEmployees;
async function updateEmployee(c, id, b) {
    const e = await (0, db_1.q1)(c, 'select * from employees where id=$1', [id]);
    if (!e)
        throw (0, db_1.notFound)('Employee not found');
    await c.query('update employees set name=coalesce($2,name), basic_salary=coalesce($3,basic_salary), allowances=coalesce($4,allowances), status=coalesce($5,status), kra_pin=coalesce($6,kra_pin), nssf_no=coalesce($7,nssf_no), sha_no=coalesce($8,sha_no) where id=$1', [id, b.name ?? null, b.basic_salary != null ? (0, db_1.cents)(b.basic_salary, 'basic_salary', true) : null, b.allowances != null ? (0, db_1.cents)(b.allowances, 'allowances', true) : null, b.status ?? null, b.kra_pin ?? null, b.nssf_no ?? null, b.sha_no ?? null]);
    return { ok: true };
}
// ---------------------------------------------------------------------- leave ----
async function leaveBalance(c, employeeId) {
    const e = await (0, db_1.q1)(c, 'select * from employees where id=$1', [employeeId]);
    if (!e)
        throw (0, db_1.notFound)('Employee not found');
    // Annual leave accrues at 1.75 days per completed month of service (21 days a year).
    const m = await (0, db_1.q1)(c, "select (extract(year from age(current_date, $1::date))*12 + extract(month from age(current_date, $1::date)))::int months", [e.start_date]);
    const used = (await (0, db_1.q1)(c, "select coalesce(sum(days),0)::text d from leave_requests where employee_id=$1 and kind='annual' and status='approved'", [employeeId])).d;
    const accrued = m.months * 1.75;
    return { employee: e.name, months_of_service: m.months, accrued, used: Number(used), balance: accrued - Number(used) };
}
async function requestLeave(x, b) {
    const { c } = x;
    const e = await (0, db_1.q1)(c, 'select * from employees where id=$1', [b.employee_id]);
    if (!e)
        throw (0, db_1.bad)('Unknown employee');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.start_date || '') || !/^\d{4}-\d{2}-\d{2}$/.test(b.end_date || '') || b.end_date < b.start_date)
        throw (0, db_1.bad)('Start and end dates are required');
    const days = Number(b.days);
    if (!(days > 0) || days > 365)
        throw (0, db_1.bad)('days must be a positive number');
    const kind = b.kind || 'annual';
    if (kind === 'annual' && days > (await leaveBalance(c, e.id)).balance)
        throw (0, db_1.conflict)('That is more annual leave than the employee has accrued');
    const l = await (0, db_1.q1)(c, 'insert into leave_requests(employee_id, kind, start_date, end_date, days, requested_by) values ($1,$2,$3,$4,$5,$6) returning *', [e.id, kind, b.start_date, b.end_date, days, x.userId]);
    await c.query("insert into approvals(kind, subject_id, payload, requested_by) values ('leave',$1,$2,$3)", [l.id, { number: `${e.name}: ${days} day(s) ${kind}`, reason: `${b.start_date} to ${b.end_date}` }, x.userId]);
    return l;
}
async function decideLeave(x, id, approve) {
    const l = await (0, db_1.q1)(x.c, 'select * from leave_requests where id=$1 for update', [id]);
    if (!l || l.status !== 'pending')
        throw (0, db_1.conflict)('Nothing to decide');
    if (approve && l.kind === 'annual' && Number(l.days) > (await leaveBalance(x.c, l.employee_id)).balance)
        throw (0, db_1.conflict)('Not enough annual leave accrued');
    await x.c.query('update leave_requests set status=$2, decided_by=$3 where id=$1', [id, approve ? 'approved' : 'rejected', x.userId]);
}
const listLeave = (c) => (0, db_1.qa)(c, 'select l.*, e.name employee from leave_requests l join employees e on e.id=l.employee_id order by l.created_at desc limit 200');
exports.listLeave = listLeave;
// -------------------------------------------------------------------- payroll ----
// All amounts in cents. Order of deductions follows Kenyan practice: NSSF, SHIF and the housing levy come off before PAYE.
function computePayslip(gross, r = extras_1.PAYROLL_DEFAULTS) {
    const pct = (v, bp) => Math.round((v * bp) / 10000);
    if (gross <= 0)
        return { gross, nssf_ee: 0, nssf_er: 0, shif: 0, housing_ee: 0, housing_er: 0, taxable: 0, paye: 0 };
    const nssf = pct(Math.min(gross, r.nssf_uel), r.nssf_rate_bp);
    const shif = Math.max(pct(gross, r.shif_rate_bp), r.shif_min);
    const housing_ee = pct(gross, r.housing_ee_bp), housing_er = pct(gross, r.housing_er_bp);
    const taxable = Math.max(0, gross - nssf - shif - housing_ee);
    let tax = 0, left = taxable;
    for (const [width, rate] of r.paye_bands) {
        const take = width == null ? left : Math.min(left, width);
        tax += pct(take, rate);
        left -= take;
        if (left <= 0)
            break;
    }
    return { gross, nssf_ee: nssf, nssf_er: nssf, shif, housing_ee, housing_er, taxable, paye: Math.max(0, tax - r.personal_relief) };
}
async function preview(c, gross) {
    const g = (0, db_1.cents)(gross, 'gross');
    const rates = JSON.parse((await (0, extras_1.getSettings)(c)).payroll_rates);
    const p = computePayslip(g, rates);
    return { ...p, net: g - p.nssf_ee - p.shif - p.housing_ee - p.paye, employer_cost: g + p.nssf_er + p.housing_er, rates_effective: rates.effective };
}
async function runPayroll(x, b) {
    const { c } = x;
    const period = String(b.period || '');
    if (!/^\d{4}-\d{2}$/.test(period))
        throw (0, db_1.bad)('period must be YYYY-MM');
    if (await (0, db_1.q1)(c, 'select 1 from payroll_runs where period=$1', [period]))
        throw (0, db_1.conflict)(`Payroll for ${period} has already been run`);
    const end = (await (0, db_1.q1)(c, "select (date_trunc('month', ($1 || '-01')::date) + interval '1 month - 1 day')::date::text d", [period])).d;
    const emps = await (0, db_1.qa)(c, "select * from employees where status='active' and start_date <= $1::date order by name", [end]);
    if (!emps.length)
        throw (0, db_1.conflict)('There are no active employees to pay for that period');
    const rates = JSON.parse((await (0, extras_1.getSettings)(c)).payroll_rates);
    const id = (0, crypto_1.randomUUID)();
    const T = { gross: 0, nssf_ee: 0, nssf_er: 0, shif: 0, h_ee: 0, h_er: 0, paye: 0, net: 0 };
    const recoveries = [], slips = [];
    for (const e of emps) {
        const gross = e.basic_salary + e.allowances;
        const p = computePayslip(gross, rates);
        const beforeRecovery = gross - p.nssf_ee - p.shif - p.housing_ee - p.paye;
        let recovery = 0;
        if (b.recover_staff_debt && e.party_id) {
            const owed = await (0, ledger_1.balanceOf)(c, '1120', e.party_id);
            recovery = Math.max(0, Math.min(owed, Math.floor(beforeRecovery / 2))); // never take more than half of take-home
            if (recovery > 0)
                recoveries.push({ acct: '1120', cr: recovery, party: e.party_id });
        }
        const net = beforeRecovery - recovery;
        slips.push({ e, p, recovery, net });
        T.gross += gross;
        T.nssf_ee += p.nssf_ee;
        T.nssf_er += p.nssf_er;
        T.shif += p.shif;
        T.h_ee += p.housing_ee;
        T.h_er += p.housing_er;
        T.paye += p.paye;
        T.net += net;
    }
    const lines = [
        { acct: '6120', dr: T.gross }, { acct: '6121', dr: T.nssf_er + T.h_er },
        { acct: '2400', cr: T.paye }, { acct: '2410', cr: T.nssf_ee + T.nssf_er }, { acct: '2420', cr: T.shif }, { acct: '2430', cr: T.h_ee + T.h_er },
        ...recoveries, { acct: '2440', cr: T.net },
    ];
    const jid = await (0, ledger_1.postJournal)(c, { date: end, source: 'payroll', sourceId: id, by: x.userId, memo: `payroll ${period}`, lines });
    await c.query('insert into payroll_runs(id, period, journal_id, gross, net, rates, created_by) values ($1,$2,$3,$4,$5,$6,$7)', [id, period, jid, T.gross, T.net, rates, x.userId]);
    for (const s of slips)
        await c.query('insert into payslips(run_id, employee_id, gross, nssf_ee, nssf_er, shif, housing_ee, housing_er, taxable, paye, staff_recovery, net) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [id, s.e.id, s.p.gross, s.p.nssf_ee, s.p.nssf_er, s.p.shif, s.p.housing_ee, s.p.housing_er, s.p.taxable, s.p.paye, s.recovery, s.net]);
    return { id, period, employees: emps.length, gross: T.gross, net: T.net, paye: T.paye, nssf: T.nssf_ee + T.nssf_er, shif: T.shif, housing_levy: T.h_ee + T.h_er, employer_cost: T.gross + T.nssf_er + T.h_er };
}
async function payRun(x, id, b) {
    const { c } = x;
    const r = await (0, db_1.q1)(c, 'select * from payroll_runs where id=$1 for update', [id]);
    if (!r)
        throw (0, db_1.notFound)('Payroll run not found');
    if (!ledger_1.METHOD_ACCT[b.method])
        throw (0, db_1.bad)('A payment method is required');
    const amount = r.net - r.paid;
    if (amount <= 0)
        throw (0, db_1.conflict)('This payroll has already been paid');
    const jid = await (0, ledger_1.postJournal)(c, { date: await (0, ledger_1.businessDate)(c), source: 'payroll_payment', sourceId: (0, crypto_1.randomUUID)(), by: x.userId, memo: `pay salaries ${r.period}`, lines: [{ acct: '2440', dr: amount }, { acct: ledger_1.METHOD_ACCT[b.method], cr: amount }] });
    await c.query('update payroll_runs set paid = net where id=$1', [id]);
    return { paid: amount, journal_id: jid };
}
const LIAB = { PAYE: '2400', NSSF: '2410', SHIF: '2420', AHL: '2430' };
async function remit(x, b) {
    const code = LIAB[b.liability];
    if (!code)
        throw (0, db_1.bad)('liability must be PAYE, NSSF, SHIF or AHL');
    if (!ledger_1.METHOD_ACCT[b.method])
        throw (0, db_1.bad)('A payment method is required');
    const amount = (0, db_1.cents)(b.amount);
    const owed = -(await (0, ledger_1.balanceOf)(x.c, code));
    if (amount > owed)
        throw (0, db_1.conflict)(`Only ${owed} is owed for ${b.liability}`);
    const jid = await (0, ledger_1.postJournal)(x.c, { date: await (0, ledger_1.businessDate)(x.c), source: 'remittance', sourceId: (0, crypto_1.randomUUID)(), by: x.userId, memo: `remit ${b.liability} ${b.reference || ''}`, lines: [{ acct: code, dr: amount }, { acct: ledger_1.METHOD_ACCT[b.method], cr: amount }] });
    return { journal_id: jid, still_owed: owed - amount };
}
const listRuns = (c) => (0, db_1.qa)(c, 'select id, period, gross, net, paid, created_at from payroll_runs order by period desc');
exports.listRuns = listRuns;
const payslips = (c, runId) => (0, db_1.qa)(c, 'select s.*, e.name, e.kra_pin, e.nssf_no, e.sha_no from payslips s join employees e on e.id=s.employee_id where s.run_id=$1 order by e.name', [runId]);
exports.payslips = payslips;
async function liabilities(c) {
    const out = {};
    for (const [k, code] of Object.entries(LIAB))
        out[k] = -(await (0, ledger_1.balanceOf)(c, code));
    out.NET_SALARIES = -(await (0, ledger_1.balanceOf)(c, '2440'));
    return out;
}
