// End-to-end HTTP workflows against the real Express app and a disposable, test-managed MongoDB replica set.
// Covers the frontend contracts: auth, cart, checkout (idempotent), ownership isolation, wishlist, notifications,
// cash-on-delivery payment, and the admin refund lifecycle (including the providerRefundId completion reference).
const assert = require("node:assert/strict");
const { randomBytes, randomUUID } = require("node:crypto");
const { after, before, test } = require("node:test");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const LOOPBACK = "127.0.0.1";
const PASSWORD = "Str0ng!Passw0rd#1";
const DELIVERY = { name: "Test Customer", phone: "+20 100 000 0000", address: "12 Test Street, Cairo" };

let replicaSet, mongoose, server, baseUrl, Product, Category, User;

const api = async (method, path, { token, body, headers = {} } = {}) => {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
        method,
        headers: {
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, body: json };
};

const register = async tag => {
    const email = `${tag}-${randomBytes(4).toString("hex")}@example.com`;
    const created = await api("POST", "/user", { body: { name: `Test ${tag}`, email, password: PASSWORD } });
    assert.equal(created.status, 201);
    const login = await api("POST", "/auth/login", { body: { email, password: PASSWORD } });
    assert.equal(login.status, 200);
    return { email, token: login.body.token, id: login.body.data._id };
};

before(async () => {
    replicaSet = await MongoMemoryReplSet.create({ replSet: { name: "api-wf-rs", count: 1 }, instanceOpts: [{ ip: LOOPBACK }] });
    const databaseName = `api_wf_it_${randomBytes(8).toString("hex")}`;
    Object.assign(process.env, {
        MONGO_URI: `mongodb://${LOOPBACK}:${replicaSet.servers[0].instanceInfo.port}/${databaseName}?replicaSet=api-wf-rs`,
        JWT_SECRET: randomBytes(32).toString("hex"),
        JWT_EXPIRES_IN: "1h",
        ALLOWED_ORIGINS: "http://localhost:4200",
        DUMMY_PASSWORD_HASH: "$2b$12$HrcL.PN5mx6kmCl22zS71eodMVI2A3iYLafBfkmFC0rBgFIgs/fgy",
        PAYMENT_PROVIDER: "manual",
        RESET_EMAIL_MODE: "console"
    });
    mongoose = require("mongoose");
    await mongoose.connect(process.env.MONGO_URI);
    assert.equal(mongoose.connection.name, databaseName);
    Product = require("../model/product.model");
    Category = require("../model/category.model");
    User = require("../model/user.model");
    const app = require("../app");
    server = await new Promise(resolve => { const s = app.listen(0, LOOPBACK, () => resolve(s)); });
    baseUrl = `http://${LOOPBACK}:${server.address().port}`;
});

after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (mongoose) await mongoose.disconnect();
    if (replicaSet) await replicaSet.stop();
});

test("shopping, ownership isolation, COD payment and refund lifecycle work through the HTTP API", async () => {
    const category = await Category.create({ name: `Workflow ${randomBytes(3).toString("hex")}` });
    const product = await Product.create({ name: `Workflow Tee ${randomBytes(3).toString("hex")}`, price: 250, desc: "Workflow fixture product", stock: 10, imgURL: "fixture-image", category: category._id });

    const alice = await register("alice");
    const bob = await register("bob");

    // Authentication is enforced.
    assert.equal((await api("GET", "/cart")).status, 401);
    assert.equal((await api("GET", "/cart", { token: "not.a.jwt" })).status, 401);

    // Catalogue search and detail.
    const search = await api("GET", `/product?search=${encodeURIComponent("Workflow Tee")}`);
    assert.equal(search.status, 200);
    assert.ok(search.body.data.some(item => item._id === String(product._id)));
    assert.equal((await api("GET", "/product/definitely-not-a-product")).status, 404);

    // Cart validation and server-side pricing (client-supplied price must be ignored).
    assert.equal((await api("POST", "/cart", { token: alice.token, body: { product: String(product._id), quantity: 0 } })).status, 400);
    assert.equal((await api("POST", "/cart", { token: alice.token, body: { product: String(product._id), quantity: 999 } })).status, 400);
    assert.equal((await api("POST", "/cart", { token: alice.token, body: { product: String(product._id), quantity: 2, price: 1 } })).status < 300, true);

    // Wishlist persistence and isolation.
    assert.equal((await api("POST", `/wishlist/${product._id}`, { token: alice.token })).status < 300, true);
    assert.equal((await api("GET", "/wishlist", { token: alice.token })).body.data.products.length, 1);
    assert.equal((await api("GET", "/wishlist", { token: bob.token })).body.data.products.length, 0);

    // Checkout: idempotent, stock decremented once, cart emptied, total computed on the server.
    const key = randomUUID();
    const checkout = () => api("POST", "/order/checkout", { token: alice.token, headers: { "Idempotency-Key": key }, body: { deliveryDetails: DELIVERY, total: 1 } });
    const first = await checkout();
    assert.equal(first.status, 201);
    assert.equal(first.body.data.total, 500);
    const repeat = await checkout();
    assert.equal(repeat.body.data._id, first.body.data._id);
    assert.equal((await Product.findById(product._id).lean()).stock, 8);
    assert.equal((await api("GET", "/cart", { token: alice.token })).body.data?.items?.length || 0, 0);
    const orderId = first.body.data._id;

    // Ownership isolation for orders and notifications.
    assert.equal((await api("GET", `/order/${orderId}`, { token: alice.token })).status, 200);
    assert.ok([403, 404].includes((await api("GET", `/order/${orderId}`, { token: bob.token })).status));
    assert.ok([403, 404].includes((await api("PATCH", `/order/${orderId}/cancel`, { token: bob.token })).status));
    assert.equal((await api("GET", "/order", { token: bob.token })).body.data.length, 0);
    const aliceNotes = await api("GET", "/notifications", { token: alice.token });
    assert.ok(aliceNotes.body.unreadCount >= 1);
    assert.equal((await api("GET", "/notifications", { token: bob.token })).body.unreadCount, 0);
    const noteId = aliceNotes.body.data[0]._id;
    assert.ok([403, 404].includes((await api("PATCH", `/notifications/${noteId}/read`, { token: bob.token })).status));
    assert.equal((await api("PATCH", `/notifications/${noteId}/read`, { token: alice.token })).status, 200);

    // Cash on delivery payment; customers cannot perform admin actions.
    const payment = await api("POST", "/payment", { token: alice.token, headers: { "Idempotency-Key": randomUUID() }, body: { order: orderId, method: "cash_on_delivery" } });
    assert.equal(payment.status, 201);
    const paymentId = payment.body.data._id;
    assert.ok((await api("POST", "/payment", { token: bob.token, headers: { "Idempotency-Key": randomUUID() }, body: { order: orderId, method: "cash_on_delivery" } })).status >= 400);
    assert.equal((await api("PATCH", `/payment/${paymentId}/confirm-cash-on-delivery`, { token: alice.token })).status, 403);
    assert.equal((await api("GET", "/order/admin", { token: alice.token })).status, 403);
    assert.ok((await api("POST", "/refunds", { token: alice.token, headers: { "Idempotency-Key": randomUUID() }, body: { payment: paymentId, amount: 10, reason: "too early" } })).status >= 400);

    // Admin fulfils the order and confirms cash collection.
    const adminEmail = `admin-${randomBytes(4).toString("hex")}@example.com`;
    await User.create({ name: "Admin Tester", email: adminEmail, password: PASSWORD, role: "admin" });
    const admin = (await api("POST", "/auth/login", { body: { email: adminEmail, password: PASSWORD } })).body.token;
    assert.equal((await api("PATCH", `/order/${orderId}/status`, { token: admin, body: { status: "processing" } })).status, 200);
    assert.equal((await api("PATCH", `/payment/${paymentId}/confirm-cash-on-delivery`, { token: admin })).status, 200);

    // Refund request (owner only), idempotent, bounded by the paid amount.
    const refundKey = randomUUID();
    const requestRefund = () => api("POST", "/refunds", { token: alice.token, headers: { "Idempotency-Key": refundKey }, body: { payment: paymentId, amount: 500, reason: "Item did not fit" } });
    const refund = await requestRefund();
    assert.equal(refund.status, 201);
    assert.equal((await requestRefund()).body.data._id, refund.body.data._id);
    const refundId = refund.body.data._id;
    assert.ok((await api("POST", "/refunds", { token: alice.token, headers: { "Idempotency-Key": randomUUID() }, body: { payment: paymentId, amount: 5000, reason: "too much" } })).status >= 400);
    assert.ok((await api("POST", "/refunds", { token: bob.token, headers: { "Idempotency-Key": randomUUID() }, body: { payment: paymentId, amount: 1, reason: "not mine" } })).status >= 400);
    assert.ok([403, 404].includes((await api("GET", `/refunds/${refundId}`, { token: bob.token })).status));
    assert.equal((await api("PATCH", `/refunds/${refundId}/review`, { token: alice.token, body: { decision: "approve" } })).status, 403);

    // Admin lifecycle exactly as the Angular dashboard drives it; completion needs providerRefundId.
    assert.equal((await api("PATCH", `/refunds/${refundId}/review`, { token: admin, body: { decision: "approve", reviewNote: "ok" } })).status, 200);
    assert.equal((await api("PATCH", `/refunds/${refundId}/process`, { token: admin })).status, 200);
    assert.equal((await api("PATCH", `/refunds/${refundId}/complete`, { token: admin, body: {} })).status, 400);
    const completed = await api("PATCH", `/refunds/${refundId}/complete`, { token: admin, body: { providerRefundId: "COD-REF-1" } });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.data.status, "completed");
    assert.ok((await api("POST", "/refunds", { token: alice.token, headers: { "Idempotency-Key": randomUUID() }, body: { payment: paymentId, amount: 500, reason: "second" } })).status >= 400);

    // Logout invalidates the session.
    assert.equal((await api("POST", "/auth/logout", { token: bob.token })).status, 200);
    assert.equal((await api("GET", "/cart", { token: bob.token })).status, 401);
});
