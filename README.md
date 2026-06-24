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

## Staging

[https://your-staging-url.up.railway.app](https://your-staging-url.up.railway.app)
