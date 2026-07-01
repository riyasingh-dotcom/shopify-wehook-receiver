# Shopify Webhook — Concepts

## 1. What is a webhook? How is it different from calling Shopify's API?

A webhook is like a "push notification" from Shopify to your app. Instead of your app repeatedly asking Shopify "did something change?" (which is what API polling is), Shopify automatically sends your app a message whenever an event happens — like an order being created or updated. This solves the problem of wasted requests, delay, and inefficiency from constantly checking the API. With APIs, you pull data when you want it; with webhooks, Shopify pushes data to you the moment something happens.

---

## 2. What is HMAC verification? Why does Shopify sign webhook payloads?

HMAC verification is a way to confirm that a webhook really came from Shopify and wasn't faked or modified in transit. Shopify signs the webhook payload using a shared secret key, and your server recalculates and checks that signature before trusting the data. If you skip this, an attacker could send fake webhook requests to your endpoint pretending to be Shopify — triggering wrong business logic, creating fake orders, or corrupting your database. HMAC prevents this by ensuring both the authenticity and integrity of every payload.

---

## 3. Why return 200 OK for a duplicate event instead of 409 Conflict?

Shopify's webhook delivery system treats any non-2xx response as a failure and will retry the same webhook up to 19 times over 48 hours. If you return `409`, Shopify sees a failed delivery, keeps retrying, and your server ends up processing — and logging noise for — the same event repeatedly. Returning `200` tells Shopify "received, all good," which is accurate: you *did* receive it, you just didn't need to act on it again. Duplicate detection is your internal concern, not Shopify's.

## 4. ESLint failure (`var` usage)

**Q: Which step failed?**  
A: Lint step failed.

**Q: What line does the CI log point to?**  
A: It points to the file and line where `var` is used (e.g. `src/file.ts:1:1`).

**Q: How long did it take to fail?**  
A: ~5–15 seconds because lint runs first.

**Q: Fix + result?**  
A: Replace `var` with `const/let`, CI goes green after ~30–90 seconds.

---

## 2. TypeScript type error

**Q: Which step fails now?**  
A: Typecheck step fails.

**Q: Why does lint pass but typecheck fail?**  
A: Lint checks style rules, TypeScript checks actual type correctness.

**Q: Fix + result?**  
A: Change `string` to `number` (`const badValue: number = 42`), CI passes typecheck.

---

## 3. Test failure (wrong assertion)

**Q: Which step fails?**  
A: Test step fails.

**Q: When does it run in pipeline?**  
A: After lint and typecheck both pass.

**Q: Fix + result?**  
A: Correct expected value in assertion, then CI goes green.


# Webhooks + BullMQ Understanding

## 1. Why async job queues solve this?

**Answer:**  
A synchronous webhook handler does too much work in one request: validate, parse, compute logic, and write to the database. If any of these steps are slow, you risk crossing Shopify’s ~5 second timeout, which triggers retries and can create duplicate processing. By offloading heavy work to an async job queue, your webhook endpoint only does the minimum—validate + enqueue + return 200 immediately—while the actual processing happens in the background. This keeps responses fast, avoids timeouts, and makes the system more resilient under load spikes.

---

## 2. What is BullMQ and what does Redis do?

**Answer:**  
BullMQ is a Node.js job queue system that lets you manage background tasks reliably (like processing webhooks, sending emails, or syncing data). It uses Redis as its storage and coordination layer—Redis holds the job data, job states (waiting, active, completed, failed), and acts as a fast in-memory broker between your app and workers. Without Redis, BullMQ wouldn’t have a central place to persist or distribute jobs, so Redis essentially becomes the shared “queue memory” that both your NestJS API and worker processes use.

---

## 3. Producer / Consumer pattern — what does each do?

**Answer:**  
The producer/consumer pattern splits work into two roles: the producer is your NestJS webhook handler that receives Shopify events and pushes them into the queue (it produces jobs but doesn’t process them). The consumer is a separate worker process that listens to the queue, pulls jobs when available, and executes the actual business logic like saving to the database or updating records. This separation ensures your API stays fast and lightweight, while heavy processing is handled independently and can scale horizontally by adding more consumers.



## Why Polaris exists
Shopify built Polaris so that every surface inside the admin — their own pages and third-party apps alike — shares the same visual language, interaction patterns, and accessibility standards. Rather than each app team solving the same UI problems independently, Polaris centralizes those decisions: spacing scales, color tokens, component behavior, motion, and screen-reader support are all pre-solved. It also lets Shopify evolve the admin's look (dark mode, new brand refresh, etc.) across every app at once by updating tokens rather than asking hundreds of developers to restyle their UIs.

## Merchant experience and App Store expectations
For merchants an embedded app built on Polaris feels like a native part of the admin rather than a foreign iframe — the typography, button styles, and navigation patterns match exactly what they use all day, which lowers cognitive load and builds trust. From Shopify's side, apps submitted to the App Store are reviewed against their app requirements, and using App Bridge alongside Polaris is effectively a prerequisite for Built for Shopify status and a smooth review. Apps that skip Polaris aren't automatically rejected, but they tend to fail review on UX criteria (inconsistent design, accessibility gaps, not feeling "native" to the admin), and they're ineligible for the higher-tier badging that drives discovery and conversion on the store.

## Explain Jest unit testing to me as a NestJS developer.
- What exactly is a "unit" in unit testing?
- What is a mock, and why do I need to mock Prisma in my tests?
- What is the difference between testing "does this function return the right value"
  vs testing "does this function call the right database method"?

Answer:In NestJS, a unit is a single class in isolation — typically a service like WebhooksService. The goal is to test that class's logic without involving anything outside it: no real database, no HTTP, no queue. When you test handleOrderCreated, you're asking "given this input, does my code do the right thing?" — not "does Postgres accept this query?" A unit test runs in milliseconds because it never touches the network or disk. The "unit" boundary is the class; everything the class depends on (Prisma, BullMQ, other services) gets replaced with fakes.

A mock is that fake replacement. Prisma is a dependency you inject into WebhooksService, so in tests you substitute it with an object that has the same shape but does nothing real — its methods are jest.fn() spies that return whatever you tell them to. This matters for two reasons. First, your tests stay deterministic and fast. Second, it lets you make a precise claim: "my service logic is correct assuming Prisma works." That splits into two distinct assertions you can make. Testing return value means: given a mocked Prisma that returns a fake order, does handleOrderCreated return the processed result I expect? Testing call behavior means: does handleOrderCreated actually call prisma.webhookEvent.create with the right arguments? Both matter — the first catches logic bugs, the second catches "I forgot to persist anything" bugs. In NestJS services you often want both: verify the output shape and verify the DB write happened with the right data.

## What would happen in production if this case wasn't handled?
Shopify delivers webhooks at-least-once. A retry of the same delivery would hit prisma.webhookEvent.create with a shopifyId that already exists. Without the catch, Prisma throws a PrismaClientKnownRequestError with code P2002. That exception propagates up to WebhookProcessor, BullMQ treats the job as failed, retries it (per your retry config), eventually exhausts retries, and writes a row to FailedJob — for an event that was actually processed successfully the first time.

## What is the mock doing — what real behaviour is it replacing?
The real path is: Prisma issues a PostgreSQL INSERT → Postgres returns error 23505 (unique violation) → Prisma wraps that in a PrismaClientKnownRequestError({ code: 'P2002' }).

mockRejectedValue skips all of that. It throws a plain object with code: 'P2002' set via Object.assign. The isPrismaUniqueConstraintError check only tests for err.code === 'P2002', so it can't tell the difference — which is exactly what makes the mock valid here.

 ## Would this test pass if I deleted the idempotency check? (Test 1 and 4 should fail. If they wouldn't, the test is wrong.)
 Yes, correctly. Here's why each one breaks:

Test 1 (returns null when shopifyId already exists):


// Without the try/catch, P2002 propagates as an unhandled rejection.
// The test awaits and then asserts result === null — but the promise rejects
// instead of resolving, so Jest fails the test before that line is ever reached.
const result = await service.handleOrderCreated(...); // ← throws
expect(result).toBeNull(); // ← never runs
Test 4 (still calls prisma.create for duplicate events):


// Same problem — the unhandled rejection causes the async test function itself
// to reject, which Jest counts as a failure.
await service.handleOrderCreated(...); // ← throws, test fails here
expect(prisma.webhookEvent.create).toHaveBeenCalledTimes(1); // ← never runs
Test 4 also fails if someone replaces the catch with a pre-flight findUnique instead — create would never be called so toHaveBeenCalledTimes(1) would fail. That's the point: it locks in the optimistic-insert contract specifically, not just "idempotency works somehow."

## Hardest thing during this !

the railway deployment- i have deployed it on railway and there are lots or errors occur on that
- the first is url mismatch due to monorepo structure
- Second is -- due to custom app like custom next.js project which was embeded in shopify, it creates lots of error and misconfiguration
- third is maintaining the tunnel during the development.
- one more docker setup for the frontend.
- Redis upsatsh limit exceeded due to **BullMQ** becausse its wpker continue polls even there is no webhook event arrives.

## Explain the Shopify Billing API to me. I'm building an embedded Shopify app.
## 1. What is a recurring application charge? How is it different from a one-time charge?
## 2. Walk me through the billing flow step by step — from "merchant clicks upgrade"to "subscription is active". What HTTP calls happen? Who redirects who?
## 3. What is a billing status? What are the possible values and what does each mean?

1. Recurring vs One-Time Charges
A recurring application charge (AppSubscription in GraphQL) is a monthly or annual subscription. Shopify auto-renews it on the billing cycle. The merchant pays every period until they uninstall the app or you cancel it. This is the dominant model for SaaS apps.

A one-time charge (ApplicationCharge) is a single payment — used for setup fees, lifetime licenses, or à-la-carte feature unlocks. No renewal, ever.

There's a third kind worth knowing: a usage charge sits on top of a recurring subscription and lets you bill variably (e.g., per order processed). It requires a cappedAmount that Shopify enforces as a hard ceiling per billing cycle — the merchant approves that cap upfront.

2. The Billing Flow, Step by Step
Step 1 — App creates the charge
Your backend calls the Shopify Admin API (GraphQL appSubscriptionCreate mutation, or REST POST /recurring_application_charges.json). You pass the plan name, price, interval, and a returnUrl (where Shopify sends the merchant back after they decide).

Shopify responds with a confirmationUrl — a URL on myshopify.com.

Step 2 — App redirects the merchant
You redirect the merchant's browser to that confirmationUrl. This must be a full browser redirect, not a fetch/XHR call, because the destination is a native Shopify page outside your iframe.

Step 3 — Merchant decides on Shopify's page
Shopify shows a standard "approve this charge" screen. The merchant clicks Approve or Decline.

Step 4 — Shopify redirects back
Shopify redirects to your returnUrl with ?charge_id=<id> appended.

Step 5 — App confirms (GraphQL vs REST diverge here)

GraphQL: Approval automatically activates the subscription. You just query the charge by ID (or currentAppInstallation { activeSubscriptions }) to confirm it's ACTIVE.
REST: You must make one more call — POST /recurring_application_charges/{id}/activate.json — to flip accepted → active. Without this, the charge never bills.
After activation, Shopify starts the billing cycle and the subscription is live.

3. Billing Statuses
These are the AppSubscription status values in the GraphQL API:

Status	What it means
PENDING	Created, waiting for the merchant to visit the confirmationUrl and decide. Expires after ~2 days if untouched.
ACTIVE	Merchant approved and billing is live. This is the only state where your app should grant full access.
DECLINED	Merchant clicked "Decline" on the confirmation screen. You should handle this in your returnUrl handler and show a message.
EXPIRED	The pending charge was never confirmed before it timed out. Treat like DECLINED — create a new charge if the merchant tries again.
FROZEN	The merchant's Shopify account is frozen (usually non-payment to Shopify). Your app loses access temporarily. Resume when it becomes ACTIVE again.
CANCELLED	Subscription was cancelled — either the app was uninstalled, you called appSubscriptionCancel, or Shopify cancelled it.
The most important gate in your app logic: only serve paid features when status is ACTIVE. FROZEN is a temporary interruption, not a permanent loss — don't treat it as uninstall.


## Explain the difference between a unit test and an integration testusing a NestJS webhook endpoint as the example.

## Specifically:
## - In a unit test of handleOrderCreated, what am I actually testing?
## - In an integration test of POST /webhooks/shopify, what am I testing that the unit test cannot?
## - What does Supertest do that Jest alone cannot?

A **unit test** focuses on a single piece of code in isolation. For a NestJS `handleOrderCreated()` method, you're testing only that method's business logic: given a valid Shopify order payload, does it validate the data, enqueue the BullMQ job, return the expected result, or throw an error for invalid input? All external dependencies (such as the queue or database) are usually mocked, so you're not testing HTTP requests or NestJS itself.

An **integration test** exercises multiple parts of the application working together. When testing `POST /webhooks/shopify`, you send a real HTTP request to your NestJS application and verify that the request is routed correctly, the controller receives it, the service is called, middleware and validation run, and the endpoint returns the expected HTTP response. This catches problems such as incorrect routes, missing decorators, broken request handling, or wiring issues that a unit test would never detect.

**Jest** is the testing framework—it runs tests, provides assertions (`expect`), and supports mocking and spying. **Supertest** is an HTTP client designed for testing web applications; it sends real HTTP requests (GET, POST, headers, JSON bodies, etc.) to your NestJS server and lets you verify the responses. In short, Jest tells you whether a test passed or failed, while Supertest lets you test your API endpoints as if they were being called by Shopify.

### Shopify Billing API — Subscription Lifecycle Webhooks
## app_subscriptions/update
This is the main topic your app needs. Shopify fires it whenever an app subscription's status changes — covering transitions to ACTIVE (charge approved or trial started), DECLINED (merchant rejected the charge), EXPIRED (billing cycle ended without renewal), FROZEN (shop suspended by Shopify), CANCELLED (merchant uninstalled or cancelled manually), and PENDING (waiting for merchant approval). Your app should receive this webhook, look up the subscription by the admin_graphql_api_id in the payload, and update your local DB to reflect the new status. It's the single source of truth for subscription state changes.

## What happens when a charge fails
Shopify doesn't fire a separate "charge failed" webhook. Instead, when billing fails (e.g. the merchant's payment method declines), Shopify transitions the subscription to FROZEN and fires app_subscriptions/update with that status. Your app should treat FROZEN similarly to EXPIRED — restrict access (with a grace period if you choose) and prompt the merchant to update their payment method in the Shopify admin. Shopify will automatically retry the charge and fire another app_subscriptions/update with ACTIVE if it succeeds.

## What is a "frozen" subscription
A frozen subscription means the merchant's Shopify store itself has been suspended — typically because Shopify couldn't collect their platform subscription fee (not your app's fee). While frozen, the merchant can't use the Shopify Admin at all, so they can't use your app either. Your app should detect FROZEN status and pause access gracefully. When Shopify unfreezes the store (merchant pays their bill), the subscription transitions back to ACTIVE and you get another app_subscriptions/update. Don't delete their data when frozen — it's a temporary hold, not a cancellation.

---

## Day 3 — Coverage Report (2026-07-01)

### Coverage table

```
File                             | % Stmts | % Branch | % Funcs | % Lines
---------------------------------|---------|----------|---------|--------
All files                        |   76.47 |    67.46 |   67.74 |   76.16
 auth/shopify-session-token.guard|   31.25 |        0 |       0 |   21.42
 billing/billing.controller.ts   |   67.85 |    64.28 |      50 |   67.92
 billing/billing.service.ts      |   79.31 |       70 |    62.5 |   78.57
 billing/plan.guard.ts           |     100 |       88 |     100 |     100
 billing/plans.ts                |     100 |      100 |     100 |     100
 prisma/prisma.service.ts        |   71.42 |      100 |       0 |      60
 products/products.controller.ts |     100 |       75 |     100 |     100
 webhooks/order-payload.ts       |   88.88 |    66.66 |     100 |   88.88
 webhooks/product-diff.ts        |    91.3 |       85 |     100 |   97.56
 webhooks/webhook.processor.ts   |   56.41 |    58.82 |   66.66 |   51.42
 webhooks/webhooks.controller.ts |   43.13 |     36.5 |   22.22 |   42.55
 webhooks/webhooks.service.ts    |    96.2 |    90.56 |   89.47 |   97.26
```

### Gap analysis

- **webhooks.controller.ts (42% lines)** — biggest gap. The reprocess endpoint, product-history endpoint, and failed-jobs routes have zero test coverage. These are integration-test candidates (supertest against the full NestJS app).
- **webhook.processor.ts (51% lines)** — the processor's error path (permanent failure → FailedJob write) and the `app_subscriptions/update` branch added in Day 3 are not covered. Unit tests need a mock BillingService.
- **auth/shopify-session-token.guard.ts (21% lines)** — almost entirely untested. The JWT verification path (lines 31–52) is skipped in every test because the guard is overridden. Needs its own isolated unit test with a mocked `jsonwebtoken.verify`.
- **billing.service.ts (78% lines)** — `getStatus` and `resolveShopByChargeId` (lines 103–129, 240–247) not covered. `testToken` (lines 370–388) is a debug helper — low priority.
- **billing.controller.ts (67% lines)** — callback redirect and subscribe error branches (lines 36–76) missing coverage.

### Before / after functions coverage

| Point | Functions |
|---|---|
| Before Task 4 (webhooks.service) | 48.38% |
| After Task 4 | 67.74% |

Most surprising uncovered line: `webhooks.service.ts:170–182` — the error branch inside `getEvents` that merges `ProductChangeLog` entries. The happy path is covered but the empty-array edge case isn't.

### Friday flag

**What was built:** `app_subscriptions/update` webhook handler + grace period logic (PlanGuard headers + frontend banner) + CI coverage gate at 60%.

**Overall coverage % before adding tests:** ~48% functions / ~65% lines

**Overall coverage % after:** 67.74% functions / 76.16% lines

**Most surprising uncovered line:** `webhooks.controller.ts` — 22% function coverage means most controller handlers have zero tests. Controllers look simple but they wire guards, decorators, and response codes — integration tests here catch bugs that unit tests on the service miss entirely.

**One thing not fully understood yet:** Why BullMQ's `attemptsMade >= attempts` check is needed before writing `FailedJob` — BullMQ fires the `failed` event on every failed attempt, not just the last one, so without that guard you'd write a `FailedJob` row on the first retry too.

---

## TDD Exercise Reflection — Day 4

**The function:** `calculateOverageCharge(plan, eventsProcessedThisMonth)` — calculates how much to charge a merchant for going over their monthly webhook event limit.

**Before writing the implementation, I knew:**

Writing the tests first forced me to be exact about the rules before touching any code. I had to decide: does "within limit" mean strictly less than 5000, or up to and including 5000? The test `calculateOverageCharge('basic', 5000)` should return 0 — meaning the limit itself is not an overage. That sounds obvious in hindsight, but I had to make that call before writing a single line of logic.

I also had to know the exact numbers: the limit is 5000, the rate is $0.001 per event, the cap is $5.00. Writing the test for "1000 events over" (6000 total → $1.00) and "cap scenario" (15000 total → $5.00, not $10.00) meant I had to do the maths myself first, not just assume the code would figure it out.

**One thing the tests forced me to think about that I wouldn't have thought about otherwise:**

The cap. Without writing the cap test first, I probably would have written `overLimit * 0.001` and called it done. The test for 15000 events explicitly forced me to handle the `Math.min(..., 5.0)` case. If I had written the implementation first, I might have forgotten the cap entirely and only noticed it when manually testing an edge case much later.

**Would I use TDD again? For what kind of function?**

Yes — for pure functions with clear rules. `calculateOverageCharge` is a perfect TDD candidate: no database, no network, no side effects. The inputs and outputs are numbers. The business rules can be expressed as exact assertions. TDD shines here because you can write all the test cases in 2 minutes and they tell you exactly what the function must do.

I would not reach for TDD first when dealing with something like a NestJS controller or a database query — those have too many moving parts to specify upfront in isolation. But for any pure calculation function — pricing logic, discount rules, validation — writing the tests first is faster overall because it catches edge cases before the implementation exists.