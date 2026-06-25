'use strict';

const crypto = require('crypto');
const http = require('http');

const SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || '44933ac15566187db1eda9b1aedd705b57099924687720d0256c1d129d15a79f';
const HOST = 'localhost';
const PORT = 3000;

const payload = JSON.stringify({
  id: Date.now(),
  email: 'test@example.com',
  total_price: '99.99',
  line_items: [{ title: 'Test Product', quantity: 1, price: '99.99' }],
});

const hmac = crypto
  .createHmac('sha256', SECRET)
  .update(payload)
  .digest('base64');

const options = {
  hostname: HOST,
  port: PORT,
  path: '/webhooks/shopify',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'X-Shopify-Hmac-SHA256': hmac,
    'X-Shopify-Topic': 'orders/create',
    'X-Shopify-Shop-Domain': 'test-store.myshopify.com',
  },
};

const req = http.request(options, (res) => {
  process.stdout.write(`Status: ${res.statusCode}\n`);
  res.on('data', (chunk) => process.stdout.write(chunk));
  res.on('end', () => process.stdout.write('\nDone — job queued, watch server logs for processing\n'));
});

req.on('error', (err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});

req.write(payload);
req.end();
