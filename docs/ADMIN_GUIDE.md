# Administrator manual (USR-02)

## Business administrator (owner or manager): Setup screen

- **Add an item:** name, unit, selling price **with** VAT, VAT %, whether it is sold, whether it is tracked in stock, the store it is kept in (needed if tracked), and the sales and cost accounts.
- **Recipes:** choose a menu item and list the raw items and quantities it uses, **and the store each is taken from**. Stock always leaves that store, whichever till rings the sale. Save the recipe.
- **Parties:** add customers (with a credit limit, 0 means every credit sale needs a PIN), suppliers and staff.
- **People:** add users with a role. Give managers a **PIN**: it is what authorises complimentary items, staff deductions, write-offs and credit over limit. Only owners can add owners.
- **Lock a period (owner):** after locking, nothing can be posted on or before that date. It only moves forward. Lock after the accountant has finished a month.
- **Opening balances:** post once, before trading (API: `POST /api/opening-balances`, `POST /api/stock/opening`).

## Roles

See [SECURITY_ACCESS.md](SECURITY_ACCESS.md). Use the least access that works: waiters sell; storekeepers count and receive; accountants see and approve but do not sell.

## Platform operator (whoever hosts it)

```bash
docker compose exec api node dist/cli.js tenants                    # all client businesses
docker compose exec api node dist/cli.js create-tenant <slug> "<name>" <email> '<password>' [--demo]
docker compose exec api node dist/cli.js migrate-all                # upgrade every client database
docker compose exec backup node dist/cli.js backup                  # back up now
docker compose exec api node dist/cli.js set-password <email> '<new password>'
docker compose exec api node dist/cli.js suspend <slug>             # block a business within 30 seconds
docker compose exec api node dist/cli.js activate <slug>
```

With `PLATFORM_ADMIN_TOKEN` set, the same are available at `GET /api/platform/tenants` and `POST /api/platform/migrate` with header `x-platform-token`. Leave the token empty to disable them.

**Closing signup:** set `ALLOW_SIGNUP=false` and restart `api`.

**Suspending a business:** `cli suspend <slug>` (and `cli activate <slug>`). Access stops within 30 seconds.

## Not available yet

Disabling or removing a user from the screen, self-service password reset (the operator command above is the workaround), changing a user's role, a per-business settings screen. See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Settings (More → Settings; owner or manager to view, owner to change)

Business name, address, phone, KRA PIN and receipt footer (printed on receipts); tourism/catering levy %, default service charge %, loyalty on/off with its rates; nightly report on/off, hour and notification address. **Payroll rates** are stored here too (API `POST /api/settings` with `payroll_rates`). Review them with your accountant before every payroll and whenever the law changes (see PAYROLL_STATUTORY.md).

## Printing

Run `scripts/print-agent.js` on a computer in the restaurant for each printer (see README). Give the agent a login for a waiter or cashier. Receipts and kitchen tickets can also be printed from the browser with the Receipt and Kitchen ticket buttons.

## Importing from another system

More → Import. Export your items, customers or opening stock to CSV, press **Check first**, fix the rows reported, then **Import**. Load items before opening stock. Importing the same file twice is harmless.

## Subscriptions and billing (platform operator)

Needs `PLATFORM_ADMIN_TOKEN`. All calls send header `x-platform-token`.

```
GET  /api/platform/plans
POST /api/platform/subscribe            {"slug":"my-lounge","plan":"restaurant","outlets":2}
POST /api/platform/invoices/generate    (run daily; one invoice per business per month, in advance)
GET  /api/platform/invoices?status=issued
POST /api/platform/invoices/<id>/pay    {"amount":700000,"method":"mpesa","reference":"QWE123"}
```

An expired trial or an invoice more than `BILLING_GRACE_DAYS` overdue makes that business read-only until the invoice is paid. Prices in the plans table are illustrative: edit them in the control database before selling.

## Nightly report

Settings → Nightly report. The address must be https and must not point at a private network. Check that messages arrive with **Send one now** and the list below it.
