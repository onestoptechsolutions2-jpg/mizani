# Authentication and access control matrix (SEC-01)

Generated 2026-11-14 from the running system. Do not edit by hand: run `npm run docs:gen`.

## Roles and permissions

| Permission | owner | manager | accountant | storekeeper | cashier | waiter |
|---|---|---|---|---|---|---|
| read | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| sell | ✔ | ✔ |  |  | ✔ | ✔ |
| discount | ✔ | ✔ |  |  |  |  |
| count | ✔ | ✔ |  | ✔ |  |  |
| stock | ✔ | ✔ | ✔ | ✔ |  |  |
| purchase | ✔ | ✔ | ✔ | ✔ |  |  |
| approve | ✔ | ✔ | ✔ |  |  |  |
| override | ✔ | ✔ |  |  |  |  |
| money | ✔ | ✔ | ✔ |  |  |  |
| report | ✔ | ✔ | ✔ |  |  |  |
| setup | ✔ | ✔ |  |  |  |  |
| admin | ✔ |  |  |  |  |  |
| hotel | ✔ | ✔ |  |  | ✔ | ✔ |
| housekeeping | ✔ | ✔ |  | ✔ | ✔ | ✔ |
| hr | ✔ | ✔ | ✔ |  |  |  |
| payroll | ✔ |  | ✔ |  |  |  |

What the permissions mean: **sell** take orders and payments. **discount** give discounts. **count** perform stock counts. **stock** see stock and move it. **purchase** record deliveries. **approve** approve voids, stock counts and late wastage. **override** act as the manager who approves complimentary, staff deductions, write-offs, credit over limit and removal of prepared items (needs PIN). **money** expenses, cash, banking, receipts, day close. **report** financial reports. **setup** items, recipes, people. **admin** lock a period, change settings, add outlets. **hotel** reservations, folios, check-in and out. **housekeeping** room status. **hr** employees, leave, payroll preview. **payroll** run and pay payroll, remit to authorities.

## Separation of duties built into the system

- The person who counts stock cannot approve the count, and never sees the system quantity.
- Nobody can approve their own request. Manager approvals on a bill must come from a different person than the one at the till.
- Credit within a customer's limit needs no approval. Anything over needs a manager PIN.
- Voids go through a request and an approval by a different person.

## Authentication

| Control | Status |
|---|---|
| Password storage | scrypt with per-user salt |
| Manager PIN storage | scrypt with per-user salt |
| Session | Signed token, 12 hours, bound to one business |
| Disabled users | Rejected on the next request |
| Suspended business | Rejected within 30 seconds |
| Brute-force protection | 10 sign-in attempts per 5 minutes per address and email; 10 signups per hour. **In memory, per process** |
| Multi-factor authentication | **Not implemented** |
| Password reset | **Not implemented** |
| Account lifecycle | Users can be added. **There is no screen to disable or remove one yet** (the database flag exists) |
| Privileged platform access | One shared platform token set in the environment; disabled when empty. Also gates billing operations |
| Outbound notifications | The business-supplied web address must be https and must not resolve to a private, loopback or link-local address. Checked when sending, redirects refused, 5 second timeout |
