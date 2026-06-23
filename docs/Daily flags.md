# Day 1 Task Flag

## Built:
- Understood NestJS architecture and project structure
- Learned webhook concept and implemented a successful webhook call to my server
- Understood HMAC verification and why it is required for securing Shopify webhooks
- Set up initial Prisma integration with PostgreSQL (attempted data insertion flow)

## Blocked by:
- Prisma was failing to insert data into PostgreSQL
- Server connection issues between NestJS app and PostgreSQL database
- pnpm-related dependency/configuration conflicts causing setup instability

## One thing I'm not sure I understand:
- Prisma configuration details, especially how it properly connects with PostgreSQL in my current setup and why pnpm is causing dependency or runtime conflicts that prevent the server from connecting to the database


# Day 2 Task Flag

## Built:
- Successfully received Shopify `order/create` webhook events on the server
- Stored incoming order data into PostgreSQL using Prisma
- Implemented idempotency to prevent duplicate orders by ensuring the same Shopify order ID is not inserted multiple times
- Created CI workflow (`ci.yaml`) to run on pushes to `main` and on pull requests
- CI pipeline validates:
  - Lint checks
  - TypeScript type checking
  - Build checks
- Configured CI to block merges if any linting or TypeScript errors are detected

## Blocked by:
- Handling duplicate webhook retries correctly while ensuring safe database writes (resolved through idempotency logic)
- Initial setup and stabilization of CI workflow with correct GitHub Actions configuration

## One thing I'm not sure I understand:
- How to properly design webhook retry + idempotency strategy at scale (especially when multiple workers or concurrent requests hit the same order event at the same time without causing race conditions)


# Day 3 Flag

## Built:
- Registered and handled a new Shopify webhook for product updates
- Implemented product audit tracking in the database to store historical changes
- Built a diff mechanism to compare **old vs new product values** and persist changes
- Created a structured audit table to track product change history (initial state stores `old_value = null`, then compares against latest `product` table state)
- Improved CI pipeline understanding by intentionally testing failure scenarios:
  - Lint check failures
  - TypeScript compilation failures
  - Jest test failures
- Fixed default NestJS-generated Jest test to ensure test suite passes successfully

## Blocked by:
- Designing correct product diff logic (initially attempted to store diffs directly in webhook event table, but it caused improper overwrites)
- Refactoring approach to introduce a dedicated **product audit table** for clean historical tracking
- Understanding proper schema flow between product updates and audit records

## One thing I'm not sure I understand:
- The best practice for building scalable diff + audit systems (especially how to handle concurrent product updates, ordering of webhook events, and ensuring no data is lost when multiple updates arrive quickly)