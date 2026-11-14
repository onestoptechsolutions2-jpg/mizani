# System architecture (ARC-01)

## Overview

```
 Browser (single-page web app, no build step)
        |  HTTPS (terminate TLS in front of the app)
        v
 +-------------------------- api (Node 22, Fastify) ---------------------------+
 |  auth + permissions -> tenant transaction -> idempotency -> module handler  |
 |  modules: sales, purchases, inventory, accounting, reports, approvals       |
 |  posting engine (ledger.ts) and stock engine (stock.ts)  <- only writers    |
 +---------------+------------------------------------------+------------------+
                 |                                          |
                 v                                          v
   control-plane database                     one database PER CLIENT (tenant)
   tenants, identities, memberships           accounts, journals, stock moves,
   (no business data)                         bills, purchases, users, ...
                 \________ same PostgreSQL 16 server (or cluster) ________/
 backup container: nightly pg_dump of every tenant database -> ./backups
```

## Components

| Component | Responsibility |
|---|---|
| `src/server.ts` | Routes, authentication, role checks, one transaction per request, idempotency keys, error mapping |
| `src/control.ts` | Creates a client database, runs migrations, seeds the chart of accounts, sign-in |
| `src/migrate.ts` | Forward-only versioned SQL, advisory-locked, one transaction per file |
| `src/ledger.ts` | The only code that writes journals; reversal; business date |
| `src/stock.ts` | Moving-average costing, stock moves; all arithmetic in Postgres `numeric` |
| `src/modules/*` | Business workflows built on the two engines |
| `src/modules/reconcile.ts` | The 12 invariants |
| `migrations/` | The database schema, including the integrity triggers |
| `public/index.html` | The whole web interface |

## Request flow

1. Verify the signed token, check the role has the permission, check the client is active.
2. Open a transaction on **that client's database only**.
3. If an `Idempotency-Key` is supplied and seen before, return the stored response.
4. Run the workflow. Every posting goes through `postJournal`.
5. At commit, the database verifies each journal balances. If anything is wrong, **nothing** is saved.

## Why the ledger cannot be corrupted

Enforced in the database, not only the code (`migrations/tenant/0001_kernel.sql`):

- A deferred constraint trigger rejects any journal that does not balance or has fewer than two lines.
- Update, delete and truncate on journals, lines and stock moves are refused.
- Lines can only be added in the same transaction that created the journal.
- `stock_balances` can only be written by the trigger on `stock_moves`.
- Postings dated inside a locked period are refused.

## Data model highlights

- Money is integer cents; quantities are exact decimals (6 places); no floating point anywhere in money or stock.
- A **business date** (the open trading day), not the calendar date, dates every posting. A bill opened at 23:40 and paid at 00:15 stays in one day.
- Each bill line posts its own entries, so removing a line reverses exactly that line.
- Open bills sit in a separate control account (1110) from customers' credit (1100) so credit ageing stays clean.
- Costing: moving weighted average per item and store. Stock-count gains use average cost.

## Multi-tenancy (database per client)

- Control database holds only the registry and sign-in identities.
- Provisioning: create database, run all migrations, seed, create the owner, register. Failure drops the half-built database.
- Connection pools are per client, small, and evicted when least recently used.
- Upgrades: `migrate-all` applies pending migrations to every client with bounded concurrency; one failure does not stop the others.
- Backups and restores are per client.

## Major design decisions

| Decision | Reason | Revisit when |
|---|---|---|
| Database per client | Isolation, per-client restore and export | Cluster capacity is exhausted (never benchmarked) |
| Revenue recognised when a line is committed, through Open Bills receivable | Gives the debtors leg the audited system lacked | An accountant disagrees (see open questions in the design document) |
| Approvals by a different person, always | Real segregation of duties | Single-person businesses need a configurable rule |
| Business logic in TypeScript, integrity rules in SQL triggers | Defence in depth | — |
| Single HTML file UI, no framework | Zero build, easy to audit | Offline mode and printing need a real front-end build |
| No ORM | Ledger arithmetic must be visible SQL | — |

## Not yet in the architecture

Offline queue, print agent, integration adapters (eTIMS, M-Pesa, SMS), job queue, read replicas, per-client database roles, WAL archiving. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
