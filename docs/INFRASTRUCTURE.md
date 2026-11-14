# Infrastructure and hosting register (DEP-03)

Nothing below is provisioned yet. "Unassigned" means a decision or a purchase is still needed. Do not record passwords or keys here.

| Item | Current state | Owner |
|---|---|---|
| Hosting provider and region | **Unassigned.** Data-protection advice is needed before choosing a region (see PRIVACY_AND_DATA.md) | Unassigned |
| Server(s) | None. Needs one Linux host with Docker, 2 vCPU and 4 GB RAM as a starting guess (**not benchmarked**) | Unassigned |
| Domain and DNS | None registered | Unassigned |
| TLS certificate | None. Use the reverse proxy's automatic certificates | Unassigned |
| Reverse proxy | Not included in the compose file | Unassigned |
| Database | PostgreSQL 16 container with a named volume `pgdata`. Timezone set to Africa/Nairobi | Unassigned |
| Backup storage | `./backups` on the **same host**. Off-site copy is **not configured** | Unassigned |
| Monitoring and alerting | None. See OPERATIONS.md | Unassigned |
| Log storage | Container logs only | Unassigned |
| Messaging provider for nightly reports (WhatsApp/SMS gateway with a webhook) | None chosen | Unassigned |
| Email / SMS / M-Pesa / eTIMS | None connected | Unassigned |
| Source repository host | None. The code is delivered as an archive | Unassigned |

## Network

Only the `api` port is published. The database is reachable only on the internal Compose network.

## Dependencies on outside services at runtime

None. The app calls no third-party service today.
