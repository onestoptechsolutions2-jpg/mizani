# Technology stack and dependency register (ARC-02)

Generated 2026-11-14 from the running system. Do not edit by hand: run `npm run docs:gen`.

## Platform

| Component | Version | Notes |
|---|---|---|
| Node.js | 22 LTS (container `node:22-alpine`) | Runtime |
| TypeScript | ^5.6.0 | Compiled to CommonJS |
| PostgreSQL | 16 (container `postgres:16-alpine`) | One database per client plus a control database |
| Docker Compose | v2 | Packaging. **Not executed in the build environment**, see KNOWN_ISSUES |

## Direct dependencies

| Package | Version | Licence | Scope |
|---|---|---|---|
| @fastify/jwt | 9.1.0 | MIT | production |
| @types/node | 22.20.5 | MIT | development |
| @types/pg | 8.23.1 | MIT | development |
| fastify | 5.12.8 | MIT | production |
| pg | 8.23.1 | MIT | production |
| tsx | 4.23.15 | MIT | development |
| typescript | 5.9.3 | Apache-2.0 | development |

## Licence summary

Production packages (78, including transitive): MIT: 64, ISC: 8, BSD-3-Clause: 4, Apache-2.0: 2

Development-only packages (33): MIT: 32, Apache-2.0: 1

No copyleft (GPL/AGPL) licence appears in the production set unless listed above. Re-check on every dependency change.

## All production packages

| Package | Version | Licence |
|---|---|---|
| @fastify/ajv-compiler | 4.0.7 | MIT |
| @fastify/deepmerge | 3.2.4 | MIT |
| @fastify/error | 4.2.1 | MIT |
| @fastify/fast-json-stringify-compiler | 5.1.1 | MIT |
| @fastify/forwarded | 3.1.2 | MIT |
| @fastify/jwt | 9.1.0 | MIT |
| @fastify/merge-json-schemas | 0.2.2 | MIT |
| @fastify/proxy-addr | 5.1.2 | MIT |
| @lukeed/ms | 2.0.2 | MIT |
| @pinojs/redact | 0.4.0 | MIT |
| abstract-logging | 2.0.1 | MIT |
| ajv | 8.20.0 | MIT |
| ajv-formats | 3.0.1 | MIT |
| asn1.js | 5.4.1 | MIT |
| atomic-sleep | 1.0.0 | MIT |
| avvio | 9.3.1 | MIT |
| bn.js | 4.12.5 | MIT |
| cookie | 2.0.2 | MIT |
| dequal | 2.0.3 | MIT |
| ecdsa-sig-formatter | 1.0.11 | Apache-2.0 |
| fast-decode-uri-component | 1.0.1 | MIT |
| fast-deep-equal | 3.1.3 | MIT |
| fast-json-stringify | 7.3.4 | MIT |
| fast-jwt | 5.0.6 | Apache-2.0 |
| fast-querystring | 1.1.2 | MIT |
| fast-uri | 3.1.9 | BSD-3-Clause |
| fast-uri | 4.2.3 | BSD-3-Clause |
| fastfall | 1.5.1 | MIT |
| fastify | 5.12.8 | MIT |
| fastify-plugin | 5.1.0 | MIT |
| fastparallel | 2.4.1 | ISC |
| fastq | 1.20.3 | ISC |
| fastseries | 1.7.2 | ISC |
| find-my-way | 9.10.0 | MIT |
| inherits | 2.0.4 | ISC |
| ipaddr.js | 2.5.0 | MIT |
| json-schema-ref-resolver | 3.0.1 | MIT |
| json-schema-traverse | 1.0.0 | MIT |
| light-my-request | 6.8.0 | BSD-3-Clause |
| minimalistic-assert | 1.0.1 | ISC |
| mnemonist | 0.40.8 | MIT |
| obliterator | 2.0.5 | MIT |
| on-exit-leak-free | 2.1.2 | MIT |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| pino | 10.4.0 | MIT |
| pino-abstract-transport | 3.0.0 | MIT |
| pino-std-serializers | 7.1.0 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| process-warning | 5.1.1 | MIT |
| quick-format-unescaped | 4.0.4 | MIT |
| real-require | 1.0.0 | MIT |
| require-from-string | 2.0.2 | MIT |
| ret | 0.5.1 | MIT |
| reusify | 1.1.0 | MIT |
| rfdc | 1.4.1 | MIT |
| safe-buffer | 5.2.1 | MIT |
| safe-regex2 | 5.1.2 | MIT |
| safe-stable-stringify | 2.5.0 | MIT |
| safer-buffer | 2.1.2 | MIT |
| secure-json-parse | 4.1.1 | BSD-3-Clause |
| semver | 7.8.6 | ISC |
| set-cookie-parser | 3.2.2 | MIT |
| sonic-boom | 4.2.1 | MIT |
| split2 | 4.2.0 | ISC |
| steed | 1.1.3 | MIT |
| thread-stream | 4.2.1 | MIT |
| toad-cache | 3.7.4 | MIT |
| xtend | 4.0.2 | MIT |

## Support status

Versions are pinned by `package-lock.json`. Run `npm audit` and `npm outdated` before each release. A named owner for dependency upkeep has not been assigned.
