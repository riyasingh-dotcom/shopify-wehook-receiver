## Day 3 (Wednesday) — Billing Webhooks + Coverage Report in CI

**Time budget**: 8 hours

### Build Goal
Shopify sends webhooks when a subscription status changes — when a merchant cancels, when a charge fails, when a trial ends. Handle these. Add grace period logic — a merchant whose subscription lapses still has 3 days of access before being downgraded to free. In parallel: add test coverage reporting to CI so you can see exactly which lines of code have no tests.

By end of day: billing lifecycle is handled automatically via webhooks. CI outputs a coverage report on every PR. You know which parts of your codebase are untested.

---

### What you need to understand first (20 min)

Use Claude:

```
In the Shopify Billing API, what webhook topics are fired during the subscription lifecycle?
For each topic, what is the expected action my app should take?
Specifically cover:
- app_subscriptions/update (what statuses trigger this?)
- What happens when a merchant's charge fails?
- What is a "frozen" subscription?

No code. One paragraph per topic.
```

Add to `NOTES.md`.

---

### Task 1 — Handle `app_subscriptions/update` webhook (2 hours)

Register a new webhook in Shopify Partner Dashboard:
- Topic: `app_subscriptions/update`
- URL: same endpoint — `POST /webhooks/shopify`

Add a case to your webhook router:

```typescript
case 'app_subscriptions/update':
  await this.webhooksService.handleSubscriptionUpdate(payload);
  break;
```

Use Claude:

```
Build a NestJS service method: handleSubscriptionUpdate(payload: unknown).

The Shopify app_subscriptions/update payload contains:
- app_subscription.admin_graphql_api_id: the Shopify charge GID
- app_subscription.status: the new status ('ACTIVE' | 'DECLINED' | 'EXPIRED' | 'FROZEN' | 'CANCELLED' | 'PENDING')

The method should:
1. Validate the payload with Zod
2. Find the Subscription in DB by shopifyChargeId
3. Map Shopify status to our DB status (uppercase to lowercase)
4. Update the subscription status
5. If status becomes 'EXPIRED' or 'CANCELLED': set a graceEndsAt field = now + 3 days
6. If status becomes 'ACTIVE': clear graceEndsAt
7. Log the status change with structured logging

Show me the Zod schema, the method, and the Prisma schema addition for graceEndsAt.
```

Add `graceEndsAt DateTime?` to the Subscription model. Run migration.

---

### Task 2 — Grace period logic (1.5 hours)

The grace period means: when a subscription lapses, the merchant still has 3 days of full access. After that, they're downgraded to the free plan.

Update `PlanGuard` to account for grace period:

```typescript
// In PlanGuard, after fetching subscription:
const isInGracePeriod = subscription.graceEndsAt && subscription.graceEndsAt > new Date();

if (subscription.status === 'expired' || subscription.status === 'cancelled') {
  if (isInGracePeriod) {
    // Allow access — they're within 3-day grace window
    // Add a warning header so the frontend can show a banner
    response.setHeader('X-Subscription-Warning', 'grace_period');
    return true;
  }
  // Grace period over — treat as free plan
  throw new ForbiddenException({ error: 'subscription_expired' });
}
```

Add a grace period banner to your Polaris UI: when `X-Subscription-Warning: grace_period` header is present in any API response, show a Polaris `Banner` with status `warning`:
```
"Your subscription has expired. You have X days remaining to renew before losing access."
```

---

### Task 3 — Coverage report in CI (2 hours)

Right now CI runs `npm test` and shows pass/fail. You don't know what percentage of your code is covered. Fix that.

**Set up Jest coverage**:

Add to `package.json` jest config (or `jest.config.ts`):

```json
{
  "collectCoverageFrom": [
    "src/**/*.ts",
    "!src/**/*.spec.ts",
    "!src/**/*.module.ts",
    "!src/main.ts"
  ],
  "coverageThresholds": {
    "global": {
      "lines": 60,
      "functions": 60
    }
  }
}
```

Run locally first:
```bash
npm run test -- --coverage
```

Read the output. You'll see a table showing each file with:
- `% Stmts` (statements covered)
- `% Branch` (if/else branches covered)
- `% Funcs` (functions covered)
- `% Lines` (lines covered)
- `Uncovered Line #s` (exact lines with no tests)

Use Claude:

```
I have this Jest coverage report output: [paste your coverage table]

For each file under 60% coverage:
- What is the most likely reason coverage is low?
- Which specific function or branch is probably untested?
- What is the highest-value test I could add to increase coverage meaningfully?

Prioritise by: business impact first, then coverage improvement.
```

**Add coverage to CI**:

Update your test step in `.github/workflows/ci.yml`:

```yaml
- name: Run tests with coverage
  run: npm run test -- --coverage --coverageReporters=text-summary
  env:
    TEST_DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
```

Add a coverage gate — the CI step already fails if coverage drops below the threshold you set in `package.json`. That threshold is your quality gate.

**Add `TEST_DATABASE_URL` to GitHub secrets** (same value as your `.env`).

**Verify**: Push a commit. Watch CI output — you should see a coverage summary in the test step logs.

---

### Task 4 — Write tests for the uncovered gap (1 hour)

From the coverage report, pick the single file with the lowest coverage that handles real business logic (not a module file or main.ts).

Write at least 3 tests for it. Use Claude to help generate them, but verify each one is testing something real.

---

### Deliverable checklist
- [ ] `app_subscriptions/update` webhook received and processed correctly
- [ ] Grace period logic working — `graceEndsAt` set on subscription expiry
- [ ] Grace period banner showing in embedded app UI
- [ ] Coverage report runs in CI (`npm test -- --coverage` step in workflow)
- [ ] Coverage thresholds set (60% lines and functions minimum)
- [ ] Coverage report pasted + analysed in `NOTES.md`
- [ ] At least 3 new tests for the lowest-coverage meaningful file
- [ ] Committed: `feat: billing-webhooks + grace-period` and `test: coverage-improvements`

---

### Friday flag
```
Day 3 flag:
Built: [what you shipped]
Overall coverage % before adding tests: [X%]
Overall coverage % after: [X%]
Most surprising uncovered line: [which file + line number + why it surprised you]
One thing I'm not sure I understand: [specific]
```