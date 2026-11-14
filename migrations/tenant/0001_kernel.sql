-- ============================================================================
-- KERNEL: chart of accounts, parties, stores, items, the double-entry ledger
-- and the append-only stock ledger. Integrity is enforced by the database.
-- ============================================================================
create table settings (key text primary key, value text not null);
insert into settings values ('locked_through','1970-01-01'), ('opening_posted','false');

create table accounts (
  id serial primary key,
  code text unique not null,
  name text not null,
  type text not null check (type in ('asset','contra_asset','liability','equity','income','contra_income','cost_of_sales','expense')),
  is_control boolean not null default false,
  active boolean not null default true
);

create table parties (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('customer','supplier','staff')),
  name text not null,
  phone text,
  credit_limit bigint not null default 0 check (credit_limit >= 0),
  created_at timestamptz not null default now()
);

create table outlets (id uuid primary key default gen_random_uuid(), name text not null);
create table stores (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id),
  name text not null,
  kind text not null default 'store'
);

create table items (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  name text not null,
  base_unit text not null default 'each',
  is_sellable boolean not null default false,
  is_stocked boolean not null default false,
  sell_price bigint not null default 0 check (sell_price >= 0),       -- cents, tax inclusive
  tax_rate_bp int not null default 1600 check (tax_rate_bp >= 0),     -- basis points (1600 = 16%)
  revenue_account_id int references accounts(id),
  cogs_account_id int references accounts(id),
  production_store_id uuid references stores(id),
  category text,
  last_cost numeric(18,6) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table item_units (
  item_id uuid not null references items(id),
  unit text not null,
  factor numeric(18,6) not null check (factor > 0),                    -- units of base per 1 of this unit
  primary key (item_id, unit)
);

-- ---------------------------------------------------------------- ledger ---
create table journals (
  id uuid primary key default gen_random_uuid(),
  seq bigserial unique,
  business_date date not null,
  posted_at timestamptz not null default now(),
  source_type text not null,
  source_id uuid,
  idempotency_key text unique,
  reverses_id uuid references journals(id),
  memo text,
  created_by uuid
);
create table journal_lines (
  id bigserial primary key,
  journal_id uuid not null references journals(id),
  account_id int not null references accounts(id),
  debit bigint not null default 0 check (debit >= 0),
  credit bigint not null default 0 check (credit >= 0),
  store_id uuid,
  department text,
  party_id uuid,
  check ((debit = 0) <> (credit = 0))
);
create index on journal_lines (journal_id);
create index on journal_lines (account_id);
create index on journal_lines (party_id) where party_id is not null;
create index on journals (business_date);
create index on journals (source_type, source_id);

-- Every journal must have lines and must balance, checked at COMMIT.
create function trg_journal_balanced() returns trigger language plpgsql as $$
declare d bigint; c bigint; n int; jid uuid;
begin
  if tg_table_name = 'journals' then jid := new.id; else jid := new.journal_id; end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) into d, c, n
    from journal_lines where journal_id = jid;
  if n < 2 then raise exception 'journal % must have at least two lines', jid; end if;
  if d <> c then raise exception 'journal % is out of balance: debits % credits %', jid, d, c; end if;
  return null;
end $$;
create constraint trigger journals_balanced after insert on journals
  deferrable initially deferred for each row execute function trg_journal_balanced();
create constraint trigger journal_lines_balanced after insert on journal_lines
  deferrable initially deferred for each row execute function trg_journal_balanced();

-- Lines may only be added in the same transaction that created the journal.
create function trg_lines_same_tx() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from journals where id = new.journal_id and posted_at = transaction_timestamp()) then
    raise exception 'journal lines can only be added when the journal is created';
  end if;
  return new;
end $$;
create trigger journal_lines_same_tx before insert on journal_lines
  for each row execute function trg_lines_same_tx();

-- Append-only: no updates, deletes or truncates.
create function trg_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'ledger is append-only: % on % is not allowed. Post a reversal instead.', tg_op, tg_table_name;
end $$;
create trigger journals_immutable before update or delete on journals for each row execute function trg_immutable();
create trigger journal_lines_immutable before update or delete on journal_lines for each row execute function trg_immutable();
create trigger journals_no_truncate before truncate on journals for each statement execute function trg_immutable();
create trigger journal_lines_no_truncate before truncate on journal_lines for each statement execute function trg_immutable();

-- Locked periods reject new postings.
create function trg_journal_period() returns trigger language plpgsql as $$
begin
  if new.business_date <= (select value::date from settings where key = 'locked_through') then
    raise exception 'period is locked through %: cannot post on %', (select value from settings where key='locked_through'), new.business_date;
  end if;
  return new;
end $$;
create trigger journals_period before insert on journals for each row execute function trg_journal_period();

-- ----------------------------------------------------------- stock ledger ---
create table stock_moves (
  id bigserial primary key,
  item_id uuid not null references items(id),
  store_id uuid not null references stores(id),
  qty numeric(18,6) not null check (qty <> 0),
  value bigint not null,
  business_date date not null,
  source_type text not null,
  source_id uuid,
  note text,
  journal_id uuid references journals(id),
  created_at timestamptz not null default now()
);
create index on stock_moves (item_id, store_id);
create index on stock_moves (source_type, source_id);
create index on stock_moves (journal_id);
create trigger stock_moves_immutable before update or delete on stock_moves for each row execute function trg_immutable();
create trigger stock_moves_no_truncate before truncate on stock_moves for each statement execute function trg_immutable();

create table stock_balances (
  item_id uuid not null references items(id),
  store_id uuid not null references stores(id),
  qty numeric(18,6) not null default 0,
  value bigint not null default 0,
  primary key (item_id, store_id)
);
-- stock_balances can only be written from inside the stock_moves trigger.
create function trg_balances_guard() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() < 2 then
    raise exception 'stock_balances is derived from stock_moves and cannot be written directly';
  end if;
  return coalesce(new, old);
end $$;
create trigger stock_balances_guard before insert or update or delete on stock_balances
  for each row execute function trg_balances_guard();
create function trg_stock_moves_apply() returns trigger language plpgsql as $$
begin
  insert into stock_balances (item_id, store_id, qty, value) values (new.item_id, new.store_id, new.qty, new.value)
  on conflict (item_id, store_id) do update set qty = stock_balances.qty + excluded.qty, value = stock_balances.value + excluded.value;
  return null;
end $$;
create trigger stock_moves_apply after insert on stock_moves for each row execute function trg_stock_moves_apply();

-- Idempotency for every mutating command.
create table commands (
  key text primary key,
  route text,
  status int,
  response jsonb,
  created_at timestamptz not null default now()
);
