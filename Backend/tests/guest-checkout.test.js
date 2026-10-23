const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const Order = require('../model/order.model');
const Payment = require('../model/payment.model');

const orderSeed = (overrides = {}) => ({
  user: null,
  guestName: 'Sample Guest',
  guestEmail: 'guest@example.com',
  guestAccessTokenHash: crypto.createHash('sha256').update('A'.repeat(43)).digest('hex'),
  items: [{ product: '64b000000000000000000003', name: 'Shirt', slug: 'shirt', quantity: 2, unitPrice: 150, totalPrice: 300 }],
  subtotal: 300,
  discount: 0,
  total: 300,
  currency: 'EGP',
  orderStatus: 'confirmed',
  paymentStatus: 'pending',
  idempotencyKey: 'guest-checkout-key-001',
  ...overrides,
});

test('guest order schema accepts valid guest details and server-computed totals', async () => {
  const order = new Order(orderSeed());
  await assert.doesNotReject(() => order.validate());
  assert.equal(Order.schema.path('guestAccessTokenHash').options.select, false);
});

test('guest order schema rejects missing private access-token hash', async () => {
  const order = new Order(orderSeed({ guestAccessTokenHash: undefined }));
  await assert.rejects(() => order.validate(), error => error.name === 'ValidationError' && Boolean(error.errors.guestEmail));
});

test('guest payment schema accepts COD tied to an email and order', async () => {
  const payment = new Payment({
    user: null,
    guestEmail: 'guest@example.com',
    order: '64b000000000000000000004',
    amount: 300,
    currency: 'EGP',
    method: 'cash_on_delivery',
    provider: 'manual',
    status: 'pending',
    idempotencyKey: 'guest-payment-001',
  });
  await assert.doesNotReject(() => payment.validate());
});

test('guest payment schema rejects a payment with neither account nor guest email', async () => {
  const payment = new Payment({
    user: null,
    order: '64b000000000000000000004',
    amount: 300,
    currency: 'EGP',
    method: 'cash_on_delivery',
    provider: 'manual',
    idempotencyKey: 'guest-payment-002',
  });
  await assert.rejects(() => payment.validate(), error => error.name === 'ValidationError' && Boolean(error.errors.guestEmail));
});
