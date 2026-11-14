# Documentation index

Maps each handover checklist item to its document. "Draft" means written but not yet reviewed or approved by a person.

| ID | Item | Document | State |
|---|---|---|---|
| PRD-01 | System overview | [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) | Draft |
| PRD-04 | Functional specification and workflows | [WORKFLOWS.md](WORKFLOWS.md) | Draft |
| ARC-01 | Architecture | [ARCHITECTURE.md](ARCHITECTURE.md) | Draft |
| ARC-02 | Stack and dependencies | [DEPENDENCIES.md](DEPENDENCIES.md) (generated) | Draft |
| ARC-03 | Data dictionary | [DATA_DICTIONARY.md](DATA_DICTIONARY.md) (generated) | Draft |
| ARC-04 | API | [API.md](API.md) (generated) | Draft |
| USR-01 | User guide | [USER_GUIDE.md](USER_GUIDE.md) | Draft |
| USR-02 | Administrator manual | [ADMIN_GUIDE.md](ADMIN_GUIDE.md) | Draft |
| USR-03 | Troubleshooting | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Draft |
| DEP-01 | Installation | [../README.md](../README.md) | Draft |
| DEP-02 | Deployment and release | [DEPLOYMENT.md](DEPLOYMENT.md) | Draft |
| DEP-03 | Infrastructure register | [INFRASTRUCTURE.md](INFRASTRUCTURE.md) | Draft, mostly unassigned |
| DEP-04 | Database migrations | [MIGRATIONS.md](MIGRATIONS.md) | Draft |
| SEC-01 | Access control matrix | [SECURITY_ACCESS.md](SECURITY_ACCESS.md) (generated) | Draft |
| SEC-02 | Privacy and data | [PRIVACY_AND_DATA.md](PRIVACY_AND_DATA.md) | Draft, needs legal review |
| SEC-03 | Audit logging and incidents | [AUDIT_AND_INCIDENTS.md](AUDIT_AND_INCIDENTS.md) | Draft |
| TST-01 | Test plan | [TEST_PLAN.md](TEST_PLAN.md) (generated) | Draft |
| TST-02 | Test report | [TEST_REPORT.md](TEST_REPORT.md), [evidence/](evidence) | Draft (release 0.2) |
| TST-03 | UAT | [UAT_SCRIPT.md](UAT_SCRIPT.md) | Script only, no sign-off |
| OPS-01 | Operations and monitoring | [OPERATIONS.md](OPERATIONS.md) | Draft |
| OPS-02 | Backup and restore | [BACKUP_RESTORE.md](BACKUP_RESTORE.md) | Draft, restore tested locally |
| OPS-03 | Disaster recovery | [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) | Draft, targets are proposals |
| OPS-05 | Change management | [CHANGE_MANAGEMENT.md](CHANGE_MANAGEMENT.md) | Draft |
| HDO-01 | Source code handover | [HANDOVER_REPOSITORY.md](HANDOVER_REPOSITORY.md) | Draft |
| HDO-04 | Known issues | [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | Draft (release 0.2) |
| n/a | Features added in 0.2 (B4 to B13) | [PACKS_AND_FEATURES.md](PACKS_AND_FEATURES.md) | Draft |
| n/a | Payroll and statutory deductions | [PAYROLL_STATUTORY.md](PAYROLL_STATUTORY.md) | Draft, needs accountant |

Not started (need people or decisions, not software): PRD-02 BRD sign-off, PRD-03 SRS, ARC-05 integrations (eTIMS, M-Pesa, SMS not built; only an outbound webhook exists, described in PACKS_AND_FEATURES.md), OPS-04 support model and SLA, HDO-02 accounts register, HDO-03 contracts, HDO-05 training record, HDO-06 final acceptance report.

Companion design documents (in Claude Docs, outside this repository): *Product & System Design (v0.1)* and *Posting Matrix & Acceptance Tests (v0.1)*.
