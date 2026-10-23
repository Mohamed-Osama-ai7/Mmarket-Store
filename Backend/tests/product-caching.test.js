const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { afterEach, beforeEach, test } = require("node:test");
const mongoose = require("mongoose");
const Product = require("../model/product.model");
const Review = require("../model/review.model");
const Category = require("../model/category.model");
const Purchase = require("../model/purchase.model");
const Order = require("../model/order.model");
const Payment = require("../model/payment.model");
const Cart = require("../model/cart.model");
const productController = require("../controller/product.controller");
const categoryController = require("../controller/category.controller");
const purchaseController = require("../controller/purchase.controller");
const orderService = require("../service/order.service");
const productListCache = require("../utilities/productListCache");
const cache = require("../utilities/cache");
const logger = require("../utilities/logger");

const objectId = "64b000000000000000000001";

const makeProducts = count => Array.from({ length: count }, (_, index) => ({
    _id: `product-${index + 1}`,
    isActive: true,
    createdAt: new Date(Date.UTC(2026, 0, index + 1)),
    category: {
        name: "Category",
        slug: "category"
    }
}));

const invoke = async (handler, {
    query = {},
    params = {},
    body = {},
    file,
    user
} = {}) => {
    let statusCode;
    let responseBody;
    let forwardedError;
    const req = {
        query,
        params,
        body,
        file,
        user,
        id: "test-request",
        method: "GET"
    };
    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(bodyValue) {
            responseBody = bodyValue;
            return this;
        }
    };

    await handler(req, res, error => {
        forwardedError = error;
    });
    return {
        statusCode,
        body: responseBody,
        error: forwardedError
    };
};

const withListQueries = async (products, callback, state = {}) => {
    const originalFind = Product.find;
    const originalCountDocuments = Product.countDocuments;
    const originalReviewAggregate = Review.aggregate;
    state.findCount = 0;
    state.countCount = 0;

    Product.find = filter => {
        state.findCount += 1;
        const query = {
            populate() {
                return query;
            },
            sort() {
                return query;
            },
            skip(skip) {
                query.offset = skip;
                return query;
            },
            limit(limit) {
                query.pageSize = limit;
                return query;
            },
            lean() {
                if (state.findError) {
                    return Promise.reject(state.findError);
                }
                return Promise.resolve(
                    products
                        .filter(product => product.isActive === filter.isActive)
                        .sort((left, right) => right.createdAt - left.createdAt)
                        .slice(query.offset, query.offset + query.pageSize)
                );
            }
        };
        return query;
    };
    Review.aggregate = async () => [];
    Product.countDocuments = async filter => {
        state.countCount += 1;
        if (state.countError) {
            throw state.countError;
        }
        return products.filter(
            product => product.isActive === filter.isActive
        ).length;
    };

    try {
        await callback(state);
    } finally {
        Product.find = originalFind;
        Product.countDocuments = originalCountDocuments;
        Review.aggregate = originalReviewAggregate;
    }
};

beforeEach(() => cache.flushAll());
afterEach(() => cache.flushAll());

test("cache lifetime and entry count are bounded", () => {
    assert.equal(cache.options.maxKeys, 1000);
    assert.ok(cache.options.stdTTL >= 1);
    assert.ok(cache.options.stdTTL <= 86400);
});

test("first list request queries the database and repeated normalized requests hit cache", async () => {
    await withListQueries(makeProducts(4), async state => {
        const first = await invoke(productController.getProducts);
        const repeated = await invoke(productController.getProducts, {
            query: {
                page: "1",
                pageSize: "10"
            }
        });

        assert.equal(first.statusCode, 200);
        assert.deepEqual(repeated, first);
        assert.deepEqual(Object.keys(repeated.body).sort(), [
            "data",
            "message",
            "pagination"
        ]);
        assert.deepEqual(repeated.body.pagination, {
            page: 1,
            pageSize: 10,
            totalItems: 4,
            totalPages: 1
        });
        assert.equal(state.findCount, 1);
        assert.equal(state.countCount, 1);
    });
});

test("pages and page sizes have independent cache entries", async () => {
    await withListQueries(makeProducts(6), async state => {
        const firstPage = await invoke(productController.getProducts, {
            query: { page: "1", pageSize: "2" }
        });
        const secondPage = await invoke(productController.getProducts, {
            query: { page: "2", pageSize: "2" }
        });
        const differentSize = await invoke(productController.getProducts, {
            query: { page: "1", pageSize: "3" }
        });
        const firstPageAgain = await invoke(productController.getProducts, {
            query: { page: "1", pageSize: "2" }
        });

        assert.notDeepEqual(firstPage.body.data, secondPage.body.data);
        assert.equal(firstPage.body.pagination.pageSize, 2);
        assert.equal(differentSize.body.pagination.pageSize, 3);
        assert.deepEqual(firstPageAgain, firstPage);
        assert.equal(state.findCount, 3);
        assert.equal(state.countCount, 3);
    });
});

test("invalid requests do not access cache or database", async () => {
    const originalGet = productListCache.get;
    const originalSet = productListCache.set;
    const calls = { get: 0, set: 0 };
    productListCache.get = () => {
        calls.get += 1;
        return undefined;
    };
    productListCache.set = () => {
        calls.set += 1;
    };

    try {
        await withListQueries(makeProducts(1), async state => {
            const response = await invoke(productController.getProducts, {
                query: {
                    page: ["1", "2"]
                }
            });
            assert.equal(response.statusCode, 400);
            assert.equal(state.findCount, 0);
            assert.equal(state.countCount, 0);
            assert.deepEqual(calls, { get: 0, set: 0 });
        });
    } finally {
        productListCache.get = originalGet;
        productListCache.set = originalSet;
    }
});

test("database failures are not cached", async () => {
    const originalLogError = logger.logError;
    logger.logError = () => {};

    await withListQueries(makeProducts(1), async state => {
        try {
            state.countError = new Error("database failure");
            const failed = await invoke(productController.getProducts);
            assert.equal(failed.statusCode, 500);

            state.countError = undefined;
            const recovered = await invoke(productController.getProducts);
            assert.equal(recovered.statusCode, 200);
            assert.equal(state.findCount, 2);
            assert.equal(state.countCount, 2);
        } finally {
            logger.logError = originalLogError;
        }
    });
});

test("a list query started before invalidation cannot repopulate stale results", async () => {
    const originalFind = Product.find;
    const originalCountDocuments = Product.countDocuments;
    const originalReviewAggregate = Review.aggregate;
    let finishFirstQuery;
    let findCount = 0;

    Product.find = () => {
        findCount += 1;
        const query = {
            populate() {
                return query;
            },
            sort() {
                return query;
            },
            skip() {
                return query;
            },
            limit() {
                return query;
            },
            lean() {
                if (findCount === 1) {
                    return new Promise(resolve => {
                        finishFirstQuery = resolve;
                    });
                }
                return Promise.resolve([{ _id: "fresh-product" }]);
            }
        };
        return query;
    };
    Product.countDocuments = async () => 1;
    Review.aggregate = async () => [];

    try {
        const pendingResponse = invoke(productController.getProducts);
        while (!finishFirstQuery) {
            await new Promise(resolve => setImmediate(resolve));
        }

        productListCache.invalidate();
        finishFirstQuery([{ _id: "stale-product" }]);
        const staleResponse = await pendingResponse;
        assert.equal(staleResponse.body.data[0]._id, "stale-product");
        assert.equal(productListCache.get(1, 10), undefined);

        const freshResponse = await invoke(productController.getProducts);
        assert.equal(freshResponse.body.data[0]._id, "fresh-product");
        assert.equal(findCount, 2);
        assert.equal(productListCache.get(1, 10).data[0]._id, "fresh-product");
    } finally {
        Product.find = originalFind;
        Product.countDocuments = originalCountDocuments;
        Review.aggregate = originalReviewAggregate;
    }
});

test("cache failures do not expose internal details or fail the list response", async () => {
    const originals = {
        get: productListCache.get,
        set: productListCache.set,
        logError: logger.logError
    };

    try {
        productListCache.get = () => {
            throw new Error("private cache detail");
        };
        productListCache.set = () => {
            throw new Error("private cache detail");
        };
        logger.logError = () => {};

        await withListQueries(makeProducts(2), async state => {
            const response = await invoke(productController.getProducts);
            assert.equal(response.statusCode, 200);
            assert.equal(response.body.message, "Products list");
            assert.equal(JSON.stringify(response.body).includes("private"), false);
            assert.equal(state.findCount, 1);
            assert.equal(state.countCount, 1);
        });
    } finally {
        productListCache.get = originals.get;
        productListCache.set = originals.set;
        logger.logError = originals.logError;
    }
});

test("configured TTL expires list entries", () => {
    const script = [
        'const listCache = require("./utilities/productListCache");',
        'listCache.set(1, 10, { message: "Products list" });',
        "setTimeout(() => {",
        '  process.stdout.write(String(listCache.get(1, 10) === undefined));',
        "}, 1100);"
    ].join("\n");
    const result = spawnSync(process.execPath, ["-e", script], {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 5000,
        env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            PRODUCT_LIST_CACHE_TTL_SECONDS: "1"
        }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "true");
});

test("payment-failure stock restoration invalidates only after a successful write", () => {
    const script = `
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Payment = require("./model/payment.model");
const Order = require("./model/order.model");
const Product = require("./model/product.model");
const listCache = require("./utilities/productListCache");
const paymentService = require("./service/payment.service");
const id = "64b000000000000000000001";
const session = {
    withTransaction: callback => callback(),
    endSession: async () => {}
};
const payment = {
    _id: id,
    order: id,
    method: "card",
    status: "processing",
    async save() {}
};
const order = {
    _id: id,
    paymentStatus: "pending",
    orderStatus: "pending",
    stockReleasedAt: null,
    items: [{ product: id, quantity: 1, name: "Product" }]
};
mongoose.startSession = async () => session;
Payment.findOne = () => ({ session: async () => null });
Payment.findById = () => ({ session: async () => payment });
Order.findById = () => ({ session: async () => order });
Order.updateOne = async () => ({ matchedCount: 1 });
Product.updateOne = async () => ({ matchedCount: 1 });

(async () => {
    listCache.set(1, 10, { stale: true });
    await paymentService.handleWebhook({
        receivedSecret: "cache-test-secret",
        eventId: "cache-event",
        type: "payment.failed",
        paymentId: id
    });
    assert.equal(listCache.get(1, 10), undefined);

    payment.status = "processing";
    Product.updateOne = async () => ({ matchedCount: 0 });
    listCache.set(1, 10, { stale: true });
    await assert.rejects(paymentService.handleWebhook({
        receivedSecret: "cache-test-secret",
        eventId: "failed-cache-event",
        type: "payment.failed",
        paymentId: id
    }));
    assert.deepEqual(listCache.get(1, 10), { stale: true });
    process.stdout.write("PASS");
})().catch(error => {
    process.stderr.write(error.stack);
    process.exitCode = 1;
});
`;
    const result = spawnSync(process.execPath, ["-e", script], {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 5000,
        env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            PRODUCT_LIST_CACHE_TTL_SECONDS: "60",
            PAYMENT_WEBHOOK_SECRET: "cache-test-secret"
        }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "PASS");
});

test("successful Product create, update, and soft delete invalidate list entries", async () => {
    const originals = {
        productCreate: Product.create,
        productFindById: Product.findById,
        categoryFindOne: Category.findOne
    };
    const category = { _id: objectId };
    const doc = {
        _id: objectId,
        isActive: true,
        async save() {
            return this;
        }
    };
    const makePopulatedQuery = () => ({
        populate() {
            return this;
        },
        lean() {
            return Promise.resolve({ _id: objectId });
        }
    });

    try {
        Category.findOne = () => ({
            select: async () => category
        });
        Product.create = async () => ({ _id: objectId });
        Product.findById = () => makePopulatedQuery();

        productListCache.set(1, 10, { stale: true });
        const created = await invoke(productController.addProduct, {
            body: {
                name: "Created",
                price: "10",
                desc: "Product",
                stock: "2",
                category: objectId
            },
            file: { filename: "product.jpg" }
        });
        assert.equal(created.statusCode, 201);
        assert.equal(productListCache.get(1, 10), undefined);

        let updateLookup = 0;
        Product.findById = () => {
            updateLookup += 1;
            return updateLookup === 1 ? doc : makePopulatedQuery();
        };
        productListCache.set(1, 10, { stale: true });
        const updated = await invoke(productController.updateProduct, {
            params: { id: objectId },
            body: { stock: "3" }
        });
        assert.equal(updated.statusCode, 200);
        assert.equal(productListCache.get(1, 10), undefined);

        Product.findById = async () => doc;
        productListCache.set(1, 10, { stale: true });
        const deleted = await invoke(productController.deleteProduct, {
            params: { id: objectId }
        });
        assert.equal(deleted.statusCode, 200);
        assert.equal(productListCache.get(1, 10), undefined);
    } finally {
        Product.create = originals.productCreate;
        Product.findById = originals.productFindById;
        Category.findOne = originals.categoryFindOne;
    }
});

test("a successful Product create refreshes the cached list response", async () => {
    const originalCreate = Product.create;
    const originalFindById = Product.findById;
    const originalCategoryFindOne = Category.findOne;
    const products = makeProducts(2);

    try {
        await withListQueries(products, async state => {
            Category.findOne = () => ({
                select: async () => ({ _id: objectId })
            });
            Product.create = async productData => {
                products.push({
                    ...productData,
                    _id: "created-product",
                    isActive: true,
                    createdAt: new Date(Date.UTC(2026, 0, 4)),
                    category: {
                        name: "Category",
                        slug: "category"
                    }
                });
                return { _id: "created-product" };
            };
            Product.findById = () => ({
                populate() {
                    return this;
                },
                lean: async () => ({ _id: "created-product" })
            });

            const beforeCreate = await invoke(productController.getProducts);
            assert.equal(beforeCreate.body.data.length, 2);

            const created = await invoke(productController.addProduct, {
                body: {
                    name: "Created",
                    price: "10",
                    desc: "Product",
                    category: objectId
                },
                file: { filename: "product.jpg" }
            });
            assert.equal(created.statusCode, 201);

            const afterCreate = await invoke(productController.getProducts);
            assert.equal(afterCreate.body.data.length, 3);
            assert.equal(state.findCount, 2);
            assert.equal(state.countCount, 2);
        });
    } finally {
        Product.create = originalCreate;
        Product.findById = originalFindById;
        Category.findOne = originalCategoryFindOne;
    }
});

test("failed Product writes do not invalidate list entries", async () => {
    const originalCreate = Product.create;
    const originalFindById = Product.findById;
    const originalCategoryFindOne = Category.findOne;
    const originalLogError = logger.logError;

    try {
        logger.logError = () => {};
        Category.findOne = () => ({
            select: async () => ({ _id: objectId })
        });
        productListCache.set(1, 10, { stale: true });
        Product.create = async () => {
            throw new Error("write failed");
        };
        const createResponse = await invoke(productController.addProduct, {
            body: {
                name: "Created",
                price: "10",
                desc: "Product",
                category: objectId
            },
            file: { filename: "product.jpg" }
        });
        assert.equal(createResponse.statusCode, 500);
        assert.deepEqual(productListCache.get(1, 10), { stale: true });

        Product.findById = async () => ({
            _id: objectId,
            isActive: true,
            async save() {
                throw new Error("write failed");
            }
        });
        const updateResponse = await invoke(productController.updateProduct, {
            params: { id: objectId },
            body: { stock: "3" }
        });
        assert.equal(updateResponse.statusCode, 500);
        assert.deepEqual(productListCache.get(1, 10), { stale: true });
    } finally {
        Product.create = originalCreate;
        Product.findById = originalFindById;
        Category.findOne = originalCategoryFindOne;
        logger.logError = originalLogError;
    }
});

test("successful category updates and stock purchases invalidate list entries", async () => {
    const originals = {
        categoryFindById: Category.findById,
        categoryFindOne: Category.findOne,
        productFindOneAndUpdate: Product.findOneAndUpdate,
        purchaseCreate: Purchase.create,
        purchaseFindById: Purchase.findById,
        startSession: mongoose.startSession,
        invalidate: productListCache.invalidate
    };
    let committedStock = 2;
    let transactionStock;
    let transactionActive = false;
    let transactionCommitted = false;
    let sessionEnded = false;
    let stockDecrementedInTransaction = false;
    let purchaseCreatedInTransaction = false;
    let purchaseInvalidatedAfterCommit = false;
    const session = {
        async withTransaction(callback) {
            transactionStock = committedStock;
            transactionActive = true;
            try {
                await callback();
                committedStock = transactionStock;
                transactionCommitted = true;
            } finally {
                transactionActive = false;
            }
        },
        async endSession() {
            sessionEnded = true;
        }
    };

    try {
        Category.findById = async () => ({
            _id: objectId,
            async save() {
                return this;
            }
        });
        Category.findOne = async () => null;
        productListCache.set(1, 10, { stale: true });
        const categoryUpdated = await invoke(categoryController.updateCategory, {
            params: { id: objectId },
            body: { name: "Renamed" }
        });
        assert.equal(categoryUpdated.statusCode, 200);
        assert.equal(productListCache.get(1, 10), undefined);

        mongoose.startSession = async () => session;
        Product.findOneAndUpdate = async (filter, update, options) => {
            assert.equal(transactionActive, true);
            assert.equal(options.session, session);
            assert.deepEqual(filter, {
                _id: objectId,
                isActive: true,
                stock: { $gte: 1 }
            });
            assert.deepEqual(update, {
                $inc: { stock: -1 }
            });
            transactionStock += update.$inc.stock;
            stockDecrementedInTransaction = true;
            return {
                _id: objectId,
                price: 10,
                stock: transactionStock
            };
        };
        Purchase.create = async (documents, options) => {
            assert.equal(transactionActive, true);
            assert.equal(options.session, session);
            assert.equal(documents.length, 1);
            assert.equal(documents[0].product, objectId);
            assert.equal(documents[0].quantity, 1);
            purchaseCreatedInTransaction = true;
            return [{ _id: objectId }];
        };
        Purchase.findById = () => ({
            populate() {
                return Promise.resolve({ _id: objectId });
            }
        });
        productListCache.invalidate = (...args) => {
            if (transactionCommitted) {
                purchaseInvalidatedAfterCommit = true;
            }
            return originals.invalidate(...args);
        };
        productListCache.set(1, 10, { stale: true });
        const purchase = await invoke(purchaseController.addPurchase, {
            body: { product: objectId, quantity: "1" },
            user: { id: objectId }
        });
        assert.equal(purchase.statusCode, 201);
        assert.equal(productListCache.get(1, 10), undefined);
        assert.equal(committedStock, 1);
        assert.equal(stockDecrementedInTransaction, true);
        assert.equal(purchaseCreatedInTransaction, true);
        assert.equal(transactionCommitted, true);
        assert.equal(purchaseInvalidatedAfterCommit, true);
        assert.equal(sessionEnded, true);
    } finally {
        Category.findById = originals.categoryFindById;
        Category.findOne = originals.categoryFindOne;
        Product.findOneAndUpdate = originals.productFindOneAndUpdate;
        Purchase.create = originals.purchaseCreate;
        Purchase.findById = originals.purchaseFindById;
        mongoose.startSession = originals.startSession;
        productListCache.invalidate = originals.invalidate;
    }
});

test("category name updates refresh the populated fields in the Product list", async () => {
    const originalFindById = Category.findById;
    const originalFindOne = Category.findOne;
    const products = makeProducts(1);

    try {
        await withListQueries(products, async state => {
            Category.findById = async () => ({
                name: "Category",
                async save() {
                    products[0].category.name = this.name;
                    return this;
                }
            });
            Category.findOne = async () => null;

            const beforeUpdate = await invoke(productController.getProducts);
            assert.equal(beforeUpdate.body.data[0].category.name, "Category");

            const updated = await invoke(categoryController.updateCategory, {
                params: { id: objectId },
                body: { name: "Renamed" }
            });
            assert.equal(updated.statusCode, 200);

            const afterUpdate = await invoke(productController.getProducts);
            assert.equal(afterUpdate.body.data[0].category.name, "Renamed");
            assert.equal(state.findCount, 2);
            assert.equal(state.countCount, 2);
        });
    } finally {
        Category.findById = originalFindById;
        Category.findOne = originalFindOne;
    }
});

test("failed Purchase transaction rolls back stock and preserves committed cache", async () => {
    const originals = {
        productFindOneAndUpdate: Product.findOneAndUpdate,
        productFind: Product.find,
        productCountDocuments: Product.countDocuments,
        purchaseCreate: Purchase.create,
        logError: logger.logError,
        startSession: mongoose.startSession,
        invalidate: productListCache.invalidate
    };
    const products = [{
        _id: objectId,
        isActive: true,
        stock: 2,
        createdAt: new Date(),
        category: null
    }];
    let committedStock = 2;
    let transactionStock;
    let transactionActive = false;
    let transactionCommitted = false;
    let sessionEnded = false;
    let committedPurchases = [];
    let transactionPurchases;
    let purchaseAttemptedInTransaction = false;
    let invalidationCount = 0;
    let findCount = 0;
    const session = {
        async withTransaction(callback) {
            transactionStock = committedStock;
            transactionPurchases = [];
            transactionActive = true;
            try {
                await callback();
                committedStock = transactionStock;
                committedPurchases.push(...transactionPurchases);
                transactionCommitted = true;
            } catch (error) {
                transactionStock = undefined;
                transactionPurchases = undefined;
                throw error;
            } finally {
                transactionActive = false;
            }
        },
        async endSession() {
            sessionEnded = true;
        }
    };

    Product.find = filter => {
        findCount += 1;
        const query = {
            populate() {
                return query;
            },
            sort() {
                return query;
            },
            skip() {
                return query;
            },
            limit() {
                return query;
            },
            lean() {
                return Promise.resolve(products.filter(
                    product => product.isActive === filter.isActive
                ).map(product => ({
                    ...product,
                    stock: committedStock
                })));
            }
        };
        return query;
    };
    Product.countDocuments = async () => products.length;

    try {
        logger.logError = () => {};
        mongoose.startSession = async () => session;
        Product.findOneAndUpdate = async (filter, update, options) => {
            assert.equal(transactionActive, true);
            assert.equal(options.session, session);
            assert.equal(filter.stock.$gte, 1);
            assert.equal(update.$inc.stock, -1);
            transactionStock += update.$inc.stock;
            return {
                _id: objectId,
                price: 10,
                stock: transactionStock
            };
        };
        Purchase.create = async (documents, options) => {
            assert.equal(transactionActive, true);
            assert.equal(options.session, session);
            assert.equal(documents.length, 1);
            purchaseAttemptedInTransaction = true;
            transactionPurchases.push(...documents);
            const temporaryList = await invoke(productController.getProducts);
            assert.equal(temporaryList.body.data[0].stock, 2);
            throw new Error("purchase creation failed");
        };
        productListCache.invalidate = (...args) => {
            invalidationCount += 1;
            return originals.invalidate(...args);
        };
        committedPurchases = [];

        const cachedProducts = {
            message: "Products list",
            data: [{ stock: 2 }],
            pagination: {
                page: 1,
                pageSize: 10,
                totalItems: 1,
                totalPages: 1
            }
        };
        productListCache.set(1, 10, cachedProducts);
        const failedPurchase = await invoke(purchaseController.addPurchase, {
            body: { product: objectId, quantity: "1" },
            user: { id: objectId }
        });
        assert.equal(failedPurchase.statusCode, 500);
        assert.deepEqual(failedPurchase.body, {
            error: "Error creating purchase",
            message: "An unexpected error occurred"
        });
        assert.equal(purchaseAttemptedInTransaction, true);
        assert.equal(transactionCommitted, false);
        assert.equal(committedStock, 2);
        assert.equal(transactionStock, undefined);
        assert.equal(transactionPurchases, undefined);
        assert.deepEqual(committedPurchases, []);
        assert.equal(invalidationCount, 0);
        assert.deepEqual(productListCache.get(1, 10), cachedProducts);
        assert.equal(sessionEnded, true);

        const restoredList = await invoke(productController.getProducts);
        assert.equal(restoredList.body.data[0].stock, 2);
        assert.equal(findCount, 0);
    } finally {
        Product.findOneAndUpdate = originals.productFindOneAndUpdate;
        Product.find = originals.productFind;
        Product.countDocuments = originals.productCountDocuments;
        Purchase.create = originals.purchaseCreate;
        logger.logError = originals.logError;
        mongoose.startSession = originals.startSession;
        productListCache.invalidate = originals.invalidate;
    }
});

test("failed category updates do not invalidate list entries", async () => {
    const originalFindById = Category.findById;
    const originalFindOne = Category.findOne;
    const originalLogError = logger.logError;

    try {
        logger.logError = () => {};
        Category.findById = async () => ({
            _id: objectId,
            async save() {
                throw new Error("write failed");
            }
        });
        Category.findOne = async () => null;
        productListCache.set(1, 10, { stale: true });
        const response = await invoke(categoryController.updateCategory, {
            params: { id: objectId },
            body: { name: "Renamed" }
        });
        assert.equal(response.statusCode, undefined);
        assert.match(response.error.message, /write failed/);
        assert.deepEqual(productListCache.get(1, 10), { stale: true });
    } finally {
        Category.findById = originalFindById;
        Category.findOne = originalFindOne;
        logger.logError = originalLogError;
    }
});

test("committed order stock restoration invalidates the list; failed writes do not", async () => {
    const originals = {
        startSession: mongoose.startSession,
        orderFindById: Order.findById,
        productUpdateOne: Product.updateOne,
        paymentUpdateOne: Payment.updateOne,
        invalidate: productListCache.invalidate
    };
    let invalidationCount = 0;
    const session = {
        async withTransaction(callback) {
            return callback();
        },
        async endSession() {}
    };
    const makeOrder = () => ({
        orderStatus: "pending",
        paymentStatus: "pending",
        stockReleasedAt: null,
        items: [{
            product: objectId,
            quantity: 2,
            name: "Product"
        }],
        async save({ failSave } = {}) {
            if (failSave) {
                throw new Error("order transaction failed");
            }
            return this;
        }
    });

    try {
        mongoose.startSession = async () => session;
        Order.findById = () => ({
            session: async () => makeOrder()
        });
        Product.updateOne = async () => ({ matchedCount: 1 });
        Payment.updateOne = async () => ({ matchedCount: 0, modifiedCount: 0 });
        productListCache.invalidate = () => {
            invalidationCount += 1;
            originals.invalidate();
        };

        productListCache.set(1, 10, { stale: true });
        const cancelled = await orderService.updateOrderStatus({
            orderId: objectId,
            status: "cancelled"
        });
        assert.equal(cancelled.orderStatus, "cancelled");
        assert.equal(invalidationCount, 1);
        assert.equal(productListCache.get(1, 10), undefined);

        Product.updateOne = async () => ({ matchedCount: 0 });
        productListCache.set(1, 10, { stale: true });
        await assert.rejects(orderService.updateOrderStatus({
            orderId: objectId,
            status: "cancelled"
        }));
        assert.equal(invalidationCount, 1);
        assert.deepEqual(productListCache.get(1, 10), { stale: true });

        Order.findById = () => ({
            session: async () => ({
                ...makeOrder(),
                async save() {
                    throw new Error("order transaction failed");
                }
            })
        });
        Product.updateOne = async () => ({ matchedCount: 1 });
        await assert.rejects(orderService.updateOrderStatus({
            orderId: objectId,
            status: "cancelled"
        }), /order transaction failed/);
        assert.equal(invalidationCount, 1);
        assert.deepEqual(productListCache.get(1, 10), { stale: true });
    } finally {
        mongoose.startSession = originals.startSession;
        Order.findById = originals.orderFindById;
        Product.updateOne = originals.productUpdateOne;
        Payment.updateOne = originals.paymentUpdateOne;
        productListCache.invalidate = originals.invalidate;
    }
});

test("committed order checkout stock reservation invalidates the list", async () => {
    const originals = {
        startSession: mongoose.startSession,
        orderFindOne: Order.findOne,
        orderCreate: Order.create,
        orderFindById: Order.findById,
        cartFindOne: Cart.findOne,
        productFindOne: Product.findOne,
        productFindOneAndUpdate: Product.findOneAndUpdate,
        invalidate: productListCache.invalidate
    };
    let orderLookupCount = 0;
    let stockReservationFails = false;
    let invalidationCount = 0;
    const session = {
        async withTransaction(callback) {
            return callback();
        },
        async endSession() {}
    };
    const cart = {
        items: [{
            product: objectId,
            quantity: 1
        }],
        async save() {}
    };
    const product = {
        _id: objectId,
        name: "Product",
        slug: "product",
        price: 12
    };

    try {
        mongoose.startSession = async () => session;
        Order.findOne = () => {
            orderLookupCount += 1;
            return orderLookupCount === 1
                ? Promise.resolve(null)
                : { session: async () => null };
        };
        Order.create = async () => [{ _id: objectId }];
        Order.findById = async () => ({ _id: objectId });
        Cart.findOne = () => ({
            session: async () => cart
        });
        Product.findOne = () => ({
            session: async () => product
        });
        Product.findOneAndUpdate = async () => stockReservationFails
            ? null
            : product;
        productListCache.invalidate = () => {
            invalidationCount += 1;
            originals.invalidate();
        };

        productListCache.set(1, 10, { stale: true });
        const checkout = await orderService.checkoutCart({
            userId: objectId,
            idempotencyKey: "cache-test",
        });
        assert.equal(checkout.alreadyCreated, false);
        assert.equal(invalidationCount, 1);
        assert.equal(productListCache.get(1, 10), undefined);

        orderLookupCount = 0;
        stockReservationFails = true;
        cart.items = [{
            product: objectId,
            quantity: 1
        }];
        productListCache.set(1, 10, { stale: true });
        await assert.rejects(orderService.checkoutCart({
            userId: objectId,
            idempotencyKey: "failed-cache-test",
        }));
        assert.equal(invalidationCount, 1);
        assert.deepEqual(productListCache.get(1, 10), { stale: true });
    } finally {
        mongoose.startSession = originals.startSession;
        Order.findOne = originals.orderFindOne;
        Order.create = originals.orderCreate;
        Order.findById = originals.orderFindById;
        Cart.findOne = originals.cartFindOne;
        Product.findOne = originals.productFindOne;
        Product.findOneAndUpdate = originals.productFindOneAndUpdate;
        productListCache.invalidate = originals.invalidate;
    }
});
