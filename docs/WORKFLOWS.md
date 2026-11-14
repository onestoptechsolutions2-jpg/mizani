# Functional specification and workflows (PRD-04)

How each workflow behaves, who may do it, and what happens when it goes wrong. Postings refer to account codes in the chart of accounts. The full design lives in the *Posting Matrix & Acceptance Tests* document; this file records **what is actually built in v0.1**.

## Selling

| Step | Who | Posting | Rules |
|---|---|---|---|
| Open bill | sell | none | Dated to the open trading day |
| Add item | sell | Dr 1110 Open bills; Cr revenue and 2100 VAT; Dr 5000/5010 cost, Cr 1200 Inventory | Stock comes from the recipe's store. Discounts: manager only |
| Change quantity | sell | Reverses the line, posts a new one | Not allowed once the kitchen marked it made |
| Remove item (not made) | sell | Full reversal including stock | — |
| Remove item (made) | sell + manager PIN | Reverses revenue; Dr 5110 Wastage, Cr cost; stock stays out | Reason required |
| Pay | sell | Dr cash/M-Pesa/card, Cr 1110 | Cannot exceed balance. Full payment closes the bill |
| Close unpaid | sell + manager PIN | Dr 1100 customer credit, 1120 staff debtors, 6000 complimentary or 6020 write-off; Cr 1110 | Credit within the customer's limit needs no PIN. Approver must be a different person. Reason required for complimentary and write-off |
| Void bill | sell requests, manager approves | Reverses every line | Only unpaid bills. Request waits in the approvals queue |

Exception paths: payment larger than balance (refused); edit a closed bill (refused); payments exceed remaining items after a removal (refused, refunds not built).

## Buying

| Step | Who | Posting | Rules |
|---|---|---|---|
| Record purchase | purchase | Stock lines Dr 1200; VAT input Dr 1400 if claimable (else added to cost); expense/asset lines to their account; Cr 2000 supplier | **One price per line**; payable is the sum of the lines. Dated to the **delivery date**; entry more than 2 days later is flagged. Units convert exactly |
| Pay supplier | money | Dr 2000, Cr cash/M-Pesa/card/bank | Payment mode mandatory; cannot exceed what is owed |

## Stock

| Workflow | Who | Rules |
|---|---|---|
| Stock take | count, then approve | Covers every stocked item assigned to the store, holding stock there, or used by a recipe from it. Counter never sees system quantity. System quantity freezes at submission. A **different** person approves. Loss: Dr 5100, Cr 1200. **Gain: Dr 1200, Cr 5100** |
| Transfer | stock | Moves at the source store's average cost. Dr 1200 (to), Cr 1200 (from) |
| Consumables | stock | Dr 5120 by department, Cr 1200 |
| Wastage | stock | Reason from a list; exact quantity; double submissions ignored; dated more than 2 days back waits for approval |

## Money

Expenses (Dr expense, Dr 1400 VAT, Cr payment account or 2000), cash count (variance to 6010), banking (Dr 1030, Cr 1000), receipts from customers and staff, opening balances (once, against 3900), period lock (owner, forward only).

## Day end

The day closes only when: no open bills, no void approvals waiting, no stock counts waiting, no wastage approvals waiting, and all 12 invariants pass. After closing, the next transaction opens the next business date.

## Roles

See [SECURITY_ACCESS.md](SECURITY_ACCESS.md).

## Coverage against the Posting Matrix (release 0.2)

| Matrix events | State |
|---|---|
| S1–S9 sales, credit, staff, complimentary, write-off | Built |
| S10–S11 tips (held as liability, paid out) and service charge | Built. Service charge is not auto-refreshed |
| E1–E4 line edits and voids (including service charge on voids) | Built |
| E5 refund after payment | Built (whole lines, paid bills) |
| P1–P4, P6 purchases, supplier payments, delivery date | Built |
| P5 purchase return | Built (stock lines) |
| T1–T5 transfers, stock takes, wastage, consumables | Built |
| T6 prep production, T7 staff meals | Built |
| M1–M4 deposits and gift cards | Built |
| M5–M7 M-Pesa matching and settlement | **Not built** (no integration) |
| M8–M9 cash-up and banking | Built |
| X1–X2 expenses, X4 opening balances, X5 period lock | Built |
| X3 depreciation | Built (straight line) |
| Tourism/catering levy (2110) | Built as a business-wide inclusive rate **(verify)** |
| Loyalty (2220, 6150) | Built |
| Hotel folio (1130, 4100) | Built |
| Payroll (2400–2440, 6120, 6121) | Built **(verify with a real payslip)** |
| eTIMS credit notes, offline | **Not built** |

See PACKS_AND_FEATURES.md for the rules of each added area.
