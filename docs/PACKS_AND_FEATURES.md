# Features added in release 0.2 (known-issues items B4 to B13)

What was built, how it behaves, and its limits. Each item is covered by automated tests (see TEST_PLAN.md). Accounting treatments marked **(verify)** need an accountant.

## B4 Printing
- **Receipt** (`GET /bills/:id/receipt`): text for 80 mm paper (42 columns), JSON, or ESC/POS bytes. Shows business name, address, phone, KRA PIN, lines, discounts, VAT and levy included, service charge, payments, tip, balance.
- **Kitchen ticket** (`POST /bills/:id/kot`): prints only lines not yet sent. They are marked sent, so reprints never duplicate an order. Preview with GET.
- **Screen printing:** the Receipt and Kitchen ticket buttons open a print window (browser print dialog).
- **Print agent** (`scripts/print-agent.js`): sends ESC/POS to a network printer on port 9100, one receipt or a kitchen watcher that polls every 3 seconds. Tested against a **fake** printer; **never against real hardware**. USB printers are not supported by the agent.

## B5 Refunds and returns
- **Refund a paid bill line** (manager PIN, reason required): reverses revenue, VAT and levy; pays out by cash, M-Pesa, card or store credit. If the item is **not** restocked its cost goes to Wastage; if restocked, stock returns. Whole lines only.
- **Purchase return** (stock lines): credits Inventory and VAT input at the **original cost**, reduces what is owed to the supplier (or leaves the supplier owing you if already paid).

## B6 Tips, service charge, deposits, gift cards, loyalty
- **Tips** on cash, M-Pesa and card payments are held as a liability (not revenue) and paid out with `POST /tips/payout`.
- **Service charge:** a percentage added to a bill, held as a liability. Re-applying replaces it. It is **not updated automatically** if items change, and is treated as outside VAT **(verify)**.
- **Customer deposits** are liabilities used to pay bills. **Gift cards** are sold (liability) and redeemed as payment; balance is amount minus redemptions.
- **Loyalty:** optional (Settings). Points earned on money actually paid (default 1 point per KES 100); one point worth KES 1; redeemable as payment. The cost of points is expensed when earned and held as a liability.

## B7 Tourism / catering levy
A business-wide percentage (Settings, owner) carved out of VAT-inclusive prices using the Tourism Fund formula (total × levy ÷ (100 + VAT + levy)). Posts to the levy payable account and reverses with the line. Applies to restaurant items and hotel room charges. Whether it applies to you and at what rate **must be confirmed (verify)**: it is 2% for many tourism enterprises, and 2026 news reports describe it being extended to online booking platforms. No levy return is generated.

## B8 Production, staff meals, depreciation
- **Production:** raw items out at average cost, prepared item in at the total; net zero on Inventory; the prepared item's cost updates.
- **Staff meals:** stock items issued to the Staff meals account.
- **Fixed assets:** register plus monthly straight-line depreciation (catches up skipped months, once per period). The register must match the ledger (invariant I15). Assets are registered by hand; purchases do not create them automatically.

## B9 Hotel, HR and payroll, retail, wholesale
- **Hotel:** room types and rates, rooms, availability, reservations, deposits before arrival, check-in, **night audit** (posts one room charge per in-house guest per trading day, safe to repeat), extra charges, folio payments, **restaurant bills charged to a room**, checkout (unpaid balance moved to the guest's account with manager approval), housekeeping status, occupancy report. The guest ledger always equals the open folios (I13). **No booking engine or channel manager.**
- **HR and payroll:** see PAYROLL_STATUTORY.md. Employees, leave with 1.75 days a month accrual and approval, payroll preview and run, paying salaries, remitting PAYE, NSSF, SHIF and housing levy.
- **Retail:** barcode lookup, reorder levels with a low-stock report, automatic percentage promotions (shown as discounts).
- **Wholesale:** price lists per customer, payment terms, customer statements, ageing (receipts matched to oldest invoices first), sales orders delivered as credit invoices.

## B10 Importing and the Books Health Check
- **Import** items, customers/suppliers/staff and opening stock from CSV. Always **Check first** (nothing saved), then Import. Tolerates many column names. Importing twice skips what exists. Opening stock is **all or nothing**. The column mapping was **not** verified against a real JiPOS export.
- **Free Books Health Check** (no account): upload a trial balance, stock report and bills list from any system; it finds out-of-balance books, negative stock, unpaid closed bills, stale open bills, excess voids and discounts, scores them and says what Mizani prevents. Files are analysed in memory and not stored.

## B11 Owner view, alerts, forecasting
- **Owner screen** (More → Today): sales, gross profit, open bills, cash, things to watch (complimentary, write-offs, wastage, variances), top sellers, books status and one-tap approvals. Installable on a phone (web app manifest and icon). **Not a native app, no push notifications, and trading still needs a connection.**
- **Nightly report and alerts:** one short message a day at the chosen hour (Nairobi time), plus an alert if the books fail a check. Delivered to **a web address (webhook) you supply** from a messaging provider. Addresses pointing at private networks are refused. **There is no direct WhatsApp, SMS or email sender.** Delivery to a real receiver has not been tested.
- **Forecast:** expected quantities for the next days from the same weekday's average over recent weeks. **Reorder suggestions** from real usage over 28 days and reorder levels. Baselines only.

## B12 Billing and subscriptions
Plans (illustrative prices in KES per outlet per month: Core 2,500, Restaurant 3,500, Hotel 12,000), 30-day trial, monthly invoices, manual payment recording by the platform operator, grace period (7 days). An expired trial or overdue invoice makes the business **read-only**, never locked out of its own data. A business with no subscription record is treated as active. **There is no online payment collection, proration, VAT on invoices, or PDF invoices.**

## B13 Multi-outlet
Outlets, stores belong to outlets, bills belong to outlets, an outlet picker at the top of the page filters open bills, stock and today's numbers, and a **sales and gross profit by outlet** report. Only sales postings carry the outlet; expenses and purchases are business-wide. **Users are not restricted to particular outlets.**
