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