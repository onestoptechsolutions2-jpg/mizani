# Known issues, limitations and backlog (HDO-04)

Read this before using the product with real money. Severity: **High** = could cause wrong money, lost data or lost trading; **Medium** = a control or capability a business will expect; **Low** = convenience.

## A. Things not verified

| # | Item | Severity | Note |
|---|---|---|---|
| A1 | **Dockerfile and docker-compose.yml have never been built or run** | High | All code and 64 tests ran directly on PostgreSQL 16. Expect small packaging fixes on the first run (for example the `postgresql16-client` package for `pg_dump`) |
| A2 | No human code review | High | See HANDOVER_REPOSITORY.md |
| A3 | No user acceptance and **no accountant sign-off** of the posting rules | High | New since 0.1: levy, tips and service charge, loyalty, refunds, room revenue, depreciation and payroll accounting all need review. See the open questions in the design document |
| A4 | **Payroll has never been compared with a real payslip or iTax return** | High | Verified only against hand-worked examples and published rates. See PAYROLL_STATUTORY.md |
| A5 | **Statutory rates can change and nothing warns you** | High | The Treasury has proposed changes to PAYE (October 2026). Rates are editable settings, not automatically updated |
| A6 | Printing never tried on real printer hardware | Medium | The print agent was tested against a fake network printer only |
| A7 | **Notification delivery to a real receiver is untested** | Medium | Only the safety checks (refusing private addresses) are tested. A WhatsApp or SMS gateway needs to be chosen and tried |
| A8 | The CSV importer's column names were guessed, not checked against a real JiPOS export | Medium | Always use "Check first" |
| A9 | Hotel flows never used by hotel staff; night audit is manual | Medium | |
| A10 | No performance, load, capacity or penetration testing | Medium | "Hundreds of clients per cluster" is unmeasured |
| A11 | Interface tested headlessly only (26 checks), not on real tablets, phones or browsers; PWA install untested; accessibility not audited | Medium | |
| A12 | Timezone fix has no automated test | Low | Trading-day dates rely on the database timezone being Africa/Nairobi |

## B. Still not built

| # | Item | Severity | Effect |
|---|---|---|---|
| B1 | **Offline trading** | High | If the internet or server is down nobody can sell. Paper fallback, then enter later |
| B2 | **eTIMS / KRA tax integration** | High | Cannot be used where tax-compliant invoicing is mandatory |
| B3 | **M-Pesa integration** | High | M-Pesa is a payment method entered by hand; no automatic matching or STK push |
| B4 | Direct WhatsApp, SMS and email senders | Medium | Alerts go to a webhook you supply |
| B5 | Hotel booking engine, channel manager (Beds24 etc.), group bookings, rate plans and seasons, room moves, no-show and cancellation fees, guest ID capture | Medium | Hotel pack covers the in-house folio cycle only |
| B6 | Time and attendance, appraisals, training, employee self-service | Low | |
| B7 | Batch and expiry tracking, serial numbers, weighed-item labels, label printing | Medium | |
| B8 | Van sales and routes, delivery notes and proof of delivery as documents, partial deliveries, backorders, B2B portal | Medium | Orders deliver in full as a credit invoice |
| B9 | Native mobile apps and push notifications | Low | The owner view is an installable web app |
| B10 | Online payment collection for Mizani subscriptions, proration, invoice PDFs | Medium | Operator records payments by hand |

## C. Limits inside what was built (found by review, not yet fixed)

| Area | Limit |
|---|---|
| Refunds | Whole bill lines only. No partial quantity. Not for credit, staff or room bills. Loyalty points are not reversed. Purchase returns cover stock lines only |
| Tips | Held in one account; no per-employee distribution |
| Service charge | Calculated once; **not refreshed** when items change. Assumed outside VAT **(verify)** |
| Gift cards, points | No expiry or breakage; one fixed points rate; no tiers |
| Levy | One rate for the whole business, inclusive only, no exempt items; no levy return produced |
| Production | No yield or loss recording. Staff meals only for stock items |
| Assets | Entered by hand, straight line only, no disposal |
| Hotel | Overpaid folios cannot be refunded in the system; deposits are not returned automatically on cancellation; night audit must be run each day by someone |
| Payroll | Full month only (no part-month joiners), no overtime, bonuses, loans, benefits, pension or insurance relief; no payroll reversal (forward fix only); no payslip PDF or iTax file |
| Leave | Annual leave accrual only; no carry-over rules; unpaid leave does not reduce pay |
| Wholesale | Ageing allocates receipts to oldest invoices first, not to a chosen invoice |
| Importer | Creates only, never updates existing items; no recipes or images; no undo |
| Health check | Fixed thresholds; CSV only; ignores files it cannot read columns from |
| Forecast | Same-weekday average only; no seasonality, holidays or events; ignores supplier pack sizes and minimums |
| Billing | Prices in the migration are **illustrative hypotheses**. Enforced by the API; the screen only shows a banner |
| Multi-outlet | Only sales postings carry the outlet. Users are not restricted to outlets. No per-outlet P&L beyond gross profit |
| Scheduler | Runs inside the API process, so two API copies could both send a report in the same minute |

## D. Security and operations

| # | Item | Severity |
|---|---|---|
| D1 | No multi-factor authentication | Medium |
| D2 | No self-service password reset (operator command `set-password` exists) | Medium |
| D3 | No screen to disable users or change roles | Medium |
| D4 | Rate limits are in memory, per process | Medium |
| D5 | JWT cannot be revoked before 12 hours (disabled users and suspended businesses are refused on the next request) | Low |
| D6 | App connects to PostgreSQL as a superuser; one role for all clients | Medium |
| D7 | **App does no TLS; backups are unencrypted, stored on the same host; the control database is not backed up** | **High** |
| D8 | No audit of sign-ins, setting changes (including payroll rates) or operator actions | Medium |
| D9 | No monitoring or alerting; `commands` table never purged | Medium |
| D10 | No disaster-recovery exercise; RPO is 24 hours | High |
| D11 | Public signup is on by default, gives a 30-day trial, and each signup builds a database | Medium |
| D12 | **Salaries, national ID numbers, KRA PINs and NSSF/SHA numbers are now stored**: they need encryption at rest, access logging and a data-protection review | **High** |
| D13 | The platform token is one shared secret and now also controls billing | Medium |
| D14 | No data export or erasure tool for data subjects | Medium |

## E. Behaviour to be aware of

| # | Behaviour | Why |
|---|---|---|
| E1 | Approvals always need a **different person** | Segregation of duties. A one-person business cannot approve its own complimentary items |
| E2 | Credit limit 0 means every credit sale needs a manager PIN | Safe default |
| E3 | VAT is rounded per bill line | Per-line posting |
| E4 | Stock can go negative and shows red | Selling is never blocked |
| E5 | After a day closes the next transaction opens the next calendar date | Closed days never reopen |
| E6 | A refunded item that is not restocked is recorded as wastage | Cooked food cannot be resold |
| E7 | Promotions apply automatically, even to staff who cannot discount | They are dated and visible |
| E8 | Payroll recovery of staff debts is capped at half of take-home pay | Conservative; confirm the legal cap |
| E9 | An expired trial or overdue invoice makes the system read-only | Customers keep access to their data |
| E10 | Business with no subscription row is treated as active | So businesses made before billing existed keep working |
| E11 | Gift card codes are upper-case | |
| E12 | The same email can belong to several businesses and must use the same password | Shared identity |

## F. Defects found by the soak tests after release 0.2 started (all fixed)

Voiding a bill with a service charge left a balance on the voided bill (found by AT-36, fixed, regression test F-05b). The interface's bills list had always rendered as "[object HTMLDivElement]" and false values as the word "false" (found by the browser test, fixed at the root). Details in TEST_REPORT.md.

## G. Recommended next steps (in order)

1. Run `docker compose up --build` and the test profile; fix what breaks (A1).
2. Human code review, then an accountant's review of the posting rules and of **one real payroll month** (A2 to A5).
3. Shadow-run alongside the current system for 30 days with a design-partner business (UAT_SCRIPT.md).
4. Before real money: TLS and a reverse proxy; encrypted off-site backups including the control database; secrets manager; encrypt or restrict the HR columns; close signup (D7, D10 to D12).
5. Build, in this order: eTIMS, M-Pesa matching, offline mode (B1 to B3). Try the print agent on the real printer (A6).
6. Choose a messaging provider and test real alert delivery (A7, B4).
7. Audit log for security and setting changes; user management screens; password reset (D2, D3, D8).
8. Benchmark capacity; add PgBouncer, monitoring and a nightly reconcile alert (A10, D9).
9. Then the gaps in section B and C that your first customers actually ask for.
