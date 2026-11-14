# Backup and restore procedure (OPS-02)

## What is backed up

A compressed `pg_dump` of **every active client database**, one file each, named `<slug>-<timestamp>.sql.gz`, written to `./backups` by the `backup` container once a day. The control database (registry and sign-in identities) is **not** included yet: back it up too (`pg_dump mizani_control`) or sign-in identities are lost on a disaster.

| Setting | Value |
|---|---|
| Frequency | Daily (container loop), or on demand |
| Retention | 14 days (`BACKUP_KEEP_DAYS`) |
| Storage | `./backups` on the host. **Off-site copy is not configured.** Files are **not encrypted** |
| Access | Anyone with host access |

## Take a backup now

```bash
docker compose exec backup node dist/cli.js backup
```

## Restore one client (tested procedure)

1. **Verify first in a scratch database** (never skip):
```bash
createdb -h <host> -U <user> restore_check
gunzip -c backups/<slug>-<timestamp>.sql.gz | psql -h <host> -U <user> -d restore_check -v ON_ERROR_STOP=1
psql -h <host> -U <user> -d restore_check -c "select count(*) from journals" -c "select sum(debit), sum(credit) from journal_lines"
dropdb -h <host> -U <user> restore_check
```
2. **Replace the live database** (stops that client's trading for a few minutes):
```bash
docker compose stop api
# find the database name:  select slug, db_name from tenants;   (control database)
dropdb --force -h <host> -U <user> <db_name>
createdb -h <host> -U <user> <db_name>
gunzip -c backups/<file>.sql.gz | psql -h <host> -U <user> -d <db_name> -v ON_ERROR_STOP=1
docker compose start api
```
3. Sign in as that client, check the header strip is green, and `GET /api/reconcile`.
4. Record the incident and the data lost (everything since the backup).

## Evidence of testing

On 2026-11-11 a dump of a client database was restored into an empty database on the build machine: restore succeeded, journal count and balanced totals matched, and the three append-only triggers were present. **The containerised `backup` service itself has not been run.**

## Gaps

No point-in-time recovery (WAL archiving is not configured), so up to 24 hours can be lost. No automatic restore test. No encryption. No off-site copy. Restoring the control database is not documented because it is not yet backed up.
