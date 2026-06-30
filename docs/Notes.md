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

