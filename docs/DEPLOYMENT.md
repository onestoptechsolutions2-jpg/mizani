# Deployment and release procedure (DEP-02)

## Environments

Only a local development environment exists today. Staging and production are not provisioned (see INFRASTRUCTURE.md).

## First deployment

1. Server with Docker Engine and the Compose plugin. Open only ports 80/443 to the internet.
2. Copy the project, then `cp .env.example .env` and set `PGPASSWORD`, `JWT_SECRET` (`openssl rand -hex 32`), and optionally `PLATFORM_ADMIN_TOKEN`.
3. Put a TLS-terminating reverse proxy (Caddy, nginx, a cloud load balancer) in front of port 3000. **The app does not do TLS.**
4. `docker compose up -d --build`
5. Verify: `curl -fsS http://localhost:3000/healthz` returns `{"ok":true}`; open the app, create a test business, take a sale, check the strip is green.
6. Run the tests once on the target: `docker compose --profile test run --rm test`.
7. Edit the illustrative plan prices in the control database (`plans` table) before selling. Decide the trial length (`TRIAL_DAYS`).
8. Set `ALLOW_SIGNUP=false` once your own clients are created, if signup should be closed.

## Release procedure

| Step | Action | Evidence |
|---|---|---|
| 1 | Merge to the main branch only when `npm test` is green | CI or test log |
| 2 | Update the version in `package.json` and add release notes (changes, migrations, risks) | Release notes |
| 3 | Take a backup: `docker compose exec backup node dist/cli.js backup` | Backup file listed |
| 4 | Approval from the system owner for any release that adds a migration | Recorded approval |
| 5 | `git pull && docker compose up -d --build` (migrations run automatically at start) | Logs show "Server listening" and no "Tenant migrations failed" |
| 6 | `docker compose exec api node dist/cli.js migrate-all` and check every client reports `ok` | Output |
| 7 | Smoke test: sign in, sell, pay, check the strip, `GET /api/reconcile` | Screenshot |
| 8 | Announce completion | — |

## Rollback

- **Code only (no migration in the release):** check out the previous version and `docker compose up -d --build`.
- **Release included a migration:** migrations are forward-only. Either ship a corrective migration, or restore each affected client from the backup taken in step 3 (see BACKUP_RESTORE.md) and redeploy the previous code. Decide before releasing: migrations should be additive so the previous code still runs against them.

## Zero-downtime

Not provided. Restarting `api` takes a few seconds. Release outside trading hours.
