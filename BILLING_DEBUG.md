# Shopify Billing API — Debugging Journal

## Goal

Clicking "Upgrade to Basic ($9/mo)" in the embedded app should redirect the merchant to Shopify's billing approval page via the `appSubscriptionCreate` GraphQL mutation.

---

## Attempt 1 — Traditional OAuth token in cookie

**What we tried**

During app install, run the standard OAuth flow and store the resulting access token in an HttpOnly cookie (`shopify_access_token`). When the upgrade button is clicked, read the token from the cookie and pass it to the NestJS backend, which uses it to call the Shopify Admin API.

**What failed**

Shopify rejected the token with:

```
Non-expiring access tokens are no longer accepted for the Admin API
```

Tokens issued by the traditional OAuth flow have a `shpat_` prefix and never expire. Shopify deprecated this format. The rejection happened even after uninstalling and reinstalling the app — the new token was still in the same deprecated format because the OAuth flow itself had not changed.

---

## Attempt 2 — Session token exchange (Next.js route, JSON body)

**What we tried**

Switch to Shopify's token exchange flow. The App Bridge SDK provides a short-lived session JWT via `window.shopify.idToken()`. Exchange this JWT at Shopify's token exchange endpoint to get a short-lived online access token that Shopify accepts.

The exchange was done inside the Next.js API route using a raw `fetch` call with `Content-Type: application/json`.

**What failed**

```
Token exchange failed (403): ...
```

Shopify's token exchange endpoint follows RFC 8693 and requires the request body to be `application/x-www-form-urlencoded`, not JSON. The JSON body was silently rejected.

---

## Attempt 3 — Session token exchange (Next.js route, form-encoded body)

**What we tried**

Fix the content type to `application/x-www-form-urlencoded` and resend the same exchange request from the Next.js server (running on Railway).

**What failed**

```
Token exchange failed (403): <!DOCTYPE html>...Verifying your connection...
```

The full response was a Cloudflare bot-protection challenge page. Shopify's OAuth endpoints on `{shop}.myshopify.com` sit behind Cloudflare, which blocks automated server-to-server HTTP requests. A Railway server making a raw `fetch` is treated as a bot and returned a challenge it cannot solve.

---

## Fix — Token exchange via the Shopify SDK in the NestJS backend

**Root cause summary**

| Issue | Cause |
|---|---|
| `shpat_` token rejected | Shopify deprecated non-expiring offline tokens |
| JSON body 403 | Token exchange endpoint requires `application/x-www-form-urlencoded` |
| Form-encoded body 403 | Cloudflare blocks raw server-to-server requests to the OAuth endpoint |

**What actually works**

Move the token exchange into the NestJS backend and use the `@shopify/shopify-api` SDK's built-in `shopify.auth.tokenExchange()` method. The SDK handles the request with the correct headers and credentials that bypass Cloudflare.

**Flow after the fix**

```
User clicks "Upgrade"
  ↓
window.shopify.idToken()           ← App Bridge session JWT (short-lived)
  ↓
POST /api/billing/subscribe        ← Next.js route, passes token through
  ↓
POST /billing/subscribe            ← NestJS backend
  ↓
shopify.auth.tokenExchange()       ← SDK handles Cloudflare correctly
  ↓
Online access token (~24h expiry)  ← Accepted by Shopify Admin API
  ↓
appSubscriptionCreate mutation
  ↓
confirmationUrl → window.top redirect to billing approval page
```

**Files changed**

| File | Change |
|---|---|
| `frontend/app/page.tsx` | `handleUpgrade` calls `getIdToken()` and passes session JWT as `Authorization: Bearer` |
| `frontend/app/api/billing/subscribe/route.ts` | Removed token exchange logic; proxies session token to NestJS backend |
| `src/billing/billing.controller.ts` | Accepts `sessionToken` instead of `accessToken` |
| `src/billing/billing.service.ts` | Calls `shopify.auth.tokenExchange()` to get an online token before the billing mutation |
| `src/billing/billing.service.spec.ts` | Updated mocks for `auth.tokenExchange` and `RequestedTokenType` |

---

## Key lessons

- **Traditional OAuth offline tokens are dead.** Any new Shopify app must use online tokens (via session token exchange) or enable token rotation in Partners. The dev dashboard does not expose the token rotation toggle — it only appears in the Partners dashboard under API credentials.
- **Shopify OAuth endpoints are Cloudflare-protected.** Never call `https://{shop}.myshopify.com/admin/oauth/...` from a server using raw `fetch`. Always go through the official SDK, which is whitelisted.
- **The Shopify SDK exists for a reason.** `shopify.auth.tokenExchange()` handles auth, retries, and correct headers. Reimplementing it with `fetch` breaks in non-obvious ways.
- **App Bridge `idToken()` is the right starting point for embedded apps.** It is a signed JWT that proves the current user is a legitimate admin of the store, and it can be exchanged for an API token without any OAuth redirect.
