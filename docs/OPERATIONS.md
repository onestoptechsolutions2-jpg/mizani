# Operations and monitoring guide (OPS-01)

## Health checks

| Check | How | Healthy |
|---|---|---|
| App alive | `GET /healthz` | `{"ok":true}` (also queries the control database). The container healthcheck uses it |
| Database up | `docker compose ps` shows `db` healthy | healthy |
| A client's books | `GET /api/reconcile` with that client's token. The web app shows it as the header strip and refreshes every 30 seconds | `ok: true`, 12 checks pass |
| Migrations | `cli tenants` shows every client `active` with the newest `schema_version` | all equal |
| Backups | `ls -l backups/` and `select * from backups order by id desc limit 10` in the control database | A file per client within the last 24 hours |
| Disk | `docker system df`; the `pgdata` volume | Under 80% |

## Logs

`docker compose logs -f api` (JSON lines; errors have `"level":50`). **500 errors are bugs** and should be reported with the request ID.

## Routine tasks

| Frequency | Task |
|---|---|
| Daily | Confirm backups ran; glance at error logs |
| Weekly | Review clients whose strip is red; test one restore into a scratch database |
| Monthly | `npm audit`; apply updates through the release procedure; remove old backup copies off-site; review disk growth |
| Before upgrades | Backup, then follow DEPLOYMENT.md |

## Alerts

**None are configured.** Recommended minimum: an external uptime monitor on `/healthz`; an alert when no backup file is newer than 26 hours; a nightly job calling `reconcile` for every client and alerting on failures (not built; the call exists per client).

## Capacity notes

Not measured. Each client uses up to 4 connections (`TENANT_POOL_MAX`) and at most 50 client pools stay open (`TENANT_POOL_CACHE`). PostgreSQL's default connection limit is 100, so **about 25 simultaneously active clients per database server** before tuning. Put PgBouncer in front for more.

## Scheduler and billing

The API process checks every 10 minutes whether any business is due its nightly report or has failing books and needs an alert. Run **one** API instance, or two could both send. Run `POST /api/platform/invoices/generate` once a day, and check `GET /api/platform/invoices?status=issued` for overdue invoices.

## Growth

The `commands` table (idempotency keys) is never purged and grows with every mutating call. Purge rows older than 7 days periodically: `delete from commands where created_at < now() - interval '7 days'`.

## Escalation

Severity levels are in AUDIT_AND_INCIDENTS.md. Named contacts and an on-call rota are **not assigned**.
