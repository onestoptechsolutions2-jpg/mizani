# Data dictionary (ARC-03)

Generated 2026-11-14 from the running system. Do not edit by hand: run `npm run docs:gen`.

Two kinds of database exist. The **control plane** holds the registry of businesses and sign-in identities. Each client business has its **own tenant database** with the tables below. Money is stored as integer cents; quantities as exact decimals.

## Control plane database

### `backups`
Record of each backup file taken.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | bigint | no | nextval('backups_id_seq'::regclass) |  |
| tenant_id | uuid | no |  |  |
| path | text | no |  |  |
| bytes | bigint | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `FOREIGN KEY (tenant_id) REFERENCES tenants(id)`; `PRIMARY KEY (id)`

### `billing_invoices`
Subscription invoices.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| number | text | no |  |  |
| tenant_id | uuid | no |  |  |
| period_start | date | no |  |  |
| period_end | date | no |  |  |
| amount | bigint | no |  |  |
| status | text | no | 'issued'::text |  |
| due_date | date | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((amount >= 0))`; `CHECK ((status = ANY (ARRAY['issued'::text, 'paid'::text, 'void'::text])))`; `FOREIGN KEY (tenant_id) REFERENCES tenants(id)`; `PRIMARY KEY (id)`; `UNIQUE (number)`; `UNIQUE (tenant_id, period_start)`

Indexes: `UNIQUE billing_invoices USING btree (number)`; `UNIQUE billing_invoices USING btree (tenant_id, period_start)`

### `billing_payments`
Payments received against subscription invoices.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| invoice_id | uuid | no |  |  |
| amount | bigint | no |  |  |
| method | text | no |  |  |
| reference | text | yes |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((amount > 0))`; `FOREIGN KEY (invoice_id) REFERENCES billing_invoices(id)`; `PRIMARY KEY (id)`

### `identities`
Sign-in identities (email and password hash).

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| email | text | no |  | Personal data |
| password_hash | text | no |  | Credential (scrypt hash) |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `PRIMARY KEY (id)`; `UNIQUE (email)`

Indexes: `UNIQUE identities USING btree (email)`

### `memberships`
Which identity belongs to which business and which user inside it.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| identity_id | uuid | no |  |  |
| tenant_id | uuid | no |  |  |
| tenant_user_id | uuid | no |  |  |

Constraints: `FOREIGN KEY (identity_id) REFERENCES identities(id)`; `FOREIGN KEY (tenant_id) REFERENCES tenants(id)`; `PRIMARY KEY (identity_id, tenant_id)`

### `plans`
Subscription plans.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| code | text | no |  |  |
| name | text | no |  |  |
| price_per_outlet | bigint | no |  |  |
| trial_days | integer | no | 30 |  |

Constraints: `CHECK ((price_per_outlet >= 0))`; `PRIMARY KEY (code)`

### `schema_migrations`
Applied database migrations.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| version | text | no |  |  |
| applied_at | timestamp with time zone | no | now() |  |

Constraints: `PRIMARY KEY (version)`

### `subscriptions`
Each business’s plan and status.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| tenant_id | uuid | no |  |  |
| plan_code | text | no |  |  |
| status | text | no |  |  |
| outlets | integer | no | 1 |  |
| trial_ends | date | yes |  |  |
| period_start | date | yes |  |  |
| period_end | date | yes |  |  |
| updated_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((outlets >= 1))`; `CHECK ((status = ANY (ARRAY['trial'::text, 'active'::text, 'past_due'::text, 'cancelled'::text])))`; `FOREIGN KEY (plan_code) REFERENCES plans(code)`; `FOREIGN KEY (tenant_id) REFERENCES tenants(id)`; `PRIMARY KEY (tenant_id)`

### `tenants`
One row per client business: its database name, status and schema version.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| slug | text | no |  |  |
| name | text | no |  |  |
| db_name | text | no |  |  |
| status | text | no | 'provisioning'::text |  |
| schema_version | text | yes |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((slug ~ '^[a-z][a-z0-9-]{2,30}$'::text))`; `CHECK ((status = ANY (ARRAY['provisioning'::text, 'active'::text, 'suspended'::text, 'deleted'::text])))`; `PRIMARY KEY (id)`; `UNIQUE (db_name)`; `UNIQUE (slug)`

Indexes: `UNIQUE tenants USING btree (slug)`; `UNIQUE tenants USING btree (db_name)`

## Tenant database (one per client)

### `accounts`
Chart of accounts.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | integer | no | nextval('accounts_id_seq'::regclass) |  |
| code | text | no |  |  |
| name | text | no |  |  |
| type | text | no |  |  |
| is_control | boolean | no | false |  |
| active | boolean | no | true |  |

Constraints: `CHECK ((type = ANY (ARRAY['asset'::text, 'contra_asset'::text, 'liability'::text, 'equity'::text, 'income'::text, 'contra_income'::text, 'cost_of_sales'::text, 'expense'::text])))`; `PRIMARY KEY (id)`; `UNIQUE (code)`

Indexes: `UNIQUE accounts USING btree (code)`

### `approvals`
Queue of requests that need a second person.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| kind | text | no |  |  |
| subject_id | uuid | no |  |  |
| payload | jsonb | no | '{}'::jsonb |  |
| status | text | no | 'pending'::text |  |
| requested_by | uuid | no |  |  |
| decided_by | uuid | yes |  |  |
| reason | text | yes |  |  |
| created_at | timestamp with time zone | no | now() |  |
| decided_at | timestamp with time zone | yes |  |  |

Constraints: `CHECK ((kind = ANY (ARRAY['bill_void'::text, 'stock_take'::text, 'wastage'::text, 'leave'::text])))`; `CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))`; `PRIMARY KEY (id)`

### `bill_charges`
Service charges added to bills.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| bill_id | uuid | no |  |  |
| kind | text | no | 'service_charge'::text |  |
| amount | bigint | no |  |  |
| status | text | no | 'active'::text |  |
| journal_id | uuid | no |  |  |
| created_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((amount > 0))`; `CHECK ((status = ANY (ARRAY['active'::text, 'removed'::text])))`; `FOREIGN KEY (bill_id) REFERENCES bills(id)`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `PRIMARY KEY (id)`

### `bill_dispositions`
How an unpaid balance was closed (credit, staff, complimentary, write-off).

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| bill_id | uuid | no |  |  |
| kind | text | no |  |  |
| amount | bigint | no |  |  |
| party_id | uuid | yes |  |  |
| approver_id | uuid | yes |  |  |
| reason | text | yes |  |  |
| journal_id | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |
| reservation_id | uuid | yes |  |  |

Constraints: `CHECK ((amount > 0))`; `CHECK ((kind = ANY (ARRAY['credit'::text, 'staff'::text, 'complimentary'::text, 'writeoff'::text, 'room'::text])))`; `FOREIGN KEY (bill_id) REFERENCES bills(id)`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `FOREIGN KEY (party_id) REFERENCES parties(id)`; `PRIMARY KEY (id)`

### `bill_lines`
Items on a bill, each with its own posting.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no |  |  |
| bill_id | uuid | no |  |  |
| item_id | uuid | no |  |  |
| qty | numeric(18,6) | no |  |  |
| unit_price | bigint | no |  |  |
| discount | bigint | no | 0 |  |
| gross | bigint | no |  |  |
| payable | bigint | no |  |  |
| tax | bigint | no |  |  |
| net | bigint | no |  |  |
| cogs_value | bigint | no | 0 |  |
| status | text | no | 'active'::text |  |
| prepared_at | timestamp with time zone | yes |  |  |
| removed_at | timestamp with time zone | yes |  |  |
| remove_reason | text | yes |  |  |
| replaces_line_id | uuid | yes |  |  |
| journal_id | uuid | yes |  |  |
| created_at | timestamp with time zone | no | now() |  |
| levy | bigint | no | 0 |  |
| kot_sent_at | timestamp with time zone | yes |  |  |

Constraints: `CHECK ((discount >= 0))`; `CHECK ((qty > (0)::numeric))`; `CHECK ((status = ANY (ARRAY['active'::text, 'removed'::text, 'refunded'::text])))`; `FOREIGN KEY (bill_id) REFERENCES bills(id)`; `FOREIGN KEY (item_id) REFERENCES items(id)`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `PRIMARY KEY (id)`

Indexes: `bill_lines USING btree (bill_id)`

### `bills`
Customer bills (orders).

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| number | text | no |  |  |
| business_date | date | no |  |  |
| status | text | no | 'open'::text |  |
| disposition | text | yes |  |  |
| table_name | text | yes |  |  |
| customer_id | uuid | yes |  |  |
| terminal_store_id | uuid | yes |  |  |
| opened_by | uuid | no |  |  |
| opened_at | timestamp with time zone | no | now() |  |
| closed_by | uuid | yes |  |  |
| closed_at | timestamp with time zone | yes |  |  |
| outlet_id | uuid | yes |  |  |

Constraints: `CHECK (((status <> 'closed'::text) OR (disposition IS NOT NULL)))`; `CHECK ((disposition = ANY (ARRAY['paid'::text, 'credit'::text, 'staff'::text, 'complimentary'::text, 'writeoff'::text, 'void'::text, 'room'::text])))`; `CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'void'::text])))`; `FOREIGN KEY (customer_id) REFERENCES parties(id)`; `FOREIGN KEY (outlet_id) REFERENCES outlets(id)`; `FOREIGN KEY (terminal_store_id) REFERENCES stores(id)`; `PRIMARY KEY (id)`; `UNIQUE (number)`

Indexes: `UNIQUE bills USING btree (number)`

### `business_days`
Trading days and their open/closed state.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| business_date | date | no |  |  |
| status | text | no | 'open'::text |  |
| opened_at | timestamp with time zone | no | now() |  |
| closed_at | timestamp with time zone | yes |  |  |
| closed_by | uuid | yes |  |  |

Constraints: `CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))`; `PRIMARY KEY (business_date)`

### `cash_ups`
Cash counts and variances.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| business_date | date | no |  |  |
| expected | bigint | no |  |  |
| counted | bigint | no |  |  |
| variance | bigint | no |  |  |
| journal_id | uuid | yes |  |  |
| created_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `PRIMARY KEY (id)`

### `commands`
Idempotency keys and stored responses for every mutating call.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| key | text | no |  |  |
| route | text | yes |  |  |
| status | integer | yes |  |  |
| response | jsonb | yes |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `PRIMARY KEY (key)`

### `depreciation_runs`
Months already depreciated.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| period | text | no |  |  |
| journal_id | uuid | yes |  |  |
| total | bigint | no |  |  |
| created_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((period ~ '^\d{4}-\d{2}$'::text))`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `PRIMARY KEY (period)`

### `employees`
Staff records for HR and payroll.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| name | text | no |  | Personal data |
| id_number | text | yes |  | Personal data (national ID) |
| kra_pin | text | yes |  | Personal tax identifier |
| nssf_no | text | yes |  | Personal identifier |
| sha_no | text | yes |  | Personal identifier (health) |
| basic_salary | bigint | no |  | Financial, confidential |
| allowances | bigint | no | 0 | Financial, confidential |
| start_date | date | no | CURRENT_DATE |  |
| status | text | no | 'active'::text |  |
| party_id | uuid | yes |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((allowances >= 0))`; `CHECK ((basic_salary >= 0))`; `CHECK ((status = ANY (ARRAY['active'::text, 'terminated'::text])))`; `FOREIGN KEY (party_id) REFERENCES parties(id)`; `PRIMARY KEY (id)`

### `expenses`
Operating expenses.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| account_id | integer | no |  |  |
| amount | bigint | no |  |  |
| vat | bigint | no | 0 |  |
| method | text | no |  |  |
| supplier_id | uuid | yes |  |  |
| description | text | yes |  |  |
| business_date | date | no |  |  |
| journal_id | uuid | no |  |  |
| created_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((amount > 0))`; `CHECK ((method = ANY (ARRAY['cash'::text, 'mpesa'::text, 'card'::text, 'bank'::text, 'credit'::text])))`; `FOREIGN KEY (account_id) REFERENCES accounts(id)`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `FOREIGN KEY (supplier_id) REFERENCES parties(id)`; `PRIMARY KEY (id)`

### `fixed_assets`
Fixed-asset register.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| name | text | no |  |  |
| cost | bigint | no |  |  |
| salvage | bigint | no | 0 |  |
| life_months | integer | no |  |  |
| acquired | date | no |  |  |
| accumulated | bigint | no | 0 |  |
| status | text | no | 'active'::text |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((salvage < cost))`; `CHECK ((cost > 0))`; `CHECK ((life_months > 0))`; `CHECK ((salvage >= 0))`; `CHECK ((status = ANY (ARRAY['active'::text, 'disposed'::text])))`; `PRIMARY KEY (id)`

### `folio_charges`
Charges on a guest folio.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| reservation_id | uuid | no |  |  |
| kind | text | no |  |  |
| description | text | no |  |  |
| amount | bigint | no |  |  |
| business_date | date | no |  |  |
| journal_id | uuid | no |  |  |
| created_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((amount > 0))`; `CHECK ((kind = ANY (ARRAY['room'::text, 'extra'::text, 'pos'::text])))`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `FOREIGN KEY (reservation_id) REFERENCES reservations(id)`; `PRIMARY KEY (id)`

Indexes: `UNIQUE folio_charges USING btree (reservation_id, business_date) WHERE (kind = 'room'::text)`

### `folio_payments`
Payments and transfers on a guest folio.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| reservation_id | uuid | no |  |  |
| method | text | no |  |  |
| amount | bigint | no |  |  |
| journal_id | uuid | no |  |  |
| created_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((amount > 0))`; `CHECK ((method = ANY (ARRAY['cash'::text, 'mpesa'::text, 'card'::text, 'bank'::text, 'deposit'::text, 'transfer'::text])))`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `FOREIGN KEY (reservation_id) REFERENCES reservations(id)`; `PRIMARY KEY (id)`

### `gift_cards`
Gift cards sold (balance = amount minus redemptions).

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| code | text | no |  |  |
| amount | bigint | no |  |  |
| journal_id | uuid | no |  |  |
| sold_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((amount > 0))`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `PRIMARY KEY (code)`

### `item_units`
Purchase units and their exact conversion to the base unit.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| item_id | uuid | no |  |  |
| unit | text | no |  |  |
| factor | numeric(18,6) | no |  |  |

Constraints: `CHECK ((factor > (0)::numeric))`; `FOREIGN KEY (item_id) REFERENCES items(id)`; `PRIMARY KEY (item_id, unit)`

### `items`
Menu items and stock items.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| sku | text | yes |  |  |
| name | text | no |  |  |
| base_unit | text | no | 'each'::text |  |
| is_sellable | boolean | no | false |  |
| is_stocked | boolean | no | false |  |
| sell_price | bigint | no | 0 |  |
| tax_rate_bp | integer | no | 1600 |  |
| revenue_account_id | integer | yes |  |  |
| cogs_account_id | integer | yes |  |  |
| production_store_id | uuid | yes |  |  |
| category | text | yes |  |  |
| last_cost | numeric(18,6) | no | 0 |  |
| active | boolean | no | true |  |
| created_at | timestamp with time zone | no | now() |  |
| barcode | text | yes |  |  |
| reorder_level | numeric(18,6) | no | 0 |  |

Constraints: `CHECK ((sell_price >= 0))`; `CHECK ((tax_rate_bp >= 0))`; `FOREIGN KEY (cogs_account_id) REFERENCES accounts(id)`; `FOREIGN KEY (production_store_id) REFERENCES stores(id)`; `FOREIGN KEY (revenue_account_id) REFERENCES accounts(id)`; `PRIMARY KEY (id)`; `UNIQUE (barcode)`; `UNIQUE (sku)`

Indexes: `UNIQUE items USING btree (sku)`; `UNIQUE items USING btree (barcode)`

### `journal_lines`
Ledger lines (debits and credits). Append-only, balanced at commit.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | bigint | no | nextval('journal_lines_id_seq'::regclass) |  |
| journal_id | uuid | no |  |  |
| account_id | integer | no |  |  |
| debit | bigint | no | 0 |  |
| credit | bigint | no | 0 |  |
| store_id | uuid | yes |  |  |
| department | text | yes |  |  |
| party_id | uuid | yes |  |  |
| outlet_id | uuid | yes |  |  |

Constraints: `CHECK (((debit = 0) <> (credit = 0)))`; `CHECK ((credit >= 0))`; `CHECK ((debit >= 0))`; `FOREIGN KEY (account_id) REFERENCES accounts(id)`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `PRIMARY KEY (id)`; `TRIGGER DEFERRABLE INITIALLY DEFERRED`

Indexes: `journal_lines USING btree (journal_id)`; `journal_lines USING btree (account_id)`; `journal_lines USING btree (party_id) WHERE (party_id IS NOT NULL)`; `journal_lines USING btree (outlet_id) WHERE (outlet_id IS NOT NULL)`

### `journals`
Ledger headers. Append-only.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| seq | bigint | no | nextval('journals_seq_seq'::regclass) |  |
| business_date | date | no |  |  |
| posted_at | timestamp with time zone | no | now() |  |
| source_type | text | no |  |  |
| source_id | uuid | yes |  |  |
| idempotency_key | text | yes |  |  |
| reverses_id | uuid | yes |  |  |
| memo | text | yes |  |  |
| created_by | uuid | yes |  |  |

Constraints: `FOREIGN KEY (reverses_id) REFERENCES journals(id)`; `PRIMARY KEY (id)`; `TRIGGER DEFERRABLE INITIALLY DEFERRED`; `UNIQUE (idempotency_key)`; `UNIQUE (seq)`

Indexes: `UNIQUE journals USING btree (seq)`; `UNIQUE journals USING btree (idempotency_key)`; `journals USING btree (business_date)`; `journals USING btree (source_type, source_id)`

### `leave_requests`
Leave requests and decisions.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| employee_id | uuid | no |  |  |
| kind | text | no | 'annual'::text | May reveal health or family status (sick, maternity) |
| start_date | date | no |  |  |
| end_date | date | no |  |  |
| days | numeric(6,2) | no |  |  |
| status | text | no | 'pending'::text |  |
| requested_by | uuid | no |  |  |
| decided_by | uuid | yes |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((end_date >= start_date))`; `CHECK ((days > (0)::numeric))`; `CHECK ((kind = ANY (ARRAY['annual'::text, 'sick'::text, 'maternity'::text, 'paternity'::text, 'unpaid'::text, 'other'::text])))`; `CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))`; `FOREIGN KEY (employee_id) REFERENCES employees(id)`; `PRIMARY KEY (id)`

### `loyalty_ledger`
Loyalty points earned and redeemed.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | bigint | no | nextval('loyalty_ledger_id_seq'::regclass) |  |
| customer_id | uuid | no |  |  |
| points | integer | no |  |  |
| kind | text | no |  |  |
| bill_id | uuid | yes |  |  |
| journal_id | uuid | yes |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((kind = ANY (ARRAY['accrual'::text, 'redemption'::text])))`; `CHECK ((points <> 0))`; `FOREIGN KEY (bill_id) REFERENCES bills(id)`; `FOREIGN KEY (customer_id) REFERENCES parties(id)`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `PRIMARY KEY (id)`

Indexes: `loyalty_ledger USING btree (customer_id)`

### `notifications`
Nightly reports and alerts sent or skipped.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | bigint | no | nextval('notifications_id_seq'::regclass) |  |
| kind | text | no |  |  |
| message | text | no |  |  |
| status | text | no | 'queued'::text |  |
| detail | text | yes |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))`; `PRIMARY KEY (id)`

### `outlets`
Trading locations of the business.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| name | text | no |  |  |

Constraints: `PRIMARY KEY (id)`

### `parties`
Customers, suppliers and staff (sub-ledger owners).

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| kind | text | no |  |  |
| name | text | no |  | Personal data |
| phone | text | yes |  | Personal data |
| credit_limit | bigint | no | 0 | Financial |
| created_at | timestamp with time zone | no | now() |  |
| price_list_id | uuid | yes |  |  |
| terms_days | integer | no | 30 |  |

Constraints: `CHECK ((credit_limit >= 0))`; `CHECK ((kind = ANY (ARRAY['customer'::text, 'supplier'::text, 'staff'::text])))`; `FOREIGN KEY (price_list_id) REFERENCES price_lists(id)`; `PRIMARY KEY (id)`

### `payments`
Customer payments against bills.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| bill_id | uuid | no |  |  |
| method | text | no |  |  |
| amount | bigint | no |  |  |
| reference | text | yes |  | Payment reference |
| business_date | date | no |  |  |
| journal_id | uuid | no |  |  |
| created_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |
| tip | bigint | no | 0 |  |

Constraints: `CHECK ((amount > 0))`; `CHECK ((method = ANY (ARRAY['cash'::text, 'mpesa'::text, 'card'::text, 'deposit'::text, 'giftcard'::text, 'points'::text])))`; `CHECK ((tip >= 0))`; `FOREIGN KEY (bill_id) REFERENCES bills(id)`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `PRIMARY KEY (id)`

### `payroll_runs`
One row per monthly payroll.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| period | text | no |  |  |
| journal_id | uuid | no |  |  |
| gross | bigint | no |  |  |
| net | bigint | no |  |  |
| paid | bigint | no | 0 |  |
| rates | jsonb | no |  |  |
| created_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((period ~ '^\d{4}-\d{2}$'::text))`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `PRIMARY KEY (id)`; `UNIQUE (period)`

Indexes: `UNIQUE payroll_runs USING btree (period)`

### `payslips`
One payslip per employee per run.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| run_id | uuid | no |  |  |
| employee_id | uuid | no |  |  |
| gross | bigint | no |  | Financial, confidential |
| nssf_ee | bigint | no |  |  |
| nssf_er | bigint | no |  |  |
| shif | bigint | no |  |  |
| housing_ee | bigint | no |  |  |
| housing_er | bigint | no |  |  |
| taxable | bigint | no |  |  |
| paye | bigint | no |  | Financial, confidential |
| staff_recovery | bigint | no | 0 |  |
| net | bigint | no |  | Financial, confidential |

Constraints: `FOREIGN KEY (employee_id) REFERENCES employees(id)`; `FOREIGN KEY (run_id) REFERENCES payroll_runs(id)`; `PRIMARY KEY (id)`; `UNIQUE (run_id, employee_id)`

Indexes: `UNIQUE payslips USING btree (run_id, employee_id)`

### `price_list_items`
Prices within a price list.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| price_list_id | uuid | no |  |  |
| item_id | uuid | no |  |  |
| price | bigint | no |  |  |

Constraints: `CHECK ((price >= 0))`; `FOREIGN KEY (item_id) REFERENCES items(id)`; `FOREIGN KEY (price_list_id) REFERENCES price_lists(id)`; `PRIMARY KEY (price_list_id, item_id)`

### `price_lists`
Wholesale price lists.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| name | text | no |  |  |

Constraints: `PRIMARY KEY (id)`; `UNIQUE (name)`

Indexes: `UNIQUE price_lists USING btree (name)`

### `productions`
Prep and batch production runs.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| output_item_id | uuid | no |  |  |
| store_id | uuid | no |  |  |
| qty | numeric(18,6) | no |  |  |
| total_cost | bigint | no |  |  |
| journal_id | uuid | yes |  |  |
| created_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((qty > (0)::numeric))`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `FOREIGN KEY (output_item_id) REFERENCES items(id)`; `FOREIGN KEY (store_id) REFERENCES stores(id)`; `PRIMARY KEY (id)`

### `promotions`
Automatic percentage promotions.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| name | text | no |  |  |
| item_id | uuid | yes |  |  |
| percent_bp | integer | no |  |  |
| starts | date | yes |  |  |
| ends | date | yes |  |  |
| active | boolean | no | true |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK (((percent_bp > 0) AND (percent_bp <= 10000)))`; `FOREIGN KEY (item_id) REFERENCES items(id)`; `PRIMARY KEY (id)`

### `purchase_lines`
Lines of a purchase (stock, expense or asset), one price per line.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| purchase_id | uuid | no |  |  |
| line_type | text | no |  |  |
| item_id | uuid | yes |  |  |
| account_id | integer | yes |  |  |
| description | text | yes |  |  |
| qty | numeric(18,6) | no |  |  |
| unit | text | yes |  |  |
| factor | numeric(18,6) | no | 1 |  |
| unit_price | bigint | no |  |  |
| tax_rate_bp | integer | no | 0 |  |
| line_net | bigint | no |  |  |
| line_tax | bigint | no |  |  |
| vat_claimable | boolean | no | true |  |

Constraints: `CHECK ((((line_type = 'stock'::text) AND (item_id IS NOT NULL)) OR ((line_type <> 'stock'::text) AND (account_id IS NOT NULL))))`; `CHECK ((line_type = ANY (ARRAY['stock'::text, 'expense'::text, 'asset'::text])))`; `CHECK ((qty > (0)::numeric))`; `CHECK ((unit_price >= 0))`; `FOREIGN KEY (account_id) REFERENCES accounts(id)`; `FOREIGN KEY (item_id) REFERENCES items(id)`; `FOREIGN KEY (purchase_id) REFERENCES purchases(id)`; `PRIMARY KEY (id)`

### `purchase_return_lines`
Lines of a purchase return.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| return_id | uuid | no |  |  |
| purchase_line_id | uuid | no |  |  |
| qty | numeric(18,6) | no |  |  |
| value | bigint | no |  |  |
| tax | bigint | no |  |  |

Constraints: `CHECK ((qty > (0)::numeric))`; `FOREIGN KEY (purchase_line_id) REFERENCES purchase_lines(id)`; `FOREIGN KEY (return_id) REFERENCES purchase_returns(id)`; `PRIMARY KEY (return_id, purchase_line_id)`

### `purchase_returns`
Stock returned to suppliers.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| purchase_id | uuid | no |  |  |
| amount | bigint | no |  |  |
| reason | text | no |  |  |
| journal_id | uuid | no |  |  |
| created_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((amount > 0))`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `FOREIGN KEY (purchase_id) REFERENCES purchases(id)`; `PRIMARY KEY (id)`

### `purchases`
Supplier deliveries.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| number | text | no |  |  |
| supplier_id | uuid | no |  |  |
| store_id | uuid | no |  |  |
| delivery_date | date | no |  |  |
| entry_date | date | no | CURRENT_DATE |  |
| late_entry | boolean | no | false |  |
| reference | text | yes |  |  |
| total | bigint | no |  |  |
| paid | bigint | no | 0 |  |
| journal_id | uuid | no |  |  |
| created_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |
| returned | bigint | no | 0 |  |

Constraints: `CHECK ((total > 0))`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `FOREIGN KEY (store_id) REFERENCES stores(id)`; `FOREIGN KEY (supplier_id) REFERENCES parties(id)`; `PRIMARY KEY (id)`; `UNIQUE (number)`

Indexes: `UNIQUE purchases USING btree (number)`

### `recipe_components`
What each menu item consumes and from which store.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| menu_item_id | uuid | no |  |  |
| component_item_id | uuid | no |  |  |
| store_id | uuid | no |  |  |
| qty | numeric(18,6) | no |  |  |

Constraints: `CHECK ((qty > (0)::numeric))`; `FOREIGN KEY (component_item_id) REFERENCES items(id)`; `FOREIGN KEY (menu_item_id) REFERENCES items(id)`; `FOREIGN KEY (store_id) REFERENCES stores(id)`; `PRIMARY KEY (menu_item_id, component_item_id)`

### `refunds`
Refunds of paid bill lines, with approver.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| bill_id | uuid | no |  |  |
| line_id | uuid | no |  |  |
| amount | bigint | no |  |  |
| method | text | no |  |  |
| restock | boolean | no |  |  |
| reason | text | no |  |  |
| approver_id | uuid | no |  |  |
| journal_id | uuid | no |  |  |
| created_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((amount > 0))`; `CHECK ((method = ANY (ARRAY['cash'::text, 'mpesa'::text, 'card'::text, 'deposit'::text])))`; `FOREIGN KEY (bill_id) REFERENCES bills(id)`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `FOREIGN KEY (line_id) REFERENCES bill_lines(id)`; `PRIMARY KEY (id)`

### `reservations`
Hotel bookings and stays.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| number | text | no |  |  |
| guest_id | uuid | no |  |  |
| room_type_id | uuid | no |  |  |
| room_id | uuid | yes |  |  |
| check_in | date | no |  |  |
| check_out | date | no |  |  |
| rate | bigint | no |  |  |
| adults | integer | no | 1 |  |
| status | text | no | 'booked'::text |  |
| notes | text | yes |  |  |
| created_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((check_out > check_in))`; `CHECK ((rate >= 0))`; `CHECK ((status = ANY (ARRAY['booked'::text, 'checked_in'::text, 'checked_out'::text, 'cancelled'::text, 'no_show'::text])))`; `FOREIGN KEY (guest_id) REFERENCES parties(id)`; `FOREIGN KEY (room_id) REFERENCES rooms(id)`; `FOREIGN KEY (room_type_id) REFERENCES room_types(id)`; `PRIMARY KEY (id)`; `UNIQUE (number)`

Indexes: `UNIQUE reservations USING btree (number)`

### `room_types`
Hotel room types and rates.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| name | text | no |  |  |
| rate | bigint | no |  |  |
| tax_rate_bp | integer | no | 1600 |  |

Constraints: `CHECK ((rate >= 0))`; `PRIMARY KEY (id)`; `UNIQUE (name)`

Indexes: `UNIQUE room_types USING btree (name)`

### `rooms`
Hotel rooms and housekeeping status.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| number | text | no |  |  |
| room_type_id | uuid | no |  |  |
| status | text | no | 'clean'::text |  |

Constraints: `CHECK ((status = ANY (ARRAY['clean'::text, 'dirty'::text, 'occupied'::text, 'out_of_order'::text, 'maintenance'::text])))`; `FOREIGN KEY (room_type_id) REFERENCES room_types(id)`; `PRIMARY KEY (id)`; `UNIQUE (number)`

Indexes: `UNIQUE rooms USING btree (number)`

### `sales_orders`
Wholesale orders awaiting delivery.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| number | text | no |  |  |
| customer_id | uuid | no |  |  |
| status | text | no | 'open'::text |  |
| lines | jsonb | no |  |  |
| bill_id | uuid | yes |  |  |
| created_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((status = ANY (ARRAY['open'::text, 'delivered'::text, 'cancelled'::text])))`; `FOREIGN KEY (bill_id) REFERENCES bills(id)`; `FOREIGN KEY (customer_id) REFERENCES parties(id)`; `PRIMARY KEY (id)`; `UNIQUE (number)`

Indexes: `UNIQUE sales_orders USING btree (number)`

### `schema_migrations`
Applied database migrations.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| version | text | no |  |  |
| applied_at | timestamp with time zone | no | now() |  |

Constraints: `PRIMARY KEY (version)`

### `settings`
Per-business settings (period lock, opening balances flag).

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| key | text | no |  |  |
| value | text | no |  |  |

Constraints: `PRIMARY KEY (key)`

### `stock_balances`
Derived stock per item and store. Written only by trigger.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| item_id | uuid | no |  |  |
| store_id | uuid | no |  |  |
| qty | numeric(18,6) | no | 0 |  |
| value | bigint | no | 0 |  |

Constraints: `FOREIGN KEY (item_id) REFERENCES items(id)`; `FOREIGN KEY (store_id) REFERENCES stores(id)`; `PRIMARY KEY (item_id, store_id)`

### `stock_moves`
Append-only stock ledger.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | bigint | no | nextval('stock_moves_id_seq'::regclass) |  |
| item_id | uuid | no |  |  |
| store_id | uuid | no |  |  |
| qty | numeric(18,6) | no |  |  |
| value | bigint | no |  |  |
| business_date | date | no |  |  |
| source_type | text | no |  |  |
| source_id | uuid | yes |  |  |
| note | text | yes |  |  |
| journal_id | uuid | yes |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((qty <> (0)::numeric))`; `FOREIGN KEY (item_id) REFERENCES items(id)`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `FOREIGN KEY (store_id) REFERENCES stores(id)`; `PRIMARY KEY (id)`

Indexes: `stock_moves USING btree (item_id, store_id)`; `stock_moves USING btree (source_type, source_id)`; `stock_moves USING btree (journal_id)`

### `stock_take_lines`
Counted and system quantities per item.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| take_id | uuid | no |  |  |
| item_id | uuid | no |  |  |
| counted_qty | numeric(18,6) | yes |  |  |
| system_qty | numeric(18,6) | yes |  |  |

Constraints: `FOREIGN KEY (item_id) REFERENCES items(id)`; `FOREIGN KEY (take_id) REFERENCES stock_takes(id)`; `PRIMARY KEY (take_id, item_id)`

### `stock_takes`
Stock counts.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| number | text | no |  |  |
| store_id | uuid | no |  |  |
| status | text | no | 'counting'::text |  |
| counted_by | uuid | no |  |  |
| approved_by | uuid | yes |  |  |
| created_at | timestamp with time zone | no | now() |  |
| submitted_at | timestamp with time zone | yes |  |  |
| approved_at | timestamp with time zone | yes |  |  |
| journal_id | uuid | yes |  |  |

Constraints: `CHECK ((status = ANY (ARRAY['counting'::text, 'pending_approval'::text, 'approved'::text, 'rejected'::text])))`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `FOREIGN KEY (store_id) REFERENCES stores(id)`; `PRIMARY KEY (id)`

### `stores`
Stock locations (kitchen, bar, butchery…).

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| outlet_id | uuid | no |  |  |
| name | text | no |  |  |
| kind | text | no | 'store'::text |  |

Constraints: `FOREIGN KEY (outlet_id) REFERENCES outlets(id)`; `PRIMARY KEY (id)`

### `supplier_payments`
Payments to suppliers.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| purchase_id | uuid | no |  |  |
| method | text | no |  |  |
| amount | bigint | no |  |  |
| reference | text | yes |  | Payment reference |
| journal_id | uuid | no |  |  |
| created_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((amount > 0))`; `CHECK ((method = ANY (ARRAY['cash'::text, 'mpesa'::text, 'card'::text, 'bank'::text])))`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `FOREIGN KEY (purchase_id) REFERENCES purchases(id)`; `PRIMARY KEY (id)`

### `users`
People who work in the business, with role and optional PIN.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| name | text | no |  | Personal data |
| role | text | no |  |  |
| pin_hash | text | yes |  | Credential (scrypt hash) |
| identity_id | uuid | yes |  |  |
| active | boolean | no | true |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'accountant'::text, 'storekeeper'::text, 'cashier'::text, 'waiter'::text])))`; `PRIMARY KEY (id)`; `UNIQUE (identity_id)`

Indexes: `UNIQUE users USING btree (identity_id)`

### `wastage`
Wastage entries.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() |  |
| item_id | uuid | no |  |  |
| store_id | uuid | no |  |  |
| qty | numeric(18,6) | no |  |  |
| reason | text | no |  |  |
| note | text | yes |  |  |
| business_date | date | no |  |  |
| entry_date | date | no | CURRENT_DATE |  |
| backdated | boolean | no | false |  |
| status | text | no | 'posted'::text |  |
| journal_id | uuid | yes |  |  |
| created_by | uuid | no |  |  |
| created_at | timestamp with time zone | no | now() |  |

Constraints: `CHECK ((qty > (0)::numeric))`; `CHECK ((status = ANY (ARRAY['posted'::text, 'pending'::text, 'rejected'::text])))`; `FOREIGN KEY (item_id) REFERENCES items(id)`; `FOREIGN KEY (journal_id) REFERENCES journals(id)`; `FOREIGN KEY (reason) REFERENCES wastage_reasons(code)`; `FOREIGN KEY (store_id) REFERENCES stores(id)`; `PRIMARY KEY (id)`

### `wastage_reasons`
Allowed wastage reasons.

| Column | Type | Null | Default | Sensitivity |
|---|---|---|---|---|
| code | text | no |  |  |
| label | text | no |  |  |

Constraints: `PRIMARY KEY (code)`

## Integrity triggers (tenant database)

These are what make the ledger trustworthy. They run inside the database, so no application bug can bypass them.

| Table | Trigger | When | Event |
|---|---|---|---|
| journal_lines | journal_lines_balanced | AFTER | INSERT |
| journal_lines | journal_lines_immutable | BEFORE | UPDATE or DELETE |
| journal_lines | journal_lines_same_tx | BEFORE | INSERT |
| journals | journals_balanced | AFTER | INSERT |
| journals | journals_immutable | BEFORE | UPDATE or DELETE |
| journals | journals_period | BEFORE | INSERT |
| stock_balances | stock_balances_guard | BEFORE | DELETE or UPDATE or INSERT |
| stock_moves | stock_moves_apply | AFTER | INSERT |
| stock_moves | stock_moves_immutable | BEFORE | UPDATE or DELETE |
