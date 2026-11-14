# Source code and repository handover (HDO-01)

## Location

The code is delivered as an archive (`mizani.zip`). **No remote repository exists yet.** Create one (private), push the archive's contents as the first commit, and record its address here.

## Contents

See the layout in the README. Everything needed to build and run is included; there is no external build service.

## Build and test

```bash
npm ci && npm run build        # compiles src/ to dist/
npm test                       # needs PostgreSQL; see README
npm run docs:gen               # regenerates the generated documents
docker compose up -d --build   # runs everything (not yet executed by the author)
```

## Branching (proposed)

`main` is always releasable. Work on short branches (`feature/…`, `fix/…`), merged by pull request after tests pass. Tag releases `vX.Y.Z`. Ledger-affecting changes need the accountant's review (CHANGE_MANAGEMENT.md).

## Code ownership

Authored with AI assistance (Claude) at the request of the product owner. **No human has reviewed the code yet.** A human maintainer must read it, particularly `src/ledger.ts`, `src/stock.ts`, `src/modules/*` and `migrations/tenant/*`, before the product handles real money.

## Conventions worth knowing

- Money is integer cents, quantities are decimal strings with 6 places, all arithmetic on them is done in SQL.
- Only `postJournal` writes journals. Never write ledger tables from anywhere else.
- Corrections are reversals; there is no update or delete on the ledger.
- Every module function takes a `Ctx` holding a transaction client; never use the pool inside a handler.

## Licence

None chosen. The product owner must decide the licence and the legal entity before distribution. The name "Mizani" is a working codename with no trademark search done.
