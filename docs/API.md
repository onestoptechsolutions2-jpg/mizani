# API reference (ARC-04)

Generated 2026-11-14 from the running system. Do not edit by hand: run `npm run docs:gen`.

Base URL: the address the app is served from. All endpoints are JSON over HTTPS (terminate TLS in front of the app).

## Authentication

1. `POST /api/signup` creates a business and returns a token. `POST /api/auth/login` with `{slug, email, password}` returns a token.
2. Send `Authorization: Bearer <token>` on every other call. Tokens last 12 hours and are bound to one business.
3. Each call runs in one database transaction. Either everything in it posts or nothing does.

## Idempotency

Add the header `Idempotency-Key: <unique string>` to any POST, PATCH or DELETE. Replaying the same key returns the original response and posts nothing twice. Use one key per form submission.

## Money and quantities

Money is **integer cents** (KES 650.00 is `65000`). Quantities are decimal strings with at most 6 decimals (`"1.42"`). Anything with more precision is rejected, never rounded.

## Errors

| Status | Meaning |
|---|---|
| 400 | The request is invalid (missing or malformed field) |
| 401 | Not signed in, or the token expired |
| 403 | Your role cannot do this, or a manager approval was missing or invalid |
| 404 | Not found |
| 409 | The business rule refused it (period locked, unbalanced, already closed, payment too large…). The message says why |
| 429 | Too many attempts |
| 500 | Our fault. Nothing was posted |

Body: `{"error": "message", "detail": …}`.

## Examples

```bash
TOKEN=$(curl -s localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d '{"slug":"my-lounge","email":"me@example.com","password":"…"}' | jq -r .token)

curl -s localhost:3000/api/bills -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"table_name":"T4"}'
curl -s localhost:3000/api/bills/$BILL/lines -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"item_id":"…","qty":"2"}'
curl -s localhost:3000/api/bills/$BILL/payments -H "authorization: Bearer $TOKEN" -H 'Idempotency-Key: pay-001' -H 'content-type: application/json' -d '{"method":"cash","amount":130000}'
curl -s localhost:3000/api/reconcile -H "authorization: Bearer $TOKEN"
```

## Versioning

There is no version prefix yet (v0.1). Breaking changes will add `/api/v2` and keep `/api` working for one release.

## Endpoints

| Method | Path | Permission | Roles allowed |
|---|---|---|---|
| POST | /api/signup | public (rate limited) | |
| POST | /api/auth/login | public (rate limited) | |
| GET | /healthz | public | |
| GET | / | public (web app) | |
| GET | /api/platform/tenants | platform token | |
| POST | /api/platform/migrate | platform token | |
| GET | /api/me | read | owner, manager, accountant, storekeeper, cashier, waiter |
| GET | /api/approvers | read | owner, manager, accountant, storekeeper, cashier, waiter |
| GET | /api/users | setup | owner, manager |
| POST | /api/users | setup | owner, manager |
| GET | /api/accounts | read | owner, manager, accountant, storekeeper, cashier, waiter |
| GET | /api/stores | read | owner, manager, accountant, storekeeper, cashier, waiter |
| POST | /api/stores | setup | owner, manager |
| GET | /api/items | read | owner, manager, accountant, storekeeper, cashier, waiter |
| POST | /api/items | setup | owner, manager |
| POST | /api/items/:id/recipe | setup | owner, manager |
| POST | /api/items/:id/units | setup | owner, manager |
| GET | /api/parties | read | owner, manager, accountant, storekeeper, cashier, waiter |
| POST | /api/parties | setup | owner, manager |
| GET | /api/day | read | owner, manager, accountant, storekeeper, cashier, waiter |
| POST | /api/day/open | money | owner, manager, accountant |
| POST | /api/day/close | money | owner, manager, accountant |
| POST | /api/bills | sell | owner, manager, cashier, waiter |
| GET | /api/bills | sell | owner, manager, cashier, waiter |
| GET | /api/bills/:id | sell | owner, manager, cashier, waiter |
| POST | /api/bills/:id/lines | sell | owner, manager, cashier, waiter |
| PATCH | /api/bills/:id/lines/:lineId | sell | owner, manager, cashier, waiter |
| DELETE | /api/bills/:id/lines/:lineId | sell | owner, manager, cashier, waiter |
| POST | /api/bills/:id/lines/:lineId/prepared | sell | owner, manager, cashier, waiter |
| POST | /api/bills/:id/payments | sell | owner, manager, cashier, waiter |
| POST | /api/bills/:id/close | sell | owner, manager, cashier, waiter |
| POST | /api/bills/:id/void-request | sell | owner, manager, cashier, waiter |
| POST | /api/parties/:id/receipts | money | owner, manager, accountant |
| POST | /api/purchases | purchase | owner, manager, accountant, storekeeper |
| GET | /api/purchases | purchase | owner, manager, accountant, storekeeper |
| POST | /api/purchases/:id/payments | money | owner, manager, accountant |
| GET | /api/stock | stock | owner, manager, accountant, storekeeper |
| POST | /api/stock/transfers | stock | owner, manager, accountant, storekeeper |
| POST | /api/stock/consume | stock | owner, manager, accountant, storekeeper |
| POST | /api/stock/opening | money | owner, manager, accountant |
| POST | /api/wastage | stock | owner, manager, accountant, storekeeper |
| GET | /api/wastage/reasons | read | owner, manager, accountant, storekeeper, cashier, waiter |
| POST | /api/stock-takes | count | owner, manager, storekeeper |
| GET | /api/stock-takes | stock | owner, manager, accountant, storekeeper |
| GET | /api/stock-takes/:id | stock | owner, manager, accountant, storekeeper |
| POST | /api/stock-takes/:id/counts | count | owner, manager, storekeeper |
| POST | /api/stock-takes/:id/submit | count | owner, manager, storekeeper |
| GET | /api/approvals | approve | owner, manager, accountant |
| POST | /api/approvals/:id/approve | approve | owner, manager, accountant |
| POST | /api/approvals/:id/reject | approve | owner, manager, accountant |
| POST | /api/expenses | money | owner, manager, accountant |
| POST | /api/cash/count | money | owner, manager, accountant |
| POST | /api/cash/bank | money | owner, manager, accountant |
| POST | /api/opening-balances | money | owner, manager, accountant |
| POST | /api/periods/lock | admin | owner |
| GET | /api/reports/trial-balance | report | owner, manager, accountant |
| GET | /api/reports/pnl | report | owner, manager, accountant |
| GET | /api/reports/balance-sheet | report | owner, manager, accountant |
| GET | /api/reports/balances/:kind | report | owner, manager, accountant |
| GET | /api/journals/:id | report | owner, manager, accountant |
| GET | /api/accounts/:code/ledger | report | owner, manager, accountant |
| GET | /api/reconcile | read | owner, manager, accountant, storekeeper, cashier, waiter |
| GET | /api/bills/:id/receipt | sell | owner, manager, cashier, waiter |
| GET | /api/bills/:id/kot | sell | owner, manager, cashier, waiter |
| POST | /api/bills/:id/kot | sell | owner, manager, cashier, waiter |
| POST | /api/bills/:id/refund | sell | owner, manager, cashier, waiter |
| POST | /api/bills/:id/service-charge | sell | owner, manager, cashier, waiter |
| POST | /api/tips/payout | money | owner, manager, accountant |
| POST | /api/deposits | sell | owner, manager, cashier, waiter |
| POST | /api/gift-cards | sell | owner, manager, cashier, waiter |
| GET | /api/gift-cards/:code | sell | owner, manager, cashier, waiter |
| GET | /api/customers/:id/loyalty | sell | owner, manager, cashier, waiter |
| GET | /api/settings | setup | owner, manager |
| POST | /api/settings | admin | owner |
| POST | /api/purchases/:id/returns | purchase | owner, manager, accountant, storekeeper |
| POST | /api/stock/production | stock | owner, manager, accountant, storekeeper |
| POST | /api/stock/staff-meal | stock | owner, manager, accountant, storekeeper |
| GET | /api/assets | money | owner, manager, accountant |
| POST | /api/assets | money | owner, manager, accountant |
| POST | /api/assets/depreciate | money | owner, manager, accountant |
| GET | /api/hotel/room-types | hotel | owner, manager, cashier, waiter |
| POST | /api/hotel/room-types | setup | owner, manager |
| GET | /api/hotel/rooms | hotel | owner, manager, cashier, waiter |
| POST | /api/hotel/rooms | setup | owner, manager |
| PATCH | /api/hotel/rooms/:id/status | housekeeping | owner, manager, storekeeper, cashier, waiter |
| GET | /api/hotel/availability | hotel | owner, manager, cashier, waiter |
| GET | /api/hotel/reservations | hotel | owner, manager, cashier, waiter |
| POST | /api/hotel/reservations | hotel | owner, manager, cashier, waiter |
| GET | /api/hotel/reservations/:id | hotel | owner, manager, cashier, waiter |
| POST | /api/hotel/reservations/:id/cancel | hotel | owner, manager, cashier, waiter |
| POST | /api/hotel/reservations/:id/check-in | hotel | owner, manager, cashier, waiter |
| POST | /api/hotel/reservations/:id/charges | hotel | owner, manager, cashier, waiter |
| POST | /api/hotel/reservations/:id/payments | hotel | owner, manager, cashier, waiter |
| POST | /api/hotel/reservations/:id/check-out | hotel | owner, manager, cashier, waiter |
| POST | /api/hotel/night-audit | money | owner, manager, accountant |
| GET | /api/hotel/occupancy | hotel | owner, manager, cashier, waiter |
| GET | /api/hr/employees | hr | owner, manager, accountant |
| POST | /api/hr/employees | hr | owner, manager, accountant |
| PATCH | /api/hr/employees/:id | hr | owner, manager, accountant |
| GET | /api/hr/employees/:id/leave-balance | hr | owner, manager, accountant |
| GET | /api/hr/leave | hr | owner, manager, accountant |
| POST | /api/hr/leave | hr | owner, manager, accountant |
| POST | /api/payroll/preview | hr | owner, manager, accountant |
| GET | /api/payroll/runs | payroll | owner, accountant |
| POST | /api/payroll/runs | payroll | owner, accountant |
| GET | /api/payroll/runs/:id/payslips | payroll | owner, accountant |
| POST | /api/payroll/runs/:id/pay | payroll | owner, accountant |
| POST | /api/payroll/remit | payroll | owner, accountant |
| GET | /api/payroll/liabilities | payroll | owner, accountant |
| GET | /api/items/barcode/:code | sell | owner, manager, cashier, waiter |
| GET | /api/reports/low-stock | stock | owner, manager, accountant, storekeeper |
| GET | /api/promotions | sell | owner, manager, cashier, waiter |
| POST | /api/promotions | setup | owner, manager |
| POST | /api/promotions/:id/active | setup | owner, manager |
| GET | /api/price-lists | sell | owner, manager, cashier, waiter |
| POST | /api/price-lists | setup | owner, manager |
| POST | /api/price-lists/:id/items | setup | owner, manager |
| POST | /api/customers/:id/price-list | setup | owner, manager |
| GET | /api/customers/:id/statement | money | owner, manager, accountant |
| GET | /api/reports/ageing | report | owner, manager, accountant |
| GET | /api/orders | sell | owner, manager, cashier, waiter |
| POST | /api/orders | sell | owner, manager, cashier, waiter |
| POST | /api/orders/:id/deliver | sell | owner, manager, cashier, waiter |
| POST | /api/orders/:id/cancel | sell | owner, manager, cashier, waiter |
| POST | /api/import/items | setup | owner, manager |
| POST | /api/import/parties | setup | owner, manager |
| POST | /api/import/opening-stock | money | owner, manager, accountant |
| GET | /api/owner/summary | report | owner, manager, accountant |
| GET | /api/owner/digest | report | owner, manager, accountant |
| POST | /api/owner/digest/send | admin | owner |
| GET | /api/notifications | report | owner, manager, accountant |
| GET | /api/forecast | report | owner, manager, accountant |
| GET | /api/forecast/reorder | stock | owner, manager, accountant, storekeeper |
| GET | /api/outlets | read | owner, manager, accountant, storekeeper, cashier, waiter |
| POST | /api/outlets | admin | owner |
| PATCH | /api/stores/:id | setup | owner, manager |
| GET | /api/reports/outlets | report | owner, manager, accountant |
