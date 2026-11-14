# Mizani

**Restaurant, bar and lounge operating system whose books always balance.** Working name; the final name and trademark are still open.

Every sale, purchase, stock count, wastage entry and payment posts through one double-entry ledger, in one database transaction, with balance enforced by the database itself. Each client business gets its **own PostgreSQL database**.

> **Status: v0.2.0, pre-release.** It runs and passes its automated tests (64 tests), but it has **not** been through user acceptance, an accountant's review, a security review, or a real Docker run. **Payroll in particular has never been checked against a real payslip.** Read [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) before putting real money through it.

## Run it (Docker)

```bash
cp .env.example .env          # then edit the three secrets inside
docker compose up -d --build
open http://localhost:3000    # create a business, tick "Start with a sample menu"
```

This starts three containers: `db` (PostgreSQL 16, not exposed to the host), `api` (the app and web interface), and `backup` (nightly per-client dumps into `./backups`).

| Task | Command |
|---|---|
| Run the tests | `docker compose --profile test run --rm test` |
| List businesses | `docker compose exec api node dist/cli.js tenants` |
| Create a business from the command line | `docker compose exec api node dist/cli.js create-tenant my-lounge "My Lounge" me@example.com 'a-strong-password' --demo` |
| Upgrade every client database | `docker compose exec api node dist/cli.js migrate-all` |
| Back up now | `docker compose exec backup node dist/cli.js backup` |
| Logs | `docker compose logs -f api` |

## Run it without Docker

Needs Node 22 and a PostgreSQL 16 server where the user can create databases.

```bash
npm ci
export PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres JWT_SECRET=$(openssl rand -hex 32)
npm run build && npm start     # http://localhost:3000
npm test                       # 64 tests, about one minute
```

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` | localhost, 5432, postgres, postgres | Database server. The user must be able to `CREATE DATABASE` |
| `CONTROL_DB` | `mizani_control` | Name of the control-plane database (created if missing) |
| `JWT_SECRET` | dev value | **Required in production.** 32+ random characters. The app refuses to start without it when `NODE_ENV=production` |
| `PLATFORM_ADMIN_TOKEN` | empty (disabled) | Enables `/api/platform/*` operator endpoints |
| `ALLOW_SIGNUP` | `true` | Set `false` to close public signup |
| `PORT` | 3000 | HTTP port |
| `TENANT_POOL_MAX`, `TENANT_POOL_CACHE` | 4, 50 | Connections per client database, and how many client pools stay open |
| `BACKUP_DIR`, `BACKUP_KEEP_DAYS` | ./backups, 14 | Backup location and retention |
| `TRIAL_DAYS`, `BILLING_GRACE_DAYS` | 30, 7 | Free trial length for new signups; days after an invoice is due before the business becomes read-only |

## What is in 0.2

Restaurant, bar and lounge core plus: receipts and kitchen tickets with a print agent, refunds and purchase returns, tips, service charge, deposits, gift cards, loyalty, tourism/catering levy, prep production, staff meals, depreciation, a hotel folio pack, HR and Kenyan payroll, retail and wholesale tools, CSV import, a free Books Health Check, an owner screen with nightly webhook reports, forecasting, subscription billing and multi-outlet. See [docs/PACKS_AND_FEATURES.md](docs/PACKS_AND_FEATURES.md). Still **not built**: offline trading, eTIMS, M-Pesa integration.

**Printing:** `node scripts/print-agent.js --server URL --token TOKEN --printer 192.168.1.50 --receipt BILL_ID` (or `--watch-kot` for the kitchen). Tested against a fake printer only.

## Documentation

All handover documents are in [`docs/`](docs). Start with [SYSTEM_OVERVIEW.md](docs/SYSTEM_OVERVIEW.md), then [ARCHITECTURE.md](docs/ARCHITECTURE.md). The index is [docs/INDEX.md](docs/INDEX.md).

## Layout

```
src/            application (server, ledger, stock, modules/*)
migrations/     SQL: control/ and tenant/ (forward-only)
public/         the web interface (single file, no build step)
test/           acceptance, features, two random soak tests, concurrency
scripts/        gen-docs.ts (regenerates data dictionary, API, access matrix…), ui-smoke.js, print-agent.js
docs/           handover documents
```
