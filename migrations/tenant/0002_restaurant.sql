-- ============================================================================
-- RESTAURANT / BAR PACK: users, recipes, bills, purchases, stock takes,
-- wastage, expenses, approvals, business days.
-- ============================================================================
create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null check (role in ('owner','manager','accountant','storekeeper','cashier','waiter')),
  pin_hash text,
  identity_id uuid unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table recipe_components (
  menu_item_id uuid not null references items(id),
  component_item_id uuid not null references items(id),
  store_id uuid not null references stores(id),            -- the production store that holds this component
  qty numeric(18,6) not null check (qty > 0),              -- in the component's base unit, per 1 sold
  primary key (menu_item_id, component_item_id)
);

create table business_days (
  business_date date primary key,
  status text not null default 'open' check (status in ('open','closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid
);

create sequence bill_seq;
create table bills (
  id uuid primary key default gen_random_uuid(),
  number text unique not null,
  business_date date not null,
  status text not null default 'open' check (status in ('open','closed','void')),
  disposition text check (disposition in ('paid','credit','staff','complimentary','writeoff','void')),
  table_name text,
  customer_id uuid references parties(id),
  terminal_store_id uuid references stores(id),
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz,
  check (status <> 'closed' or disposition is not null)
);
create table bill_lines (
  id uuid primary key,
  bill_id uuid not null references bills(id),
  item_id uuid not null references items(id),
  qty numeric(18,6) not null check (qty > 0),
  unit_price bigint not null,
  discount bigint not null default 0 check (discount >= 0),
  gross bigint not null,
  payable bigint not null,
  tax bigint not null,
  net bigint not null,
  cogs_value bigint not null default 0,
  status text not null default 'active' check (status in ('active','removed')),
  prepared_at timestamptz,
  removed_at timestamptz,
  remove_reason text,
  replaces_line_id uuid,
  journal_id uuid references journals(id),
  created_at timestamptz not null default now()
);
create index on bill_lines (bill_id);
create table payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id),
  method text not null check (method in ('cash','mpesa','card')),
  amount bigint not null check (amount > 0),
  reference text,
  business_date date not null,
  journal_id uuid not null references journals(id),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create table bill_dispositions (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id),
  kind text not null check (kind in ('credit','staff','complimentary','writeoff')),
  amount bigint not null check (amount > 0),
  party_id uuid references parties(id),
  approver_id uuid,
  reason text,
  journal_id uuid not null references journals(id),
  created_at timestamptz not null default now()
);

create table purchases (
  id uuid primary key default gen_random_uuid(),
  number text unique not null,
  supplier_id uuid not null references parties(id),
  store_id uuid not null references stores(id),
  delivery_date date not null,
  entry_date date not null default current_date,
  late_entry boolean not null default false,
  reference text,
  total bigint not null check (total > 0),
  paid bigint not null default 0,
  journal_id uuid not null references journals(id),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create sequence purchase_seq;
create table purchase_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id),
  line_type text not null check (line_type in ('stock','expense','asset')),
  item_id uuid references items(id),
  account_id int references accounts(id),
  description text,
  qty numeric(18,6) not null check (qty > 0),
  unit text,
  factor numeric(18,6) not null default 1,
  unit_price bigint not null check (unit_price >= 0),                  -- per purchase unit, excluding VAT
  tax_rate_bp int not null default 0,
  line_net bigint not null,
  line_tax bigint not null,
  vat_claimable boolean not null default true,
  check ((line_type = 'stock' and item_id is not null) or (line_type <> 'stock' and account_id is not null))
);
create table supplier_payments (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id),
  method text not null check (method in ('cash','mpesa','card','bank')),
  amount bigint not null check (amount > 0),
  reference text,
  journal_id uuid not null references journals(id),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table stock_takes (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  store_id uuid not null references stores(id),
  status text not null default 'counting' check (status in ('counting','pending_approval','approved','rejected')),
  counted_by uuid not null,
  approved_by uuid,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  journal_id uuid references journals(id)
);
create sequence stock_take_seq;
create table stock_take_lines (
  take_id uuid not null references stock_takes(id),
  item_id uuid not null references items(id),
  counted_qty numeric(18,6),
  system_qty numeric(18,6),            -- hidden from the counter; filled at submit
  primary key (take_id, item_id)
);

create table wastage_reasons (code text primary key, label text not null);
create table wastage (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id),
  store_id uuid not null references stores(id),
  qty numeric(18,6) not null check (qty > 0),
  reason text not null references wastage_reasons(code),
  note text,
  business_date date not null,
  entry_date date not null default current_date,
  backdated boolean not null default false,
  status text not null default 'posted' check (status in ('posted','pending','rejected')),
  journal_id uuid references journals(id),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  account_id int not null references accounts(id),
  amount bigint not null check (amount > 0),
  vat bigint not null default 0,
  method text not null check (method in ('cash','mpesa','card','bank','credit')),
  supplier_id uuid references parties(id),
  description text,
  business_date date not null,
  journal_id uuid not null references journals(id),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create table cash_ups (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  expected bigint not null,
  counted bigint not null,
  variance bigint not null,
  journal_id uuid references journals(id),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('bill_void','stock_take','wastage')),
  subject_id uuid not null,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid not null,
  decided_by uuid,
  reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
