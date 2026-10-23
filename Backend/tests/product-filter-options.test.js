const assert = require('node:assert/strict');
const { test } = require('node:test');
const Product = require('../model/product.model');
const controller = require('../controller/product.controller');
const logger = require('../utilities/logger');

test('filter options return normalized, sorted brands, sizes and colours from active catalogue queries', async () => {
  const originals = { distinct: Product.distinct, aggregate: Product.aggregate, logError: logger.logError };
  try {
    Product.distinct = async (field, filter) => {
      assert.equal(field, 'brand');
      assert.equal(filter.isActive, true);
      return ['Northline', 'Daily Form', 'Northline', 'daily form', '', null];
    };
    Product.aggregate = async pipeline => {
      assert.ok(pipeline.some(stage => stage.$unwind === '$variants'));
      assert.ok(pipeline.some(stage => stage.$match?.['variants.stock']?.$gt === 0));
      return [{ sizes: ['M', 'S', 'M', 's', ''], colors: ['Olive', 'Black', 'Olive', 'black'] }];
    };
    logger.logError = () => {};
    let status = 200;
    let body;
    await controller.getProductFilterOptions({ id: 'options-test', method: 'GET' }, {
      status(code) { status = code; return this; },
      json(payload) { body = payload; return this; }
    });
    assert.equal(status, 200);
    assert.deepEqual(body.data.brands, ['Daily Form', 'Northline']);
    assert.deepEqual(body.data.sizes, ['M', 'S']);
    assert.deepEqual(body.data.colors, ['Black', 'Olive']);
  } finally {
    Product.distinct = originals.distinct;
    Product.aggregate = originals.aggregate;
    logger.logError = originals.logError;
  }
});
