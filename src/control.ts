import { randomBytes } from 'crypto';
import { PoolClient } from 'pg';
import { bad, conflict, controlPool, CONTROL_DB, dropDatabase, ensureDatabase, q1, qa, tenantPool, tx, closeTenantPool } from './db';
import { latestVersion, migrate } from './migrate';
import { hashSecret, verifySecret } from './security';

export async function initControl() {
  await ensureDatabase(CONTROL_DB());
  await migrate(controlPool(), 'control');
}

const CHART: [string, string, string, boolean?][] = [
  ['1000', 'Cash on hand', 'asset'], ['1010', 'M-Pesa clearing', 'asset'], ['1020', 'Card clearing', 'asset'], ['1030', 'Bank', 'asset'],
  ['1100', 'Trade debtors', 'asset', true], ['1110', 'Open bills receivable', 'asset', true], ['1120', 'Staff debtors', 'asset', true],
  ['1200', 'Inventory', 'asset'], ['1400', 'VAT input', 'asset'], ['1500', 'Fixed assets', 'asset'], ['1590', 'Accumulated depreciation', 'contra_asset'],
  ['2000', 'Trade creditors', 'liability', true], ['2100', 'VAT output', 'liability'], ['2110', 'Tourism / catering levy payable', 'liability'],
  ['2200', 'Customer deposits', 'liability'], ['2210', 'Gift cards and vouchers', 'liability'], ['2300', 'Tips and service charge payable', 'liability'],
  ['2900', 'Unallocated receipts', 'liability'],
  ['3000', 'Owner capital', 'equity'], ['3100', 'Retained earnings', 'equity'], ['3900', 'Opening balance equity', 'equity'],
  ['4000', 'Food sales', 'income'], ['4010', 'Beverage sales', 'income'], ['4020', 'Other income', 'income'], ['4900', 'Sales discounts', 'contra_income'],
  ['5000', 'Cost of sales: food', 'cost_of_sales'], ['5010', 'Cost of sales: beverage', 'cost_of_sales'], ['5100', 'Stock count variance', 'cost_of_sales'],
  ['5110', 'Wastage and damages', 'cost_of_sales'], ['5120', 'Departmental consumables', 'cost_of_sales'], ['5130', 'Staff meals', 'cost_of_sales'],
  ['6000', 'Complimentary and entertainment', 'expense'], ['6010', 'Cash over and short', 'expense'], ['6020', 'Bad debts and bill write-offs', 'expense'],
  ['6030', 'Payment processing fees', 'expense'], ['6040', 'Depreciation', 'expense'], ['6100', 'Rent', 'expense'], ['6110', 'Electricity and water', 'expense'],
  ['6120', 'Salaries and wages', 'expense'], ['6130', 'Repairs and maintenance', 'expense'], ['6140', 'Marketing', 'expense'], ['6190', 'Other operating expenses', 'expense'],
  ['6990', 'Rounding', 'expense'],
];
const REASONS: [string, string][] = [['spoilage', 'Spoiled or expired'], ['breakage', 'Broken or spilled'], ['over_prep', 'Over-prepared'],
  ['customer_return', 'Customer sent it back'], ['kitchen_error', 'Kitchen error'], ['unexplained', 'Unexplained shortage'], ['other', 'Other (add a note)']];

export async function seedTenant(c: PoolClient, demo: boolean) {
  for (const [code, name, type, ctl] of CHART) await c.query('insert into accounts(code, name, type, is_control) values ($1,$2,$3,$4)', [code, name, type, !!ctl]);
  for (const [code, label] of REASONS) await c.query('insert into wastage_reasons values ($1,$2)', [code, label]);
  const o = await q1(c, "insert into outlets(name) values ('Main outlet') returning id");
  const mk = async (name: string, kind: string) => (await q1(c, 'insert into stores(outlet_id, name, kind) values ($1,$2,$3) returning id', [o.id, name, kind])).id;
  const main = await mk('Main store', 'store'), kitchen = await mk('Kitchen', 'kitchen'), butchery = await mk('Butchery', 'butchery'), bar = await mk('Bar', 'bar'), rest = await mk('Restaurant', 'restaurant');
  if (!demo) return;
  const acct = async (code: string) => (await q1(c, 'select id from accounts where code=$1', [code])).id;
  const food = await acct('4000'), bev = await acct('4010'), cf = await acct('5000'), cb = await acct('5010');
  const item = async (name: string, o: any) => (await q1(c, `insert into items(name, base_unit, is_sellable, is_stocked, sell_price, tax_rate_bp, revenue_account_id, cogs_account_id, production_store_id, category, last_cost)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`, [name, o.unit || 'each', !!o.sell, !!o.stock, o.price || 0, o.tax ?? 1600, o.rev || null, o.cogs || null, o.store || null, o.cat || null, o.cost || 0])).id;
  const beef = await item('Beef (raw)', { unit: 'kg', stock: true, store: butchery, cost: 75000, cat: 'Raw' });
  const onion = await item('Onions', { unit: 'kg', stock: true, store: kitchen, cost: 12000, cat: 'Raw' });
  const flour = await item('Wheat flour', { unit: 'kg', stock: true, store: kitchen, cost: 15000, cat: 'Raw' });
  const tusker = await item('Tusker Lager 500ml', { sell: true, stock: true, price: 30000, rev: bev, cogs: cb, store: bar, cost: 20000, cat: 'Beer' });
  const stew = await item('Beef stew', { sell: true, price: 65000, rev: food, cogs: cf, cat: 'Food' });
  const chapati = await item('Chapati', { sell: true, price: 5000, rev: food, cogs: cf, cat: 'Food' });
  await c.query('insert into recipe_components values ($1,$2,$3,0.25),($1,$4,$5,0.05)', [stew, beef, butchery, onion, kitchen]);
  await c.query('insert into recipe_components values ($1,$2,$3,0.1)', [chapati, flour, kitchen]);
  await c.query("insert into item_units values ($1,'carton',24)", [tusker]);
  await c.query("insert into parties(kind,name,phone,credit_limit) values ('supplier','General Supplier',null,0),('customer','Walk-in account','',500000)");
}

export async function provisionTenant(o: { slug: string; name: string; ownerName: string; email: string; password: string; pin?: string; demo?: boolean }) {
  const slug = String(o.slug || '').toLowerCase();
  if (!/^[a-z][a-z0-9-]{2,30}$/.test(slug)) throw bad('Business address must be 3 to 31 letters, numbers or hyphens, starting with a letter');
  const email = String(o.email || '').toLowerCase().trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('A valid email is required');
  if (!o.password || o.password.length < 8) throw bad('Password must be at least 8 characters');
  const cp = controlPool();
  if (await q1(cp, 'select 1 from tenants where slug=$1', [slug])) throw conflict('That business address is taken');
  const dbName = `t_${randomBytes(4).toString('hex')}_${slug.replace(/-/g, '_')}`.slice(0, 60);
  const t = await q1(cp, 'insert into tenants(slug, name, db_name) values ($1,$2,$3) returning *', [slug, o.name, dbName]);
  try {
    await ensureDatabase(dbName);
    await migrate(tenantPool(dbName), 'tenant');
    const userId = await tx(tenantPool(dbName), async (c) => {
      await seedTenant(c, !!o.demo);
      const u = await q1(c, "insert into users(name, role, pin_hash) values ($1,'owner',$2) returning id", [o.ownerName || 'Owner', o.pin ? hashSecret(String(o.pin)) : null]);
      return u.id as string;
    });
    await tx(cp, async (c) => {
      let idn = await q1(c, 'select * from identities where email=$1', [email]);
      if (!idn) idn = await q1(c, 'insert into identities(email, password_hash) values ($1,$2) returning *', [email, hashSecret(o.password)]);
      else if (!verifySecret(o.password, idn.password_hash)) throw conflict('That email already has an account. Use its existing password.');
      await c.query('insert into memberships(identity_id, tenant_id, tenant_user_id) values ($1,$2,$3)', [idn.id, t.id, userId]);
      await c.query("update tenants set status='active', schema_version=$2 where id=$1", [t.id, latestVersion('tenant')]);
      await c.query("insert into subscriptions(tenant_id, plan_code, status, trial_ends) values ($1,'trial','trial', current_date + $2::int)", [t.id, parseInt(process.env.TRIAL_DAYS || '30', 10)]);
    });
    return { tenantId: t.id as string, slug, dbName, userId };
  } catch (e) {
    await closeTenantPool(dbName);
    await dropDatabase(dbName).catch(() => {});
    await cp.query('delete from tenants where id=$1', [t.id]);
    throw e;
  }
}

export async function login(email: string, password: string, slug: string) {
  const cp = controlPool();
  const r = await q1(cp, `select i.password_hash, t.id tenant_id, t.db_name, t.name tenant_name, t.status, m.tenant_user_id
    from identities i join memberships m on m.identity_id=i.id join tenants t on t.id=m.tenant_id where i.email=$1 and t.slug=$2`, [String(email || '').toLowerCase().trim(), String(slug || '').toLowerCase()]);
  if (!r || !verifySecret(String(password || ''), r.password_hash)) throw new (require('./db').HttpError)(401, 'Wrong email, password or business address');
  if (r.status !== 'active') throw new (require('./db').HttpError)(403, `This business is ${r.status}`);
  const u = await q1(tenantPool(r.db_name), 'select * from users where id=$1 and active', [r.tenant_user_id]);
  if (!u) throw new (require('./db').HttpError)(403, 'This user is disabled');
  return { tenantId: r.tenant_id as string, tenantName: r.tenant_name as string, dbName: r.db_name as string, user: u };
}

export const listTenants = () => qa(controlPool(), 'select id, slug, name, db_name, status, schema_version, created_at from tenants order by created_at');

// Bounded-concurrency migration of every tenant database.
export async function migrateAll(concurrency = 4) {
  const ts = await qa(controlPool(), "select id, slug, db_name from tenants where status in ('active','suspended')");
  const out: any[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, ts.length || 1) }, async () => {
    while (i < ts.length) {
      const t = ts[i++];
      try {
        const applied = await migrate(tenantPool(t.db_name), 'tenant');
        await controlPool().query('update tenants set schema_version=$2 where id=$1', [t.id, latestVersion('tenant')]);
        out.push({ slug: t.slug, ok: true, applied });
      } catch (e: any) { out.push({ slug: t.slug, ok: false, error: e.message }); }
    }
  }));
  return out;
}

// ------------------------------------------------------------------ billing ----
const GRACE_DAYS = parseInt(process.env.BILLING_GRACE_DAYS || '7', 10);
export interface Access { status: string; writable: boolean; message: string | null; days_left: number | null; plan: string | null }
// A business with no subscription row is treated as active (grandfathered). Expired trials and unpaid plans become READ-ONLY, never locked out of their own data.
export async function subscriptionAccess(tenantId: string): Promise<Access> {
  const s = await q1(controlPool(), `select s.*, p.name plan_name, (current_date - s.period_end) over_days, (s.trial_ends - current_date) trial_left from subscriptions s join plans p on p.code=s.plan_code where s.tenant_id=$1`, [tenantId]);
  if (!s) return { status: 'active', writable: true, message: null, days_left: null, plan: null };
  if (s.status === 'cancelled') return { status: 'cancelled', writable: false, message: 'This subscription is cancelled. Your data is safe and can be read and exported.', days_left: null, plan: s.plan_name };
  if (s.status === 'trial') {
    if (s.trial_left < 0) return { status: 'trial_expired', writable: false, message: 'Your free trial has ended. Choose a plan to keep trading. Your data is safe and can still be read.', days_left: 0, plan: s.plan_name };
    return { status: 'trial', writable: true, message: s.trial_left <= 7 ? `Your free trial ends in ${s.trial_left} day(s).` : null, days_left: s.trial_left, plan: s.plan_name };
  }
  const od = (await q1(controlPool(), "select coalesce(max(current_date - due_date),0)::int d from billing_invoices where tenant_id=$1 and status='issued'", [tenantId])).d;
  if (od > GRACE_DAYS) return { status: 'past_due', writable: false, message: 'Your subscription payment is overdue, so the system is read-only. Pay your invoice to continue.', days_left: 0, plan: s.plan_name };
  if (od > 0) return { status: 'grace', writable: true, message: `Your subscription payment is overdue. Pay within ${GRACE_DAYS - od} day(s) to avoid interruption.`, days_left: GRACE_DAYS - od, plan: s.plan_name };
  if (s.status === 'past_due') return { status: 'awaiting_invoice', writable: true, message: 'Your plan is set. Your first invoice will arrive shortly.', days_left: null, plan: s.plan_name };
  return { status: 'active', writable: true, message: null, days_left: s.period_end ? -s.over_days : null, plan: s.plan_name };
}
export const listPlans = () => qa(controlPool(), 'select * from plans order by price_per_outlet');
export async function subscribe(slug: string, plan: string, outlets = 1) {
  const t = await q1(controlPool(), 'select id from tenants where slug=$1', [slug]);
  if (!t) throw bad('No such business');
  const p = await q1(controlPool(), 'select * from plans where code=$1', [plan]);
  if (!p) throw bad('No such plan');
  if (!Number.isInteger(outlets) || outlets < 1 || outlets > 500) throw bad('outlets must be 1 to 500');
  await controlPool().query(`insert into subscriptions(tenant_id, plan_code, status, outlets, trial_ends) values ($1,$2,$3,$4,$5)
    on conflict (tenant_id) do update set plan_code=$2, outlets=$4, status=case when $2='trial' then 'trial' else (case when subscriptions.status in ('trial','cancelled') then 'past_due' else subscriptions.status end) end, updated_at=now()`,
    [t.id, plan, plan === 'trial' ? 'trial' : 'past_due', outlets, plan === 'trial' ? new Date(Date.now() + p.trial_days * 86400000).toISOString().slice(0, 10) : null]);
  return { ok: true, note: plan === 'trial' ? 'On trial' : 'Plan set. Generate and collect the first invoice to activate it.' };
}
// One invoice per business per month, in advance. Safe to run daily.
export async function generateInvoices() {
  const subs = await qa(controlPool(), `select s.*, p.price_per_outlet from subscriptions s join plans p on p.code=s.plan_code
    where s.status in ('active','past_due') and s.plan_code <> 'trial' and (s.period_end is null or s.period_end < current_date + 3)`);
  const made: any[] = [];
  for (const s of subs) {
    const start = await q1(controlPool(), "select (coalesce($1::date + 1, current_date))::text s, (coalesce($1::date + 1, current_date) + interval '1 month' - interval '1 day')::date::text e, (current_date + 7)::text due", [s.period_end]);
    if (await q1(controlPool(), 'select 1 from billing_invoices where tenant_id=$1 and period_start=$2', [s.tenant_id, start.s])) continue;
    const n = await q1(controlPool(), "select 'INV' || lpad(nextval('invoice_seq')::text, 6, '0') n");
    const amount = s.price_per_outlet * s.outlets;
    await controlPool().query('insert into billing_invoices(number, tenant_id, period_start, period_end, amount, due_date) values ($1,$2,$3,$4,$5,$6)', [n.n, s.tenant_id, start.s, start.e, amount, start.due]);
    made.push({ number: n.n, tenant: s.tenant_id, amount });
  }
  return made;
}
export async function payInvoice(invoiceId: string, b: any) {
  const inv = await q1(controlPool(), 'select * from billing_invoices where id=$1', [invoiceId]);
  if (!inv) throw bad('No such invoice');
  if (inv.status !== 'issued') throw conflict(`Invoice is ${inv.status}`);
  const amount = Number(b.amount);
  if (!Number.isInteger(amount) || amount <= 0) throw bad('amount must be whole cents');
  await tx(controlPool(), async (c) => {
    await c.query('insert into billing_payments(invoice_id, amount, method, reference) values ($1,$2,$3,$4)', [invoiceId, amount, b.method || 'manual', b.reference ?? null]);
    const paid = (await q1(c, 'select coalesce(sum(amount),0)::bigint p from billing_payments where invoice_id=$1', [invoiceId])).p;
    if (paid >= inv.amount) {
      await c.query("update billing_invoices set status='paid' where id=$1", [invoiceId]);
      await c.query("update subscriptions set status='active', period_start=$2, period_end=$3, updated_at=now() where tenant_id=$1", [inv.tenant_id, inv.period_start, inv.period_end]);
    }
  });
  return { ok: true };
}
export const listInvoices = (status?: string) => qa(controlPool(), `select i.id, i.number, t.slug, i.period_start, i.period_end, i.amount, i.status, i.due_date,
  (select coalesce(sum(amount),0)::bigint from billing_payments p where p.invoice_id=i.id) paid from billing_invoices i join tenants t on t.id=i.tenant_id where ($1::text is null or i.status=$1) order by i.created_at desc limit 200`, [status ?? null]);
export async function tenantBilling(tenantId: string) {
  const access = await subscriptionAccess(tenantId);
  const sub = await q1(controlPool(), 'select s.plan_code, s.status, s.outlets, s.trial_ends, s.period_start, s.period_end, p.name plan, p.price_per_outlet from subscriptions s join plans p on p.code=s.plan_code where s.tenant_id=$1', [tenantId]);
  const invoices = await qa(controlPool(), 'select number, period_start, period_end, amount, status, due_date from billing_invoices where tenant_id=$1 order by created_at desc limit 24', [tenantId]);
  return { access, subscription: sub, invoices };
}
