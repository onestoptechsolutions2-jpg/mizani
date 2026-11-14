-- ============================================================================
-- Release 0.2: refunds, returns, tips, deposits, gift cards, loyalty, levy,
-- production, depreciation, hotel, HR/payroll, retail, wholesale, outlets.
-- Additive only: the previous release still runs against this schema.
-- ============================================================================
insert into accounts(code, name, type, is_control) values
  ('1130','Guest ledger (hotel folios)','asset',true),
  ('2220','Loyalty points liability','liability',false),
  ('2400','PAYE payable','liability',false), ('2410','NSSF payable','liability',false),
  ('2420','SHIF payable','liability',false), ('2430','Affordable housing levy payable','liability',false),
  ('2440','Net salaries payable','liability',false),
  ('4100','Room revenue','income',false),
  ('6121','Employer statutory contributions','expense',false),
  ('6150','Loyalty expense','expense',false)
on conflict (code) do nothing;

-- dimensions -----------------------------------------------------------------
alter table journal_lines add column outlet_id uuid;
create index on journal_lines (outlet_id) where outlet_id is not null;
alter table bills add column outlet_id uuid references outlets(id);
alter table bill_lines add column levy bigint not null default 0, add column kot_sent_at timestamptz;
alter table items add column barcode text unique, add column reorder_level numeric(18,6) not null default 0;
alter table parties add column price_list_id uuid, add column terms_days int not null default 30;

-- bill changes ---------------------------------------------------------------
alter table bill_lines drop constraint bill_lines_status_check;
alter table bill_lines add constraint bill_lines_status_check check (status in ('active','removed','refunded'));
alter table payments drop constraint payments_method_check;
alter table payments add constraint payments_method_check check (method in ('cash','mpesa','card','deposit','giftcard','points'));
alter table payments add column tip bigint not null default 0 check (tip >= 0);
alter table bill_dispositions drop constraint bill_dispositions_kind_check;
alter table bill_dispositions add constraint bill_dispositions_kind_check check (kind in ('credit','staff','complimentary','writeoff','room'));
alter table bill_dispositions add column reservation_id uuid;
alter table bills drop constraint bills_disposition_check;
alter table bills add constraint bills_disposition_check check (disposition in ('paid','credit','staff','complimentary','writeoff','void','room'));
alter table approvals drop constraint approvals_kind_check;
alter table approvals add constraint approvals_kind_check check (kind in ('bill_void','stock_take','wastage','leave'));

create table bill_charges (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id),
  kind text not null default 'service_charge',
  amount bigint not null check (amount > 0),
  status text not null default 'active' check (status in ('active','removed')),
  journal_id uuid not null references journals(id),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create table refunds (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id),
  line_id uuid not null references bill_lines(id),
  amount bigint not null check (amount > 0),
  method text not null check (method in ('cash','mpesa','card','deposit')),
  restock boolean not null,
  reason text not null,
  approver_id uuid not null,
  journal_id uuid not null references journals(id),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

-- purchase returns ------------------------------------------------------------
alter table purchases add column returned bigint not null default 0;
create table purchase_returns (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id),
  amount bigint not null check (amount > 0),
  reason text not null,
  journal_id uuid not null references journals(id),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create table purchase_return_lines (
  return_id uuid not null references purchase_returns(id),
  purchase_line_id uuid not null references purchase_lines(id),
  qty numeric(18,6) not null check (qty > 0),
  value bigint not null, tax bigint not null,
  primary key (return_id, purchase_line_id)
);

-- gift cards, loyalty --------------------------------------------------------
create table gift_cards (
  code text primary key,
  amount bigint not null check (amount > 0),
  journal_id uuid not null references journals(id),
  sold_by uuid not null,
  created_at timestamptz not null default now()
);
create table loyalty_ledger (
  id bigserial primary key,
  customer_id uuid not null references parties(id),
  points int not null check (points <> 0),
  kind text not null check (kind in ('accrual','redemption')),
  bill_id uuid references bills(id),
  journal_id uuid references journals(id),
  created_at timestamptz not null default now()
);
create index on loyalty_ledger (customer_id);

-- production, assets ------------------------------------------------------------
create table productions (
  id uuid primary key default gen_random_uuid(),
  output_item_id uuid not null references items(id),
  store_id uuid not null references stores(id),
  qty numeric(18,6) not null check (qty > 0),
  total_cost bigint not null,
  journal_id uuid references journals(id),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create table fixed_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cost bigint not null check (cost > 0),
  salvage bigint not null default 0 check (salvage >= 0),
  life_months int not null check (life_months > 0),
  acquired date not null,
  accumulated bigint not null default 0,
  status text not null default 'active' check (status in ('active','disposed')),
  created_at timestamptz not null default now(),
  check (salvage < cost)
);
create table depreciation_runs (
  period text primary key check (period ~ '^\d{4}-\d{2}$'),
  journal_id uuid references journals(id),
  total bigint not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

-- hotel -------------------------------------------------------------------------
create table room_types (id uuid primary key default gen_random_uuid(), name text unique not null, rate bigint not null check (rate >= 0), tax_rate_bp int not null default 1600);
create table rooms (
  id uuid primary key default gen_random_uuid(),
  number text unique not null,
  room_type_id uuid not null references room_types(id),
  status text not null default 'clean' check (status in ('clean','dirty','occupied','out_of_order','maintenance'))
);
create sequence reservation_seq;
create table reservations (
  id uuid primary key default gen_random_uuid(),
  number text unique not null,
  guest_id uuid not null references parties(id),
  room_type_id uuid not null references room_types(id),
  room_id uuid references rooms(id),
  check_in date not null,
  check_out date not null,
  rate bigint not null check (rate >= 0),
  adults int not null default 1,
  status text not null default 'booked' check (status in ('booked','checked_in','checked_out','cancelled','no_show')),
  notes text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (check_out > check_in)
);
create table folio_charges (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id),
  kind text not null check (kind in ('room','extra','pos')),
  description text not null,
  amount bigint not null check (amount > 0),
  business_date date not null,
  journal_id uuid not null references journals(id),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create unique index folio_one_room_charge_per_night on folio_charges (reservation_id, business_date) where kind = 'room';
create table folio_payments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id),
  method text not null check (method in ('cash','mpesa','card','bank','deposit','transfer')),
  amount bigint not null check (amount > 0),
  journal_id uuid not null references journals(id),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

-- HR and payroll ------------------------------------------------------------------
create table employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  id_number text, kra_pin text, nssf_no text, sha_no text,
  basic_salary bigint not null check (basic_salary >= 0),
  allowances bigint not null default 0 check (allowances >= 0),
  start_date date not null default current_date,
  status text not null default 'active' check (status in ('active','terminated')),
  party_id uuid references parties(id),
  created_at timestamptz not null default now()
);
create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  kind text not null default 'annual' check (kind in ('annual','sick','maternity','paternity','unpaid','other')),
  start_date date not null, end_date date not null,
  days numeric(6,2) not null check (days > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid not null, decided_by uuid,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create table payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period text unique not null check (period ~ '^\d{4}-\d{2}$'),
  journal_id uuid not null references journals(id),
  gross bigint not null, net bigint not null, paid bigint not null default 0,
  rates jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create table payslips (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references payroll_runs(id),
  employee_id uuid not null references employees(id),
  gross bigint not null, nssf_ee bigint not null, nssf_er bigint not null, shif bigint not null,
  housing_ee bigint not null, housing_er bigint not null, taxable bigint not null, paye bigint not null,
  staff_recovery bigint not null default 0, net bigint not null,
  unique (run_id, employee_id)
);

-- retail / wholesale ----------------------------------------------------------------
create table promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  item_id uuid references items(id),
  percent_bp int not null check (percent_bp > 0 and percent_bp <= 10000),
  starts date, ends date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table price_lists (id uuid primary key default gen_random_uuid(), name text unique not null);
create table price_list_items (
  price_list_id uuid not null references price_lists(id),
  item_id uuid not null references items(id),
  price bigint not null check (price >= 0),
  primary key (price_list_id, item_id)
);
alter table parties add constraint parties_price_list_fk foreign key (price_list_id) references price_lists(id);
create sequence order_seq;
create table sales_orders (
  id uuid primary key default gen_random_uuid(),
  number text unique not null,
  customer_id uuid not null references parties(id),
  status text not null default 'open' check (status in ('open','delivered','cancelled')),
  lines jsonb not null,
  bill_id uuid references bills(id),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

-- notifications ----------------------------------------------------------------------
create table notifications (
  id bigserial primary key,
  kind text not null,
  message text not null,
  status text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  detail text,
  created_at timestamptz not null default now()
);
