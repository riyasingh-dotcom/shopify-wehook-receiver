# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

NestJS 11 · TypeScript · Prisma 7 (PostgreSQL) · Jest · pnpm

## Commands

```bash
pnpm start:dev        # dev server with hot reload
pnpm build            # compile to dist/
pnpm start:prod       # run compiled output
pnpm test             # unit tests (src/**/*.spec.ts)
pnpm test:cov         # unit tests + coverage report
pnpm test:e2e         # e2e tests (test/jest-e2e.json)
pnpm lint             # eslint --fix
pnpm format           # prettier --write
```

Run a single test file:
```bash
pnpm jest src/webhooks/webhooks.service.spec.ts
```

## Architecture

The app is a NestJS HTTP service that receives and processes Shopify webhooks.

```
src/
  main.ts                   # bootstrap, listens on PORT (default 3000)
  app.module.ts             # root module — imports ConfigModule (global) + feature modules
  webhooks/
    webhooks.module.ts      # feature module
    webhooks.controller.ts  # route handlers — thin, delegate to service
    webhooks.service.ts     # business logic
    *.spec.ts               # co-located unit tests
test/
  app.e2e-spec.ts           # e2e tests via supertest
prisma/
  schema.prisma             # Prisma schema (PostgreSQL, output: ../generated/prisma)
prisma.config.ts            # Prisma config (reads DATABASE_URL from env)
```

**Module pattern:** Each feature lives in `src/<feature>/` with its own module, controller, and service. Add new features as NestJS modules imported into `AppModule`.

**ConfigModule** is registered globally in `AppModule`, so `ConfigService` is available everywhere without re-importing.

**Prisma client** is generated to `generated/prisma/` (not `node_modules`). After schema changes, run `pnpm prisma generate` and `pnpm prisma migrate dev`.

## Environment

Required env vars (see `.env.example`):
- `DATABASE_URL` — PostgreSQL connection string
- `SHOPIFY_WEBHOOK_SECRET` — used to verify HMAC signatures on incoming webhooks

## Shopify Webhook Verification

All incoming webhook POST handlers must verify the `X-Shopify-Hmac-Sha256` header against `SHOPIFY_WEBHOOK_SECRET` before processing the payload. Reject with 401 if the signature is invalid.

## TypeScript Notes

`noImplicitAny` is **off** in this project (unlike the global CLAUDE.md default). `strictNullChecks` is on. `emitDecoratorMetadata` and `experimentalDecorators` are required for NestJS DI.
