'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const event = await prisma.webhookEvent.create({
    data: {
      topic: 'orders/create',
      shopDomain: 'test-store.myshopify.com',
      shopifyId: 'seed-' + Date.now(),
      payload: { id: 1, title: 'Test Order', test: true },
    },
  });

  process.stdout.write('Inserted: ' + JSON.stringify(event, null, 2) + '\n');
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
