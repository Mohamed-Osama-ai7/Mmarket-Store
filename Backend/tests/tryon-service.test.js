const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const mongoose = require('mongoose');
const TryOnJob = require('../model/tryon-job.model');
const service = require('../service/tryon.service');

const oldApiKey = process.env.FASHN_API_KEY;
const oldFetch = global.fetch;
afterEach(() => {
  if (oldApiKey === undefined) delete process.env.FASHN_API_KEY;
  else process.env.FASHN_API_KEY = oldApiKey;
  global.fetch = oldFetch;
});

test('virtual try-on fails safely when the server API key is not configured', async () => {
  delete process.env.FASHN_API_KEY;
  await assert.rejects(
    () => service.createProductToModelPrediction({ slug: 'sample-shirt', audience: 'male', style: 'studio', userId: new mongoose.Types.ObjectId().toString() }),
    error => error.statusCode === 503 && /Virtual fitting is not configured/i.test(error.message) && !/(FASHN_API_KEY|\bAI\b)/i.test(error.message),
  );
});

test('virtual try-on status is scoped to the authenticated owner before calling the provider', async () => {
  process.env.FASHN_API_KEY = 'server-test-key';
  let providerCalled = false;
  let receivedQuery;
  global.fetch = async () => { providerCalled = true; throw new Error('provider should not be called for an unowned job'); };
  const originalFindOne = TryOnJob.findOne;
  TryOnJob.findOne = (query) => {
    receivedQuery = query;
    return { select: () => ({ lean: async () => null }) };
  };
  try {
    const userId = new mongoose.Types.ObjectId().toString();
    await assert.rejects(() => service.getProductToModelPrediction('12345678-1234-1234-1234-123456789012', userId), error => error.statusCode === 404);
    assert.equal(receivedQuery.predictionId, '12345678-1234-1234-1234-123456789012');
    assert.equal(receivedQuery.user, userId);
    assert.ok(receivedQuery.expiresAt.$gt instanceof Date);
    assert.equal(providerCalled, false);
  } finally {
    TryOnJob.findOne = originalFindOne;
  }
});
