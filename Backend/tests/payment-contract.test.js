const assert = require('node:assert/strict');
const { test } = require('node:test');
const mongoose = require('mongoose');
const Order = require('../model/order.model');
const paymentService = require('../service/payment.service');
const paymentController = require('../controller/payment.controller');

test('course-project orders do not persist shipping-address or shipping-fee fields', () => {
  assert.equal(Order.schema.path('shippingAddress'), undefined);
  assert.equal(Order.schema.path('shippingFee'), undefined);
});

test('payment service rejects online card and wallet methods before database access', async () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const orderId = new mongoose.Types.ObjectId().toString();

  for (const method of ['card', 'wallet']) {
    await assert.rejects(
      paymentService.createPayment({ userId, orderId, method, idempotencyKey: `disabled-${method}` }),
      error => error.statusCode === 400 && error.message === 'Unsupported payment method'
    );
  }
});

test('public online-payment webhook is explicitly disabled for COD-only scope', async () => {
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  await paymentController.handleWebhook({}, response);

  assert.equal(response.statusCode, 503);
  assert.match(response.body.error, /Cash on delivery is the only supported payment method/i);
});
