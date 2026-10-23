const assert = require("node:assert/strict");
const http = require("node:http");
const { afterEach, beforeEach, test } = require("node:test");
const express = require("express");
const Product = require("../model/product.model");
const Review = require("../model/review.model");
const cache = require("../utilities/cache");
const logger = require("../utilities/logger");
const productRouter = require("../route/product.route");

beforeEach(() => cache.flushAll());
afterEach(() => cache.flushAll());

const createProducts = count => Array.from({ length: count }, (_, index) => ({
    _id: `product-${index + 1}`,
    name: `Product ${index + 1}`,
    isActive: index !== 1,
    createdAt: new Date(Date.UTC(2026, 0, index + 1)),
    category: {
        name: `Category ${index + 1}`,
        slug: `category-${index + 1}`
    }
}));

const withProductStubs = async (products, callback, {
    countError
} = {}) => {
    const originalFind = Product.find;
    const originalCountDocuments = Product.countDocuments;
    const originalReviewAggregate = Review.aggregate;
    const calls = {
        filter: undefined,
        sort: undefined,
        skip: undefined,
        limit: undefined,
        populate: undefined,
        countFilter: undefined
    };

    Product.find = filter => {
        calls.filter = filter;
        const query = {
            populate(path, fields) {
                calls.populate = { path, fields };
                return query;
            },
            sort(sort) {
                calls.sort = sort;
                return query;
            },
            skip(skip) {
                calls.skip = skip;
                return query;
            },
            limit(limit) {
                calls.limit = limit;
                return query;
            },
            lean() {
                const matchingProducts = products
                    .filter(product => product.isActive === filter.isActive)
                    .sort((left, right) => right.createdAt - left.createdAt);
                return Promise.resolve(
                    matchingProducts
                        .slice(calls.skip, calls.skip + calls.limit)
                        .map(product => ({
                            ...product,
                            category: {
                                name: product.category.name,
                                slug: product.category.slug
                            }
                        }))
                );
            }
        };

        return query;
    };
    Review.aggregate = async () => [];
    Product.countDocuments = async filter => {
        calls.countFilter = filter;
        if (countError) {
            throw countError;
        }
        return products.filter(
            product => product.isActive === filter.isActive
        ).length;
    };

    try {
        await callback(calls);
    } finally {
        Product.find = originalFind;
        Product.countDocuments = originalCountDocuments;
        Review.aggregate = originalReviewAggregate;
    }
};

const createApp = () => {
    const app = express();
    app.use("/api/v1/product", productRouter);
    return app;
};

const get = (app, requestPath) => new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
        http.get({
            host: "127.0.0.1",
            port: server.address().port,
            path: requestPath
        }, response => {
            const chunks = [];
            response.on("data", chunk => chunks.push(chunk));
            response.on("end", () => {
                server.close(error => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve({
                        statusCode: response.statusCode,
                        body: JSON.parse(Buffer.concat(chunks).toString())
                    });
                });
            });
        }).on("error", error => {
            server.close(() => reject(error));
        });
    });
});

const assertPaginationError = async (query, pattern) => {
    await withProductStubs(createProducts(3), async calls => {
        const response = await get(createApp(), `/api/v1/product/${query}`);
        assert.equal(response.statusCode, 400);
        assert.deepEqual(response.body, {
            error: pattern
        });
        assert.equal(calls.filter, undefined);
        assert.equal(calls.countFilter, undefined);
    });
};

test("filter options endpoint is reachable before the dynamic product slug route", async () => {
    const originals = {
        distinct: Product.distinct,
        aggregate: Product.aggregate
    };
    try {
        Product.distinct = async (field, filter) => {
            assert.equal(field, "brand");
            assert.deepEqual(filter, { isActive: true, brand: { $nin: ["", null] } });
            return ["Northline", "Daily Form", "Northline"];
        };
        Product.aggregate = async pipeline => {
            assert.ok(pipeline.some(stage => stage.$unwind === "$variants"));
            return [{ sizes: ["M", "S"], colors: ["Olive", "Black"] }];
        };

        const response = await get(createApp(), "/api/v1/product/filters");
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.body.data, {
            brands: ["Daily Form", "Northline"],
            sizes: ["M", "S"],
            colors: ["Black", "Olive"]
        });
    } finally {
        Product.distinct = originals.distinct;
        Product.aggregate = originals.aggregate;
    }
});

test("default pagination preserves Product list fields and applies active filter and sort", async () => {
    const products = createProducts(12);

    await withProductStubs(products, async calls => {
        const response = await get(createApp(), "/api/v1/product/");
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.message, "Products list");
        assert.equal(response.body.data.length, 10);
        assert.deepEqual(
            response.body.data.map(product => product._id),
            [
                "product-12",
                "product-11",
                "product-10",
                "product-9",
                "product-8",
                "product-7",
                "product-6",
                "product-5",
                "product-4",
                "product-3"
            ]
        );
        assert.deepEqual(response.body.pagination, {
            page: 1,
            pageSize: 10,
            totalItems: 11,
            totalPages: 2
        });
        assert.deepEqual(calls.filter, { isActive: true });
        assert.deepEqual(calls.countFilter, { isActive: true });
        assert.deepEqual(calls.sort, { createdAt: -1, _id: 1 });
        assert.equal(calls.skip, 0);
        assert.equal(calls.limit, 10);
        assert.deepEqual(calls.populate, {
            path: "category",
            fields: "name slug"
        });
        assert.deepEqual(
            Object.keys(response.body).sort(),
            ["data", "message", "pagination"]
        );
    });
});

test("explicit page size returns the first page", async () => {
    await withProductStubs(createProducts(7), async () => {
        const response = await get(
            createApp(),
            "/api/v1/product/?page=1&pageSize=2"
        );
        assert.equal(response.statusCode, 200);
        assert.deepEqual(
            response.body.data.map(product => product._id),
            ["product-7", "product-6"]
        );
        assert.deepEqual(response.body.pagination, {
            page: 1,
            pageSize: 2,
            totalItems: 6,
            totalPages: 3
        });
    });
});

test("maximum supported page size is accepted", async () => {
    await withProductStubs(createProducts(105), async calls => {
        const response = await get(
            createApp(),
            "/api/v1/product/?pageSize=100"
        );
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.data.length, 100);
        assert.equal(response.body.pagination.pageSize, 100);
        assert.equal(response.body.pagination.totalItems, 104);
        assert.equal(calls.limit, 100);
    });
});

test("middle and last pages return only their requested records", async () => {
    await withProductStubs(createProducts(7), async () => {
        const middle = await get(
            createApp(),
            "/api/v1/product/?page=2&pageSize=2"
        );
        const last = await get(
            createApp(),
            "/api/v1/product/?page=3&pageSize=2"
        );

        assert.deepEqual(
            middle.body.data.map(product => product._id),
            ["product-5", "product-4"]
        );
        assert.deepEqual(
            last.body.data.map(product => product._id),
            ["product-3", "product-1"]
        );
        assert.equal(middle.body.pagination.totalPages, 3);
        assert.equal(last.body.pagination.totalItems, 6);
    });
});

test("empty results and pages beyond the end return empty data with metadata", async () => {
    await withProductStubs(createProducts(0), async () => {
        const empty = await get(createApp(), "/api/v1/product/");
        assert.equal(empty.statusCode, 200);
        assert.deepEqual(empty.body.data, []);
        assert.deepEqual(empty.body.pagination, {
            page: 1,
            pageSize: 10,
            totalItems: 0,
            totalPages: 0
        });
    });

    await withProductStubs(createProducts(3), async () => {
        const beyondEnd = await get(
            createApp(),
            "/api/v1/product/?page=3&pageSize=2"
        );
        assert.equal(beyondEnd.statusCode, 200);
        assert.deepEqual(beyondEnd.body.data, []);
        assert.deepEqual(beyondEnd.body.pagination, {
            page: 3,
            pageSize: 2,
            totalItems: 2,
            totalPages: 1
        });
    });
});

test("pagination rejects malformed page values before running database queries", async () => {
    for (const query of [
        "?page=abc",
        "?page=0",
        "?page=-1",
        "?page=1.5",
        "?page=1e2",
        "?page=1&page=2"
    ]) {
        await assertPaginationError(
            query,
            "page must be a positive integer"
        );
    }
});

test("the largest page within the offset bound is accepted", async () => {
    await withProductStubs(createProducts(0), async calls => {
        const response = await get(
            createApp(),
            "/api/v1/product/?page=100001&pageSize=1"
        );
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.body.data, []);
        assert.equal(response.body.pagination.page, 100001);
        assert.equal(calls.skip, 100000);
    });
});

test("pagination rejects unsafe and excessively large page values", async () => {
    for (const query of [
        "?page=9007199254740992",
        "?page=100002&pageSize=1"
    ]) {
        await assertPaginationError(query, "page is too large");
    }
});

test("pagination rejects malformed, zero, negative, and fractional pageSize values", async () => {
    for (const query of [
        "?pageSize=abc",
        "?pageSize=0",
        "?pageSize=-1",
        "?pageSize=1.5"
    ]) {
        await assertPaginationError(
            query,
            "pageSize must be a positive integer"
        );
    }
});

test("pagination rejects unsafe and excessively large pageSize values", async () => {
    for (const query of [
        "?pageSize=9007199254740992",
        "?pageSize=101",
        "?pageSize=1000000"
    ]) {
        await assertPaginationError(query, "pageSize is too large");
    }
});

test("database failures retain the endpoint's safe error response", async () => {
    const originalLogError = logger.logError;
    const logged = [];
    logger.logError = (...args) => logged.push(args);

    try {
        await withProductStubs(createProducts(2), async () => {
            const response = await get(createApp(), "/api/v1/product/");
            assert.equal(response.statusCode, 500);
            assert.deepEqual(response.body, {
                error: "Error getting products"
            });
        }, {
            countError: new Error("private database detail")
        });
    } finally {
        logger.logError = originalLogError;
    }

    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], "products.list.failed");
});
