# System overview (PRD-01)

## Purpose

Restaurants, bars and lounges lose money in places their software cannot see: stock that leaves the wrong store, bills edited after the fact, unpaid bills nobody follows up, purchases keyed at the wrong price. Worse, many systems let the accounts go out of balance, so the numbers cannot be trusted even by an accountant. A real audit of one lounge found a trial balance out by KES 114,000 across 52 accounts, all caused by the software posting one side of an entry.

**Mizani's promise is numbers you can trust without month-end patching.** The ledger is append-only, every entry must balance before it is saved, and the system checks itself against its own records continuously.

## Intended users

| Person | What they get |
|---|---|
| Owner | One header strip that says whether the books balance, plus reports from anywhere |
| Manager | Approvals, day-end checklist, fewer stock disputes |
| Accountant | A trial balance that always balances, with every figure traceable to its source |
| Storekeeper | Blind stock counts, purchases, transfers, wastage with reasons |
| Waiter / cashier | Fast ordering and payment on any browser |

## Scope of v0.2 (restaurant, bar, lounge, with first versions of hotel, HR, retail and wholesale)

**Core:** point of sale with open bills and tables; recipes that take stock from the right store; purchases with delivery date and one price per line; stock transfers, consumables, wastage and blind stock counts with separate approval; credit sales, staff deductions, complimentary and write-offs with manager approval; day-end close; trial balance, profit and loss, balance sheet; opening balances; period locking; one database per client with self-service signup; automated per-client backups.

**Added in 0.2:** receipts and kitchen tickets with a print agent; refunds and purchase returns; tips, service charge, deposits, gift cards, loyalty; tourism/catering levy; prep production, staff meals, depreciation; **hotel** folios with night audit and room charges from the restaurant; **HR and Kenyan payroll** (PAYE, NSSF, SHIF, housing levy); **retail** barcodes, reorder levels and promotions; **wholesale** price lists, statements, ageing and orders; CSV import and a free **Books Health Check**; an **owner screen** and nightly webhook report; forecasting and reorder suggestions; subscription **billing**; **multi-outlet**.

## Out of scope in 0.2

**Offline trading, eTIMS and M-Pesa integration** (deliberately skipped for now), booking engine and channel manager, time and attendance, batch/expiry tracking, native mobile apps, direct WhatsApp/SMS/email senders. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## Key capabilities that distinguish it

1. **Balance enforced by the database.** An unbalanced, one-sided or empty entry is refused at commit.
2. **Append-only.** Entries are never edited or deleted. A correction is a reversal plus a new posting.
3. **Stock leaves the recipe's store, not the till's store.**
4. **Controls are enforced, not suggested.** Blind counts, a different approver, no bill closes without a disposition, no day closes with open items.
5. **Continuous self-check.** Fifteen invariants compare the ledger with the records behind it, on every change and at day end.
6. **One database per client.** Isolation, simple export and restore, and per-client upgrades.

## Business problem it answers

It is built from a documented failure list of an existing system (posting gaps on stock-take gains, missing debtor entries on sales, bill edits that keep revenue for removed lines, non-stock purchases posting to Inventory, stock depleting from the wrong store). Each failure is a named automated test.
