# Audit logging and incident response (SEC-03)

## What is recorded

| Event | Where | Detail |
|---|---|---|
| Every financial posting | `journals`, `journal_lines` | Business date, exact time, source document, the user who did it, reversal link. **Immutable** |
| Every stock movement | `stock_moves` | Item, store, quantity, value, source, journal. Immutable |
| Who counted and who approved | `stock_takes`, `approvals` | Counter, approver, times |
| Manager overrides | `bill_dispositions.approver_id`, bill-line removal reasons | Who approved what and why |
| Voids | `approvals`, bill lines `remove_reason` | Requester, approver, reason |
| Sign-ins | **Not recorded** |
| Failed sign-ins and rate-limit hits | **Not recorded** (limit only) |
| Changes to master data (prices, recipes, users, credit limits) | **Not recorded** |
| Operator actions (create-tenant, suspend, set-password) | **Not recorded** beyond container logs |

The ledger gives a strong audit trail for money and stock. **Setup changes and security events are not audited yet.** That is a gap, listed in KNOWN_ISSUES.

## Log access and retention

Application logs go to the container's standard output as JSON. Retention depends on the Docker log driver (default: unlimited local files). Nothing is shipped off the host.

## Incident response (proposed, to be adopted by the system owner)

| Role | Responsibility |
|---|---|
| Incident lead | Decides severity, runs the response |
| Technical responder | Contains and fixes |
| Communications | Tells affected clients and, where required, the regulator |

| Severity | Example | First response |
|---|---|---|
| 1 | Data exposed to the wrong client; ledger out of balance on several clients; service down | Immediately: suspend affected clients (`cli suspend`), preserve logs and a backup, start the clock on notification duties |
| 2 | One client's checks failing; suspected misuse by staff | Within 4 hours: investigate with `GET /api/reconcile`, journal drill-down, approvals |
| 3 | Single failed action, UI defect | Next working day |

**Books-out-of-balance procedure.** The database prevents unbalanced entries, so a red check means a code or data fault, not a typo. Stop closing days for that client. Capture `GET /api/reconcile` and the failing check. Do not post correcting journals by hand to hide it; find the source document, fix the code, and post a reversal.

**Notification.** If personal data is exposed, the Data Protection Act requires notifying the regulator and affected people within a short fixed period. Confirm the exact duty with a legal adviser and put the contact details here: **not yet assigned**.
