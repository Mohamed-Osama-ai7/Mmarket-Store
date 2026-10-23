const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const mongoose = require("mongoose");
const Order = require("../model/order.model");
const Product = require("../model/product.model");
const Payment = require("../model/payment.model");
const orderService = require("../service/order.service");
const productListCache = require("../utilities/productListCache");

const orderId = "64b000000000000000000001";
const userId = "64b000000000000000000002";
const productId = "64b000000000000000000003";

const originals = {};

afterEach(() => {
    for (const [key, value] of Object.entries(originals)) {
        const [modelName, methodName] = key.split(".");
        const model = { mongoose, Order, Product, Payment, productListCache }[modelName];
        model[methodName] = value;
        delete originals[key];
    }
});

const replace = (objectName, object, methodName, replacement) => {
    const key = `${objectName}.${methodName}`;
    if (!(key in originals)) originals[key] = object[methodName];
    object[methodName] = replacement;
};

const runWithSession = (callback) => {
    replace("mongoose", mongoose, "startSession", async () => ({
        withTransaction: callback => callback(),
        endSession: async () => {}
    }));
};

const makeOrder = (overrides = {}) => ({
    _id: orderId,
    user: userId,
    orderStatus: "confirmed",
    paymentStatus: "pending",
    stockReleasedAt: null,
    cancelledAt: null,
    items: [{ product: productId, quantity: 2, name: "Product" }],
    async save() { return this; },
    ...overrides
});

test("customer cancellation restores stock and cancels any pending COD payment atomically", async () => {
    runWithSession();
    const order = makeOrder();
    let ownerScopedQuery;
    let stockRestored = 0;
    let paymentCancelled = 0;
    let cacheInvalidated = 0;

    replace("Order", Order, "findOne", query => {
        ownerScopedQuery = query;
        return { session: async () => order };
    });
    replace("Product", Product, "updateOne", async (filter, update, options) => {
        assert.deepEqual(filter, { _id: productId });
        assert.deepEqual(update, { $inc: { stock: 2 } });
        assert.ok(options.session);
        stockRestored += 1;
        return { matchedCount: 1 };
    });
    replace("Payment", Payment, "updateOne", async (filter, update, options) => {
        assert.deepEqual(filter, { order: orderId, status: "pending" });
        assert.deepEqual(update, { $set: { status: "cancelled" } });
        assert.ok(options.session);
        paymentCancelled += 1;
        return { matchedCount: 1, modifiedCount: 1 };
    });
    replace("productListCache", productListCache, "invalidate", () => { cacheInvalidated += 1; });

    const result = await orderService.updateOrderStatus({
        orderId,
        status: "cancelled",
        userId
    });

    assert.deepEqual(ownerScopedQuery, { _id: orderId, user: userId });
    assert.equal(result.orderStatus, "cancelled");
    assert.ok(result.cancelledAt instanceof Date);
    assert.ok(result.stockReleasedAt instanceof Date);
    assert.equal(stockRestored, 1);
    assert.equal(paymentCancelled, 1);
    assert.equal(cacheInvalidated, 1);
});

test("customer cannot cancel a completed or paid order", async () => {
    runWithSession();
    const order = makeOrder({ orderStatus: "completed" });
    let stockWriteCount = 0;
    replace("Order", Order, "findOne", () => ({ session: async () => order }));
    replace("Product", Product, "updateOne", async () => { stockWriteCount += 1; return { matchedCount: 1 }; });
    replace("Payment", Payment, "updateOne", async () => ({ matchedCount: 0, modifiedCount: 0 }));

    await assert.rejects(
        orderService.updateOrderStatus({ orderId, status: "cancelled", userId }),
        error => error.statusCode === 409
    );
    assert.equal(stockWriteCount, 0);

    order.orderStatus = "confirmed";
    order.paymentStatus = "paid";
    await assert.rejects(
        orderService.updateOrderStatus({ orderId, status: "cancelled", userId }),
        error => error.statusCode === 409
    );
    assert.equal(stockWriteCount, 0);
});

test("customer cannot cancel another customer's order", async () => {
    runWithSession();
    let queryUsed;
    replace("Order", Order, "findOne", query => {
        queryUsed = query;
        return { session: async () => null };
    });

    await assert.rejects(
        orderService.updateOrderStatus({ orderId, status: "cancelled", userId }),
        error => error.statusCode === 404
    );
    assert.deepEqual(queryUsed, { _id: orderId, user: userId });
});

test("guest cancellation requires its private token and an early unpaid order", async () => {
    runWithSession();
    const crypto = require("node:crypto");
    const accessToken = "a".repeat(43);
    const expectedHash = crypto.createHash("sha256").update(accessToken).digest("hex");
    const order = makeOrder({ user: null, guestName: "Guest", guestEmail: "guest@example.com", guestAccessTokenHash: expectedHash });
    let queryUsed;
    let stockRestored = 0;
    replace("Order", Order, "findOne", query => {
        queryUsed = query;
        return { select: () => ({ session: async () => order }) };
    });
    replace("Product", Product, "updateOne", async () => { stockRestored += 1; return { matchedCount: 1 }; });
    replace("Payment", Payment, "updateOne", async () => ({ matchedCount: 1, modifiedCount: 1 }));
    replace("productListCache", productListCache, "invalidate", async () => {});

    const result = await orderService.updateOrderStatus({ orderId, status: "cancelled", guestAccessToken: accessToken });
    assert.deepEqual(queryUsed, { _id: orderId, user: null });
    assert.equal(result.orderStatus, "cancelled");
    assert.equal(result.guestAccessTokenHash, undefined);
    assert.equal(stockRestored, 1);
});

test("guest cancellation rejects a wrong private token without restoring stock", async () => {
    runWithSession();
    const order = makeOrder({ user: null, guestName: "Guest", guestEmail: "guest@example.com", guestAccessTokenHash: "0".repeat(64) });
    let stockRestored = 0;
    replace("Order", Order, "findOne", () => ({ select: () => ({ session: async () => order }) }));
    replace("Product", Product, "updateOne", async () => { stockRestored += 1; return { matchedCount: 1 }; });
    await assert.rejects(
        () => orderService.updateOrderStatus({ orderId, status: "cancelled", guestAccessToken: "a".repeat(43) }),
        error => error.statusCode === 404
    );
    assert.equal(stockRestored, 0);
});
