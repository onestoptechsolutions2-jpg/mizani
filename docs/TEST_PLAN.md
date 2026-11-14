# Test plan and test cases (TST-01)

Generated 2026-11-14 from the running system. Do not edit by hand: run `npm run docs:gen`.

## Scope

The ledger and the restaurant workflows. The test suite is the executable form of the *Posting Matrix & Acceptance Tests* document. Every test runs against a real PostgreSQL database with a freshly provisioned client database, through the real API.

## Entry and exit criteria

- **Entry:** migrations apply cleanly to an empty database; the project compiles.
- **Exit:** all tests pass; every one ends by asserting the invariants I1 to I15 and a zero trial-balance difference; the randomised soak test passes with at least three different seeds (both soak tests).

## Test data

Each test creates its own business (own database) with: 6 users (owner, 2 managers, waiter, cashier, storekeeper, accountant), 5 stores, a beef raw item, a stew menu item with a recipe, a bottled beer sold in cartons of 24, a supplier, customers (one with a low credit limit) and a staff member. The soak test uses a seeded random generator (`SOAK_SEED`, `SOAK_OPS`) so any failure can be replayed.

## Invariants asserted after every scenario

I1 trial balance nets to zero and every journal balances; I2 open-bills control equals open bill balances; I3 debtor/creditor lines name a party; I4 Inventory equals stock valuation; I5 stock balances equal the sum of moves; I6 each bill line posts exactly its own amount; I7 stock issued equals cost recorded; I8 append-only triggers present; I9 no overpaid bills; I10 closed bills have no balance and a disposition; I11 every posting has a source document; I12 purchase payable equals its lines; I13 hotel guest ledger equals open folios; I14 payroll runs equal their payslips; I15 fixed-asset register equals accumulated depreciation.

## Test cases

| File | Test |
|---|---|
| acceptance.test.ts | AT-01 stock-take GAIN has a credit side (Zikis audit issue 1) |
| acceptance.test.ts | AT-02 stock-take loss posts Dr variance / Cr Inventory |
| acceptance.test.ts | AT-03 the counter cannot approve their own count |
| acceptance.test.ts | AT-04 counts are blind: the counter never sees system quantity |
| acceptance.test.ts | AT-25 stock takes cover every item mapped to the store, with a system quantity (audit: coverage) |
| acceptance.test.ts | AT-05/06 open bill posts revenue per line; payment clears Open Bills (audit issue 2) |
| acceptance.test.ts | AT-07 evening bill paid after midnight stays in one business day |
| acceptance.test.ts | AT-08 line to 0 then re-added twice leaves only the final lines (bill J30i0L4IW5HV) |
| acceptance.test.ts | AT-09 beef leaves the recipe store, never the terminal store (bills J02iH0T748R9, J30iZFUP9EHL) |
| acceptance.test.ts | AT-10 same through the offline sync path (offline sync is not built yet) **(not built yet)** |
| acceptance.test.ts | AT-11 removing an item before the kitchen prepares it restores stock and reverses revenue |
| acceptance.test.ts | AT-12 removing a prepared item reverses revenue, moves cost to Wastage, keeps stock out |
| acceptance.test.ts | AT-13 staff deduction posts to Staff Debtors; repayment clears it (audit item 4) |
| acceptance.test.ts | AT-14/15 complimentary needs a reason and a different approver |
| acceptance.test.ts | AT-16 credit sales respect the customer limit |
| acceptance.test.ts | AT-17 non-stock purchases post to asset/expense, not Inventory (audit issue 3) |
| acceptance.test.ts | AT-18 one price per purchase line: payable always equals the lines (audit issue 3) |
| acceptance.test.ts | AT-19 purchases post on the delivery date, not the keying date |
| acceptance.test.ts | AT-20 supplier payment needs a mode and reduces the supplier balance |
| acceptance.test.ts | AT-26 unit conversion is exact: 2 cartons of 24, sell 3 singles |
| acceptance.test.ts | AT-21 double-clicking wastage posts once (audit: wastage entry) |
| acceptance.test.ts | AT-22 wastage keeps exact quantity, needs a listed reason, flags backdating |
| acceptance.test.ts | Stock transfers and consumables post balanced entries |
| acceptance.test.ts | AT-23 the database rejects one-sided, unbalanced and empty journals |
| acceptance.test.ts | AT-24 the ledger is append-only and stock balances are derived only |
| acceptance.test.ts | AT-28 trial balance respects the chosen date range (audit: filter ignored) |
| acceptance.test.ts | AT-32 locked periods reject postings; locks only move forward |
| acceptance.test.ts | AT-33 replaying a command with the same key posts nothing twice |
| acceptance.test.ts | AT-31 cash count variance posts to Cash over/short; banking moves cash to bank |
| acceptance.test.ts | AT-29 the day cannot close with open bills or pending approvals |
| acceptance.test.ts | Opening balances post once, balanced against Opening Balance Equity; expenses need a mode |
| acceptance.test.ts | Every client has its own database; data never crosses |
| acceptance.test.ts | Self-serve signup, login, roles and rate limits |
| acceptance.test.ts | Roles: a waiter cannot see reports, approve, or change setup |
| soak.test.ts | AT-34 soak: 600 random events, invariants hold every 25 events |
| soak.test.ts | AT-35 concurrency: 40 simultaneous sales, payments and wastage entries keep every invariant |
| features.test.ts | F-01 refund after payment reverses revenue; cost goes to wastage unless restocked |
| features.test.ts | F-02 refund to store credit lands in the customer deposit account |
| features.test.ts | F-03 purchase return: credits Inventory and VAT input at original cost, reduces what is owed |
| features.test.ts | F-04 tips are held for staff, not booked as revenue, and paid out |
| features.test.ts | F-05 service charge is held as a liability; re-applying replaces it |
| features.test.ts | F-05b voiding a bill that has a service charge reverses the charge too (found by the soak test) |
| features.test.ts | F-06 deposits and gift cards are liabilities that settle bills |
| features.test.ts | F-07 loyalty points accrue on paid money and redeem as payment |
| features.test.ts | F-08 tourism/catering levy is carved out of the VAT-inclusive price and reverses with the line |
| features.test.ts | F-09 prep production converts raw items into a prepared item at cost, net zero on Inventory |
| features.test.ts | F-10 staff meals are charged to Staff meals, not lost |
| features.test.ts | F-11 depreciation: straight line, once per period, catches up, matches the register |
| features.test.ts | F-12 receipts and kitchen tickets: text, ESC/POS bytes, no duplicate orders on reprint |
| features.test.ts | F-13 hotel: booking, deposit, check-in, night audit, folio charges, checkout, housekeeping |
| features.test.ts | F-13b hotel: restaurant bill charged to room, and unpaid folio moved to the guest account with approval |
| features.test.ts | F-14a payroll maths matches hand-worked Kenyan figures (rates verified Nov 2026) |
| features.test.ts | F-14b payroll run posts balanced entries, pays net, remits to authorities, recovers staff debts |
| features.test.ts | F-15 leave accrues 1.75 days a month; requests need approval by someone else |
| features.test.ts | F-16 retail: barcode lookup, reorder alerts, automatic promotions visible in discounts |
| features.test.ts | F-17 wholesale: price lists, statements, FIFO ageing, orders delivered as credit invoices |
| features.test.ts | F-18 CSV import: dry run first, tolerant of other systems’ column names, idempotent, all-or-nothing for stock |
| features.test.ts | F-19 Books Health Check works without an account and finds the Zikis problems |
| features.test.ts | F-20 owner summary, digest, and webhook safety (no calls into private networks) |
| features.test.ts | F-21 forecast uses same-weekday history; reorder suggestions use real usage and reorder levels |
| features.test.ts | F-21b billing: trial, plan, invoice, overdue read-only, payment restores trading |
| features.test.ts | F-22 multi-outlet: bills, stock and sales are separated by outlet |
| features.test.ts | F-23 the app can be installed as a phone app (manifest, service worker, icon) |
| soak2.test.ts | AT-36 soak: random mix of every feature keeps all 15 invariants |

## Not covered by automated tests

Browser-level interaction on real devices, printing, offline operation, integrations (not built), load and performance at scale, security penetration testing, and accessibility audit. See KNOWN_ISSUES.

## How to run

```bash
docker compose --profile test run --rm test      # in containers
npm test                                         # locally with PGHOST/PGUSER/PGPASSWORD set
SOAK_SEED=7 SOAK_OPS=1000 npm test               # a different random run
```
