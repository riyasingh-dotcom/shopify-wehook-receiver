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
pnpm test:e2e --testPathPatterns=billing
pnpm lint             # eslint --fix
pnpm tsc --noEmit     # type-check without emitting (matches CI gate)

# Single unit test file:
pnpm jest src/billing/plan.guard.spec.ts

# Prisma:
pnpm prisma generate       # regenerate client after schema changes
pnpm prisma migrate dev    # run migrations (requires DIRECT_URL)
node scripts/seed.js       # seed a test webhook event into the DB
```

### Docker
```bash
docker compose up --build   # first run — builds image, starts Redis + app
docker compose up           # subsequent runs
docker compose up testdb -d # start test DB only (postgres:15 on port 5433)
```

**Test DB setup (one-time):**
```bash
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
  → GET /webhooks/events     (30s polling, no auth — intentional for dev)
  → GET /webhooks/product-history  (session token + plan guard — basic+)
  → renders Activity Feed via Polaris IndexTable
```

### Backend modules

**`src/webhooks/`** — core feature:
- `webhooks.controller.ts` — `POST /webhooks/shopify` (queues job), `GET /webhooks/events` (reads DB), `POST /webhooks/events/:id/reprocess` (@RequiresPlan('basic')), `GET /webhooks/product-history` (@RequiresPlan('basic'))
- `webhooks.service.ts` — HMAC verification, `handleOrderCreated`, `handleProductUpdated`, `getEvents`, `getProductHistory(days)`
- `webhook.processor.ts` — BullMQ `@Processor('webhook-processing')` — routes jobs by topic, calls service, marks processed
- `order-payload.ts` — Zod-style parsing of raw Shopify order JSON
- `product-diff.ts` — diffs previous product snapshot vs incoming payload; tracks `title`, `status`, `published_at`, and variant prices
- `webhooks.types.ts` — `WebhookJobData` type shared between controller and processor

**`src/billing/`** — Shopify Billing API + plan gating:
- `plans.ts` — `PLANS` config (free/basic/pro), `Plan` type, `PlanFeatures` type, `PLAN_ORDER` (`{ free:0, basic:1, pro:2 }`)
- `plan.guard.ts` — `PlanGuard` (reads `request.shopifySession.dest`, looks up `Subscription`, compares `PLAN_ORDER`) and `@RequiresPlan('basic'|'pro')` decorator. Always chain after `ShopifySessionTokenGuard`: `@UseGuards(ShopifySessionTokenGuard, PlanGuard)`. Throws `ForbiddenException({ error:'plan_required', requiredPlan, currentPlan, upgradeUrl:'/billing/upgrade' })`.
- `billing.controller.ts` — `POST /billing/subscribe` (body: `{ shopDomain, plan, sessionToken }`), `GET /billing/status?shop=`, `GET /billing/callback`
- `billing.service.ts` — `createSubscription` (exchanges session token → Shopify GraphQL → upserts Subscription row; throws 409 if shop already has active subscription), `getStatus` (returns plan+features; falls back to free if subscription is not active), `handleCallback`

**`src/auth/shopify-session-token.guard.ts`** — `ShopifySessionTokenGuard`: verifies Shopify session JWT, attaches `request.shopifySession = { dest: 'https://shop.myshopify.com' }`. Apply before `PlanGuard`. Not applied to `GET /webhooks/events` intentionally.

**`src/shopify/shopify.module.ts`** — exports `SHOPIFY_INSTANCE` (Symbol) containing the configured `@shopify/shopify-api` instance. **Not global** — import `ShopifyModule` explicitly in any module that needs it. Override `SHOPIFY_INSTANCE` in tests to avoid real API calls.

**`src/prisma/`** — `PrismaModule` (global) and `PrismaService`. Available everywhere without importing.

**Bull Board** — queue monitor UI at `GET /admin/queues`.

### Database models

| Model | Purpose |
|---|---|
| `WebhookEvent` | Every incoming webhook — `shopifyId` unique (idempotency), `status` tracks processing state |
| `Product` | Latest full Shopify product payload snapshot (diff baseline) |
| `ProductChangeLog` | Per-field audit trail; written atomically with `Product` upsert in a `$transaction` |
| `FailedJob` | Persistent record of BullMQ jobs that exhausted retries |
| `Subscription` | Per-shop billing record — `shopDomain` unique, tracks `plan`, `status`, `shopifyChargeId`, `accessToken` |

**Product change tracking:** `handleProductUpdated` reads current `Product` snapshot → diffs via `detectProductChanges` → single `$transaction` upserts snapshot and creates `ProductChangeLog` rows. `getEvents` unifies `WebhookEvent` + `ProductChangeLog` into one sorted list.

**Processor failure handling:** `WebhookProcessor` only writes a `FailedJob` row when `attemptsMade >= attempts` (permanent failure). Rethrowing from `process()` triggers BullMQ retry.

### Frontend (`frontend/`)

**Pages:**
- `app/page.tsx` — Activity Feed dashboard; polls `GET /webhooks/events` every 30s. The `embedded=1` URL param guard prevents fetching outside Shopify Admin iframe. Shows upgrade modal (Polaris `Modal`) when any authenticated request returns `{ error: 'plan_required' }`.
- `app/billing/page.tsx` — Pricing page with three Polaris plan cards (Free/Basic/Pro). Fetches `/api/billing/status?shop=` on mount. Upgrade button calls `getIdToken()` → POSTs to `/api/billing/subscribe` → redirects to Shopify `confirmationUrl`. Redirects always append `window.location.search` to preserve `shop=` param.
- `app/products/` — Product Change History page.

**App Bridge v4:** `window.shopify` is injected by Shopify Admin — no `AppProvider`. `useAuthenticatedFetch` (`frontend/lib/authenticated-fetch.ts`) constructs `${NEXT_PUBLIC_API_URL}${path}`, gets session token via `getIdToken()` (polls `window.shopify` up to 2s, then falls back to `id_token` URL param).

**Next.js API proxy routes** (`frontend/app/api/`):
- `auth/route.ts` + `auth/callback/route.ts` — OAuth flow
- `billing/status/route.ts` — proxies `GET /billing/status` to NestJS backend
- `billing/subscribe/route.ts` — proxies `POST /billing/subscribe` to NestJS backend

**CSP:** `next.config.mjs` sets `frame-ancestors https://*.myshopify.com https://admin.shopify.com`. No Tailwind — Polaris only.

## Environment variables

### Backend (`.env` / Railway)
| Var | Purpose |
|---|---|
| `DATABASE_URL` | Pooled PostgreSQL URL (Prisma runtime) |
| `DIRECT_URL` | Non-pooled URL (Prisma migrations only) |
| `SHOPIFY_WEBHOOK_SECRET` | HMAC verification for incoming webhooks |
| `SHOPIFY_API_KEY` | Shopify app Client ID |
| `SHOPIFY_API_SECRET` | Shopify app Client Secret |
| `APP_HOST` | Hostname of the backend |
| `REDIS_URL` | Local Redis (`redis://localhost:6379`). When set, Upstash vars are not needed. |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis endpoint (production; only when `REDIS_URL` unset) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token |
| `BILLING_RETURN_URL` | Full URL of `GET /billing/callback` — must match Shopify Partners redirect |
| `TEST_DATABASE_URL` | `postgresql://postgres:postgres@localhost:5433/webhooks_test` |

### Frontend (`frontend/.env.local`)
| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SHOPIFY_API_KEY` | Client ID (used by App Bridge) |
| `NEXT_PUBLIC_API_URL` | NestJS backend URL (e.g. `http://localhost:3000`) — must be set in deployment |
| `SHOPIFY_API_SECRET` | Client Secret (server-side only — OAuth callback) |

## Key constraints

**Body parser:** `main.ts` disables NestJS's default body parser and mounts `express.raw({ type: 'application/json' })` only on `/webhooks/shopify` so HMAC verification has the raw bytes. Any new webhook route needs the same pattern.

**Idempotency:** `shopifyId` has a unique constraint. P2002 errors are caught and silently skipped — Shopify delivers at-least-once.

**Prisma client:** generated to `generated/prisma/` (not `node_modules`). Always run `pnpm prisma generate` after schema changes.

**TypeScript:** `noImplicitAny` is off. `strictNullChecks` is on. `emitDecoratorMetadata` and `experimentalDecorators` required for NestJS DI.

**BullMQ in e2e tests:** Override both providers to avoid Redis connection:
```typescript
.overrideProvider(getQueueToken('webhook-processing')).useValue({ add: jest.fn() })
.overrideProvider(WebhookProcessor).useValue({})
```

**Shopify API in e2e tests:** Override `SHOPIFY_INSTANCE` to avoid real API calls:
```typescript
import { SHOPIFY_INSTANCE } from '../src/shopify/shopify.module';
// ...
.overrideProvider(SHOPIFY_INSTANCE).useValue(mockShopify)
```

**ShopifySessionTokenGuard in e2e tests:** Override to inject a fake session:
```typescript
const mockSessionGuard = {
  canActivate: (ctx) => {
    ctx.switchToHttp().getRequest().shopifySession = { dest: `https://${TEST_SHOP}` };
    return true;
  },
};
.overrideGuard(ShopifySessionTokenGuard).useValue(mockSessionGuard)
```

**E2e test isolation:** `test/jest-e2e.json` sets `maxWorkers: 1` — all suites run sequentially against the shared test DB. Scope `deleteMany` calls in `beforeEach` to the suite's `TEST_SHOP` to avoid cross-suite interference.
