# Shopify Webhook — Concepts

## 1. What is a webhook? How is it different from calling Shopify's API?

A webhook is like a "push notification" from Shopify to your app. Instead of your app repeatedly asking Shopify "did something change?" (which is what API polling is), Shopify automatically sends your app a message whenever an event happens — like an order being created or updated. This solves the problem of wasted requests, delay, and inefficiency from constantly checking the API. With APIs, you pull data when you want it; with webhooks, Shopify pushes data to you the moment something happens.

---

## 2. What is HMAC verification? Why does Shopify sign webhook payloads?

HMAC verification is a way to confirm that a webhook really came from Shopify and wasn't faked or modified in transit. Shopify signs the webhook payload using a shared secret key, and your server recalculates and checks that signature before trusting the data. If you skip this, an attacker could send fake webhook requests to your endpoint pretending to be Shopify — triggering wrong business logic, creating fake orders, or corrupting your database. HMAC prevents this by ensuring both the authenticity and integrity of every payload.

---

## 3. Why return 200 OK for a duplicate event instead of 409 Conflict?

Shopify's webhook delivery system treats any non-2xx response as a failure and will retry the same webhook up to 19 times over 48 hours. If you return `409`, Shopify sees a failed delivery, keeps retrying, and your server ends up processing — and logging noise for — the same event repeatedly. Returning `200` tells Shopify "received, all good," which is accurate: you *did* receive it, you just didn't need to act on it again. Duplicate detection is your internal concern, not Shopify's.
