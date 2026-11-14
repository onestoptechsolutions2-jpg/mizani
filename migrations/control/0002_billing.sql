create table plans (
  code text primary key,
  name text not null,
  price_per_outlet bigint not null check (price_per_outlet >= 0),   -- cents per month
  trial_days int not null default 30
);
insert into plans values ('trial','Free trial',0,30), ('core','Core',250000,0), ('restaurant','Restaurant pack',350000,0), ('hotel','Hotel and restaurant',1200000,0);
create table subscriptions (
  tenant_id uuid primary key references tenants(id),
  plan_code text not null references plans(code),
  status text not null check (status in ('trial','active','past_due','cancelled')),
  outlets int not null default 1 check (outlets >= 1),
  trial_ends date,
  period_start date,
  period_end date,
  updated_at timestamptz not null default now()
);
create sequence invoice_seq;
create table billing_invoices (
  id uuid primary key default gen_random_uuid(),
  number text unique not null,
  tenant_id uuid not null references tenants(id),
  period_start date not null,
  period_end date not null,
  amount bigint not null check (amount >= 0),
  status text not null default 'issued' check (status in ('issued','paid','void')),
  due_date date not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, period_start)
);
create table billing_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references billing_invoices(id),
  amount bigint not null check (amount > 0),
  method text not null,
  reference text,
  created_at timestamptz not null default now()
);
