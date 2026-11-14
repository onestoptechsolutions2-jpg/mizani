# Security and privacy documentation (SEC-02)

> **Not legal advice and not yet reviewed by a lawyer.** Kenya's Data Protection Act 2019 applies to personal data processed here. Registration, lawful basis, cross-border transfer rules and retention periods must be confirmed with a qualified adviser before production use.

## Data held

| Data | Where | Classification | Purpose |
|---|---|---|---|
| Owner and staff email, name | Control database (email), tenant `users` | Personal | Sign-in, accountability for every posting |
| Password and PIN | `identities.password_hash`, `users.pin_hash` | Credential | Authentication. Stored as salted scrypt hashes, never in clear |
| Customer and supplier names, phone numbers, credit limits | Tenant `parties` | Personal / financial | Credit sales, statements, supplier payments |
| Sales, purchases, stock, cash, ledger | Tenant database | Business confidential | Operating the business |
| Payment references (M-Pesa codes etc.) | `payments.reference`, `supplier_payments.reference` | Financial | Reconciliation |
| Employee name, national ID number, KRA PIN, NSSF and SHA numbers | Tenant `employees` | **Personal, sensitive** | HR and payroll |
| Salaries, allowances, payslips (PAYE, NSSF, SHIF, net pay) | Tenant `employees`, `payslips` | **Financial, confidential** | Payroll |
| Leave type (sick, maternity, paternity) | Tenant `leave_requests` | **May reveal health or family status** | Leave |

No card numbers are stored. No customer identity-document numbers are stored (employee ID numbers are, see above). **The nightly report** sends a short text of the business's daily figures to the web address the owner chooses (a messaging provider). That text contains sales and cash figures, so the owner is choosing a processor: record it in the data-processing agreement. Nothing else leaves the system.

**Employee data:** salaries and identifiers are stored unencrypted in the database. Restrict access (only owner, accountant and managers can read them), encrypt disks and backups, and review with a lawyer (D12 in KNOWN_ISSUES).

## Purpose and minimisation

Data is collected only to run the business and keep its books. The system asks for a phone number only for customers and suppliers, and it is optional.

## Isolation

Each client's data lives in a separate database. A signed token is bound to one client. The control database holds no business data.

## Encryption

| Layer | State |
|---|---|
| In transit | **Not provided by the app.** Terminate TLS in a reverse proxy |
| At rest | **Not configured.** Rely on encrypted disks or a managed database; backup files are **not encrypted** |
| Secrets | Environment variables. Use a secrets manager in production |

## Retention and deletion

Accounting records are append-only by design and must be kept for the legal retention period (confirm the period). **No deletion or anonymisation tool exists yet.** Offboarding a client means exporting (`pg_dump` of their database) and then dropping the database, after the retention decision is documented. Backups older than `BACKUP_KEEP_DAYS` (14) are removed automatically.

## Rights of data subjects

There is no self-service export or erasure. A subject-access request currently needs the operator to query the client's database. Erasure of a customer name inside a closed ledger conflicts with record-keeping duties and needs a decision (suggested: anonymise the party record, keep the ledger).

## Open items

Hosting region and cross-border transfer position; data protection registration; breach notification procedure sign-off; retention periods; backup encryption; a data-processing agreement template for clients.
