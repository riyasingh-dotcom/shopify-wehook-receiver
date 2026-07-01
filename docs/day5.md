## Day 5 (Friday) — Billing Lifecycle Audit + Full Demo + Week Reflection

**Time budget**: 8 hours

### Build Goal
No new features. Prove that everything works. Audit the billing lifecycle from first install to cancellation. Review the full test suite — are your tests protecting the things that actually matter? Write an honest reflection.

---

### Task 1 — Full billing lifecycle walkthrough (2.5 hours)

Walk through the complete lifecycle in your dev store, in order:

**Install + free plan:**
1. Install your app on the dev store
2. Confirm subscription record created with `plan: 'free'`, `status: 'active'`
3. Try to access a `@RequiresPlan('basic')` endpoint — confirm 403

**Upgrade to basic:**
4. Click Upgrade → Basic on the pricing page
5. Confirm redirect to Shopify billing approval page
6. Approve the charge (test mode)
7. Confirm redirect back to your app
8. Confirm subscription updated: `plan: 'basic'`, `status: 'active'`
9. Access the previously-gated endpoint — confirm it now works

**Simulate expiry + grace period:**
10. Manually update subscription in DB: `status: 'expired'`, `graceEndsAt: now + 1 hour`
11. Access the gated endpoint — confirm `X-Subscription-Warning: grace_period` header in response
12. Confirm grace period banner shows in embedded app UI
13. Manually update `graceEndsAt: 1 hour ago` (past the grace window)
14. Access the gated endpoint again — confirm 403 with `subscription_expired`

**Usage overage:**
15. Manually set `eventsProcessedThisMonth` to 5,500 (500 over basic plan limit)
16. Trigger `createUsageCharge` — confirm Shopify usage charge created in test mode
17. Confirm overage is capped at $5.00 regardless of volume

**Cancellation webhook:**
18. Simulate an `app_subscriptions/update` webhook with status `CANCELLED`
19. Confirm subscription updated in DB, `graceEndsAt` set

Write a verdict for each step in `NOTES.md`: ✅ or ❌ + one sentence. If any step is ❌ — fix it before your check-in.

---

### Task 2 — Test suite audit: billing coverage (1.5 hours)

Run coverage report one more time:

```bash
npm run test -- --coverage
```

Specifically check `billing.service.ts` and `billing.controller.ts`.

Answer in `NOTES.md`:

```
## Billing test coverage audit

billing.service.ts:
- Coverage: [X%]
- Tested functions: [list them]
- Untested functions: [list them]
- The untested function with highest business impact: [which one + why]

billing.controller.ts:
- Coverage: [X%]
- Any untested controller methods? [which ones]

If I deployed a bug in the billing service to production right now,
which function would most likely cause a merchant to be incorrectly
charged or incorrectly lose access? Is that function tested?
[your answer — full sentence]
```

If the answer to the last question is "no" — write at least one test for it before committing.

---

### Task 3 — Cleanup (1.5 hours)

- `npm run lint` — zero warnings
- `npm run test -- --coverage` — all tests pass, coverage thresholds met
- `npm run build` — clean build
- Remove any hardcoded values that should be in env (prices, limits, URLs)
- Update `.env.example` with all new variables added this week:
  ```
  BILLING_RETURN_URL=
  TEST_DATABASE_URL=
  ```
- Update README: add billing section describing the plans and upgrade flow

---

### Friday check-in to send

```
Week 7 Check-in

Repo: [GitHub link]
Staging URL: [Railway link]
CI badge: [green badge markdown]

Shopify build:
Shopify Billing API — recurring subscriptions (Basic $9 + Pro $29).
Plan feature gating with @RequiresPlan guard.
Billing lifecycle webhooks: app_subscriptions/update.
3-day grace period on expiry.
Usage-based overage charges (capped).
Pricing page + usage progress bar in embedded app.

Infra:
Supertest integration tests: [X total integration tests]
Unit tests: [X total unit tests]
Total test count: [X]
Coverage: [X%] (up from [X%] last week)
TDD exercise: calculateOverageCharge — tests written before implementation.
Coverage gate in CI at 60% lines/functions.

Billing lifecycle walkthrough: [all 19 steps passed / X steps failed — list failures]

TDD reflection (paste from NOTES.md): [your honest answers]

Coverage audit result:
The untested billing function with highest business impact: [which one]
Is it tested now? [yes / no]

One thing billing taught me about how Shopify handles money: [specific]
Something Claude got wrong this week: [what it was + how you caught it]

Claude prompt that worked best:
[exact prompt]
```

---

### End-of-week proof

Send Himanshu:
1. GitHub repo link (green CI badge, coverage badge if configured)
2. Screenshot of coverage report in CI logs (showing % per file)
3. Screenshot of pricing page in embedded app (inside Shopify Admin)
4. Screenshot of usage progress bar for a store at >80% of plan limit
5. Screenshot of grace period banner in embedded app
6. Billing lifecycle walkthrough table from `NOTES.md`
7. Your Friday check-in (above)

---

## Week 7 — What You've Built

| Component | What it does |
|-----------|--------------|
| `createSubscription` | Creates Shopify recurring charge via AppSubscriptionCreate mutation |
| Billing callback handler | Handles Shopify redirect after merchant approves/declines |
| `PLANS` config | Typed plan definitions with feature limits |
| `PlanGuard` + `@RequiresPlan()` | Decorator-based feature gating per subscription tier |
| Pricing page (Polaris) | Plan cards with current plan badge and upgrade CTA |
| `app_subscriptions/update` handler | Processes billing lifecycle webhooks from Shopify |
| Grace period logic | 3-day access window after subscription lapse |
| Grace period banner | UI warning when merchant is in grace window |
| `calculateOverageCharge` | Pure function — tested TDD, calculates usage overage with cap |
| `createUsageCharge` | Calls Shopify appUsageRecordCreate mutation for overage |
| Usage tracking | Events-per-month counter per merchant, resets monthly |
| Usage UI | Progress bar + 80% warning banner in embedded app |
| Supertest integration tests | Real HTTP tests for webhook + billing endpoints |
| Coverage report in CI | `--coverage` flag in CI, 60% threshold gate |

---

## Week 7 — Infra Standards Reached

**Testing — integration depth**
- Integration tests cover all API endpoints that process money or authentication
- Shopify API is mocked in integration tests — no real API calls during CI
- Test DB is separate, reset between tests, managed via docker-compose
- `TEST_DATABASE_URL` in GitHub secrets — CI uses the same test DB setup as local

**Testing — TDD**
- TDD used for one specific function where requirements are well-defined
- Experience with the workflow: failing tests → implementation → green tests
- Understanding of when TDD is worth it vs when it is overhead

**Coverage**
- Coverage gate active in CI — below 60% blocks the build
- Coverage report read and acted on — not just a number
- The report is used to find gaps, not to hit a score

**Shopify billing**
- Billing API understood as a flow, not just an API call
- Subscription lifecycle states known and handled
- Feature gating is in a guard, not scattered across controllers

---

## Manager review notes (Week 7)

**What to check in Friday check-in:**

The TDD reflection is the most important thing to read carefully. You're looking for evidence that the exercise changed how they thought — not that they completed the steps. A good reflection says something like: "Writing the cap test first made me realise I hadn't thought about what happens when overage is exactly $5.00 vs over $5.00." A bad reflection says: "TDD is useful for writing tests first."

The billing lifecycle walkthrough table must have 19 rows, each with ✅ or ❌. Any ❌ that isn't followed by a fix attempt is a problem. The point is not that everything works perfectly — it's that they notice when it doesn't and address it.

**What to check in the repo:**
- `@RequiresPlan` decorator exists and is applied to at least 2 endpoints
- Grace period uses `graceEndsAt` field, not just a hardcoded 3-day check from `updatedAt`
- `calculateOverageCharge` is a pure function (no DB calls, no side effects) — testable without mocks
- Integration tests use `TEST_DATABASE_URL` env variable — not the dev DB
- Coverage threshold is set in jest config, not just run as a flag

**Redo triggers:**
Two hard stops this week:
1. If `calculateOverageCharge` tests were written after the implementation — the TDD exercise was the point, not the tests. Ask the trainee to show git history proving the test commit came before the implementation commit. If they can't, redo the exercise with a different function.
2. If integration tests use `jest.mock()` on Prisma instead of a real test DB — mocking Prisma in integration tests defeats the purpose. Integration tests must hit a real (test) database.
