# User acceptance testing script (TST-03)

**No acceptance has taken place.** This is the script business users should run. Suggested participants: an owner, a manager, a waiter, a storekeeper and an accountant from the design-partner business. Run it on a **copy** of real master data, alongside the existing system for 30 days (the shadow run described in the Posting Matrix document).

| # | Scenario | Expected | Result | Initials |
|---|---|---|---|---|
| 1 | Create the business, add the real menu, recipes, stores, suppliers, staff | Items sell; recipes name the right store | | |
| 2 | Post opening stock and balances | Strip is green | | |
| 3 | Ring a table order, add items later from another till, pay by M-Pesa (manual entry) | Beef leaves the kitchen/butchery store, not the till's store | | |
| 4 | Change a quantity to 0 and re-add it twice | Bill total and stock reflect only the final lines | | |
| 5 | Remove an item the kitchen already made | Manager PIN needed; cost shows in Wastage | | |
| 6 | Put a bill on staff deduction, complimentary, credit, write-off | Each needs the right approval; balances appear under Money | | |
| 7 | Record a delivery with a non-stock item (repair, equipment) | It is not in Inventory | | |
| 8 | Record a delivery two days late | Shows "late entry"; stock dated to delivery | | |
| 9 | Stock take with a surplus and a shortage; counter and approver differ | Counter never sees expected quantities; both variances post | | |
| 10 | Record wastage with a reason, then double-tap Save | One entry | | |
| 11 | Try to close the day with an open bill | Blocked, with a checklist | | |
| 12 | Close the day; print trial balance, P&L, balance sheet | Trial balance balances; accountant agrees the figures | | |
| 13 | Compare to the existing system for the same day: sales, stock, debtors, cash | Differences explained | | |

**Acceptance outcome:** Accepted / Accepted with exceptions / Rejected. Exceptions, owners and dates: ______. Signed (business owner): ______ Date: ______
