const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { after, before, test } = require("node:test");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const mongoose = require("mongoose");

const Order = require("../../model/order.model");
const Cart = require("../../model/cart.model");
const Payment = require("../../model/payment.model");
const Refund = require("../../model/refund.model");
const Purchase = require("../../model/purchase.model");
const Product = require("../../model/product.model");
const { checkoutCart } = require("../../service/order.service");
const paymentService = require("../../service/payment.service");
const refundService = require("../../service/refund.service");
const paymentController = require("../../controller/payment.controller");
const refundController = require("../../controller/refund.controller");
const purchaseController = require("../../controller/purchase.controller");

const LOOPBACK = "127.0.0.1";
const REPLICA_SET_NAME = "mean-l2-phase3-test-rs";
const DATABASE_PREFIX = "mean_l2_phase3_it_";
const RUN_ID = `phase3-${Date.now()}-${process.pid}`;
const ownedUserIds = new Set();
const ownedProductIds = new Set();
let originalPaymentProvider;
let replicaSet;
let databaseName;

const assertTestDatabaseIsActive = async () => {
    assert.match(databaseName, /^mean_l2_phase3_it_[a-f0-9]{16}$/);
    assert.ok(replicaSet, "test-managed Replica Set must be initialized");

    const instanceInfo = replicaSet.servers[0].instanceInfo;
    assert.ok(instanceInfo, "test-managed MongoDB instance must be running");
    assert.equal(instanceInfo.ip, LOOPBACK);
    assert.equal(mongoose.connection.readyState, 1);
    assert.equal(mongoose.connection.host, LOOPBACK);
    assert.equal(mongoose.connection.port, instanceInfo.port);
    assert.equal(mongoose.connection.name, databaseName);
    assert.equal(mongoose.connection.db.databaseName, databaseName);

    const topology = mongoose.connection.client.topology;
    assert.equal(topology.description.setName, REPLICA_SET_NAME);
    assert.deepEqual(
        [...topology.description.servers.keys()],
        [`${LOOPBACK}:${instanceInfo.port}`]
    );

    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.equal(hello.setName, REPLICA_SET_NAME);
    assert.equal(hello.me, `${LOOPBACK}:${instanceInfo.port}`);
};

const assertTestMongoUri = mongoUri => {
    const uri = new URL(mongoUri);
    assert.equal(uri.protocol, "mongodb:");
    assert.equal(uri.hostname, LOOPBACK);
    assert.equal(decodeURIComponent(uri.pathname.slice(1)), databaseName);
    assert.equal(uri.searchParams.get("replicaSet"), REPLICA_SET_NAME);
    assert.equal(
        Number(uri.port),
        replicaSet.servers[0].instanceInfo.port
    );
};

const createUserId = () => {
    const userId = new mongoose.Types.ObjectId();
    ownedUserIds.add(userId);
    return userId;
};

const createProduct = async ({
    userId,
    stock = 5,
    isActive = true,
    price = 10
}) => {
    const suffix = new mongoose.Types.ObjectId().toString();
    const product = await Product.create({
        name: `${RUN_ID} ${suffix}`,
        price,
        desc: "Phase 3 transaction test fixture",
        stock,
        imgURL: "phase3-test-image",
        category: new mongoose.Types.ObjectId(),
        isActive
    });
    ownedProductIds.add(product._id);
    return product;
};

const createOrder = async ({
    userId,
    product,
    quantity = 1,
    paymentStatus = "pending",
    orderStatus = "pending"
}) => {
    const total = product.price * quantity;
    return Order.create({
        user: userId,
        items: [{
            product: product._id,
            name: product.name,
            slug: product.slug,
            quantity,
            unitPrice: product.price,
            totalPrice: total
        }],
        subtotal: total,
        discount: 0,
        total,
        currency: "EGP",
        orderStatus,
        paymentStatus,
        refundStatus: "not_required",
        idempotencyKey: `${RUN_ID}:${new mongoose.Types.ObjectId()}`
    });
};

const createSucceededPayment = async ({ userId, order }) => Payment.create({
    user: userId,
    order: order._id,
    amount: order.total,
    currency: order.currency,
    method: "card",
    provider: "stripe",
    status: "succeeded",
    refundedAmount: 0,
    refundStatus: "not_required",
    idempotencyKey: `${RUN_ID}:${new mongoose.Types.ObjectId()}`
});

const createResponse = () => ({
    statusCode: undefined,
    body: undefined,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    }
});

const createRequest = ({ userId, body, idempotencyKey }) => ({
    user: { id: userId.toString() },
    body,
    get(name) {
        return name.toLowerCase() === "idempotency-key"
            ? idempotencyKey
            : undefined;
    }
});

before(async () => {
    originalPaymentProvider = process.env.PAYMENT_PROVIDER;
    process.env.PAYMENT_PROVIDER = "manual";

    databaseName = `${DATABASE_PREFIX}${randomBytes(8).toString("hex")}`;
    replicaSet = await MongoMemoryReplSet.create({
        binary: { version: "8.2.6" },
        replSet: {
            count: 1,
            ip: LOOPBACK,
            name: REPLICA_SET_NAME,
            storageEngine: "wiredTiger"
        },
        instanceOpts: [{ ip: LOOPBACK }]
    });

    const mongoUri = replicaSet.getUri(databaseName);
    assertTestMongoUri(mongoUri);
    await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 5000
    });

    await assertTestDatabaseIsActive();

    await Promise.all([
        Order.init(),
        Cart.init(),
        Payment.init(),
        Refund.init(),
        Purchase.init(),
        Product.init()
    ]);
});

after(async () => {
    try {
        if (ownedUserIds.size || ownedProductIds.size) {
            await assertTestDatabaseIsActive();

            const userIds = [...ownedUserIds];
            const productIds = [...ownedProductIds];
            await Promise.all([
                Cart.deleteMany({ user: { $in: userIds } }),
                Order.deleteMany({ user: { $in: userIds } }),
                Payment.deleteMany({ user: { $in: userIds } }),
                Refund.deleteMany({ user: { $in: userIds } }),
                Purchase.deleteMany({ user: { $in: userIds } }),
                Product.deleteMany({ _id: { $in: productIds } })
            ]);
        }
    } finally {
        try {
            if (mongoose.connection.readyState) {
                await mongoose.disconnect();
            }
        } finally {
            try {
                if (replicaSet) {
                    await replicaSet.stop();
                }
            } finally {
                if (originalPaymentProvider === undefined) {
                    delete process.env.PAYMENT_PROVIDER;
                } else {
                    process.env.PAYMENT_PROVIDER = originalPaymentProvider;
                }
            }
        }
    }
});

test("checkout creates one order, decrements stock, and empties the cart", async () => {
    const userId = createUserId();
    const product = await createProduct({ userId, stock: 5, price: 12.5 });
    const cart = await Cart.create({
        user: userId,
        items: [{ product: product._id, quantity: 2 }]
    });

    const result = await checkoutCart({
        userId: userId.toString(),
        idempotencyKey: `${RUN_ID}:checkout-success`,
    });

    assert.equal(result.alreadyCreated, false);
    assert.equal(result.order.items.length, 1);
    assert.equal(result.order.total, 25);
    assert.equal((await Product.findById(product._id)).stock, 3);
    assert.equal((await Cart.findById(cart._id)).items.length, 0);
    assert.equal(await Order.countDocuments({ user: userId }), 1);
});

test("checkout rolls back earlier stock updates when a later cart item is unavailable", async () => {
    const userId = createUserId();
    const stockedProduct = await createProduct({ userId, stock: 3 });
    const emptyProduct = await createProduct({ userId, stock: 0 });
    const cart = await Cart.create({
        user: userId,
        items: [
            { product: stockedProduct._id, quantity: 2 },
            { product: emptyProduct._id, quantity: 1 }
        ]
    });

    await assert.rejects(
        checkoutCart({
            userId: userId.toString(),
            idempotencyKey: `${RUN_ID}:checkout-rollback`,
        }),
        error => error.statusCode === 409
    );

    assert.equal((await Product.findById(stockedProduct._id)).stock, 3);
    assert.equal((await Product.findById(emptyProduct._id)).stock, 0);
    assert.equal((await Cart.findById(cart._id)).items.length, 2);
    assert.equal(await Order.countDocuments({ user: userId }), 0);
});

test("checkout rejects inactive products without changing cart or stock", async () => {
    const userId = createUserId();
    const product = await createProduct({
        userId,
        stock: 2,
        isActive: false
    });
    const cart = await Cart.create({
        user: userId,
        items: [{ product: product._id, quantity: 1 }]
    });

    await assert.rejects(
        checkoutCart({
            userId: userId.toString(),
            idempotencyKey: `${RUN_ID}:checkout-unavailable`,
        }),
        error => error.statusCode === 400
    );

    assert.equal((await Product.findById(product._id)).stock, 2);
    assert.equal((await Cart.findById(cart._id)).items.length, 1);
    assert.equal(await Order.countDocuments({ user: userId }), 0);
});

test("concurrent checkouts cannot oversell the last unit", async () => {
    const firstUserId = createUserId();
    const secondUserId = createUserId();
    const product = await createProduct({ userId: firstUserId, stock: 1 });
    const firstCart = await Cart.create({
        user: firstUserId,
        items: [{ product: product._id, quantity: 1 }]
    });
    const secondCart = await Cart.create({
        user: secondUserId,
        items: [{ product: product._id, quantity: 1 }]
    });

    const results = await Promise.allSettled([
        checkoutCart({
            userId: firstUserId.toString(),
            idempotencyKey: `${RUN_ID}:checkout-race-one`,
        }),
        checkoutCart({
            userId: secondUserId.toString(),
            idempotencyKey: `${RUN_ID}:checkout-race-two`,
        })
    ]);

    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const rejectedCheckout = results.find(result => result.status === "rejected");
    assert.equal(rejectedCheckout.reason.statusCode, 409);
    assert.equal((await Product.findById(product._id)).stock, 0);
    assert.equal(await Order.countDocuments({
        user: { $in: [firstUserId, secondUserId] }
    }), 1);

    const [firstCartAfter, secondCartAfter] = await Promise.all([
        Cart.findById(firstCart._id),
        Cart.findById(secondCart._id)
    ]);
    assert.equal(
        Number(firstCartAfter.items.length === 0) +
        Number(secondCartAfter.items.length === 0),
        1
    );
});

test("payment returns 201 then 200 for the same key and rejects changed request data", async () => {
    const userId = createUserId();
    const product = await createProduct({ userId });
    const order = await createOrder({ userId, product });
    const otherOrder = await createOrder({ userId, product });
    const requestBody = {
        order: order._id.toString(),
        method: "cash_on_delivery"
    };

    const firstResponse = createResponse();
    await paymentController.createPayment(
        createRequest({
            userId,
            body: requestBody,
            idempotencyKey: `${RUN_ID}:payment-repeat`
        }),
        firstResponse
    );
    assert.equal(firstResponse.statusCode, 201);

    const duplicateResponse = createResponse();
    await paymentController.createPayment(
        createRequest({
            userId,
            body: requestBody,
            idempotencyKey: `${RUN_ID}:payment-repeat`
        }),
        duplicateResponse
    );
    assert.equal(duplicateResponse.statusCode, 200);

    const conflictResponse = createResponse();
    await paymentController.createPayment(
        createRequest({
            userId,
            body: {
                order: otherOrder._id.toString(),
                method: "cash_on_delivery"
            },
            idempotencyKey: `${RUN_ID}:payment-repeat`
        }),
        conflictResponse
    );
    assert.equal(conflictResponse.statusCode, 409);
    assert.equal(await Payment.countDocuments({ user: userId }), 1);
});

test("concurrent duplicate payment requests create one payment and return the idempotent result", async () => {
    const userId = createUserId();
    const product = await createProduct({ userId });
    const order = await createOrder({ userId, product });
    const idempotencyKey = `${RUN_ID}:payment-concurrent`;

    const responses = [createResponse(), createResponse()];

    await Promise.all(responses.map(response =>
        paymentController.createPayment(
            createRequest({
                userId,
                body: {
                    order: order._id.toString(),
                    method: "cash_on_delivery"
                },
                idempotencyKey
            }),
            response
        )
    ));

    assert.deepEqual(
        responses.map(response => response.statusCode).sort(),
        [200, 201]
    );
    assert.equal(await Payment.countDocuments({ user: userId }), 1);
});

test("payment idempotency keys are scoped to a user", async () => {
    const firstUserId = createUserId();
    const secondUserId = createUserId();
    const firstProduct = await createProduct({ userId: firstUserId });
    const secondProduct = await createProduct({ userId: secondUserId });
    const firstOrder = await createOrder({
        userId: firstUserId,
        product: firstProduct
    });
    const secondOrder = await createOrder({
        userId: secondUserId,
        product: secondProduct
    });
    const idempotencyKey = `${RUN_ID}:same-key-two-users`;

    const results = await Promise.all([
        paymentService.createPayment({
            userId: firstUserId.toString(),
            orderId: firstOrder._id.toString(),
            method: "cash_on_delivery",
            idempotencyKey
        }),
        paymentService.createPayment({
            userId: secondUserId.toString(),
            orderId: secondOrder._id.toString(),
            method: "cash_on_delivery",
            idempotencyKey
        })
    ]);

    assert.equal(results.length, 2);
    assert.equal(await Payment.countDocuments({
        user: { $in: [firstUserId, secondUserId] }
    }), 2);
});

test("refund lifecycle is idempotent and keeps payment and order states consistent", async () => {
    const userId = createUserId();
    const product = await createProduct({ userId, price: 50 });
    const order = await createOrder({
        userId,
        product,
        paymentStatus: "paid",
        orderStatus: "confirmed"
    });
    const payment = await createSucceededPayment({ userId, order });
    const key = `${RUN_ID}:refund-lifecycle`;
    const refundBody = {
        payment: payment._id.toString(),
        amount: 25,
        reason: "Phase 3 test refund"
    };

    const firstResponse = createResponse();
    await refundController.createRefundRequest(
        createRequest({ userId, body: refundBody, idempotencyKey: key }),
        firstResponse
    );
    assert.equal(firstResponse.statusCode, 201);

    const duplicateResponse = createResponse();
    await refundController.createRefundRequest(
        createRequest({ userId, body: refundBody, idempotencyKey: key }),
        duplicateResponse
    );
    assert.equal(duplicateResponse.statusCode, 200);

    const conflictResponse = createResponse();
    await refundController.createRefundRequest(
        createRequest({
            userId,
            body: { ...refundBody, amount: 20 },
            idempotencyKey: key
        }),
        conflictResponse
    );
    assert.equal(conflictResponse.statusCode, 409);

    const invalidAmountResponse = createResponse();
    await refundController.createRefundRequest(
        createRequest({
            userId,
            body: { ...refundBody, amount: 0.001 },
            idempotencyKey: `${RUN_ID}:refund-invalid-amount`
        }),
        invalidAmountResponse
    );
    assert.equal(invalidAmountResponse.statusCode, 400);

    const refundId = firstResponse.body.data._id.toString();
    await assert.rejects(
        refundService.startRefundProcessing({
            adminId: userId,
            refundId
        }),
        error => error.statusCode === 409
    );

    await refundService.reviewRefund({
        adminId: userId,
        refundId,
        decision: "approve"
    });
    await refundService.startRefundProcessing({
        adminId: userId,
        refundId
    });
    await refundService.completeRefund({
        adminId: userId,
        refundId,
        providerRefundId: `${RUN_ID}:provider-refund`
    });
    await refundService.completeRefund({
        adminId: userId,
        refundId,
        providerRefundId: `${RUN_ID}:provider-refund`
    });

    const [savedRefund, savedPayment, savedOrder] = await Promise.all([
        Refund.findById(refundId),
        Payment.findById(payment._id),
        Order.findById(order._id)
    ]);
    assert.equal(savedRefund.status, "completed");
    assert.equal(savedPayment.refundedAmount, 25);
    assert.equal(savedPayment.status, "partially_refunded");
    assert.equal(savedPayment.refundStatus, "partially_refunded");
    assert.equal(savedOrder.paymentStatus, "paid");
    assert.equal(savedOrder.refundStatus, "partially_refunded");

    const secondRefund = await refundService.createRefundRequest({
        userId: userId.toString(),
        paymentId: payment._id.toString(),
        amount: 25,
        reason: "Complete remaining refund",
        idempotencyKey: `${RUN_ID}:refund-final-part`
    });
    assert.equal(secondRefund.created, true);
    await refundService.reviewRefund({
        adminId: userId,
        refundId: secondRefund.refund._id.toString(),
        decision: "approve"
    });
    await refundService.startRefundProcessing({
        adminId: userId,
        refundId: secondRefund.refund._id.toString()
    });
    await refundService.completeRefund({
        adminId: userId,
        refundId: secondRefund.refund._id.toString(),
        providerRefundId: `${RUN_ID}:provider-refund-final`
    });

    const [fullyRefundedPayment, fullyRefundedOrder] = await Promise.all([
        Payment.findById(payment._id),
        Order.findById(order._id)
    ]);
    assert.equal(fullyRefundedPayment.refundedAmount, 50);
    assert.equal(fullyRefundedPayment.status, "refunded");
    assert.equal(fullyRefundedPayment.refundStatus, "completed");
    assert.equal(fullyRefundedOrder.paymentStatus, "refunded");
    assert.equal(fullyRefundedOrder.refundStatus, "completed");
    assert.equal(await Refund.countDocuments({ user: userId }), 2);
});

test("concurrent duplicate refund requests do not create duplicate records", async () => {
    const userId = createUserId();
    const product = await createProduct({ userId, price: 30 });
    const order = await createOrder({
        userId,
        product,
        paymentStatus: "paid",
        orderStatus: "confirmed"
    });
    const payment = await createSucceededPayment({ userId, order });
    const input = {
        userId: userId.toString(),
        paymentId: payment._id.toString(),
        amount: 10,
        reason: "Concurrent refund test",
        idempotencyKey: `${RUN_ID}:refund-concurrent`
    };

    const results = await Promise.all([
        refundService.createRefundRequest(input),
        refundService.createRefundRequest(input)
    ]);

    assert.equal(results.filter(result => result.created).length, 1);
    assert.equal(await Refund.countDocuments({ user: userId }), 1);
});

test("concurrent refunds with different keys allow only one active refund", async () => {
    const userId = createUserId();
    const product = await createProduct({ userId, price: 30 });
    const order = await createOrder({
        userId,
        product,
        paymentStatus: "paid",
        orderStatus: "confirmed"
    });
    const payment = await createSucceededPayment({ userId, order });

    const results = await Promise.allSettled([
        refundService.createRefundRequest({
            userId: userId.toString(),
            paymentId: payment._id.toString(),
            amount: 10,
            reason: "First concurrent refund",
            idempotencyKey: `${RUN_ID}:refund-active-one`
        }),
        refundService.createRefundRequest({
            userId: userId.toString(),
            paymentId: payment._id.toString(),
            amount: 15,
            reason: "Second concurrent refund",
            idempotencyKey: `${RUN_ID}:refund-active-two`
        })
    ]);

    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const rejectedRefund = results.find(result => result.status === "rejected");
    assert.equal(rejectedRefund.reason.statusCode, 409);
    assert.equal(await Refund.countDocuments({ user: userId }), 1);
    assert.equal((await Payment.findById(payment._id)).refundStatus, "pending");
});

test("refund creation rolls back its refund and payment writes when an order write fails", async () => {
    const userId = createUserId();
    const product = await createProduct({ userId, price: 40 });
    const order = await createOrder({
        userId,
        product,
        paymentStatus: "paid",
        orderStatus: "confirmed"
    });
    const payment = await createSucceededPayment({ userId, order });
    const originalSave = Order.prototype.save;

    Order.prototype.save = async function (...args) {
        if (this._id.equals(order._id)) {
            throw new Error("Injected order persistence failure");
        }

        return originalSave.apply(this, args);
    };

    try {
        await assert.rejects(
            refundService.createRefundRequest({
                userId: userId.toString(),
                paymentId: payment._id.toString(),
                amount: 10,
                reason: "Refund rollback test",
                idempotencyKey: `${RUN_ID}:refund-rollback`
            }),
            /Injected order persistence failure/
        );
    } finally {
        Order.prototype.save = originalSave;
    }

    const [savedPayment, savedOrder] = await Promise.all([
        Payment.findById(payment._id),
        Order.findById(order._id)
    ]);
    assert.equal(await Refund.countDocuments({ user: userId }), 0);
    assert.equal(savedPayment.refundStatus, "not_required");
    assert.equal(savedOrder.refundStatus, "not_required");
});

test("Purchase remains an independent workflow and atomically decrements stock", async () => {
    const userId = createUserId();
    const product = await createProduct({ userId, stock: 4, price: 7 });
    const response = createResponse();

    await purchaseController.addPurchase(
        createRequest({
            userId,
            body: { product: product._id.toString(), quantity: 2 }
        }),
        response
    );

    assert.equal(response.statusCode, 201);
    const savedPurchase = await Purchase.findById(response.body.data._id);
    assert.equal(savedPurchase.user.toString(), userId.toString());
    assert.equal(savedPurchase.product.toString(), product._id.toString());
    assert.equal(savedPurchase.order, null);
    assert.equal(savedPurchase.totalPrice, 14);
    assert.equal((await Product.findById(product._id)).stock, 2);
    assert.equal(await Order.countDocuments({ user: userId }), 0);
});

test("Purchase restores reserved stock if purchase persistence fails", async () => {
    const userId = createUserId();
    const product = await createProduct({ userId, stock: 3 });
    const originalCreate = Purchase.create;

    Purchase.create = async () => {
        throw new Error("Injected purchase persistence failure");
    };

    try {
        const response = createResponse();
        await purchaseController.addPurchase(
            createRequest({
                userId,
                body: { product: product._id.toString(), quantity: 2 }
            }),
            response
        );
        assert.equal(response.statusCode, 500);
    } finally {
        Purchase.create = originalCreate;
    }

    assert.equal((await Product.findById(product._id)).stock, 3);
    assert.equal(await Purchase.countDocuments({ user: userId }), 0);
});
