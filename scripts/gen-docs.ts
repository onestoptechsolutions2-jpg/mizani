// Generates documentation that must match the running system: data dictionary, dependency register,
// API reference, access matrix, test inventory. Run: npm run docs:gen  (needs Postgres, see README).
import fs from 'fs';
import path from 'path';
process.env.CONTROL_DB = 'mizani_docs_control';
import { Pool } from 'pg';
import { adminPool, closeAll, controlPool, dropDatabase, ensureDatabase, tenantPool } from '../src/db';
import { initControl } from '../src/control';
import { migrate } from '../src/migrate';
import { can } from '../src/security';

const out = (f: string, s: string) => fs.writeFileSync(path.join('docs', f), s);
const esc = (s: any) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const stamp = `Generated ${new Date().toISOString().slice(0, 10)} from the running system. Do not edit by hand: run \`npm run docs:gen\`.`;

const PURPOSE: Record<string, string> = {
  tenants: 'One row per client business: its database name, status and schema version', identities: 'Sign-in identities (email and password hash)', memberships: 'Which identity belongs to which business and which user inside it', backups: 'Record of each backup file taken',
  accounts: 'Chart of accounts', parties: 'Customers, suppliers and staff (sub-ledger owners)', outlets: 'Trading locations of the business', stores: 'Stock locations (kitchen, bar, butchery…)', items: 'Menu items and stock items', item_units: 'Purchase units and their exact conversion to the base unit',
  journals: 'Ledger headers. Append-only', journal_lines: 'Ledger lines (debits and credits). Append-only, balanced at commit', stock_moves: 'Append-only stock ledger', stock_balances: 'Derived stock per item and store. Written only by trigger', settings: 'Per-business settings (period lock, opening balances flag)', commands: 'Idempotency keys and stored responses for every mutating call',
  users: 'People who work in the business, with role and optional PIN', bill_charges: 'Service charges added to bills', refunds: 'Refunds of paid bill lines, with approver', purchase_returns: 'Stock returned to suppliers', purchase_return_lines: 'Lines of a purchase return', gift_cards: 'Gift cards sold (balance = amount minus redemptions)', loyalty_ledger: 'Loyalty points earned and redeemed', productions: 'Prep and batch production runs', fixed_assets: 'Fixed-asset register', depreciation_runs: 'Months already depreciated', room_types: 'Hotel room types and rates', rooms: 'Hotel rooms and housekeeping status', reservations: 'Hotel bookings and stays', folio_charges: 'Charges on a guest folio', folio_payments: 'Payments and transfers on a guest folio', employees: 'Staff records for HR and payroll', leave_requests: 'Leave requests and decisions', payroll_runs: 'One row per monthly payroll', payslips: 'One payslip per employee per run', promotions: 'Automatic percentage promotions', price_lists: 'Wholesale price lists', price_list_items: 'Prices within a price list', sales_orders: 'Wholesale orders awaiting delivery', notifications: 'Nightly reports and alerts sent or skipped', plans: 'Subscription plans', subscriptions: 'Each business’s plan and status', billing_invoices: 'Subscription invoices', billing_payments: 'Payments received against subscription invoices', recipe_components: 'What each menu item consumes and from which store', business_days: 'Trading days and their open/closed state', bills: 'Customer bills (orders)', bill_lines: 'Items on a bill, each with its own posting', payments: 'Customer payments against bills', bill_dispositions: 'How an unpaid balance was closed (credit, staff, complimentary, write-off)',
  purchases: 'Supplier deliveries', purchase_lines: 'Lines of a purchase (stock, expense or asset), one price per line', supplier_payments: 'Payments to suppliers', stock_takes: 'Stock counts', stock_take_lines: 'Counted and system quantities per item', wastage_reasons: 'Allowed wastage reasons', wastage: 'Wastage entries', expenses: 'Operating expenses', cash_ups: 'Cash counts and variances', approvals: 'Queue of requests that need a second person', schema_migrations: 'Applied database migrations',
};
const SENSITIVE: Record<string, string> = { 'identities.email': 'Personal data', 'identities.password_hash': 'Credential (scrypt hash)', 'users.pin_hash': 'Credential (scrypt hash)', 'users.name': 'Personal data', 'parties.name': 'Personal data', 'parties.phone': 'Personal data', 'parties.credit_limit': 'Financial', 'payments.reference': 'Payment reference', 'employees.name': 'Personal data', 'employees.id_number': 'Personal data (national ID)', 'employees.kra_pin': 'Personal tax identifier', 'employees.nssf_no': 'Personal identifier', 'employees.sha_no': 'Personal identifier (health)', 'employees.basic_salary': 'Financial, confidential', 'employees.allowances': 'Financial, confidential', 'payslips.gross': 'Financial, confidential', 'payslips.net': 'Financial, confidential', 'payslips.paye': 'Financial, confidential', 'leave_requests.kind': 'May reveal health or family status (sick, maternity)', 'supplier_payments.reference': 'Payment reference' };

async function dictionary() {
  const tmp = 'mizani_docs_tenant';
  await dropDatabase(tmp); await ensureDatabase(tmp);
  const tp = tenantPool(tmp); await migrate(tp, 'tenant');
  let md = `# Data dictionary (ARC-03)\n\n${stamp}\n\nTwo kinds of database exist. The **control plane** holds the registry of businesses and sign-in identities. Each client business has its **own tenant database** with the tables below. Money is stored as integer cents; quantities as exact decimals.\n`;
  for (const [title, pool] of [['Control plane database', controlPool()], ['Tenant database (one per client)', tp]] as [string, Pool][]) {
    md += `\n## ${title}\n`;
    const tables = (await pool.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name")).rows;
    for (const { table_name: t } of tables) {
      md += `\n### \`${t}\`\n${PURPOSE[t] ? PURPOSE[t] + '.' : ''}\n\n| Column | Type | Null | Default | Sensitivity |\n|---|---|---|---|---|\n`;
      for (const c of (await pool.query("select column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position", [t])).rows) {
        const type = c.data_type + (c.numeric_precision && c.data_type === 'numeric' ? `(${c.numeric_precision},${c.numeric_scale})` : '');
        md += `| ${c.column_name} | ${type} | ${c.is_nullable === 'YES' ? 'yes' : 'no'} | ${esc(c.column_default)} | ${SENSITIVE[t + '.' + c.column_name] || ''} |\n`;
      }
      const cons = (await pool.query("select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid=('public.'||quote_ident($1))::regclass order by contype, conname", [t])).rows;
      if (cons.length) md += `\nConstraints: ${cons.map((c) => `\`${c.d.replace(/\s+/g, ' ')}\``).join('; ')}\n`;
      const idx = (await pool.query("select indexdef from pg_indexes where schemaname='public' and tablename=$1 and indexname not like '%_pkey'", [t])).rows;
      if (idx.length) md += `\nIndexes: ${idx.map((i) => `\`${i.indexdef.replace(/^CREATE (UNIQUE )?INDEX \S+ ON public\./, '$1')}\``).join('; ')}\n`;
    }
  }
  const trg = (await tp.query("select event_object_table t, trigger_name, action_timing, string_agg(event_manipulation, ' or ') ev from information_schema.triggers where trigger_schema='public' group by 1,2,3 order by 1,2")).rows;
  md += `\n## Integrity triggers (tenant database)\n\nThese are what make the ledger trustworthy. They run inside the database, so no application bug can bypass them.\n\n| Table | Trigger | When | Event |\n|---|---|---|---|\n` + trg.map((r) => `| ${r.t} | ${r.trigger_name} | ${r.action_timing} | ${r.ev} |`).join('\n') + '\n';
  out('DATA_DICTIONARY.md', md);
  await closeAll(); await (async () => { const { Pool } = require('pg'); })();
}

function dependencies() {
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const rows: any[] = [];
  for (const [p, v] of Object.entries<any>(lock.packages)) {
    if (!p) continue;
    const name = p.replace(/^.*node_modules\//, '');
    let lic = v.license; try { lic ||= JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8')).license; } catch {}
    rows.push({ name, version: v.version, dev: !!v.dev, optional: !!v.optional, lic: typeof lic === 'string' ? lic : JSON.stringify(lic || 'unknown'), direct: !!(pkg.dependencies?.[name] || pkg.devDependencies?.[name]) });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const prod = rows.filter((r) => !r.dev), dev = rows.filter((r) => r.dev);
  const counts = (rs: any[]) => Object.entries(rs.reduce((m: any, r) => ((m[r.lic] = (m[r.lic] || 0) + 1), m), {})).sort((a: any, b: any) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(', ');
  let md = `# Technology stack and dependency register (ARC-02)\n\n${stamp}\n\n## Platform\n\n| Component | Version | Notes |\n|---|---|---|\n| Node.js | 22 LTS (container \`node:22-alpine\`) | Runtime |\n| TypeScript | ${pkg.devDependencies.typescript} | Compiled to CommonJS |\n| PostgreSQL | 16 (container \`postgres:16-alpine\`) | One database per client plus a control database |\n| Docker Compose | v2 | Packaging. **Not executed in the build environment**, see KNOWN_ISSUES |\n\n## Direct dependencies\n\n| Package | Version | Licence | Scope |\n|---|---|---|---|\n` + rows.filter((r) => r.direct).map((r) => `| ${r.name} | ${r.version} | ${r.lic} | ${r.dev ? 'development' : 'production'} |`).join('\n');
  md += `\n\n## Licence summary\n\nProduction packages (${prod.length}, including transitive): ${counts(prod)}\n\nDevelopment-only packages (${dev.length}): ${counts(dev)}\n\nNo copyleft (GPL/AGPL) licence appears in the production set unless listed above. Re-check on every dependency change.\n\n## All production packages\n\n| Package | Version | Licence |\n|---|---|---|\n` + prod.map((r) => `| ${r.name} | ${r.version} | ${r.lic} |`).join('\n') + '\n';
  md += `\n## Support status\n\nVersions are pinned by \`package-lock.json\`. Run \`npm audit\` and \`npm outdated\` before each release. A named owner for dependency upkeep has not been assigned.\n`;
  out('DEPENDENCIES.md', md);
}

function api() {
  const src = fs.readFileSync('src/server.ts', 'utf8');
  const routes = [...src.matchAll(/route\('(GET|POST|PATCH|DELETE)', '([^']+)', '([^']+)'/g)].map((m) => ({ m: m[1], p: '/api' + m[2], perm: m[3] }));
  const pub = [['POST', '/api/signup', 'public (rate limited)'], ['POST', '/api/auth/login', 'public (rate limited)'], ['GET', '/healthz', 'public'], ['GET', '/', 'public (web app)'], ['GET', '/api/platform/tenants', 'platform token'], ['POST', '/api/platform/migrate', 'platform token']];
  const roles = ['owner', 'manager', 'accountant', 'storekeeper', 'cashier', 'waiter'] as const;
  const who = (perm: string) => roles.filter((r) => can(r, perm)).join(', ');
  let md = `# API reference (ARC-04)\n\n${stamp}\n\nBase URL: the address the app is served from. All endpoints are JSON over HTTPS (terminate TLS in front of the app).\n\n## Authentication\n\n1. \`POST /api/signup\` creates a business and returns a token. \`POST /api/auth/login\` with \`{slug, email, password}\` returns a token.\n2. Send \`Authorization: Bearer <token>\` on every other call. Tokens last 12 hours and are bound to one business.\n3. Each call runs in one database transaction. Either everything in it posts or nothing does.\n\n## Idempotency\n\nAdd the header \`Idempotency-Key: <unique string>\` to any POST, PATCH or DELETE. Replaying the same key returns the original response and posts nothing twice. Use one key per form submission.\n\n## Money and quantities\n\nMoney is **integer cents** (KES 650.00 is \`65000\`). Quantities are decimal strings with at most 6 decimals (\`"1.42"\`). Anything with more precision is rejected, never rounded.\n\n## Errors\n\n| Status | Meaning |\n|---|---|\n| 400 | The request is invalid (missing or malformed field) |\n| 401 | Not signed in, or the token expired |\n| 403 | Your role cannot do this, or a manager approval was missing or invalid |\n| 404 | Not found |\n| 409 | The business rule refused it (period locked, unbalanced, already closed, payment too large…). The message says why |\n| 429 | Too many attempts |\n| 500 | Our fault. Nothing was posted |\n\nBody: \`{"error": "message", "detail": …}\`.\n\n## Examples\n\n\`\`\`bash\nTOKEN=$(curl -s localhost:3000/api/auth/login -H 'content-type: application/json' \\\n  -d '{"slug":"my-lounge","email":"me@example.com","password":"…"}' | jq -r .token)\n\ncurl -s localhost:3000/api/bills -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"table_name":"T4"}'\ncurl -s localhost:3000/api/bills/$BILL/lines -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"item_id":"…","qty":"2"}'\ncurl -s localhost:3000/api/bills/$BILL/payments -H "authorization: Bearer $TOKEN" -H 'Idempotency-Key: pay-001' -H 'content-type: application/json' -d '{"method":"cash","amount":130000}'\ncurl -s localhost:3000/api/reconcile -H "authorization: Bearer $TOKEN"\n\`\`\`\n\n## Versioning\n\nThere is no version prefix yet (v0.1). Breaking changes will add \`/api/v2\` and keep \`/api\` working for one release.\n\n## Endpoints\n\n| Method | Path | Permission | Roles allowed |\n|---|---|---|---|\n` + pub.map(([m, p, w]) => `| ${m} | ${p} | ${w} | |`).join('\n') + '\n' + routes.map((r) => `| ${r.m} | ${r.p} | ${r.perm} | ${who(r.perm)} |`).join('\n') + '\n';
  out('API.md', md);
  return routes;
}

function access() {
  const perms = ['read', 'sell', 'discount', 'count', 'stock', 'purchase', 'approve', 'override', 'money', 'report', 'setup', 'admin', 'hotel', 'housekeeping', 'hr', 'payroll'];
  const roles = ['owner', 'manager', 'accountant', 'storekeeper', 'cashier', 'waiter'] as const;
  let md = `# Authentication and access control matrix (SEC-01)\n\n${stamp}\n\n## Roles and permissions\n\n| Permission | ${roles.join(' | ')} |\n|---|${roles.map(() => '---').join('|')}|\n` + perms.map((p) => `| ${p} | ${roles.map((r) => (can(r, p) ? '✔' : '')).join(' | ')} |`).join('\n');
  md += `\n\nWhat the permissions mean: **sell** take orders and payments. **discount** give discounts. **count** perform stock counts. **stock** see stock and move it. **purchase** record deliveries. **approve** approve voids, stock counts and late wastage. **override** act as the manager who approves complimentary, staff deductions, write-offs, credit over limit and removal of prepared items (needs PIN). **money** expenses, cash, banking, receipts, day close. **report** financial reports. **setup** items, recipes, people. **admin** lock a period, change settings, add outlets. **hotel** reservations, folios, check-in and out. **housekeeping** room status. **hr** employees, leave, payroll preview. **payroll** run and pay payroll, remit to authorities.\n\n## Separation of duties built into the system\n\n- The person who counts stock cannot approve the count, and never sees the system quantity.\n- Nobody can approve their own request. Manager approvals on a bill must come from a different person than the one at the till.\n- Credit within a customer's limit needs no approval. Anything over needs a manager PIN.\n- Voids go through a request and an approval by a different person.\n\n## Authentication\n\n| Control | Status |\n|---|---|\n| Password storage | scrypt with per-user salt |\n| Manager PIN storage | scrypt with per-user salt |\n| Session | Signed token, 12 hours, bound to one business |\n| Disabled users | Rejected on the next request |\n| Suspended business | Rejected within 30 seconds |\n| Brute-force protection | 10 sign-in attempts per 5 minutes per address and email; 10 signups per hour. **In memory, per process** |\n| Multi-factor authentication | **Not implemented** |\n| Password reset | **Not implemented** |\n| Account lifecycle | Users can be added. **There is no screen to disable or remove one yet** (the database flag exists) |\n| Privileged platform access | One shared platform token set in the environment; disabled when empty. Also gates billing operations |\n| Outbound notifications | The business-supplied web address must be https and must not resolve to a private, loopback or link-local address. Checked when sending, redirects refused, 5 second timeout |\n`;
  out('SECURITY_ACCESS.md', md);
}

function tests() {
  let md = `# Test plan and test cases (TST-01)\n\n${stamp}\n\n## Scope\n\nThe ledger and the restaurant workflows. The test suite is the executable form of the *Posting Matrix & Acceptance Tests* document. Every test runs against a real PostgreSQL database with a freshly provisioned client database, through the real API.\n\n## Entry and exit criteria\n\n- **Entry:** migrations apply cleanly to an empty database; the project compiles.\n- **Exit:** all tests pass; every one ends by asserting the invariants I1 to I15 and a zero trial-balance difference; the randomised soak test passes with at least three different seeds (both soak tests).\n\n## Test data\n\nEach test creates its own business (own database) with: 6 users (owner, 2 managers, waiter, cashier, storekeeper, accountant), 5 stores, a beef raw item, a stew menu item with a recipe, a bottled beer sold in cartons of 24, a supplier, customers (one with a low credit limit) and a staff member. The soak test uses a seeded random generator (\`SOAK_SEED\`, \`SOAK_OPS\`) so any failure can be replayed.\n\n## Invariants asserted after every scenario\n\nI1 trial balance nets to zero and every journal balances; I2 open-bills control equals open bill balances; I3 debtor/creditor lines name a party; I4 Inventory equals stock valuation; I5 stock balances equal the sum of moves; I6 each bill line posts exactly its own amount; I7 stock issued equals cost recorded; I8 append-only triggers present; I9 no overpaid bills; I10 closed bills have no balance and a disposition; I11 every posting has a source document; I12 purchase payable equals its lines; I13 hotel guest ledger equals open folios; I14 payroll runs equal their payslips; I15 fixed-asset register equals accumulated depreciation.\n\n## Test cases\n\n| File | Test |\n|---|---|\n`;
  for (const f of ['acceptance', 'soak', 'features', 'soak2']) {
    const s = fs.readFileSync(`test/${f}.test.ts`, 'utf8');
    for (const m of s.matchAll(/test(\.todo)?\('([^']+)'/g)) md += `| ${f}.test.ts | ${m[2]}${m[1] ? ' **(not built yet)**' : ''} |\n`;
  }
  md += `\n## Not covered by automated tests\n\nBrowser-level interaction on real devices, printing, offline operation, integrations (not built), load and performance at scale, security penetration testing, and accessibility audit. See KNOWN_ISSUES.\n\n## How to run\n\n\`\`\`bash\ndocker compose --profile test run --rm test      # in containers\nnpm test                                         # locally with PGHOST/PGUSER/PGPASSWORD set\nSOAK_SEED=7 SOAK_OPS=1000 npm test               # a different random run\n\`\`\`\n`;
  out('TEST_PLAN.md', md);
}

(async () => {
  await initControl();
  const routes = api(); access(); dependencies(); tests();
  await dictionary();
  console.log(`docs generated; ${routes.length} routes documented`);
  await dropDatabase('mizani_docs_tenant').catch(() => {});
})().catch((e) => { console.error(e); process.exit(1); });
