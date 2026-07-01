## Day 4 (Thursday) — Usage Charges + TDD for Grace Period Logic

**Time budget**: 8 hours

### Build Goal
Add usage-based billing — charge merchants per webhook event processed beyond their plan limit. This is how Shopify apps charge for variable consumption. In parallel: for the first time this week, write the test before writing the code. One function. Test first, implementation second.

By end of day: usage charges wired up and working in test mode. You have experienced TDD — not as a philosophy, but as a practical tool for one specific function.

---

### What you need to understand first (20 min)

Use Claude:

```
Explain usage-based billing in the Shopify Billing API.
- What is an application usage charge?
- How does it differ from a recurring subscription charge?
- What does a merchant see on their Shopify bill when you add a usage charge?
- What is a usage charge cap and why does Shopify require one?

No code. Keep it practical.
```

Then:

```
Explain test-driven development (TDD) to me in one paragraph.
Not the philosophy — the practical workflow.
What does "write the test first" actually mean in practice?
What is the specific benefit of writing the test before the implementation?
```

Both go in `NOTES.md`.

---

### Task 1 — TDD: write the test first (2 hours)

The function you're building: `calculateOverageCharge(plan: Plan, eventsProcessedThisMonth: number): number`

This function calculates how much to charge a merchant for webhook events beyond their plan limit.

Rules:
- Free plan: no overage (cannot be charged — they should have upgraded)
- Basic plan (5,000 events/month): $0.001 per event over limit, max $5.00/month
- Pro plan (unlimited): never has overage

**Write the tests first — before writing any implementation:**

Open a new file: `src/billing/billing.service.spec.ts` (add to existing spec file).

Write these test cases in Jest — the function does not exist yet:

```typescript
describe('calculateOverageCharge', () => {
  it('returns 0 for free plan regardless of events', () => {
    // write this test
  });

  it('returns 0 for basic plan when events are within limit', () => {
    // write this test
  });

  it('returns correct charge for basic plan with 1000 events over limit', () => {
    // 1000 events × $0.001 = $1.00
    // write this test
  });

  it('caps overage at $5.00 for basic plan regardless of volume', () => {
    // 10,000 events over limit × $0.001 = $10 but cap is $5.00
    // write this test
  });

  it('returns 0 for pro plan regardless of events', () => {
    // write this test
  });
});
```

Use Claude to help write the test bodies — but you must write the `describe` and `it` strings yourself. Those are the specification. If you can't write the description, you don't understand what you're testing.

**Run the tests. They should all fail.** That is correct. Failing tests against non-existent code is the starting state of TDD.

Now write the implementation:

```typescript
// src/billing/billing.service.ts
calculateOverageCharge(plan: Plan, eventsProcessedThisMonth: number): number {
  // implement to make the tests pass
}
```

Run tests again. Fix implementation until all 5 pass.

**Write in `NOTES.md` after this exercise:**
```
TDD exercise reflection:

Before writing the implementation, I knew:
[what you learned about the requirements just from writing the tests]

One thing the tests forced me to think about that I wouldn't have thought about otherwise:
[specific — not vague]

Would I use TDD again? For what kind of function?
[honest answer]
```

---

### Task 2 — Implement usage charges (2.5 hours)

Use Claude — now that you've built the calculation logic with TDD, implement the actual Shopify API call:

```
Build a NestJS service method: createUsageCharge(shopDomain: string, eventsCount: number).

It should:
1. Fetch the merchant's active subscription (must be 'active' status — can't charge frozen/expired)
2. Calculate the overage using calculateOverageCharge(plan, eventsCount)
3. If overage is 0: return early (nothing to charge)
4. Call the Shopify appUsageRecordCreate mutation:
   - subscriptionLineItemId: from the active subscription's Shopify charge ID
   - price: { amount: overageCharge, currencyCode: 'USD' }
   - description: "Webhook events overage: [eventsCount] events"
5. Log the charge with structured logging: shopDomain, amount, eventsCount
6. Return the charge record

Important:
- Usage charges require the subscription to have a usage pricing line (cappedAmount)
- The cap on the subscription itself must be >= any individual usage charge
- For dev stores: all charges are in test mode — no real money

Show me the GraphQL mutation for appUsageRecordCreate and the service method.
```

**What to verify:**
- [ ] Only charges when subscription is `active` — not `frozen`, `expired`, `pending`
- [ ] Returns early (no API call) when overage is 0
- [ ] The description string is meaningful — merchants see this on their bill
- [ ] Uses structured logging — amount and eventsCount are separate log fields, not string interpolation

**Add a usage tracking field to Subscription**:
```prisma
eventsProcessedThisMonth Int @default(0)
lastResetAt               DateTime @default(now())
```

Run migration. In your webhook processor, increment `eventsProcessedThisMonth` on every successful job.

---

### Task 3 — Usage charge UI (1 hour)

Add to the billing status page in the embedded app:

- Current month events processed: X / plan limit
- A progress bar (use Polaris `ProgressBar`) showing usage vs limit
- If over 80% of limit: show Polaris `Banner` with status `warning` suggesting upgrade
- If on basic plan and overage > 0: show the overage charge amount for the current month

---

### Deliverable checklist
- [ ] TDD exercise complete: 5 tests written before implementation, all 5 now passing
- [ ] `calculateOverageCharge` pure function tested and implemented
- [ ] `createUsageCharge` calls Shopify API, skips if no overage
- [ ] Events processed tracked per merchant per month
- [ ] Usage UI in embedded app: progress bar + warning banner at 80%
- [ ] TDD reflection written in `NOTES.md` (full sentences, not bullet points)
- [ ] Committed: `test: tdd-overage-calculation` and `feat: usage-charges`
