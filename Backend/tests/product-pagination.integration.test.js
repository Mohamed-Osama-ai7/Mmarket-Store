const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { after, afterEach, before, test } = require("node:test");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const LOOPBACK = "127.0.0.1";
const REPLICA_SET_NAME = "mean-l2-product-test-rs";
const DATABASE_PREFIX = "mean_l2_product_it_";

let replicaSet;
let mongoose;
let Product;
let Category;
let productController;
let categoryController;
let cache;
let app;
let server;
let serverPort;
let databaseName;
let mongoAddress;
let commandListener;
let productIds = new Set();
let categoryIds = new Set();
const productCommands = [];

const assertSafeMongoTarget = async () => {
    assert.ok(databaseName, "test database name must be initialized");
    assert.match(databaseName, /^mean_l2_product_it_[a-f0-9]{16}$/);
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

const parseAndValidateMongoUri = uri => {
    const match = /^mongodb:\/\/127\.0\.0\.1:(\d+)\/(mean_l2_product_it_[a-f0-9]{16})\?replicaSet=mean-l2-product-test-rs$/.exec(uri);
    assert.ok(match, "generated URI must target one loopback test Replica Set");

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

const requestProducts = async query => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        for (const item of Array.isArray(value) ? value : [value]) {
            search.append(key, item);
        }
    }
    const response = await fetch(
        `http://${LOOPBACK}:${serverPort}/api/v1/product/${search.size ? `?${search}` : ""}`
    );

    return {
        status: response.status,
        body: await response.json()
    };
};

const createCategory = async name => {
    await assertSafeMongoTarget();
    const category = await Category.create({ name });
    categoryIds.add(category._id.toString());
    return category;
};

const createProduct = async ({
    name,
    category,
    price = 10,
    stock = 5,
    createdAt
}) => {
    await assertSafeMongoTarget();
    const product = await Product.create({
        name,
        price,
        desc: `Description for ${name}`,
        stock,
        imgURL: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
        category: category._id,
        ...(createdAt ? { createdAt, updatedAt: createdAt } : {})
    });
    productIds.add(product._id.toString());
    return product;
};

const cleanOwnedFixtures = async () => {
    if (!productIds.size && !categoryIds.size) {
        return;
    }

    await assertSafeMongoTarget();
    if (productIds.size) {
        await Product.deleteMany({
            _id: { $in: [...productIds] }
        });
        productIds.clear();
    }
    if (categoryIds.size) {
        await Category.deleteMany({
            _id: { $in: [...categoryIds] }
        });
        categoryIds.clear();
    }
};

const invokeController = async (handler, { params = {}, body = {}, file } = {}) => {
    let status;
    let responseBody;
    await handler(
        {
            params,
            body,
            file,
            id: "product-integration-test",
            method: "TEST"
        },
        {
            status(code) {
                status = code;
                return this;
            },
            json(value) {
                responseBody = value;
                return this;
            }
        }
    );
    return { status, body: responseBody };
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
        instanceOpts: [{
            ip: LOOPBACK,
            args: ["--setParameter", "enableTestCommands=1"]
        }]
    });

    const mongoUri = replicaSet.getUri(databaseName);
    mongoAddress = parseAndValidateMongoUri(mongoUri);
    const instanceInfo = replicaSet.servers[0].instanceInfo;
    assert.ok(instanceInfo, "test-managed MongoDB instance must be running");
    assert.equal(instanceInfo.ip, LOOPBACK);
    assert.equal(instanceInfo.port, mongoAddress.port);

    mongoose = require("mongoose");
    await mongoose.connect(mongoUri, {
        autoIndex: false,
        monitorCommands: true,
        retryReads: false,
        serverSelectionTimeoutMS: 5000
    });
    await assertSafeMongoTarget();

    app = require("../app");
    Product = require("../model/product.model");
    Category = require("../model/category.model");
    productController = require("../controller/product.controller");
    categoryController = require("../controller/category.controller");
    cache = require("../utilities/cache");

    commandListener = event => {
        if (
            event.databaseName === databaseName &&
            (
                event.command.find === "products" ||
                event.command.aggregate === "products"
            )
        ) {
            productCommands.push(event.commandName);
        }
    };
    mongoose.connection.client.on("commandStarted", commandListener);

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
    await cleanOwnedFixtures();
    productCommands.length = 0;
});

after(async () => {
    try {
        if (server) {
            await closeHttpServer(server);
        }
    } finally {
        try {
            if (commandListener && mongoose?.connection.client) {
                mongoose.connection.client.removeListener(
                    "commandStarted",
                    commandListener
                );
            }
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

test("HTTP pagination defaults, ordering, totals, and stable page boundaries", async () => {
    const category = await createCategory("Pagination Category");
    const expectedNames = [];

    for (let index = 1; index <= 12; index += 1) {
        const name = `Pagination Product ${index}`;
        expectedNames.unshift(name);
        await createProduct({
            name,
            category,
            createdAt: new Date(Date.UTC(2025, 0, index))
        });
    }

    const firstPage = await requestProducts({});
    assert.equal(firstPage.status, 200);
    assert.deepEqual(firstPage.body.pagination, {
        page: 1,
        pageSize: 10,
        totalItems: 12,
        totalPages: 2
    });
    assert.deepEqual(
        firstPage.body.data.map(product => product.name),
        expectedNames.slice(0, 10)
    );
    assert.equal(firstPage.body.data[0].category.name, "Pagination Category");

    const secondPage = await requestProducts({ page: "2" });
    assert.equal(secondPage.status, 200);
    assert.deepEqual(secondPage.body.pagination, {
        page: 2,
        pageSize: 10,
        totalItems: 12,
        totalPages: 2
    });
    assert.deepEqual(
        secondPage.body.data.map(product => product.name),
        expectedNames.slice(10)
    );
    assert.equal(
        new Set([
            ...firstPage.body.data.map(product => product._id),
            ...secondPage.body.data.map(product => product._id)
        ]).size,
        12
    );
});

test("HTTP list handles empty collections and pages beyond the available range", async () => {
    const empty = await requestProducts({});
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.data, []);
    assert.deepEqual(empty.body.pagination, {
        page: 1,
        pageSize: 10,
        totalItems: 0,
        totalPages: 0
    });

    const category = await createCategory("Out of Range Category");
    await createProduct({ name: "One Product", category });
    const outOfRange = await requestProducts({ page: "2", pageSize: "1" });
    assert.equal(outOfRange.status, 200);
    assert.deepEqual(outOfRange.body.data, []);
    assert.deepEqual(outOfRange.body.pagination, {
        page: 2,
        pageSize: 1,
        totalItems: 1,
        totalPages: 1
    });
});

test("HTTP cache hits avoid Product reads and normalized inputs share a cache entry", async () => {
    const category = await createCategory("Cache Category");
    await createProduct({ name: "Cached Product", category });
    productCommands.length = 0;

    const first = await requestProducts({});
    assert.equal(first.status, 200);
    assert.ok(productCommands.length >= 2);

    productCommands.length = 0;
    const repeated = await requestProducts({ page: "1", pageSize: "10" });
    assert.equal(repeated.status, 200);
    assert.deepEqual(repeated.body, first.body);
    assert.equal(productCommands.length, 0);

    const differentPage = await requestProducts({ page: "2", pageSize: "10" });
    assert.equal(differentPage.status, 200);
    assert.ok(productCommands.length >= 2);

    productCommands.length = 0;
    const differentPageSize = await requestProducts({ pageSize: "1" });
    assert.equal(differentPageSize.status, 200);
    assert.equal(differentPageSize.body.pagination.pageSize, 1);
    assert.ok(productCommands.length >= 2);

    productCommands.length = 0;
    const repeatedPageSize = await requestProducts({ pageSize: "1" });
    assert.equal(repeatedPageSize.status, 200);
    assert.deepEqual(repeatedPageSize.body, differentPageSize.body);
    assert.equal(productCommands.length, 0);
});

test("invalid pagination is rejected before any Product database command", async () => {
    productCommands.length = 0;
    const invalid = await requestProducts({ page: "1.5" });
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.body, {
        error: "page must be a positive integer"
    });
    assert.equal(productCommands.length, 0);

    const duplicate = await requestProducts({ page: ["1", "2"] });
    assert.equal(duplicate.status, 400);
    assert.equal(productCommands.length, 0);
});

test("failed MongoDB Product reads are not cached", async () => {
    await assertSafeMongoTarget();
    const category = await createCategory("Failed Read Category");
    await createProduct({ name: "Failed Read Product", category });
    productCommands.length = 0;

    const admin = mongoose.connection.db.admin();
    await admin.command({
        configureFailPoint: "failCommand",
        mode: { times: 1 },
        data: {
            failCommands: ["find"],
            errorCode: 2
        }
    });

    try {
        const failed = await requestProducts({});
        assert.equal(failed.status, 500);
        assert.deepEqual(failed.body, {
            error: "Error getting products"
        });
        assert.ok(productCommands.length >= 1);

        productCommands.length = 0;
        const retried = await requestProducts({});
        assert.equal(retried.status, 200);
        assert.equal(retried.body.data.length, 1);
        assert.ok(productCommands.length >= 2);
    } finally {
        await admin.command({
            configureFailPoint: "failCommand",
            mode: "off"
        });
    }
});

test("Product create, update, and soft delete refresh the observable HTTP list", async () => {
    const category = await createCategory("Mutation Category");
    const existing = await createProduct({
        name: "Existing Product",
        category,
        createdAt: new Date("2025-01-01T00:00:00.000Z")
    });

    const beforeCreate = await requestProducts({});
    assert.equal(beforeCreate.body.pagination.totalItems, 1);

    const created = await invokeController(productController.addProduct, {
        body: {
            name: "Controller Created Product",
            price: 14,
            desc: "Created through Product controller",
            stock: 3,
            category: category._id.toString()
        },
        file: { filename: "controller-created.png" }
    });
    assert.equal(created.status, 201);
    productIds.add(created.body.data._id);

    const afterCreate = await requestProducts({});
    assert.equal(afterCreate.body.pagination.totalItems, 2);
    assert.ok(afterCreate.body.data.some(
        product => product.name === "Controller Created Product"
    ));

    const updated = await invokeController(productController.updateProduct, {
        params: { id: created.body.data._id },
        body: { price: 28 }
    });
    assert.equal(updated.status, 200);
    const afterUpdate = await requestProducts({});
    const updatedProduct = afterUpdate.body.data.find(
        product => product.name === "Controller Created Product"
    );
    assert.ok(updatedProduct);
    assert.equal(updatedProduct.price, 28);

    const deleted = await invokeController(productController.deleteProduct, {
        params: { id: existing._id.toString() }
    });
    assert.equal(deleted.status, 200);
    const afterDelete = await requestProducts({});
    assert.equal(afterDelete.body.pagination.totalItems, 1);
    assert.ok(afterDelete.body.data.every(
        product => product._id !== existing._id.toString()
    ));
});

test("renaming a Category refreshes populated fields in the HTTP Product list", async () => {
    const category = await createCategory("Original Category");
    await createProduct({ name: "Category Population Product", category });

    const beforeRename = await requestProducts({});
    assert.equal(
        beforeRename.body.data[0].category.name,
        "Original Category"
    );

    const renamed = await invokeController(
        categoryController.updateCategory,
        {
            params: { id: category._id.toString() },
            body: { name: "Renamed Category" }
        }
    );
    assert.equal(renamed.status, 200);

    const afterRename = await requestProducts({});
    assert.equal(
        afterRename.body.data[0].category.name,
        "Renamed Category"
    );
});
