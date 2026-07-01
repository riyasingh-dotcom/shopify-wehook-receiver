# Shopify Webhook Receiver

![CI](https://github.com/riyasingh-dotcom/shopify-wehook-receiver/actions/workflows/ci.yml/badge.svg)

A production-ready NestJS service that receives, verifies, and processes Shopify webhooks in real time. Incoming requests are authenticated via HMAC-SHA256 signature, queued with BullMQ (backed by Upstash Redis), and persisted to PostgreSQL via Prisma. The service handles `orders/create` events and `products/update` events — product updates are snapshot-diffed and logged per field to a `ProductChangeLog` table. A built-in dashboard at `/` lets you browse and filter the latest events with relative timestamps, status badges, and auto-refresh every 30 seconds.

## Setup

### 1. Clone

```bash
git clone https://github.com/riyasingh-dotcom/shopify-wehook-receiver.git
cd shopify-wehook-receiver
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Fill in the values — see [Environment Variables](#environment-variables) below.

### 4. Generate the Prisma client and run migrations

```bash
pnpm prisma generate
pnpm prisma migrate dev
```

### 5. Start the dev server

```bash
pnpm start:dev
```

The service listens on `http://localhost:3000`. Open `/` for the webhook events dashboard.

To seed a test event:

```bash
node scripts/seed.js
```

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL pooled connection string (Prisma runtime) |
| `DIRECT_URL` | PostgreSQL non-pooled connection string (Prisma migrations) |
| `SHOPIFY_WEBHOOK_SECRET` | HMAC secret from your Shopify Partners app — used to verify every incoming webhook |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint (BullMQ queue) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token |

## Running locally with Docker Compose

```bash
docker compose up --build
```

The service starts at `http://localhost:3000`. On subsequent runs without code changes, omit `--build`.

## CI/CD Pipeline

Every push to `main` and every pull request triggers four jobs on GitHub Actions:

| Job | What it does |
|---|---|
| **Lint** | `pnpm lint` — ESLint with auto-fix rules |
| **Type check** | `pnpm tsc --noEmit` — catches type errors without emitting output |
| **Test** | `pnpm test` — Jest unit test suite |
| **Build** | `pnpm build` — compiles the NestJS app to `dist/` |

Merging to `main` triggers an automatic deployment to staging.

## Billing & Plans

The app uses the [Shopify Billing API](https://shopify.dev/docs/apps/billing) to charge merchants for app usage. Three tiers are available:

| Plan | Price | Webhook events/month | Product history | Failed job reprocessing |
|---|---|---|---|---|
| Free | $0 | 100 | 7 days | No |
| Basic | $9 | 5,000 | 30 days | Yes |
| Pro | $29 | Unlimited | 365 days | Yes |

### Upgrade flow

1. Merchant clicks **Upgrade** on the pricing page inside the Shopify Admin embedded app
2. App calls `POST /billing/subscribe` → creates an `AppSubscription` via Shopify GraphQL
3. Merchant is redirected to Shopify's billing approval page
4. After approval, Shopify redirects to `GET /billing/callback` → subscription is marked `active`

### Feature gating

Protected endpoints use the `@RequiresPlan('basic' | 'pro')` decorator backed by `PlanGuard`. A request without the required plan receives `403 { error: 'plan_required', upgradeUrl: '/billing/upgrade' }`.

### Grace period

When a subscription expires or is cancelled, the merchant gets a 3-day grace window. During this window, gated endpoints still respond but include `X-Subscription-Warning: grace_period` and `X-Grace-Ends-At` headers. After the window closes, the guard returns `403`.

### Usage-based overage charges

Basic plan merchants are charged $0.001 per webhook event over the 5,000/month limit, capped at $5.00/month. The `eventsProcessedThisMonth` counter is incremented in the BullMQ processor on every successfully processed job.

## Staging

[https://your-staging-url.up.railway.app](https://your-staging-url.up.railway.app)
