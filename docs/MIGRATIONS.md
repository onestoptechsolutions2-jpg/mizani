# Database migration procedure (DEP-04)

## How it works

SQL files in `migrations/control/` and `migrations/tenant/`, applied in filename order, each in one transaction, recorded in `schema_migrations`. A database-wide advisory lock stops two migrators colliding. A migration that fails rolls back and stops that database; the others carry on.

- Control database: migrated at every app start.
- Tenant databases: migrated at every app start (`migrateAll`, up to 4 at once), when created, and on demand with `cli migrate-all`.

## Writing a migration

1. Add `migrations/tenant/NNNN_description.sql` with the next number. Never edit a file that has been released.
2. **Expand then contract.** Add columns and tables first (nullable or with defaults); remove old ones in a later release. That way the previous version of the app still runs against the new schema, which makes rollback possible.
3. Never drop or rewrite ledger tables. They are append-only by trigger; a migration that needs to touch them must be reviewed by the accountant and the system owner.
4. Keep each migration fast; locks time out after 10 seconds.
5. Add or update a test.

## Prechecks

- Backup taken (BACKUP_RESTORE.md).
- Applied on a copy of a real client database first: restore a dump to a scratch database, run the migration, run `GET /api/reconcile`.

## Execution

`docker compose up -d --build` applies them at start. Then `docker compose exec api node dist/cli.js migrate-all` prints, per client, `ok` and the files applied.

## Validation

Every client reports `ok`; the control database `tenants.schema_version` equals the newest file; `GET /api/reconcile` is all green for a sample of clients.

## Rollback

Forward-only. Options: a corrective migration, or restore that client from the pre-release backup and redeploy the previous code.

## Known gap

There is no automatic check that a migration is backwards compatible with the previous release.

## Release history

| File | Release | Notes |
|---|---|---|
| control/0001_control.sql | 0.1 | Tenants, identities, memberships, backups |
| control/0002_billing.sql | 0.2 | Plans, subscriptions, invoices, payments. Additive |
| tenant/0001_kernel.sql | 0.1 | Ledger, stock ledger, integrity triggers |
| tenant/0002_restaurant.sql | 0.1 | Bills, purchases, stock takes, approvals |
| tenant/0003_pack_features.sql | 0.2 | New accounts, refunds, returns, hotel, payroll, retail, wholesale, outlets. Widens four CHECK constraints (payment methods, line status, bill dispositions, approval kinds) and adds columns/tables. **Version 0.1 of the app cannot use the new payment methods but still runs.** The upgrade path 0.1 to 0.2 was exercised in the build environment by applying all migrations to fresh databases, **not** by upgrading a database that already held data |
