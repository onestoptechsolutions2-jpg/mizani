# FAQ and troubleshooting (USR-03)

Messages below are the ones the system actually shows. First check: tap the header strip. If a check is red, tell your administrator which one.

| You see | Meaning | What to do |
|---|---|---|
| *Wrong email, password or business address* | Sign-in failed | Check all three. The business address is the short name chosen at signup |
| *Too many attempts. Wait a few minutes* | Rate limit | Wait 5 minutes |
| *Please sign in again* | Session expired (12 hours) | Sign in |
| *Your role cannot do this* | Your role lacks the permission | Ask a manager or the owner |
| *Manager approval required: provide approver user and PIN* | Action needs a manager | Have a **different** manager choose their name and enter their PIN |
| *The approver must be a different person…* | You tried to approve your own action | Ask another manager |
| *Approval rejected: invalid manager or PIN* | Wrong PIN, or that person is not a manager | Retry. Managers need a PIN set under Setup |
| *Bill … is closed and cannot be changed* | The bill is finished | Start a new bill. Refunds are not built yet |
| *Payment of X exceeds the bill balance* | Too much entered | Enter the balance or less |
| *This bill still has X unpaid* | Tried to close as paid | Take payment or choose credit, staff, complimentary or write-off |
| *The kitchen has prepared this item…* | Cannot reduce a made item | Remove it with a reason (manager PIN), then add the new quantity |
| *N items are not counted yet* | Stock take incomplete | Enter every quantity, including 0 |
| *The person who counted cannot approve the count* | Separation of duties | A different person approves |
| *You cannot approve your own request* | Same | Ask someone else |
| *period is locked through DATE* | The period was closed | Post it in the current period, or ask the owner |
| *The day cannot close yet* | Checklist items are open | Open **Money → Day end** and clear each item |
| *delivery_date … is required* | Purchase needs the arrival date | Enter when the goods arrived, not today's date |
| *Choose a reason from the list* | Wastage reason missing | Pick one |
| *Books need attention* (red strip) | An invariant failed | Do not close the day. Note the failing check and escalate |

## Common questions

**Stock shows negative.** Sales were rung before the delivery was recorded, or a recipe is missing. Record the purchase, or fix the recipe, then count the store.

**Why does a removed item not return to stock?** The kitchen had already made it. Its cost went to Wastage.

**Can I edit a posted entry?** No, by design. Corrections are reversals that leave a visible trail.

**I forgot my password.** Reset is not built yet. The platform operator runs `node dist/cli.js set-password <email> <new password>`.

**A user left.** There is no screen to disable them yet; ask the platform operator to set `active=false` on their row in the business database (the next request they make is refused).

## Escalate

Give: business address, the time, what you did, the exact message, and a screenshot of the header strip. Support contacts and SLA have **not** been set up (see OPS-04 in the checklist).
