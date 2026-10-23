const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { after, afterEach, before, test } = require("node:test");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const LOOPBACK = "127.0.0.1";
const REPLICA_SET_NAME = "mean-l2-stock-test-rs";
const DATABASE_PREFIX = "mean_l2_stock_it_";
const TEST_WEBHOOK_SECRET = "isolated-stock-test-secret";

let replicaSet;
let mongoose;
let Product;
let Cart;
let Order;
let Payment;
let Purchase;
let checkoutCart;
let updateOrderStatus;
let paymentService;
let purchaseController;
let productListCache;
let app;
let cache;
let server;
let serverPort;
let databaseName;
let mongoAddress;
const ownedUserIds = new Set();
const ownedProductIds = new Set();
const ownedCartIds = new Set();
const ownedOrderIds = new Set();
const ownedPaymentIds = new Set();
const ownedPurchaseIds = new Set();

const assertSafeMongoTarget = async () => {
    assert.match(databaseName, /^mean_l2_stock_it_[a-f0-9]{16}$/);
    assert.ok(replicaSet, "test-managed Replica Set must be initialized");

    const info = replicaSet.servers[0].instanceInfo;
    assert.ok(info, "test-managed MongoDB instance must be running");
    assert.equal(info.ip, LOOPBACK);
    assert.equal(info.port, mongoAddress.port);
    assert.equal(mongoAddress.host, LOOPBACK);
    assert.equal(mongoAddress.databaseName, databaseName);
    assert.equal(mongoAddress.replicaSet, REPLICA_SET_NAME);
    assert.equal(mongoose.connection.readyState, 1);
    assert.equal(mongoose.connection.host, LOOPBACK);
    assert.equal(mongoose.connection.port, mongoAddress.port);
    assert.equal(mongoose.connection.name, databaseName);
    assert.equal(mongoose.connection.db.databaseName, databaseName);

    const topology = mongoose.connection.client.topology;
    assert.equal(topology.description.setName, REPLICA_SET_NAME);
    assert.deepEqual(
        [...topology.description.servers.keys()],
        [`${LOOPBACK}:${mongoAddress.port}`]
    );

    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.equal(hello.setName, REPLICA_SET_NAME);
    assert.equal(hello.me, `${LOOPBACK}:${mongoAddress.port}`);
};

const validateMongoUri = uri => {
    const match = /^mongodb:\/\/127\.0\.0\.1:(\d+)\/(mean_l2_stock_it_[a-f0-9]{16})\?replicaSet=mean-l2-stock-test-rs$/.exec(uri);
    assert.ok(match, "generated URI must target the loopback stock-test Replica Set");
    return {
        host: LOOPBACK,
        port: Number(match[1]),
        databaseName: match[2],
        replicaSet: REPLICA_SET_NAME
    };
};

const closeHttpServer = httpServer => new Promise((resolve, reject) => {
    httpServer.close(error => error ? reject(error) : resolve());
    httpServer.closeAllConnections();
});

const requestProducts = async () => {
    const response = await fetch(
        `http://${LOOPBACK}:${serverPort}/api/v1/product/?page=1&pageSize=100`
    );
    return {
        status: response.status,
        body: await response.json()
    };
};

const trackSessions = async callback => {
    const originalStartSession = mongoose.startSession;
    const sessions = [];
    mongoose.startSession = async function (...args) {
        const session = await originalStartSession.apply(this, args);
        sessions.push(session);
        return session;
    };

    try {
        const result = await callback();
        assert.ok(sessions.length > 0, "workflow should start a real session");
        assert.ok(
            sessions.every(session => session.hasEnded),
            "all workflow sessions should be ended"
        );
        return result;
    } finally {
        mongoose.startSession = originalStartSession;
    }
};

const createUserId = () => {
    const userId = new mongoose.Types.ObjectId();
    ownedUserIds.add(userId);
    return userId;
};

const createProduct = async ({ name, stock = 5, price = 10, isActive = true }) => {
    await assertSafeMongoTarget();
    const product = await Product.create({
        name: `${name} ${new mongoose.Types.ObjectId()}`,
        price,
        desc: "Stock integrity test fixture",
        stock,
        imgURL: "stock-test-image",
        category: new mongoose.Types.ObjectId(),
        isActive
    });
    ownedProductIds.add(product._id);
    return product;
};

const createCart = async (userId, items) => {
    await assertSafeMongoTarget();
    const cart = await Cart.create({ user: userId, items });
    ownedCartIds.add(cart._id);
    return cart;
};

const createOrder = async ({
    userId,
    items,
    paymentStatus = "pending",
    orderStatus = "pending",
    stockReleasedAt = null
}) => {
    const subtotal = items.reduce(
        (sum, item) => sum + item.unitPrice * item.quantity,
        0
    );
    await assertSafeMongoTarget();
    const [order] = await Order.create([{
        user: userId,
        items: items.map(item => ({
            product: item.product._id,
            name: item.product.name,
            slug: item.product.slug,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.unitPrice * item.quantity
        })),
        subtotal,
        discount: 0,
        total: subtotal,
        currency: "EGP",
        orderStatus,
        paymentStatus,
        refundStatus: "not_required",
        stockReleasedAt,
        idempotencyKey: `stock-test:${new mongoose.Types.ObjectId()}`
    }]);
    ownedOrderIds.add(order._id);
    return order;
};

const createRequest = (userId, body) => ({
    user: { id: userId.toString() },
    body,
    id: "stock-integrity-test",
    method: "POST"
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

const cleanupOwnedData = async () => {
    if (
        !ownedUserIds.size &&
        !ownedProductIds.size &&
        !ownedCartIds.size &&
        !ownedOrderIds.size &&
        !ownedPaymentIds.size &&
        !ownedPurchaseIds.size
    ) {
        return;
    }

    await assertSafeMongoTarget();
    const operations = [];
    if (ownedPurchaseIds.size) {
        operations.push(Purchase.deleteMany({
            _id: { $in: [...ownedPurchaseIds] }
        }));
    }
    if (ownedPaymentIds.size) {
        operations.push(Payment.deleteMany({
            _id: { $in: [...ownedPaymentIds] }
        }));
    }
    if (ownedOrderIds.size) {
        operations.push(Order.deleteMany({
            _id: { $in: [...ownedOrderIds] }
        }));
    }
    if (ownedCartIds.size) {
        operations.push(Cart.deleteMany({
            _id: { $in: [...ownedCartIds] }
        }));
    }
    if (ownedProductIds.size) {
        operations.push(Product.deleteMany({
            _id: { $in: [...ownedProductIds] }
        }));
    }
    await Promise.all(operations);
    ownedPurchaseIds.clear();
    ownedPaymentIds.clear();
    ownedOrderIds.clear();
    ownedCartIds.clear();
    ownedProductIds.clear();
    ownedUserIds.clear();
};

before(async () => {
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
    mongoAddress = validateMongoUri(mongoUri);
    const instanceInfo = replicaSet.servers[0].instanceInfo;
    assert.ok(instanceInfo, "test-managed MongoDB instance must be running");
    assert.equal(instanceInfo.ip, LOOPBACK);
    assert.equal(instanceInfo.port, mongoAddress.port);

    mongoose = require("mongoose");
    await mongoose.connect(mongoUri, {
        autoIndex: false,
        serverSelectionTimeoutMS: 5000
    });
    await assertSafeMongoTarget();

    Product = require("../../model/product.model");
    Cart = require("../../model/cart.model");
    Order = require("../../model/order.model");
    Payment = require("../../model/payment.model");
    Purchase = require("../../model/purchase.model");
    ({ checkoutCart, updateOrderStatus } =
        require("../../service/order.service"));
    paymentService = require("../../service/payment.service");
    purchaseController = require("../../controller/purchase.controller");
    productListCache = require("../../utilities/productListCache");
    app = require("../../app");
    cache = require("../../utilities/cache");

    await Promise.all([
        Product.init(),
        Cart.init(),
        Order.init(),
        Payment.init(),
        Purchase.init()
    ]);

    server = app.listen(0, LOOPBACK);
    const address = await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.once("listening", () => resolve(server.address()));
    });
    assert.ok(address && typeof address === "object");
    assert.equal(address.address, LOOPBACK);
    assert.equal(address.family, "IPv4");
    assert.ok(Number.isInteger(address.port) && address.port > 0);
    serverPort = address.port;
});

afterEach(async () => {
    if (cache) {
        cache.flushAll();
    }
    await cleanupOwnedData();
});

after(async () => {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
    try {
        if (server) {
            await closeHttpServer(server);
        }
    } finally {
        try {
            if (mongoose?.connection.readyState) {
                await mongoose.disconnect();
            }
        } finally {
            if (replicaSet) {
                await replicaSet.stop();
            }
        }
    }
});

test("checkout commits stock, order, and cart together and is idempotent", async () => {
    const userId = createUserId();
    const product = await createProduct({ name: "Checkout", stock: 5 });
    const cart = await createCart(userId, [
        { product: product._id, quantity: 2 }
    ]);
    const idempotencyKey = `checkout:${new mongoose.Types.ObjectId()}`;

    const before = await requestProducts();
    assert.equal(before.status, 200);
    assert.equal(
        before.body.data.find(item => item._id === product._id.toString()).stock,
        5
    );

    const first = await trackSessions(() => checkoutCart({
        userId: userId.toString(),
        idempotencyKey,
    }));
    assert.equal(first.alreadyCreated, false);
    assert.equal(await Order.countDocuments({ user: userId }), 1);
    assert.equal((await Product.findById(product._id)).stock, 3);
    assert.equal((await Cart.findById(cart._id)).items.length, 0);

    const afterCheckout = await requestProducts();
    assert.equal(
        afterCheckout.body.data.find(
            item => item._id === product._id.toString()
        ).stock,
        3
    );

    const repeated = await checkoutCart({
        userId: userId.toString(),
        idempotencyKey,
    });
    assert.equal(repeated.alreadyCreated, true);
    assert.equal(repeated.order._id.toString(), first.order._id.toString());
    assert.equal(await Order.countDocuments({ user: userId }), 1);
    assert.equal((await Product.findById(product._id)).stock, 3);
});

test("checkout aborts earlier stock deductions if a later cart item lacks stock", async () => {
    const userId = createUserId();
    const available = await createProduct({ name: "Rollback Available", stock: 3 });
    const empty = await createProduct({ name: "Rollback Empty", stock: 0 });
    const cart = await createCart(userId, [
        { product: available._id, quantity: 2 },
        { product: empty._id, quantity: 1 }
    ]);
    const cachedBefore = await requestProducts();
    assert.equal(
        cachedBefore.body.data.find(
            item => item._id === available._id.toString()
        ).stock,
        3
    );

    await assert.rejects(
        trackSessions(() => checkoutCart({
            userId: userId.toString(),
            idempotencyKey: `rollback:${new mongoose.Types.ObjectId()}`,
        })),
        error => error.statusCode === 409
    );

    assert.equal((await Product.findById(available._id)).stock, 3);
    assert.equal((await Product.findById(empty._id)).stock, 0);
    assert.equal((await Cart.findById(cart._id)).items.length, 2);
    assert.equal(await Order.countDocuments({ user: userId }), 0);
    const afterAbort = await requestProducts();
    assert.equal(
        afterAbort.body.data.find(
            item => item._id === available._id.toString()
        ).stock,
        3
    );
});

test("checkout rejects missing Product references without partial writes", async () => {
    const userId = createUserId();
    const missingProductId = new mongoose.Types.ObjectId();
    const cart = await createCart(userId, [
        { product: missingProductId, quantity: 1 }
    ]);

    await assert.rejects(
        trackSessions(() => checkoutCart({
            userId: userId.toString(),
            idempotencyKey: `missing:${new mongoose.Types.ObjectId()}`,
        })),
        error => error.statusCode === 400
    );

    assert.equal((await Cart.findById(cart._id)).items.length, 1);
    assert.equal(await Order.countDocuments({ user: userId }), 0);
    assert.equal(await Product.countDocuments({ _id: missingProductId }), 0);
});

test("concurrent checkouts cannot oversell the final unit", async () => {
    const firstUser = createUserId();
    const secondUser = createUserId();
    const product = await createProduct({ name: "Concurrent", stock: 1 });
    const firstCart = await createCart(firstUser, [
        { product: product._id, quantity: 1 }
    ]);
    const secondCart = await createCart(secondUser, [
        { product: product._id, quantity: 1 }
    ]);

    const results = await trackSessions(() => Promise.allSettled([
        checkoutCart({
            userId: firstUser.toString(),
            idempotencyKey: `race-one:${new mongoose.Types.ObjectId()}`,
        }),
        checkoutCart({
            userId: secondUser.toString(),
            idempotencyKey: `race-two:${new mongoose.Types.ObjectId()}`,
        })
    ]));

    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const failure = results.find(result => result.status === "rejected");
    assert.equal(failure.reason.statusCode, 409);
    assert.equal((await Product.findById(product._id)).stock, 0);
    assert.equal(await Order.countDocuments({
        user: { $in: [firstUser, secondUser] }
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

test("order cancellation restores stock once and refreshes the Product list", async () => {
    const userId = createUserId();
    const product = await createProduct({ name: "Cancel", stock: 3 });
    const order = await createOrder({
        userId,
        items: [{ product, quantity: 2, unitPrice: product.price }]
    });

    const before = await requestProducts();
    assert.equal(
        before.body.data.find(item => item._id === product._id.toString()).stock,
        3
    );

    const cancelled = await trackSessions(() =>
        updateOrderStatus({ orderId: order._id.toString(), status: "cancelled" })
    );
    assert.equal(cancelled.orderStatus, "cancelled");
    assert.ok(cancelled.stockReleasedAt);
    assert.equal((await Product.findById(product._id)).stock, 5);

    const afterCancellation = await requestProducts();
    assert.equal(
        afterCancellation.body.data.find(
            item => item._id === product._id.toString()
        ).stock,
        5
    );

    await assert.rejects(
        trackSessions(() => updateOrderStatus({
            orderId: order._id.toString(),
            status: "cancelled"
        })),
        error => error.statusCode === 400
    );
    assert.equal((await Product.findById(product._id)).stock, 5);
});

test("cancellation transaction rolls back prior stock restoration when a Product is missing", async () => {
    const userId = createUserId();
    const firstProduct = await createProduct({
        name: "Cancel Rollback First",
        stock: 3
    });
    const deletedProduct = await createProduct({
        name: "Cancel Rollback Missing",
        stock: 3
    });
    const order = await createOrder({
        userId,
        items: [
            { product: firstProduct, quantity: 2, unitPrice: firstProduct.price },
            { product: deletedProduct, quantity: 1, unitPrice: deletedProduct.price }
        ]
    });
    await assertSafeMongoTarget();
    await Product.deleteOne({ _id: deletedProduct._id });

    await assert.rejects(
        trackSessions(() => updateOrderStatus({
            orderId: order._id.toString(),
            status: "cancelled"
        })),
        error => error.statusCode === 409
    );

    assert.equal((await Product.findById(firstProduct._id)).stock, 3);
    const savedOrder = await Order.findById(order._id);
    assert.equal(savedOrder.orderStatus, "pending");
    assert.equal(savedOrder.stockReleasedAt, null);
});

test("failed-payment webhook restores stock once and refreshes the Product list", async () => {
    process.env.PAYMENT_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    const userId = createUserId();
    const product = await createProduct({ name: "Payment Failure", stock: 3 });
    const order = await createOrder({
        userId,
        items: [{ product, quantity: 2, unitPrice: product.price }]
    });
    await assertSafeMongoTarget();
    const [payment] = await Payment.create([{
        user: userId,
        order: order._id,
        amount: order.total,
        currency: "EGP",
        method: "card",
        provider: "stripe",
        status: "pending",
        refundedAmount: 0,
        refundStatus: "not_required",
        idempotencyKey: `payment:${new mongoose.Types.ObjectId()}`
    }]);
    ownedPaymentIds.add(payment._id);

    const before = await requestProducts();
    assert.equal(
        before.body.data.find(item => item._id === product._id.toString()).stock,
        3
    );

    const eventId = `failure:${new mongoose.Types.ObjectId()}`;
    const result = await trackSessions(() => paymentService.handleWebhook({
        receivedSecret: TEST_WEBHOOK_SECRET,
        eventId,
        type: "payment.failed",
        paymentId: payment._id.toString()
    }));
    assert.equal(result.status, "failed");
    assert.equal((await Product.findById(product._id)).stock, 5);
    const cancelledOrder = await Order.findById(order._id);
    assert.equal(cancelledOrder.paymentStatus, "failed");
    assert.equal(cancelledOrder.orderStatus, "cancelled");
    assert.ok(cancelledOrder.stockReleasedAt);

    const afterFailure = await requestProducts();
    assert.equal(
        afterFailure.body.data.find(
            item => item._id === product._id.toString()
        ).stock,
        5
    );

    await trackSessions(() => paymentService.handleWebhook({
        receivedSecret: TEST_WEBHOOK_SECRET,
        eventId,
        type: "payment.failed",
        paymentId: payment._id.toString()
    }));
    assert.equal((await Product.findById(product._id)).stock, 5);
});

test("legacy purchase rejects insufficient stock without changing stock or cache", async () => {
    const userId = createUserId();
    const product = await createProduct({ name: "Insufficient Legacy", stock: 1 });
    const before = await requestProducts();
    assert.equal(
        before.body.data.find(item => item._id === product._id.toString()).stock,
        1
    );
    const cacheGeneration = productListCache.getGeneration();
    const response = createResponse();

    await trackSessions(() => purchaseController.addPurchase(
        createRequest(userId, {
            product: product._id.toString(),
            quantity: 2
        }),
        response
    ));

    assert.equal(response.statusCode, 409);
    assert.equal((await Product.findById(product._id)).stock, 1);
    assert.equal(await Purchase.countDocuments({ user: userId }), 0);
    assert.equal(productListCache.getGeneration(), cacheGeneration);
    const after = await requestProducts();
    assert.equal(
        after.body.data.find(item => item._id === product._id.toString()).stock,
        1
    );
});

test("legacy purchase returns 404 for unavailable products without creating a record", async () => {
    const userId = createUserId();
    const inactiveProduct = await createProduct({
        name: "Inactive Legacy",
        stock: 2,
        isActive: false
    });
    const missingProductId = new mongoose.Types.ObjectId();
    const cacheGeneration = productListCache.getGeneration();

    for (const productId of [inactiveProduct._id, missingProductId]) {
        const response = createResponse();
        await trackSessions(() => purchaseController.addPurchase(
            createRequest(userId, {
                product: productId.toString(),
                quantity: 1
            }),
            response
        ));
        assert.equal(response.statusCode, 404);
        assert.deepEqual(response.body, {
            error: "Product not found or unavailable"
        });
    }

    assert.equal((await Product.findById(inactiveProduct._id)).stock, 2);
    assert.equal(await Purchase.countDocuments({ user: userId }), 0);
    assert.equal(productListCache.getGeneration(), cacheGeneration);
});

test("successful legacy purchase commits once and invalidates cache after commit", async () => {
    const userId = createUserId();
    const product = await createProduct({ name: "Legacy Success", stock: 4 });
    const before = await requestProducts();
    assert.equal(
        before.body.data.find(item => item._id === product._id.toString()).stock,
        4
    );
    const cacheGeneration = productListCache.getGeneration();
    const originalCreate = Purchase.create;
    const originalInvalidate = productListCache.invalidate;
    let invalidationCount = 0;
    Purchase.create = async function (...args) {
        assert.equal(productListCache.getGeneration(), cacheGeneration);
        return originalCreate.apply(this, args);
    };
    productListCache.invalidate = (...args) => {
        invalidationCount += 1;
        return originalInvalidate(...args);
    };

    try {
        const response = createResponse();
        await trackSessions(() => purchaseController.addPurchase(
            createRequest(userId, {
                product: product._id.toString(),
                quantity: 1
            }),
            response
        ));
        assert.equal(response.statusCode, 201);
        ownedPurchaseIds.add(response.body.data._id);
        assert.equal(await Purchase.countDocuments({ user: userId }), 1);
        assert.equal((await Product.findById(product._id)).stock, 3);
        assert.notEqual(productListCache.getGeneration(), cacheGeneration);
        assert.equal(invalidationCount, 1);

        const afterPurchase = await requestProducts();
        assert.equal(
            afterPurchase.body.data.find(
                item => item._id === product._id.toString()
            ).stock,
            3
        );
        assert.equal((await Product.findById(product._id)).stock, 3);
    } finally {
        Purchase.create = originalCreate;
        productListCache.invalidate = originalInvalidate;
    }
});

test("legacy purchase persistence failure rolls stock back without compensation", async () => {
    const userId = createUserId();
    const product = await createProduct({ name: "Legacy Compensation", stock: 3 });
    const before = await requestProducts();
    assert.equal(
        before.body.data.find(item => item._id === product._id.toString()).stock,
        3
    );
    const cacheGeneration = productListCache.getGeneration();
    const originalCreate = Purchase.create;
    const originalUpdateOne = Product.updateOne;
    let compensationAttempts = 0;
    Purchase.create = async () => {
        throw new Error("Injected purchase persistence failure");
    };
    Product.updateOne = async (...args) => {
        compensationAttempts += 1;
        return originalUpdateOne.apply(Product, args);
    };

    try {
        const response = createResponse();
        await trackSessions(() => purchaseController.addPurchase(
            createRequest(userId, {
                product: product._id.toString(),
                quantity: 2
            }),
            response
        ));
        assert.equal(response.statusCode, 500);
        assert.deepEqual(response.body, {
            error: "Error creating purchase",
            message: "An unexpected error occurred"
        });
    } finally {
        Purchase.create = originalCreate;
        Product.updateOne = originalUpdateOne;
    }

    assert.equal(compensationAttempts, 0);
    assert.equal((await Product.findById(product._id)).stock, 3);
    assert.equal(await Purchase.countDocuments({ user: userId }), 0);
    assert.equal(productListCache.getGeneration(), cacheGeneration);
    const afterRollback = await requestProducts();
    assert.equal(
        afterRollback.body.data.find(
            item => item._id === product._id.toString()
        ).stock,
        3
    );
});

test("legacy response-read failure leaves persisted Purchase stock deducted", async () => {
    const userId = createUserId();
    const product = await createProduct({ name: "Legacy Read Failure", stock: 3 });
    const before = await requestProducts();
    assert.equal(
        before.body.data.find(item => item._id === product._id.toString()).stock,
        3
    );
    const cacheGeneration = productListCache.getGeneration();
    const originalFindById = Purchase.findById;
    const originalInvalidate = productListCache.invalidate;
    let invalidationCount = 0;
    Purchase.findById = () => ({
        populate() {
            return Promise.reject(new Error("Injected response read failure"));
        }
    });
    productListCache.invalidate = (...args) => {
        invalidationCount += 1;
        return originalInvalidate(...args);
    };

    try {
        const response = createResponse();
        await trackSessions(() => purchaseController.addPurchase(
            createRequest(userId, {
                product: product._id.toString(),
                quantity: 2
            }),
            response
        ));
        assert.equal(response.statusCode, 500);
        assert.deepEqual(response.body, {
            error: "Error creating purchase",
            message: "An unexpected error occurred"
        });
    } finally {
        Purchase.findById = originalFindById;
        productListCache.invalidate = originalInvalidate;
    }

    assert.equal((await Product.findById(product._id)).stock, 1);
    assert.notEqual(productListCache.getGeneration(), cacheGeneration);
    assert.equal(invalidationCount, 1);
    const savedPurchases = await Purchase.find({ user: userId });
    assert.equal(savedPurchases.length, 1);
    assert.equal(savedPurchases[0].quantity, 2);
    ownedPurchaseIds.add(savedPurchases[0]._id);

    const afterReadFailure = await requestProducts();
    assert.equal(
        afterReadFailure.body.data.find(
            item => item._id === product._id.toString()
        ).stock,
        1
    );
});

test("concurrent legacy buyers cannot oversell or duplicate Purchases", async () => {
    const userId = createUserId();
    const product = await createProduct({ name: "Concurrent Legacy", stock: 5 });
    const responses = Array.from({ length: 3 }, createResponse);

    await trackSessions(() => Promise.all(responses.map(response =>
        purchaseController.addPurchase(
            createRequest(userId, {
                product: product._id.toString(),
                quantity: 4
            }),
            response
        )
    )));

    const successfulResponses = responses.filter(
        response => response.statusCode === 201
    );
    const rejectedResponses = responses.filter(
        response => response.statusCode === 409
    );
    assert.ok(successfulResponses.length >= 1);
    assert.ok(successfulResponses.length <= 1);
    assert.equal(rejectedResponses.length, responses.length - successfulResponses.length);

    const savedPurchases = await Purchase.find({ user: userId });
    for (const purchase of savedPurchases) {
        ownedPurchaseIds.add(purchase._id);
    }
    assert.equal(savedPurchases.length, successfulResponses.length);
    const purchasedQuantity = savedPurchases.reduce(
        (sum, purchase) => sum + purchase.quantity,
        0
    );
    const finalStock = (await Product.findById(product._id)).stock;
    assert.ok(finalStock >= 0);
    assert.equal(purchasedQuantity, 5 - finalStock);
    assert.equal(
        successfulResponses.reduce(
            (sum, response) => sum + response.body.data.quantity,
            0
        ),
        purchasedQuantity
    );
});
