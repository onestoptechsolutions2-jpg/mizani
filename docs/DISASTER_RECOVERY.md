# Disaster recovery and continuity plan (OPS-03)

**The targets below are proposals for the system owner to accept or change. They are not commitments and have not been exercised.**

| Target | Proposal | What currently achieves it |
|---|---|---|
| RPO (data you can lose) | 24 hours | Nightly dumps only. Meeting 1 hour needs WAL archiving, which is not configured |
| RTO (time to restore service) | 4 hours | Untested. One client restore takes minutes; rebuilding a host depends on having the code, `.env`, and backups **off the host** |

## Recovery priorities

1. Control database and the `api` (nobody can sign in without them).
2. Clients in order agreed with the owner (largest or most critical first).
3. Backups service.

## Dependencies

Docker host, disk with the `pgdata` volume, the `.env` secrets (**keep a copy in a password manager**: losing `JWT_SECRET` only logs users out, losing `PGPASSWORD` locks you out of the database), DNS and the TLS proxy, the backup files.

## Scenarios

| Scenario | Response |
|---|---|
| App container crashes | Compose restarts it. Check logs |
| Host lost, disk intact | New host, attach disk, `docker compose up -d` |
| Host and disk lost | New host, install Docker, restore code and `.env`, create empty databases, restore control and each client from the **off-site** backups. **This depends on off-site copies that do not exist yet** |
| One client corrupted or wrongly changed | Restore that client (BACKUP_RESTORE.md) |
| Ransomware or breach | Isolate the host, preserve evidence, rebuild, restore from the last backup known to be clean, follow AUDIT_AND_INCIDENTS.md |
| Internet or power outage at a restaurant | **Selling stops: there is no offline mode.** Record on paper and enter afterwards, with the correct business date. This is the largest continuity gap for the product |

## Roles

System owner (decides), technical responder, client communications. **No one is named yet.**

## Exercise

A disaster-recovery test has never been run. Schedule one before production: rebuild on a clean host from off-site backups and time it.
