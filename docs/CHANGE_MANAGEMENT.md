# Maintenance and change management procedure (OPS-05)

## Types of change

| Type | Examples | Approval | Window |
|---|---|---|---|
| Standard | Dependency patch, copy edit | Developer plus passing tests | Any time outside trading hours |
| Normal | New feature, fix to posting rules | System owner | Planned, with release notes |
| Ledger-affecting | Any change to `ledger.ts`, `stock.ts`, posting in `modules/*`, or a migration touching ledger tables | System owner **and the accountant** | Planned; backup first |
| Emergency | Security fix, data-integrity fault | Incident lead, reviewed afterwards | Immediately, then document |

## Rules

1. Every change has a record: what, why, who approved, release version, rollback.
2. No change merges unless the full test suite passes. A posting change must add or update an acceptance test and the invariant checks must still pass in the soak test.
3. Never edit a released migration.
4. Do not fix a ledger fault by editing data. Post a reversal; fix the code; add a test that would have caught it.
5. Upgrade through DEPLOYMENT.md.

## Patching cycle (proposed)

Monthly dependency review (`npm audit`, `npm outdated`) and PostgreSQL minor updates; security fixes within 7 days of publication. A maintenance window outside trading hours, announced to clients in advance. The cycle is a proposal; no owner is assigned.

## Change record template

`ID | date | description | type | risk | approver(s) | tests run | release | rollback plan | outcome`
