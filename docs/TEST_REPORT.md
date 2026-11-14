# Test execution and defect report (TST-02)

Raw evidence: [evidence/test-run.tap](evidence/test-run.tap), [evidence/environment.txt](evidence/environment.txt). Covers release 0.2.0.

## Result of the recorded run

| | |
|---|---|
| Date | 2026-11-14 |
| Environment | Ubuntu 24.04, Node 22.23, PostgreSQL 16.15, run directly (not in Docker) |
| Tests | 64 |
| Passed | **63** |
| Failed | **0** |
| Not built (todo) | 1: AT-10 (offline sync path) |
| Duration | about 52 seconds |
| Test files | acceptance (34), features (27), soak, soak2 (the two random mixes), concurrency |
| Soak AT-34 (restaurant core) | 600 random events, seed 20261110: 356 journals, 298 stock moves, invariants checked every 25 events |
| Soak AT-36 (everything at once) | 500 random events, seed 20261112: 676 journals, 288 stock moves, 46 hotel stays, 12 payroll runs, 17 refunds |

Every scenario ends by asserting the **fifteen invariants** (I1 to I15) and a zero trial-balance difference.

## Other checks performed (outputs not archived unless stated)

- AT-34 with three further seeds (1, 7, 424242): passed. AT-36 with seven seeds after the fix (99, 777, 3, 20261112, 5, 11, 12345): all pass. Seeds 99 and 777 failed before the fix, which is how defect 5 was found.
- Concurrency (AT-35, in the recorded run): 20 simultaneous sales and payments plus 20 wastage entries on the same stock.
- Headless interface test (`scripts/ui-smoke.js`, jsdom, production build, real server): sign-in page health check, ordering, service charge, other-payment and refund dialogs, cash payment, the five back-office screens, **all nine More tabs**, balanced header strip, no script errors. 26 of 26 checks passed; the server logged no errors.
- Print agent tested against a **fake** network printer: a receipt arrived with the initialise and cut codes, and the kitchen watcher printed an order exactly once across several polls.
- Backup and restore: tested on a **release 0.1** database (journals, balanced totals and protection triggers intact). **Not repeated** on a 0.2 database.
- Clean install (`npm ci`), build and test run from a copy of the project (release 0.1); the production-mode guard refuses to start without `JWT_SECRET`. **Not repeated for 0.2.**
- Compose file parsed as valid YAML.

## Not executed

**The Dockerfile and docker-compose.yml were not built or run.** Also not done: testing on real devices, printers or a real notification receiver; load or performance testing; penetration testing; accessibility audit; comparison of payroll with a real payslip or iTax return; any use of the hotel or payroll screens by real staff.

## Defects found and fixed

| # | Severity | Defect | Found by | Resolution | Retested |
|---|---|---|---|---|---|
| 1 | Critical | Balance-check trigger read a column missing on one of its tables, so **every posting failed** (0.1) | First run | Rewritten | Yes |
| 2 | High | Profit and loss **added** cost of sales instead of subtracting (0.1) | AT-05 | Sign corrected | Yes |
| 3 | Medium | Accountants refused access to the stock-count approval view (0.1) | AT-25 | Permission widened | Yes |
| 4 | Medium | Database defaulted to UTC, so trading days near midnight would be dated 3 hours off (0.1) | Review | Timezone set in compose. **No test covers it** | No |
| 5 | **High** | **Voiding a bill with a service charge left the charge on the voided bill (a balance on a void bill)** | **AT-36, seeds 99 and 777** | Charges reversed on void | Yes, and regression test F-05b |
| 6 | Medium | **Interface bills list had always rendered as the text "[object HTMLDivElement]", and false values as "false"** (since 0.1) | Browser test | Fixed once at the root so every screen is covered | Yes |
| 7 | Medium | A bill could not be closed to a hotel room: the bills table did not allow that disposition | F-13b | Migration widened the constraint | Yes |
| 8 | Low | Importer treated blank price, cost or credit-limit cells as errors, and decided "tracked item" by whether a cost column existed | F-18 | Per-row decision, blanks mean zero | Yes |
| 9 | Low | Notification address check gave a confusing error for IPv6 literals and unknown hosts | F-20 | Cleaned | Yes |
| 10 | Test faults | Wrong expected figures in four tests (VAT rounding per line, a typo in a levy figure, a receipt pattern, a stock count) | Feature tests | Tests corrected. The system's rounding rules were right | Yes |

## Open defects

None known beyond [KNOWN_ISSUES.md](KNOWN_ISSUES.md), which lists unverified items, unbuilt scope and limits.
