# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

**Backend (root):** NestJS 11 · TypeScript · Prisma 7 (PostgreSQL) · BullMQ (Upstash Redis) · Jest · pnpm

**Frontend (`frontend/`):** Next.js 14 App Router · TypeScript · Shopify Polaris 13 · App Bridge v4

## Commands

### Backend (run from repo root)
```bash
pnpm start:dev        # dev server with hot reload (port 3000)
pnpm build            # compile to dist/
pnpm start:prod       # run compiled output
pnpm test             # unit tests (src/**/*.spec.ts)
pnpm test:watch       # unit tests in watch mode
pnpm test:cov         # unit tests + coverage report
pnpm test:e2e         # e2e tests (test/jest-e2e.json) — requires TEST_DATABASE_URL in .env

# Single e2e test file:
pnpm test:e2e --testPathPatterns=webhooks-shopify
pnpm lint             # eslint --fix
pnpm tsc --noEmit     # type-check without emitting (matches CI gate)

# Single test file:
pnpm jest src/webhooks/webhooks.service.spec.ts

# Prisma:
pnpm prisma generate       # regenerate client after schema changes
pnpm prisma migrate dev    # run migrations (requires DIRECT_URL)
node scripts/seed.js       # seed a test webhook event
```

### Docker
```bash
docker compose up --build   # first run — builds image, starts Redis + app
docker compose up           # subsequent runs
docker compose up testdb -d # start test DB only (postgres:15 on port 5433)
```

**Test DB setup (one-time):**
```bash
# docker-compose.override.yml already defines the testdb service
docker compose up testdb -d
DATABASE_URL=$TEST_DATABASE_URL DIRECT_URL=$TEST_DATABASE_URL pnpm prisma migrate deploy
# then add TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/webhooks_test to .env
```

### Frontend (run from repo root)
```bash
pnpm --filter frontend dev          # Next.js dev server (port 3001)
pnpm --filter frontend build        # production build
pnpm --filter frontend type-check   # tsc --noEmit
pnpm --filter frontend lint         # next lint
```

### Both services together
```bash
pnpm dev:all    # runs NestJS + Next.js concurrently
```

## Architecture

This repo is a **pnpm workspace** (`pnpm-workspace.yaml` includes `frontend/`). Both packages share a single lockfile at the root.

### Request flow

```
Shopify → POST /webhooks/shopify
           ↓ HMAC verified (raw Buffer required — see body parser note)
           ↓ job pushed to BullMQ queue "webhook-processing"
           ↓ WebhookProcessor picks up job
           ↓ routes by topic → handleOrderCreated / handleProductUpdated
           ↓ writes to PostgreSQL (Prisma)

Next.js frontend (embedded in Shopify Admin iframe)
  → GET /webhooks/events  (30s polling, session token auth)
  → renders Activity Feed via Polaris IndexTable
```

### Backend modules

**`src/webhooks/`** — core feature:
- `webhooks.controller.ts` — `POST /webhooks/shopify` (queues job), `GET /webhooks/events` (reads DB)
- `webhooks.service.ts` — HMAC verification, `handleOrderCreated`, `handleProductUpdated`, `getEvents`
- `webhook.processor.ts` — BullMQ `@Processor('webhook-processing')` — routes jobs by topic, calls service, marks processed
- `order-payload.ts` — Zod-style parsing of raw Shopify order JSON
- `product-diff.ts` — diffs previous product snapshot vs incoming payload; tracks `title`, `status`, `published_at`, and variant prices
- `webhooks.types.ts` — `WebhookJobData` type shared between controller and processor

**`src/dashboard/`** — serves `public/index.html` (legacy static dashboard at `GET /`).

**Bull Board** — queue monitor UI at `GET /admin/queues`. Mounted via `BullBoardModule` in `AppModule`. Use it to inspect job states, retry failed jobs manually, and view queue depth.

**`src/auth/shopify-session-token.guard.ts`** — `ShopifySessionTokenGuard`: verifies Shopify session JWT using `@shopify/shopify-api`. Apply with `@UseGuards(ShopifySessionTokenGuard)` on routes the embedded frontend calls. Currently not applied to `GET /webhooks/events` (intentionally, for development).

**`src/billing/`** — Shopify Billing API integration:
- `billing.controller.ts` — `POST /billing/subscribe` (initiates subscription), `GET /billing/callback` (handles Shopify redirect after approval/decline)
- `billing.service.ts` — creates `appSubscriptionCreate` GraphQL mutation, exchanges session token for offline access token, writes `Subscription` rows. Plans are `basic` ($9) and `pro` ($29), defined in `PLAN_CONFIG`.

**`src/prisma/`** — `PrismaModule` and `PrismaService` wrapping `PrismaClient`. Import `PrismaModule` into any feature module that needs DB access.

### Database models

| Model | Purpose |
|---|---|
| `WebhookEvent` | Every incoming webhook — `shopifyId` unique (idempotency), `status` tracks processing state |
| `Product` | Latest full Shopify product payload snapshot (used as the diff baseline) |
| `ProductChangeLog` | Per-field audit trail; written atomically with `Product` upsert in a `$transaction` |
| `FailedJob` | Persistent record of BullMQ jobs that exhausted retries |
| `Subscription` | Per-shop billing record — `shopDomain` unique, tracks `plan`, `status`, `shopifyChargeId`, and `accessToken` |

**Product change tracking pattern:** `handleProductUpdated` reads the current `Product` snapshot, diffs it with the incoming payload via `detectProductChanges`, then runs a single `$transaction` that upserts the snapshot and creates `ProductChangeLog` rows. The `getEvents` method unifies `WebhookEvent` + `ProductChangeLog` rows into one sorted list for the frontend.

**Processor failure handling:** `WebhookProcessor` only writes a `FailedJob` row when a job has permanently failed — i.e. `attemptsMade >= attempts`. Transient failures (retries still pending) are logged but not persisted. Rethrowing from `process()` is what triggers BullMQ's retry logic.

### Frontend (`frontend/`)

**App Bridge v4:** `window.shopify` is injected by Shopify Admin — there is no `AppProvider` from `@shopify/app-bridge-react`. `useAppBridge()` is just `return window.shopify`. `useAuthenticatedFetch` (`frontend/lib/authenticated-fetch.ts`) accesses `window.shopify.idToken()` directly in the callback (not at render time) to avoid crashes before a full OAuth install; falls back to `id_token` URL param.

**OAuth routes** (`frontend/app/api/auth/`):
- `route.ts` — initiates OAuth, validates `shop` param, stores CSRF nonce in cookie, redirects to Shopify
- `callback/route.ts` — validates state + HMAC, exchanges code for access token, stores `shopify_access_token` cookie (HttpOnly, 30d)

**CSP:** `next.config.mjs` sets `frame-ancestors https://*.myshopify.com https://admin.shopify.com` so the app can be embedded. No Tailwind — Polaris only.

**Polling:** `page.tsx` polls `GET /webhooks/events` every 30 s. Silent background refresh (no full spinner on poll). The `embedded=1` URL param guard prevents data fetching outside the Shopify Admin iframe.

## Environment variables

### Backend (`.env` / Railway)
| Var | Purpose |
|---|---|
| `DATABASE_URL` | Pooled PostgreSQL URL (Prisma runtime) |
| `DIRECT_URL` | Non-pooled URL (Prisma migrations only) |
| `SHOPIFY_WEBHOOK_SECRET` | HMAC verification for incoming webhooks |
| `SHOPIFY_API_KEY` | Shopify app Client ID (used by session token guard) |
| `SHOPIFY_API_SECRET` | Shopify app Client Secret (session token guard + OAuth callback) |
| `APP_HOST` | Hostname of the backend (default `localhost`) |
| `REDIS_URL` | Local Redis override (e.g. `redis://localhost:6379`). When set, Upstash vars are not needed. docker-compose sets this automatically via the `redis` service. |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis endpoint for BullMQ (production; only used when `REDIS_URL` is unset) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token |
| `BILLING_RETURN_URL` | Full URL of `GET /billing/callback` — must match the redirect registered in Shopify Partners |
| `TEST_DATABASE_URL` | Local test DB for e2e tests (`postgresql://postgres:postgres@localhost:5433/webhooks_test`) |

### Frontend (`frontend/.env.local`)
| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SHOPIFY_API_KEY` | Client ID (safe to expose — used by App Bridge) |
| `NEXT_PUBLIC_API_URL` | NestJS backend URL (e.g. `http://localhost:3000`) |
| `SHOPIFY_API_SECRET` | Client Secret (server-side only — OAuth callback) |

## Key constraints

**Body parser:** `main.ts` disables NestJS's default body parser and mounts `express.raw({ type: 'application/json' })` only on `/webhooks/shopify` so HMAC verification has the raw bytes. Any new webhook route needs the same pattern before `express.json()`.

**Idempotency:** `shopifyId` has a unique constraint. P2002 errors are caught and silently skipped — Shopify delivers at-least-once, so all handlers must tolerate duplicate delivery.

**Prisma client:** generated to `generated/prisma/` (not `node_modules`). Always run `pnpm prisma generate` after schema changes.

**TypeScript:** `noImplicitAny` is off (unlike global CLAUDE.md). `strictNullChecks` is on. `emitDecoratorMetadata` and `experimentalDecorators` are required for NestJS DI.

**ngrok for local dev:** Next.js runs on port 3001, exposed via ngrok for Shopify Admin to load the embedded app. Set the ngrok URL as the App URL and redirect URL in the Shopify Partners dashboard. Backend stays on port 3000 and can be tunnelled separately or deployed to Railway.

**BullMQ in e2e tests:** To boot the app without Redis, override both the queue provider and the processor:
```typescript
.overrideProvider(getQueueToken('webhook-processing')).useValue({ add: jest.fn() })
.overrideProvider(WebhookProcessor).useValue({})
```
`useValue({})` on the processor sets `metatype: null`, so `BullExplorer` never creates a Worker — no Redis connection is attempted. The queue override prevents the Queue factory from running too.
