-- Control plane: tenant registry, identities, routing. No business data lives here.
create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z][a-z0-9-]{2,30}$'),
  name text not null,
  db_name text unique not null,
  status text not null default 'provisioning' check (status in ('provisioning','active','suspended','deleted')),
  schema_version text,
  created_at timestamptz not null default now()
);
create table identities (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table memberships (
  identity_id uuid not null references identities(id),
  tenant_id uuid not null references tenants(id),
  tenant_user_id uuid not null,
  primary key (identity_id, tenant_id)
);
create table backups (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id),
  path text not null,
  bytes bigint not null,
  created_at timestamptz not null default now()
);
